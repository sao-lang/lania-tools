# AxiosWrapper — Axios 增强封装

## 架构全景

```
AxiosWrapper
│
├── 核心编排层
│   └── AxiosWrapper (index.ts)          — 统筹所有 Manager，暴露 public API
│
├── 拦截器管道 (InterceptorManager.ts)
│   ├── Request 拦截器（按顺序执行）
│   │   ├── tokenMiddleware              — 自动注入 Bearer Token
│   │   ├── cacheRequestMiddleware        — 缓存命中 → 短路返回
│   │   ├── debounceMiddleware           — 相同请求防抖
│   │   ├── throttleMiddleware           — 相同请求节流
│   │   └── customRequestMiddleware      — 用户自定义请求拦截器
│   │
│   └── Response 拦截器（按顺序执行）
│       ├── flagMiddleware               — 业务 code 处理器 + 响应数据转换
│       ├── doubleTokenMiddleware        — 双 Token 自动刷新
│       ├── customResponseMiddleware     — 用户自定义响应拦截器
│       └── cacheResponseMiddleware      — 写入缓存
│
├── 功能层 (各个 Manager)
│   ├── CacheManager                     — 请求缓存（TTL + 稳定 Key 序列化）
│   ├── DebounceThrottleManager          — 防抖/节流（基于 Promise 的取消机制）
│   ├── GlobalConcurrencyController      — 全局并发控制（队列 + 调度器）
│   ├── CancelTokenManager               — 请求取消（按 ID 取消/全部取消）
│   ├── PollingManager                   — 轮询（定时 + 最大次数 + 并发控制）
│   └── UploadManager                    — 文件上传（分片/断点续传/MD5/Web Worker）
│
├── 工具层
│   ├── helper.ts                        — 请求 Key 稳定序列化（stableStringify）
│   ├── const.ts                         — 默认常量（CHUNK_SIZE=5MB, RETRY=3, DELAY=1s）
│   └── md5-calculator.worker.ts         — Web Worker 分片 MD5 计算
│
└── 工厂层
    └── AxiosWrapperFactory              — 多实例工厂（按 name 缓存 Wrapper 实例）
```

---

## 一次请求的完整生命周期

理解这个流程是理解整个 AxiosWrapper 架构的关键。以下是一次 `GET` 请求从发起到返回的完整路径：

```
AxiosWrapper.get('/api/users', { page: 1 })
    │
    ├─ 1. request() 方法
    │   ├─ 注册 CancelToken（如果传了 cancelTokenId）
    │   └─ 放入 GlobalConcurrencyController.run() 队列
    │
    ├─ 2. Request Interceptor 链
    │   │
    │   ├─ [tokenMiddleware]
    │   │   └─ 调用 tokenProvider() 获取 Token
    │   │   └─ 设置 config.headers.Authorization = `Bearer ${token}`
    │   │
    │   ├─ [cacheRequestMiddleware]
    │   │   └─ 生成请求 Key → 查询 CacheManager
    │   │   └─ 命中 → 构造 fakeResponse { __fromCache: true }
    │   │   └─ Promise.reject(fakeResponse) → 跳转到 Request Error Handler
    │   │       └─ 检测到 __fromCache → Promise.resolve(fakeResponse) → 进入 Response 链
    │   │
    │   ├─ [debounceMiddleware]
    │   │   └─ 生成请求 Key → 检查 DebounceThrottleManager
    │   │   └─ 如果已有相同请求在等待：
    │   │       ├─ 取消旧的（reject CancelError）
    │   │       └─ 启动新的倒计时
    │   │   └─ 等待 delay 毫秒 → 放行 config
    │   │
    │   ├─ [throttleMiddleware]
    │   │   └─ 生成请求 Key → 检查上次执行时间
    │   │   └─ 在冷却期内 → reject CancelError（被 isCancelError 捕获）
    │   │   └─ 不在冷却期 → 更新时间戳 → 放行 config
    │   │
    │   └─ [customRequestMiddleware]
    │       └─ 执行用户自定义 request.onFulfilled 拦截器
    │
    ├─ 3. 实际网络请求
    │   └─ axios 发起 HTTP 请求
    │
    ├─ 4. Response Interceptor 链
    │   │
    │   ├─ [flagMiddleware]
    │   │   ├─ responseHandler 存在 → 执行全局响应转换
    │   │   └─ codeHandlers 存在 → 匹配业务 code：
    │   │       ├─ 有锁（errorLocks）→ 跳过（防止重复弹窗）
    │   │       └─ 无锁 → 加锁 → 执行 handler → 1s 后解锁
    │   │
    │   ├─ [doubleTokenMiddleware]
    │   │   └─ 检测 code 是否为 accessTokenExpiredCodes
    │   │   └─ 是 → 调用 AxiosWrapper.requestWithRefreshToken()
    │   │       ├─ Promise 单例模式：防止并发请求同时刷新 Token
    │   │       ├─ 调用 refreshAccessToken(refreshToken)
    │   │       ├─ 更新 Authorization Header
    │   │       └─ 重试原请求（标记 __gotAccessToken 防死循环）
    │   │
    │   ├─ [customResponseMiddleware]
    │   │   └─ 执行用户自定义 response.onFulfilled 拦截器
    │   │
    │   └─ [cacheResponseMiddleware]
    │       └─ 非缓存命中 → 写入 CacheManager（带 TTL）
    │
    └─ 5. 返回结果
        └─ 返回 AxiosResponse<T> 给调用方
```

---

## 各 Manager 详解

### 1. GlobalConcurrencyController — 全局并发控制

**核心问题：** 规定同时进行的请求数为 5，但前端可能同时发起 20+ 个请求。如果大量请求同时发出，会导致后续请求排队等待 TCP 连接，用户体验差。

**解决方案：** 用一个队列控制同时进行的请求数，超出限制的请求排队等待。

```plaintext
┌─────────────────────────────────────────────────────────┐
│              GlobalConcurrencyController                │
│                                                         │
│  maxConcurrent = 5                                      │
│  activeCount   = 4    (当前正在执行的请求数)               │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  queue: [task7, task8, task9, ...]              │    │
│  │         等待中的请求                              │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  run(task) 流程:                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  if (activeCount < maxConcurrent)                │   │
│  │    → activeCount++ → 立即执行 task()              │   │
│  │    → finally: activeCount-- → scheduleNext()     │   │
│  │  else                                            │   │
│  │    → 将 {task, resolve, reject} 推入 queue        │   │
│  │    → 返回 Promise（resolve/reject 由队列消费）      │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  scheduleNext():                                        │
│    queue.shift() → 取出队首任务 → executeTask()           │
└─────────────────────────────────────────────────────────┘
```

**关键设计：**

- **队列存储 `{task, resolve, reject}` 三元组**：不是简单地存储任务函数，而是把 Promise 的 `resolve/reject` 一并存储。这样当任务被调度执行时，可以把结果传递给正在等待的 Promise。
- **`scheduleNext()` 在 finally 中触发**：确保每个任务完成后立即尝试启动下一个排队任务。
- **`run()` 方法有两路返回**：有空闲槽位时直接 `await task()`；无空闲槽位时返回一个新 Promise，等待队列调度。

**源码位置：** [GlobalConcurrencyController.ts](file:///c:/Users/30895/Desktop/lania-zip/lania-tools/packages/tools/src/axios/GlobalConcurrencyController.ts)

---

### 2. CacheManager — 请求缓存

**核心问题：** 短时间内多次请求相同接口（如多个组件同时请求用户信息），每次都要走网络，浪费带宽和时间。

**解决方案：** 基于请求指纹的缓存，支持 TTL 过期。

```
┌───────────────────────────────────────────┐
│              CacheManager                  │
│                                            │
│  cache: Map<key, { data, expireAt }>      │
│                                            │
│  get(config)                               │
│  ├─ key = generateRequestKey(config)      │
│  ├─ 查 Map                                 │
│  ├─ 命中 & 未过期 → 返回 data              │
│  ├─ 命中 & 已过期 → 删除 → 返回 null       │
│  └─ 未命中 → 返回 null                     │
│                                            │
│  set(config, data, ttl?)                   │
│  ├─ key = generateRequestKey(config)      │
│  └─ cache.set(key, { data, expireAt })    │
│                                            │
│  clear()                                   │
│  └─ cache.clear()                          │
└───────────────────────────────────────────┘
```

**请求指纹生成（helper.ts）：**

```
generateRequestKey(config)
  ├─ method: config.method → "get"
  ├─ url: config.url → "/api/users"
  ├─ params: stableStringify(config.params) → '{"page":1,"size":10}'
  ├─ data: stableStringify(config.data) → ""
  └─ 拼接: "get:/api/users:{"page":1,"size":10}:"
```

`stableStringify` 是关键：它对对象的 key 进行排序后再序列化，确保 `{a:1,b:2}` 和 `{b:2,a:1}` 生成相同的字符串。

**缓存命中的特殊处理：** 缓存命中后不是直接返回，而是构造一个 `{ __fromCache: true }` 的假 response 对象，通过 `Promise.reject` 抛到 Request Error Handler，然后被 `isCacheHitError` 检测到并转为 `Promise.resolve`，进入 Response 拦截器链。这样做的目的是让缓存响应也能经过 `flagMiddleware`、`customResponseMiddleware` 等中间件处理。

**源码位置：** [CacheManager.ts](file:///c:/Users/30895/Desktop/lania-zip/lania-tools/packages/tools/src/axios/CacheManager.ts) | [helper.ts](file:///c:/Users/30895/Desktop/lania-zip/lania-tools/packages/tools/src/axios/helper.ts)

---

### 3. DebounceThrottleManager — 防抖与节流

**核心问题：** 用户快速点击"保存"按钮 3 次，发起 3 个相同的 POST 请求，后端可能创建 3 条重复数据。

**解决方案：** 在请求层面实现防抖和节流，相同请求指纹的重复调用被取消。

```
防抖（Debounce）：
  请求 A ──────────────────────────────────────→ 执行
  请求 B ──→ 取消 A ──→ 等待 300ms ──→ 执行
  请求 C ──→ 取消 B ──→ 等待 300ms ──→ 执行

节流（Throttle）：
  请求 A ──→ 执行 ──→ 记录时间戳
  请求 B ──→ 距上次 < 1000ms ──→ 拒绝
  请求 C ──→ 距上次 < 1000ms ──→ 拒绝
  请求 D ──→ 距上次 >= 1000ms ──→ 执行
```

**防抖实现细节：**

```
debounceMap: Map<key, { resolve, reject, timer }>

debounceRequest(req, delay):
  1. key = generateRequestKey(req)
  2. 如果 debounceMap 中已有 key：
     ├─ clearTimeout(旧 timer)
     └─ 旧.reject(CancelError)  ← 取消旧请求的 Promise
  3. 创建新 timer = setTimeout(() => {
       debounceMap.delete(key)
       resolve(req)  ← 放行当前请求
     }, delay)
  4. 返回 Promise<AxiosRequestConfig>
```

**自定义错误类型：** `DebounceThrottleCancelError` 继承自 `Error`，设置 `isCancel = true` 兼容 Axios 的 `axios.isCancel()` 检测机制。在 `InterceptorManager.isCancelError()` 中统一判定。

**源码位置：** [DebounceThrottleManager.ts](file:///c:/Users/30895/Desktop/lania-zip/lania-tools/packages/tools/src/axios/DebounceThrottleManager.ts)

---

### 4. InterceptorManager — 拦截器管道

这是整个 AxiosWrapper 最核心的模块，将所有 Manager 串联成一个**中间件管道**。

**架构设计：**

```
InterceptorManager
│
├── attachInterceptors()  ← 构造函数中调用，挂载到 Axios 实例
│
├── Request Interceptor (onFulfilled)
│   └── runRequestMiddlewares()  ← 按顺序执行中间件数组
│       ├── tokenMiddleware
│       ├── cacheRequestMiddleware   ← 缓存命中 → Promise.reject(fakeResponse)
│       ├── debounceMiddleware       ← 可能 reject CancelError
│       ├── throttleMiddleware       ← 可能 reject CancelError
│       └── customRequestMiddleware
│
├── Request Interceptor (onRejected)
│   └── runRequestErrorMiddlewares()
│       ├── 检测 isCacheHitError → Promise.resolve(fakeResponse) → 进入 Response 链
│       ├── 检测 isCancelError → 直接 reject（不触发后续错误处理）
│       └── customRequestErrorMiddleware
│
├── Response Interceptor (onFulfilled)
│   └── runResponseMiddlewares()
│       ├── flagMiddleware           ← 业务 code 处理 + 响应转换
│       ├── doubleTokenMiddleware    ← 双 Token 刷新
│       ├── customResponseMiddleware
│       └── cacheResponseMiddleware  ← 写入缓存
│
└── Response Interceptor (onRejected)
    └── runResponseErrorMiddlewares()
        ├── 检测 isCancelError → 直接 reject
        ├── customResponseErrorMiddleware
        └── retryMiddleware          ← 自动重试
```

**关键设计决策：**

**1. 缓存命中为何走 `Promise.reject` 路径？**

Axios 的拦截器机制：Request `onFulfilled` 返回 `config` 会继续请求，返回 `Promise.reject` 会跳过请求直接进入 `onRejected`。如果缓存命中后在 `onFulfilled` 中 `Promise.resolve(response)`，Axios 仍然会发起网络请求（因为它只认 `config`）。

所以缓存命中必须走 `Promise.reject` → Request `onRejected` → 检测 `__fromCache` → `Promise.resolve` → 进入 Response `onFulfilled` 链。这条路径看起来绕，但这是 Axios 拦截器机制下唯一能让缓存数据经过完整 Response 中间件链的方式。

**2. 中间件如何传递上下文？**

每个中间件接收一个 `ctx` 对象（`{ config }` 或 `{ response }` 或 `{ err }`），通过修改 `ctx` 的属性来传递数据。这是标准的中间件模式。

**3. 错误锁（errorLocks）机制：**

`flagMiddleware` 中，对每种业务错误码维护一个 `Set<string>` 锁。处理某个错误码时加锁，1 秒后自动解锁。防止短时间内多次触发同一个错误处理（如多次弹窗 "无权限"）。

**源码位置：** [InterceptorManager.ts](file:///c:/Users/30895/Desktop/lania-zip/lania-tools/packages/tools/src/axios/InterceptorManager.ts)

---

### 5. 双 Token 刷新机制

**核心问题：** Access Token 过期后，需要自动用 Refresh Token 获取新 Token，并重试原请求。多个并发请求同时遇到 401 时，只需要刷新一次 Token。

**解决方案：** Promise 单例模式。

```
┌────────────────────────────────────────────────────────────┐
│              双 Token 刷新流程                              │
│                                                            │
│  请求 A ──→ 401 ──→ 检测到 accessTokenExpired ──→         │
│  请求 B ──→ 401 ──→ 检测到 accessTokenExpired ──→         │
│  请求 C ──→ 401 ──→ 检测到 accessTokenExpired ──→         │
│                       │                                    │
│                       ▼                                    │
│            检查 refreshTokenPromise                        │
│            ├─ null → 创建刷新 Promise 单例                  │
│            │   ├─ getRefreshToken()                        │
│            │   ├─ refreshAccessToken(refreshToken)         │
│            │   └─ finally: refreshTokenPromise = null      │
│            │                                               │
│            └─ 非 null → 复用已有 Promise                    │
│                       │                                    │
│                       ▼                                    │
│            等待刷新完成 → 获取新 Token                       │
│            ├─ 成功 → 更新 Authorization Header             │
│            │        → 标记 __gotAccessToken = true          │
│            │        → 重试原请求                            │
│            └─ 失败 → onRefreshTokenExpired()                │
│                                                            │
│  Refresh Token 过期 → 调用 onRefreshTokenExpired()         │
│  → 跳转登录页 / 清除登录态                                 │
└────────────────────────────────────────────────────────────┘
```

**防死循环机制：** 重试请求时在 `config` 上标记 `__gotAccessToken = true`。如果刷新后的请求再次返回 401（说明新 Token 也有问题），检测到该标记后直接拒绝，不再重复刷新。

**源码位置：** [AxiosWrapper.requestWithRefreshToken()](file:///c:/Users/30895/Desktop/lania-zip/lania-tools/packages/tools/src/axios/index.ts)

---

### 6. CancelTokenManager — 请求取消

**使用场景：** 用户离开页面时取消所有进行中的请求；搜索框输入时取消上一次搜索请求。

```
CancelTokenManager
├── cancelTokens: Map<id, CancelTokenSource>
│
├── set(id, source)     — 注册取消令牌
├── get(id)             — 获取取消令牌
├── delete(id)          — 删除取消令牌
├── cancelById(id)      — 取消指定请求
│   └─ source.cancel(`The request canceled: ${id}`)
└── cancelAll()         — 取消所有请求
    └─ 遍历 cancelTokens → 逐个 cancelById
```

**生命周期：** 在 `AxiosWrapper.request()` 中，请求开始时注册 CancelToken，请求完成后（finally）自动清理。

**源码位置：** [CancelTokenManager.ts](file:///c:/Users/30895/Desktop/lania-zip/lania-tools/packages/tools/src/axios/CancelTokenManager.ts)

---

### 7. PollingManager — 轮询

**使用场景：** 上传文件后轮询处理状态；大任务执行进度查询。

```
PollingManager
├── pollingTasks: Map<key, PollingState>
│
├── poll(config)
│   ├─ 如果 key 已存在 → 先 stopPolling(key)
│   ├─ 创建 PollingState { isStopped, attempts, timeoutId, config }
│   └─ 立即执行 executePoll(state)
│
├── executePoll(state)
│   ├─ 退出条件检查：isStopped || attempts >= maxPollingTimes
│   ├─ 通过 concurrencyController.run() 发起请求
│   ├─ 成功 → onSuccess(res)
│   ├─ 失败 → onError(err)
│   └─ finally:
│       ├─ attempts++
│       └─ 未达上限 → setTimeout(executePoll, interval)
│
└── stopPolling(key)
    ├─ state.isStopped = true
    ├─ clearTimeout(state.timeoutId)
    └─ pollingTasks.delete(key)
```

**关键设计：** 轮询请求也走 `GlobalConcurrencyController`，与其他请求共享并发限制。`stopPolling` 通过 `isStopped` 标志位 + `clearTimeout` 双重保险确保停止。

**源码位置：** [PollingManager.ts](file:///c:/Users/30895/Desktop/lania-zip/lania-tools/packages/tools/src/axios/PollingManager.ts)

---

### 8. UploadManager — 文件上传

**特性：** 分片上传、断点续传、MD5 校验、Web Worker。

```
UploadManager
│
├── uploadFile(url, file, options)
│   │
│   ├─ 1. 计算文件 MD5（Web Worker，不阻塞主线程）
│   │   └─ md5-calculator.worker.ts
│   │       └─ SparkMD5 逐片读取 → 计算完整文件 MD5
│   │
│   ├─ 2. 断点续传检查
│   │   └─ GET /upload/status?fileMd5=xxx
│   │   └─ 获取已上传分片索引集合 → uploadedChunks
│   │
│   ├─ 3. 创建分片上传任务
│   │   └─ 跳过已上传分片 → 每个分片调用 uploadChunk()
│   │
│   └─ 4. Promise.all 等待所有分片上传完成
│
├── uploadChunk(url, chunk, index, total, cancelToken, fileMd5, chunkMd5, onProgress)
│   │
│   ├─ 构建 FormData { file, chunkIndex, totalChunks, fileMd5, chunkMd5 }
│   ├─ 通过 concurrencyController.run() 发起请求
│   └─ 内置重试逻辑（递归 + 延迟）
│       ├─ 成功 → 完成
│       └─ 失败 & attempt < retryTimes → 延迟 retryDelay → 重试
│
└── calculateFileMd5(file, chunkSize)
    └─ 创建 Web Worker → 避免大文件 MD5 计算阻塞主线程
```

**分片上传流程：**

```
文件 (50MB) → CHUNK_SIZE=5MB → 10 个分片

chunk0 ──→ uploadChunk() ──→ GlobalConcurrencyController ──→ POST /upload
chunk1 ──→ uploadChunk() ──→ GlobalConcurrencyController ──→ POST /upload
chunk2 ──→ uploadChunk() ──→ GlobalConcurrencyController ──→ POST /upload
...
chunk9 ──→ uploadChunk() ──→ GlobalConcurrencyController ──→ POST /upload

所有分片受 maxConcurrent 限制，最多同时上传 N 个分片
```

**断点续传：** 上传前先查询服务端已接收的分片列表，跳过已上传的分片，只上传缺失的分片。配合文件 MD5 作为唯一标识。

**源码位置：** [UploadManager.ts](file:///c:/Users/30895/Desktop/lania-zip/lania-tools/packages/tools/src/axios/UploadManager.ts) | [md5-calculator.worker.ts](file:///c:/Users/30895/Desktop/lania-zip/lania-tools/packages/tools/src/axios/md5-calculator.worker.ts)

---

### 9. AxiosWrapperFactory — 多实例工厂

**使用场景：** 项目中需要对接多个后端服务，每个服务有不同的 baseURL、Token 策略、错误处理。

```typescript
// 内部实现
class AxiosWrapperFactory {
  private static instances: Map<string, AxiosWrapper> = new Map();

  static create(name: string, config?, options?) {
    if (!this.instances.has(name)) {
      this.instances.set(name, new AxiosWrapper(config, options));
    }
    return this.instances.get(name)!;
  }
}
```

**特点：** 按 `name` 缓存实例，同一名称多次调用返回同一个实例，避免重复创建。

---

## 设计模式总结

| 模式 | 应用位置 | 说明 |
|------|----------|------|
| **中间件模式** | InterceptorManager | 请求/响应按顺序流经多个中间件，每个中间件可修改 ctx 或短路 |
| **发布-订阅** | CancelTokenManager | 外部通过 cancelTokenId 取消特定请求 |
| **Promise 单例** | Token 刷新 | 多个并发 401 共享同一个刷新 Promise |
| **工厂模式** | AxiosWrapperFactory | 按名称创建/缓存 Wrapper 实例 |
| **队列调度** | GlobalConcurrencyController | 超过并发限制的请求排队等待 |
| **策略模式** | debounce/throttle | 相同请求指纹可选用防抖或节流策略 |
| **递归重试** | UploadManager.uploadChunk | 分片上传失败自动递归重试 |

## 完整使用示例

```typescript
import { AxiosWrapper } from '@lania-tools/tools/axios-wrapper';

const http = new AxiosWrapper(
  { baseURL: '/api', timeout: 10000 },
  {
    // 并发控制
    maxConcurrent: 6,

    // 缓存
    enableCache: true,
    cacheTTL: 60000,

    // 防抖（300ms 内相同请求只发一次）
    enableDebounce: true,
    debounceInterval: 300,

    // 重试
    enableRetry: true,
    retryTimes: 3,
    retryDelay: 1000,

    // 双 Token
    tokenProvider: () => localStorage.getItem('accessToken') || '',
    enableDoubleToken: true,
    getRefreshToken: () => localStorage.getItem('refreshToken') || '',
    refreshAccessToken: async (refreshToken) => {
      const res = await axios.post('/auth/refresh', { refreshToken });
      return res.data.accessToken;
    },
    accessTokenExpiredCodes: [401],
    refreshTokenExpiredCodes: [402],
    onRefreshTokenExpired: () => { window.location.href = '/login'; },

    // 响应处理
    responseHandler: (res) => res.data,
    codeHandlers: {
      403: () => console.error('无权限'),
    },
    onError: (err) => console.error('请求错误:', err),
  }
);

// 基础请求
const users = await http.get('/users', { page: 1 });
await http.post('/users', { name: '张三' });

// 取消请求
http.get('/users', { cancelTokenId: 'user-list' });
http.cancelRequest('user-list');

// 轮询
http.startPolling({
  key: 'task-status',
  url: '/tasks/123',
  interval: 3000,
  maxPollingTimes: 10,
  onSuccess: (data) => console.log('状态:', data),
});

// 停止轮询
http.stopPolling('task-status');

// 文件上传
http.uploadFile('/upload', file, {
  enableResume: true,
  getUploadedChunksUrl: '/upload/status',
  calculateChunkMd5: true,
  onProgress: (finished, total) => console.log(`${finished}/${total}`),
});

// 下载文件
http.downloadFile('/export/data.xlsx', 'get', '报表.xlsx');

// 清理
http.clearCache();
http.cancelAllRequests();
```