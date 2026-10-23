# 拦截器管道

`InterceptorManager` 把一次请求拆成**固定顺序的中间件**。顺序不是随意排列的，每一步的位置都影响最终行为。

## 顺序与理由

### Request 链

| 顺序 | 中间件 | 为什么在这个位置 |
| --- | --- | --- |
| 1 | `tokenMiddleware` | 最早注入 Token，后续判定与日志都能看到最终 header |
| 2 | `cacheRequestMiddleware` | 命中缓存时不应消耗防抖 / 节流窗口 |
| 3 | `debounceMiddleware` | 先取消重复请求，再判断限频 |
| 4 | `throttleMiddleware` | 经过防抖后的请求才需要节流 |
| 5 | `customRequestMiddleware` | 用户拦截器最后执行，能看到前四步结果 |

### Response 链

| 顺序 | 中间件 | 为什么在这个位置 |
| --- | --- | --- |
| 1 | `flagMiddleware` | 先做业务 code 分派；双 Token 判定依赖未改写的 `data.code` |
| 2 | `doubleTokenMiddleware` | 确定过期后立即刷新并重放 |
| 3 | `customResponseMiddleware` | 用户看到的是「已刷新」的最终响应 |
| 4 | `cacheResponseMiddleware` | 最后写缓存，保证缓存的是最终数据 |

## 自定义拦截器

```ts
const http = new AxiosWrapper(
    { baseURL: '/api' },
    {
        interceptors: {
            request: {
                onFulfilled(config) {
                    config.headers.set('x-trace-id', crypto.randomUUID());
                    return config;
                },
                onRejected(error) {
                    if (error.status === 428) {
                        return error.config; // 返回 config = 已修复，继续请求
                    }
                    return Promise.reject(error);
                },
            },
            response: {
                onFulfilled(response) {
                    return response;
                },
                onRejected(error) {
                    if (error.response?.status === 404) {
                        return {
                            data: null,
                            status: 200,
                            statusText: 'OK',
                            headers: {},
                            config: error.config,
                            request: {},
                        };
                    }
                    return Promise.reject(error);
                },
            },
        },
    },
);
```

### 返回值语义

| 位置 | 返回 config | 返回响应 | `Promise.reject` |
| --- | --- | --- | --- |
| `request.onFulfilled` | 继续使用该 config | — | 进入错误处理 |
| `request.onRejected` | 用该 config 继续请求（必须带 `url`） | 视为无效，继续抛错 | 抛出 |
| `response.onFulfilled` | — | 替换响应 | 进入错误处理 |
| `response.onRejected` | 需带 `data` 才当作响应 | 作为成功结果返回 | 抛出 |

## 请求错误恢复

### Axios 1.x 的关键行为

```js
instance.interceptors.request.use(
    async () => { throw new Error('boom'); },
    async () => { /* 不会执行 */ },
);
```

`onFulfilled` 抛出的错误**不会**回调同一个 `.then` 的 rejection 处理器。因此本库：

```ts
async (config) => {
    const ctx = { config };
    try {
        await this.runRequestMiddlewares(ctx);
        return ctx.config;
    } catch (err) {
        return this.handleRequestError(err, ctx.config);
    }
}
```

`handleRequestError`：

1. 缓存命中错误 → 转成功响应；
2. 取消错误 → 直接 reject；
3. 补齐 `err.config`；
4. 调用用户 `onRejected`，返回 config 则继续请求；
5. 否则 reject。

外层 `onRejected` 仅作为其他拦截器抛错的兜底入口。

### 响应错误恢复

同样的问题也存在于响应侧：`doubleTokenMiddleware` 抛错（例如刷新失败）不会回调本拦截器的 `onRejected`。因此：

```ts
async (response) => {
    const ctx = { response };
    try {
        await this.runResponseMiddlewares(ctx);
        return ctx.response;
    } catch (err) {
        return this.handleResponseError(err);
    }
}
```

`handleResponseError`：

1. 取消 → reject；
2. 用户 `onRejected` 返回响应 → 作为成功结果；
3. `enableRetry` → 重试；
4. 仍失败 → `onError(error)` → reject。

这保证 `onError` **只触发一次**。

## 业务 code 处理

```ts
const http = new AxiosWrapper(
    { baseURL: '/api' },
    {
        codeHandlers: {
            40101: () => router.push('/login'),
            50001: (res) => {
                toast(res.data.message);
                return { ...res, data: null };
            },
        },
    },
);
```

规则：

1. `responseHandler` 存在时优先执行，`codeHandlers` 被跳过；
2. key 会被转成字符串匹配；
3. 同一个 code 在 **1 秒内只执行一次**（锁在 1 秒后释放）；
4. 返回 `undefined` 保留原响应；返回对象则替换响应。

### 为什么需要锁

一个页面同时发出 6 个请求全部返回「登录已过期」时，没有锁就会出现 6 个提示框或 6 次跳转。

```text
第一次 40101 → 加锁 → 执行处理器
1 秒内的 40101 → 命中锁 → 跳过
1 秒后 → 锁释放
```

注意：锁是**时间窗口**语义，不是「只执行一次」。如果错误持续超过 1 秒，第二次仍会执行。

## `responseHandler` 与 `codeHandlers` 的关系

```ts
if (responseHandler) {
    const res = responseHandler(ctx.response);
    res && (ctx.response = res);
    return; // 不再执行 codeHandlers
}
```

`responseHandler` 适合统一解包：

```ts
responseHandler: (response) => ({
    ...response,
    data: response.data.data,
}),
```

但要注意：**双 Token 判定读取的是 `response.data.code`**。一旦解包，`code` 可能不存在。因此使用 `responseHandler` 时应关闭 `enableDoubleToken`，或保留 `code` 字段：

```ts
responseHandler: (response) => ({
    ...response,
    data: { ...response.data.data, code: response.data.code },
}),
```

## 取消错误识别

```ts
private isCancelError(err: any): boolean {
    return (
        err instanceof DebounceThrottleCancelError ||
        err?.isCancel === true ||
        axios.isCancel(err)
    );
}
```

命中后：

- 不进入重试；
- 不调用 `onError`；
- 直接 reject。

## 完整执行图

```text
请求
 │
 ├ tokenMiddleware            tokenProvider()
 ├ cacheRequestMiddleware     命中 → adapter = fake
 ├ debounceMiddleware        同 Key 旧请求 reject
 ├ throttleMiddleware        冷却期内 reject
 ├ customRequestMiddleware   用户 onFulfilled
 │    └ 抛错 → handleRequestError
 ▼
HTTP
 ▼
 ├ flagMiddleware            responseHandler / codeHandlers
 ├ doubleTokenMiddleware     过期 → 刷新 → 重放
 ├ customResponseMiddleware  用户 onFulfilled
 ├ cacheResponseMiddleware   非缓存命中才写入
 │
 └ 抛错 → handleResponseError
      ├ 取消 → reject
      ├ 用户 onRejected → 响应
      ├ 重试 → 响应
      └ onError → reject
```

## 示例：请求追踪

```ts
import { AxiosWrapper } from '@lania-tool/tools/axios-wrapper';

const http = new AxiosWrapper(
    { baseURL: '/api' },
    {
        interceptors: {
            request: {
                onFulfilled(config) {
                    const traceId = crypto.randomUUID();
                    config.headers.set('x-trace-id', traceId);
                    (config as any).__startedAt = performance.now();
                    return config;
                },
            },
            response: {
                onFulfilled(response) {
                    const startedAt = (response.config as any).__startedAt ?? 0;
                    console.debug(
                        `${response.config.method?.toUpperCase()} ${response.config.url}`,
                        `${Math.round(performance.now() - startedAt)}ms`,
                    );
                    return response;
                },
            },
        },
    },
);
```

## 测试覆盖

- 请求错误恢复：`wrapper.integration.test.ts > recovers from a request interceptor error`
- 响应错误恢复：`recovers from a response error by returning a synthetic response`
- 业务 code 锁：`runs a matching business code handler exactly once under concurrency`
- `responseHandler` 优先：`responseHandler takes precedence over codeHandlers`
- 取消不触发 `onError`：`does not call onError for debounce/throttle cancellations`
