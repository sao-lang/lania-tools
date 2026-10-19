# 错误处理与排错

请求层的错误来源很多，先分清类型再决定处理方式。

## 错误分类

| 来源 | 错误对象 | 会重试 | 触发 `onError` | 进入自定义 `onRejected` |
| --- | --- | --- | --- | --- |
| 网络错误 / 超时 | `AxiosError`（`code: 'ERR_NETWORK'` / `'ECONNABORTED'`） | 是（若开启） | 是（重试耗尽后） | 是 |
| HTTP 4xx / 5xx | `AxiosError`（带 `response`） | 是（若开启） | 是 | 是 |
| 业务 code 错误 | 正常响应，不是错误 | 否 | 否 | 否 |
| 手动取消 | `CanceledError` | 否 | **否** | 否 |
| 防抖取消 | `DebounceThrottleCancelError` | 否 | **否** | 否 |
| 节流取消 | `DebounceThrottleCancelError` | 否 | **否** | 否 |
| 双 Token 刷新失败 | 原始错误 | 否 | 是 | 是 |
| Refresh Token 过期 | `Error('Refresh token expired')` | 否 | 是 | 是 |
| 刷新死循环保护 | `Error('Request already retried after refresh')` | 否 | 是 | 是 |
| 上传取消 | `Error('Upload canceled by user signal.')` | 否 | 不适用 | 不适用 |

## 错误对象结构

### `AxiosError`

```ts
{
    message: 'Request failed with status code 500',
    code: 'ERR_BAD_RESPONSE',
    config: InternalAxiosRequestConfig,
    request: XMLHttpRequest | ClientRequest,
    response?: {
        data: any,
        status: number,
        statusText: string,
        headers: AxiosHeaders,
        config,
    },
    isAxiosError: true,
}
```

### 取消错误

```ts
// axios 原生
{ name: 'CanceledError', message: 'canceled', __CANCEL__: true }

// 防抖 / 节流
{
    name: 'CancelError',
    message: 'Request canceled by debounce',
    isCancel: true,
    type: 'debounce',
}
```

统一判定：

```ts
function isCancel(error: any) {
    return axios.isCancel(error) || error?.isCancel === true;
}
```

### 自定义错误

| 消息 | 触发条件 |
| --- | --- |
| `Missing refresh token.` | `getRefreshToken` 返回空 |
| `No refreshAccessToken provided` | 未配置刷新函数 |
| `Invalid new access token.` | 刷新返回非字符串 / 空串 |
| `Refresh token expired` | 响应 code 命中 `refreshTokenExpiredCodes` |
| `Request already retried after refresh` | 重放后仍过期 |
| `Upload canceled by user signal.` | 上传过程中被取消 |

## 全局错误处理

```ts
const http = new AxiosWrapper(
    { baseURL: '/api' },
    {
        onError: (error) => {
            // 这里不会收到取消类错误
            if (error.response?.status === 401) {
                redirectToLogin();
                return;
            }
            reportToSentry(error);
            toast.error(error.message || '网络异常');
        },
    },
);
```

`onError` 的触发时机：

```text
响应失败
  ├─ 取消 → 不触发
  ├─ 自定义 onRejected 恢复 → 不触发
  ├─ 重试成功 → 不触发
  └─ 最终失败 → 触发一次 → reject
```

## 单请求错误处理

```ts
try {
    const { data } = await http.get('/users', { page: 1 });
} catch (error) {
    if (axios.isCancel(error)) return;           // 取消
    if ((error as any).isCancel) return;         // 防抖 / 节流
    if ((error as any).response?.status === 404) return [];
    throw error;
}
```

### TypeScript 类型收窄

```ts
import axios, { AxiosError } from 'axios';

catch (error) {
    if (axios.isAxiosError<{ code: number; message: string }>(error)) {
        const message = error.response?.data?.message ?? error.message;
        console.error(message);
    }
}
```

## 业务错误处理

两种风格：

### A. 业务 code 统一在拦截器处理

```ts
codeHandlers: {
    50001: (response) => {
        toast.error(response.data.message);
        return { ...response, data: null };
    },
},
```

调用方拿到 `data: null`，不需要写 `if (code !== 0)`。

### B. 业务 code 留给调用方

```ts
const { data } = await http.get<ApiResponse<User>>('/user/1');
if (data.code !== 0) throw new Error(data.message);
```

两者不要混用，否则容易出现「拦截器已提示，页面又提示一次」。

## 调试技巧

### 1. 打印请求耗时与追踪 ID

```ts
interceptors: {
    request: {
        onFulfilled(config) {
            config.headers.set('x-trace-id', crypto.randomUUID());
            (config as any).__startedAt = performance.now();
            return config;
        },
    },
    response: {
        onFulfilled(response) {
            console.debug(
                `${response.config.method?.toUpperCase()} ${response.config.url}`,
                Math.round(performance.now() - (response.config as any).__startedAt),
                'ms',
            );
            return response;
        },
        onRejected(error) {
            console.error(
                `${error.config?.method?.toUpperCase()} ${error.config?.url}`,
                error.message,
            );
            return Promise.reject(error);
        },
    },
}
```

### 2. 判断是否命中缓存

```ts
if (response.statusText === 'Cache Hit') {
    console.debug('from cache');
}
```

### 3. 查看重试次数

```ts
if (error.config?.__retryCount) {
    console.debug('retried', error.config.__retryCount, 'times');
}
```

### 4. 定位为什么没有刷新 Token

检查清单：

1. `enableDoubleToken` 是否为 `true`？
2. `accessTokenExpiredCodes` 是否包含实际 code（数字 / 字符串要一致）？
3. 响应是否是 HTTP 200？401 不会触发。
4. `responseHandler` 是否把 `code` 解包掉了？
5. 是否命中了缓存（没发请求）？

### 5. 定位为什么没有重试

1. `enableRetry` 是否为 `true`？
2. `retryTimes` 是否 > 0？
3. 失败是否发生在网络层？
4. 是否被取消（取消不重试）？
5. 是否在等待 `retryDelay` 期间被取消？

## 常见问题速查

| 现象 | 可能原因 |
| --- | --- |
| 请求发出但 `onError` 没触发 | 被自定义 `onRejected` 恢复了，或重试成功 |
| 取消后页面出现错误提示 | `catch` 中没有过滤取消错误 |
| 防抖后拿到错误 | 防抖会 reject 被覆盖的请求，需要 `catch` |
| 缓存不生效 | 参数对象 key 顺序不同？`data` 为 `undefined`？`enableCache` 未开启？ |
| 缓存串数据 | 业务响应被错误解包（已修复，确认版本） |
| 并发数没下降 | 任务永久挂起；检查 `timeout` |
| 上传卡住 | `maxConcurrent` 太小 + 分片多；或服务端未响应 |
| 刷新后仍 401 | 重放被 `tokenProvider` 覆盖（已修复）；或新 token 本身无效 |
| 刷新接口被调用多次 | 单例被提前清空；检查是否在 `refreshAccessToken` 内部抛错 |
| 下载文件名乱码 | 服务端未发送 `filename*` |

## 日志与上报建议

```ts
function reportError(error: any) {
    const payload = {
        message: error?.message,
        url: error?.config?.url,
        method: error?.config?.method,
        status: error?.response?.status,
        code: error?.response?.data?.code,
        retryCount: error?.config?.__retryCount ?? 0,
        traceId: error?.config?.headers?.['x-trace-id'],
    };
    // 过滤掉敏感字段（Authorization 等）
    void fetch('/api/log/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
}
```

不要上报：

- `Authorization`、Cookie、请求体中的密码；
- 完整的响应体（可能包含个人信息）。

## 相关测试

| 行为 | 测试 |
| --- | --- |
| 取消不触发 `onError` | `does not call onError for debounce/throttle cancellations` |
| 重试成功不触发 `onError` | `retries failed requests until they succeed` |
| 重试耗尽只触发一次 | `rejects after the retry budget is exhausted` |
| 刷新失败触发 `onError` | `logs out when the refresh endpoint rejects the refresh token` |
| 错误恢复不触发 `onError` | `recovers from a response error by returning a synthetic response` |
