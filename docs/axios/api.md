# 完整 API 参考

本页是 `AxiosWrapper` 的完整参考：构造函数、全部配置项、全部方法、返回值与错误语义。

```ts
import {
    AxiosWrapper,
    AxiosWrapperFactory,
    DebounceThrottleCancelError,
} from '@lania-tools/tools/axios-wrapper';
```

## 构造函数

```ts
new AxiosWrapper(
    config?: CreateAxiosDefaults,
    options?: WrapperOptions,
)
```

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `config` | `CreateAxiosDefaults` | 原样传给 `axios.create`（`baseURL`、`timeout`、`headers`…） |
| `options` | `WrapperOptions` | 本库的增强配置 |

构造时会：

1. 创建两个 axios 实例：`instance`（带拦截器）与 `retryInstance`（不带拦截器，专用于重试）；
2. 初始化所有 Manager；
3. 挂载请求 / 响应拦截器。

## `WrapperOptions`

### 并发

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `maxConcurrent` | `number` | `5` | 同时进行的请求上限；`<= 0` 或非数字时回退默认值 |

### 缓存

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `enableCache` | `boolean` | `false` | 是否缓存 GET 响应 |
| `cacheTTL` | `number` | 无 | 缓存有效期（毫秒）；不传 = 永不过期；`0` 也视为不过期 |

### 防抖与节流

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `enableDebounce` | `boolean` | `false` | 相同请求只保留最后一次 |
| `debounceInterval` | `number` | `300` | 防抖窗口（毫秒） |
| `enableThrottle` | `boolean` | `false` | 相同请求在窗口内只放行一次 |
| `throttleInterval` | `number` | `1000` | 节流窗口（毫秒） |

### 重试

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `enableRetry` | `boolean` | `false` | 是否自动重试 |
| `retryTimes` | `number` | `3` | 额外重试次数（不含首次） |
| `retryDelay` | `number` | `1000` | 每次重试前等待（毫秒） |

### Token 与认证

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `tokenProvider` | `() => string \| Promise<string>` | 返回当前 Access Token；返回空值时不设置 header |
| `enableDoubleToken` | `boolean` | 是否启用双 Token 自动刷新 |
| `getRefreshToken` | `() => string \| Promise<string>` | 返回当前 Refresh Token |
| `refreshAccessToken` | `(refreshToken: string) => string \| Promise<string>` | 执行刷新，返回新 Access Token |
| `accessTokenExpiredCodes` | `(number \| string)[]` | 触发刷新的业务 code |
| `refreshTokenExpiredCodes` | `(number \| string)[]` | 触发登出的业务 code |
| `onRefreshTokenExpired` | `() => void` | 刷新失败 / Refresh 过期时的回调 |

### 错误与响应处理

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `onError` | `(error: any) => void` | 最终失败时触发；取消 / 防抖 / 节流不触发 |
| `responseHandler` | `(response: AxiosResponse) => any` | 全局响应转换，**优先于** `codeHandlers` |
| `codeHandlers` | `Record<number \| string, (response) => any>` | 按业务 code 分派，1 秒内同 code 只执行一次 |
| `interceptors` | `{ request?: {...}; response?: {...} }` | 用户自定义拦截器 |

### 自定义拦截器结构

```ts
interface AxiosWrapperInterceptors {
    request?: {
        onFulfilled?: (config) => config | Promise<config>;
        onRejected?: (error) => any;
    };
    response?: {
        onFulfilled?: (response) => response | Promise<response>;
        onRejected?: (error) => any;
    };
}
```

## 类型

### `AxiosWrapperMethodConfig`

```ts
type AxiosWrapperMethodConfig = AxiosRequestConfig & {
    /** 自定义取消请求的唯一标识 */
    cancelTokenId?: string;
};
```

`request` / `get` / `post` / `put` / `delete` / `downloadFile` 的 config 都支持 `cancelTokenId`。

### `UploadFileOptions`

```ts
interface UploadFileOptions {
    maxConcurrent?: number;        // 保留字段（实际使用全局并发控制器）
    enableResume?: boolean;        // 断点续传
    calculateChunkMd5?: boolean;   // 计算分片 MD5
    getUploadedChunksUrl?: string; // 查询已上传分片的接口
    onChunkProgress?: (chunkIndex, totalChunks, loaded, total) => void;
    onProgress?: (finishedChunks, totalChunks) => void;
    cancelToken?: CancelTokenSource; // 由 Wrapper 注入
    cancelTokenId?: string;          // 取消标识
}
```

### `PollingConfig<T>`

```ts
interface PollingConfig<T> {
    key: string;
    url: string;
    config?: AxiosRequestConfig;
    onSuccess?: (res: AxiosResponse<T>) => void;
    onError?: (err: any) => void;
    interval?: number;         // 默认 5000
    maxPollingTimes?: number;  // 默认 3（含首次）
    method?: 'get' | 'post' | 'delete' | 'put';
}
```

### `DebounceThrottleCancelError`

```ts
class DebounceThrottleCancelError extends Error {
    isCancel: true;
    type: 'debounce' | 'throttle';
    name: 'CancelError';
}
```

同时满足 `axios.isCancel(error)` 与本库的 `error.isCancel` 判定。

## 实例方法

### `request<T>(config): Promise<AxiosResponse<T>>`

通用请求入口。

```ts
const response = await http.request<User[]>({
    url: '/users',
    method: 'get',
    params: { page: 1 },
    cancelTokenId: 'list',
});
```

行为：

1. 若传 `cancelTokenId`，创建并登记取消令牌；
2. 进入全局并发队列；
3. 请求结束后清理取消令牌（成功 / 失败 / 取消都会清理）。

### `get<T>(url, params?, config?)`

第二个参数是 **query params**。

```ts
await http.get<User[]>('/users', { page: 1 }, { cancelTokenId: 'list' });
```

`url` 为空时回退到 `config.url`；`params` 为 `undefined` 时回退到 `config.params`。

### `post<T>(url, data?, config?)`

```ts
await http.post<User>('/users', { name: 'Ada' });
```

### `put<T>(url, data?, config?)`

```ts
await http.put<User>('/users/1', { name: 'Ada' });
```

### `delete<T>(url, data?, config?)`

```ts
await http.delete<void>('/users/1');
```

### `uploadFile(url, file, options?): Promise<{ fileMd5, totalChunks }>`

```ts
const { fileMd5, totalChunks } = await http.uploadFile('/upload/chunk', file, {
    enableResume: true,
    getUploadedChunksUrl: '/upload/uploaded',
    calculateChunkMd5: true,
    cancelTokenId: 'upload-1',
    onProgress: (finished, total) => {},
});
```

详见 [大文件分片上传](/axios/upload)。

### `downloadFile(url, method?, filename?, config?): Promise<AxiosResponse<Blob>>`

```ts
await http.downloadFile('/export/report', 'get', 'report.xlsx', {
    cancelTokenId: 'export',
});
```

详见 [文件下载](/axios/download)。

### `startPolling<T>(config): void`

```ts
http.startPolling({
    key: 'job-1',
    url: '/jobs/1',
    interval: 2000,
    maxPollingTimes: 30,
    onSuccess: (res) => {},
});
```

立即执行第一次，不会返回 Promise。同 key 会先停止旧任务。

### `stopPolling(key): void`

```ts
http.stopPolling('job-1');
```

停止并清理定时器。未知 key 安全。

### `cancelRequest(tokenId): void`

```ts
http.cancelRequest('list');
```

取消并移除对应令牌。未知 id 安全。

### `cancelAllRequests(): void`

取消所有通过 `cancelTokenId` 注册的请求。未传 id 的请求不受影响。

### `clearCache(): void`

清空当前实例的缓存。

## `AxiosWrapperFactory`

```ts
AxiosWrapperFactory.create(
    name: string,
    config?: CreateAxiosDefaults,
    options?: WrapperOptions & { maxConcurrent?: number },
): AxiosWrapper
```

```ts
const userApi = AxiosWrapperFactory.create('user', { baseURL: '/user' }, { enableCache: true });
const same = AxiosWrapperFactory.create('user'); // 同一个实例
const other = AxiosWrapperFactory.create('file', { baseURL: '/file' });
```

| 行为 | 说明 |
| --- | --- |
| 同名首次调用 | 创建实例并缓存 |
| 同名再次调用 | 返回已有实例（`config` / `options` 被忽略） |
| 不同名 | 独立实例，独立的缓存 / 限流 / 取消令牌 |

> 工厂的 Map 是**静态、进程级**的。测试或按租户隔离时请使用唯一名称。

## 返回与错误语义

| 场景 | 返回 / 抛出 | `onError` |
| --- | --- | --- |
| 成功 | `AxiosResponse<T>` | 否 |
| 缓存命中 | `AxiosResponse`（`statusText: 'Cache Hit'`） | 否 |
| HTTP 4xx / 5xx | reject `AxiosError` | 是（重试耗尽后） |
| 网络错误 | reject `AxiosError` | 是（重试耗尽后） |
| 手动取消 | reject `CanceledError` | **否** |
| 防抖取消 | reject `DebounceThrottleCancelError` | **否** |
| 节流取消 | reject `DebounceThrottleCancelError` | **否** |
| 双 Token 刷新失败 | reject 原始错误 | 是 |
| Refresh Token 过期 | reject `Error('Refresh token expired')` | 是 |
| 防死循环 | reject `Error('Request already retried after refresh')` | 是 |
| 上传被取消 | reject `Error('Upload canceled by user signal.')` | 不适用 |

## 默认常量

| 常量 | 值 | 使用处 |
| --- | --- | --- |
| `MAX_CONCURRENT_REQUESTS` | `5` | 并发默认值 |
| `DEFAULT_MAX_RETRIES` | `3` | 重试默认值 |
| `DEFAULT_RETRY_DELAY` | `1000` | 重试间隔默认值 |
| `CHUNK_SIZE` | `5 * 1024 * 1024` | 分片大小 |

## 配置示例：完整生产配置

```ts
const http = new AxiosWrapper(
    {
        baseURL: import.meta.env.VITE_API_BASE,
        timeout: 15_000,
        headers: { 'X-Client': 'web' },
    },
    {
        // 并发
        maxConcurrent: 5,

        // 缓存
        enableCache: true,
        cacheTTL: 60_000,

        // 防抖（搜索类接口建议用工具层 debounce 精确控制）
        enableDebounce: false,

        // 重试
        enableRetry: true,
        retryTimes: 2,
        retryDelay: 500,

        // 认证
        tokenProvider: () => session.access,
        enableDoubleToken: true,
        getRefreshToken: () => session.refresh,
        refreshAccessToken: async (refreshToken) => {
            const { data } = await axios.post('/auth/refresh', { refreshToken });
            session.save(data.data);
            return data.data.accessToken;
        },
        accessTokenExpiredCodes: [40101],
        refreshTokenExpiredCodes: [40102],
        onRefreshTokenExpired: () => {
            session.clear();
            location.assign('/login');
        },

        // 错误与响应
        onError: (error) => reportError(error),
        codeHandlers: {
            50001: (res) => toast(res.data.message),
        },
    },
);
```
