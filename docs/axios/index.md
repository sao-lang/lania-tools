# 架构与请求生命周期

`AxiosWrapper` 不是对 axios 的简单包装，而是把请求层的**横切关注点**组织成一条可预测的流水线。

## 一句话定位

> 一次配置，统一并发、缓存、防抖节流、重试、取消、双 Token、轮询、分片上传与下载，并且每一步都能解释清楚。

## 最小示例

```ts
import { AxiosWrapper } from '@lania-tools/tools/axios-wrapper';

const http = new AxiosWrapper(
    { baseURL: '/api', timeout: 10_000 },
    {
        maxConcurrent: 5,
        enableCache: true,
        cacheTTL: 30_000,
        enableRetry: true,
        retryTimes: 2,
        tokenProvider: () => localStorage.getItem('access_token') ?? '',
        onError: (error) => console.error('[http]', error),
    },
);

const { data } = await http.get<User[]>('/users', { page: 1 });
```

## 模块全景

```text
AxiosWrapper
│
├── 编排层（index.ts）
│   ├── get / post / put / delete / request
│   ├── uploadFile / downloadFile
│   ├── startPolling / stopPolling
│   └── cancelRequest / cancelAllRequests / clearCache
│
├── 管道层（InterceptorManager）
│   ├── Request：token → cache → debounce → throttle → custom
│   └── Response：flag → doubleToken → custom → cache
│
├── 能力层
│   ├── GlobalConcurrencyController  全局限流（请求 + 上传 + 轮询共享）
│   ├── CacheManager                 缓存与 TTL
│   ├── DebounceThrottleManager      防抖 / 节流
│   ├── CancelTokenManager           按 id 取消
│   ├── PollingManager               轮询
│   └── UploadManager                分片上传
│
├── 工具层
│   ├── helper.ts                    请求 Key 稳定序列化
│   ├── const.ts                     默认常量
│   └── md5-calculator.worker.ts     Worker 分片 MD5
│
└── 工厂层
    └── AxiosWrapperFactory          按名称复用实例
```

## 请求生命周期（成功路径）

```text
http.get('/users', { page: 1 })
 │
 ├─ ① AxiosWrapper.request()
 │    ├─ 有 cancelTokenId → CancelToken.source() → CancelTokenManager.set(id, source)
 │    └─ GlobalConcurrencyController.run(() => instance(config))
 │
 ├─ ② Request 拦截器
 │    ├─ tokenMiddleware           tokenProvider() → Authorization: Bearer ...
 │    ├─ cacheRequestMiddleware    命中 → config.adapter = () => fakeResponse
 │    ├─ debounceMiddleware        同 Key 旧请求 reject(CancelError)
 │    ├─ throttleMiddleware        冷却期内 reject(CancelError)
 │    └─ customRequestMiddleware   用户 onFulfilled
 │
 ├─ ③ 网络（除非缓存命中）
 │
 ├─ ④ Response 拦截器
 │    ├─ flagMiddleware            responseHandler → codeHandlers（1s 锁）
 │    ├─ doubleTokenMiddleware     业务 code 过期 → 刷新 → 重放
 │    ├─ customResponseMiddleware  用户 onFulfilled
 │    └─ cacheResponseMiddleware   非缓存命中才写缓存
 │
 ├─ ⑤ finally：清理取消令牌
 │
 └─ ⑥ 返回 AxiosResponse<T>
```

## 请求生命周期（失败路径）

```text
Request 阶段抛错
  ├─ 取消（手动 / 防抖 / 节流） → reject，不进入 onError
  ├─ 自定义 onRejected 返回 config → 用该 config 继续 dispatch
  └─ 其他 → reject

Response 阶段抛错
  ├─ 取消 → reject（不重试、不 onError）
  ├─ 自定义 onRejected 返回响应 → 作为成功结果返回
  ├─ enableRetry → 重试（无拦截器实例，最多 retryTimes 次）
  └─ 仍失败 → onError(error) → reject
```

## 五个关键设计

### 1. 缓存命中替换 `adapter`

Axios 的请求拦截器只能修改 config，不能直接返回响应。`Promise.reject(fakeResponse)` 会被当作 config 继续 dispatch，导致真实请求或异常。因此命中缓存时：

```ts
ctx.config.adapter = async () => fakeResponse;
```

请求不离开进程，同时完整经过响应拦截器链。

详见 [缓存](/axios/cache)。

### 2. 重试使用无拦截器实例

用 `this.instance(config)` 重试会再次进入 `retryMiddleware`，形成递归与重复 `onError`。内部维护 `retryInstance`：

```ts
while (config.__retryCount < maxRetries) {
    config.__retryCount += 1;
    await delay(retryDelay);
    return await concurrencyController.run(() => retryInstance(config));
}
```

详见 [重试与取消](/axios/retry-and-cancel)。

### 3. 刷新使用 Promise 单例

并发过期请求必须合并为一次刷新，否则 Refresh Token 轮换会导致后续刷新失败。`onRefreshTokenExpired` 也放在单例内部，保证一次失败只通知一次。

详见 [双 Token 刷新](/axios/double-token)。

### 4. 上传重试在并发槽位之外

在 `run()` 内部递归 `run()` 会在 `maxConcurrent = 1` 时自锁。重试循环放在槽位外，每次尝试单独占槽。

详见 [大文件分片上传](/axios/upload)。

### 5. 异步拦截器错误要手动转发

Axios 1.x 中，async 请求/响应拦截器的 `onFulfilled` 抛错不会回调同一个拦截器的 `onRejected`。本库用 `handleRequestError` / `handleResponseError` 在 `onFulfilled` 的 catch 中统一处理。

详见 [拦截器管道](/axios/interceptors)。

## 功能索引

| 想做什么 | 配置 / 方法 | 文档 |
| --- | --- | --- |
| 限制同时请求数 | `maxConcurrent` | [并发控制](/axios/concurrency) |
| 缓存读接口 | `enableCache` + `cacheTTL` | [缓存](/axios/cache) |
| 搜索防抖 | `enableDebounce` 或工具层 `debounce` | [防抖与节流](/axios/debounce-throttle) |
| 滚动节流 | `enableThrottle` | [防抖与节流](/axios/debounce-throttle) |
| 失败重试 | `enableRetry` + `retryTimes` | [重试与取消](/axios/retry-and-cancel) |
| 取消请求 | `cancelTokenId` + `cancelRequest` | [重试与取消](/axios/retry-and-cancel) |
| Token 自动续期 | `enableDoubleToken` | [双 Token 刷新](/axios/double-token) |
| 轮询任务状态 | `startPolling` | [轮询](/axios/polling) |
| 上传大文件 | `uploadFile` | [大文件分片上传](/axios/upload) |
| 导出下载 | `downloadFile` | [文件下载](/axios/download) |
| 统一错误上报 | `onError` | [错误处理](/axios/errors) |
| 统一业务 code 处理 | `codeHandlers` | [拦截器管道](/axios/interceptors) |
| 多后端实例 | `AxiosWrapperFactory` | [完整 API](/axios/api) |

## 完整 API

所有配置项、方法签名、返回值与错误语义见 [完整 API 参考](/axios/api)。

## 注意事项

| 问题 | 说明 |
| --- | --- |
| 实例级状态 | 缓存、限流、防抖、取消令牌都是实例级；不同实例互不影响 |
| 并发共享 | 请求、上传、轮询共享同一个并发控制器 |
| 双 Token 范围 | 只识别 HTTP 200 + 业务 code |
| 缓存与鉴权 | 缓存命中不会发网络请求，也就不会触发 Token 刷新 |
| 重试幂等性 | 只对幂等请求开启 |
| 取消 | 取消是 reject，不是 resolve |
