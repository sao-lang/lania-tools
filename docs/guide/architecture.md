# 整体架构

## 设计原则

| 原则 | 具体体现 |
| --- | --- |
| 一个模块解决一个问题 | 缓存、并发、防抖、上传各自独立，可单独理解与替换 |
| 依赖单向 | 上层组合下层，下层不感知上层；`store` 只依赖 `tools` |
| 可测试性优先 | 时间、网络、DOM、Worker 都能被隔离或替换 |
| 失败可解释 | 错误要么被明确恢复，要么携带足够上下文抛给调用方 |
| 无框架绑定 | 不依赖 Vue / React，任何运行时都能直接用 |

## 模块依赖关系

```text
                        ┌──────────────┐
                        │  index.ts    │  全量导出
                        └──────┬───────┘
       ┌───────────────┬───────┼─────────┬────────────────┐
       ▼               ▼       ▼         ▼                ▼
  axios/          event-bus  store   validator       type / tools
       │              │        │         │                │
       │              │        └─────────┴──────► tools.ts  ◄┘
       │              │                     (deepClone / isDeepEqual)
       ▼              │
  ┌─────────────────────────────────────────────┐
  │ GlobalConcurrencyController                 │
  │ CacheManager  CancelTokenManager            │
  │ DebounceThrottleManager  PollingManager     │
  │ UploadManager  InterceptorManager  helper   │
  └─────────────────────────────────────────────┘

  sse-client / websocket-client / web-storage-helper
  carousel / draggable / virtual-scroller / convert-chinese-text
  —— 相互独立，只依赖平台 API
```

只有两处跨模块依赖：

1. `store.ts` → `tools.ts`：深比较与深拷贝。
2. `UploadManager` / `PollingManager` → `GlobalConcurrencyController`：共享全局限流。

## 请求层分层

```text
┌──────────────────────────────────────────────────────┐
│ 编排层  AxiosWrapper                                 │
│ get / post / put / delete / request                  │
│ uploadFile / downloadFile / startPolling             │
│ cancelRequest / clearCache                           │
└──────────────────────┬───────────────────────────────┘
                       │ 注入回调（刷新、重试）
┌──────────────────────▼───────────────────────────────┐
│ 管道层  InterceptorManager                           │
│ Request 链：token → cache → debounce → throttle → custom │
│ Response 链：flag → doubleToken → custom → cache     │
└──────────────────────┬───────────────────────────────┘
                       │ 委托
┌──────────────────────▼───────────────────────────────┐
│ 能力层                                               │
│ CacheManager · CancelTokenManager                    │
│ DebounceThrottleManager · GlobalConcurrencyController│
│ PollingManager · UploadManager                       │
└──────────────────────────────────────────────────────┘
```

**职责边界**

- `AxiosWrapper` 负责「做哪些事」以及需要跨模块协调的动作（刷新 Token 后重放）。
- `InterceptorManager` 负责「什么时候做」，不关心具体实现。
- Manager 只负责单一能力，彼此无依赖。

这样拆分后，双 Token 这种「需要重放请求」的逻辑留在编排层，拦截器只需判断业务 code 并调用回调。测试时既可以单独验证判定，也可以单独验证刷新流程。

## 一次请求的完整数据流

```text
http.get('/users', { page: 1 })
  │
  ├─ ① request()
  │    ├─ 有 cancelTokenId → CancelToken.source() 并登记到 CancelTokenManager
  │    └─ GlobalConcurrencyController.run(() => instance(config))
  │
  ├─ ② axios request interceptors
  │    ├─ tokenMiddleware        tokenProvider() → Authorization
  │    ├─ cacheRequestMiddleware 命中 → config.adapter = () => fakeResponse
  │    ├─ debounceMiddleware     同 Key 旧请求 reject(CancelError)
  │    ├─ throttleMiddleware     冷却期内 reject(CancelError)
  │    └─ customRequestMiddleware 用户 onFulfilled
  │         └─ 抛错 → handleRequestError → 用户 onRejected / 抛错
  │
  ├─ ③ 网络
  │
  ├─ ④ axios response interceptors
  │    ├─ flagMiddleware           responseHandler / codeHandlers（1s 锁）
  │    ├─ doubleTokenMiddleware    过期 → 刷新单例 → 重放
  │    ├─ customResponseMiddleware
  │    └─ cacheResponseMiddleware  非缓存命中才写缓存
  │         └─ 任一中间件抛错 → handleResponseError → 自定义 onRejected / 重试 / onError
  │
  └─ ⑤ 返回 AxiosResponse<T>
```

## 状态归属

理解这张表可以避免「为什么这个请求没走缓存」「为什么取消不生效」。

| 状态 | 归属对象 | 生命周期 | 影响范围 |
| --- | --- | --- | --- |
| 缓存条目 | `CacheManager` | Wrapper 实例 | 同实例所有请求 |
| 防抖定时器 | `DebounceThrottleManager` | Wrapper 实例 | 同 Key 请求 |
| 节流时间戳 | `DebounceThrottleManager` | Wrapper 实例 | 同 Key 请求 |
| 取消令牌 | `CancelTokenManager` | 单次请求 | 单个请求 |
| 并发计数 / 队列 | `GlobalConcurrencyController` | Wrapper 实例 | 请求 + 上传 + 轮询 |
| 刷新中的 Promise | `AxiosWrapper.refreshTokenPromise` | 一次刷新周期 | 并发过期请求 |
| 业务 code 锁 | `InterceptorManager.errorLocks` | 1 秒 | 同 code 的并发响应 |
| 轮询任务 | `PollingManager` | 直到 stop 或达到次数 | 单个 key |
| Wrapper 实例 | `AxiosWrapperFactory` | 进程级静态 Map | 按名称共享 |

## 错误流

```text
请求阶段错误
  ├─ 取消（手动 / 防抖 / 节流） → 直接 reject，不通知 onError
  ├─ 自定义 onRejected 返回 config → 用该 config 继续请求
  └─ 其他 → reject

响应阶段错误
  ├─ 取消 → 直接 reject（不重试、不通知 onError）
  ├─ 自定义 onRejected 返回响应 → 作为成功结果返回
  ├─ enableRetry → 重试，成功则返回响应
  └─ 仍失败 → onError(error) → reject
```

## 关键设计决策

### 1. 缓存命中替换 adapter，而不是 reject

Axios 的请求拦截器只能修改 config。`Promise.reject(fakeResponse)` 会被当作 config 继续 dispatch，导致真实请求或异常。替换 `adapter` 可以真正短路网络，同时保留完整的响应拦截器链。

### 2. 重试使用无拦截器实例

使用 `this.instance(config)` 重试会再次进入 `retryMiddleware`，形成递归。因此内部维护 `retryInstance`，重试循环写在 `retryRequest` 中，次数线性可控。

### 3. 刷新使用 Promise 单例

并发过期请求必须合并为一次刷新，否则 Refresh Token 轮换会导致后续刷新失败。同时把 `onRefreshTokenExpired` 放进单例内部，保证一次失败只通知一次。

### 4. 上传重试移到并发槽位之外

在 `run()` 内部递归调用 `run()` 会在 `maxConcurrent = 1` 时自锁。重试循环放在槽位之外，每次尝试单独占用槽位。

### 5. 取消错误统一识别

```ts
err instanceof DebounceThrottleCancelError || err?.isCancel === true || axios.isCancel(err)
```

三类取消共用一个判定，避免在业务代码里写多个 `if`。

## 目录结构

```text
packages/tools/
├── src/
│   ├── axios/                  请求层
│   │   ├── index.ts            AxiosWrapper / Factory / 类型导出
│   │   ├── InterceptorManager.ts
│   │   ├── GlobalConcurrencyController.ts
│   │   ├── CacheManager.ts
│   │   ├── CancelTokenManager.ts
│   │   ├── DebounceThrottleManager.ts
│   │   ├── PollingManager.ts
│   │   ├── UploadManager.ts
│   │   ├── helper.ts
│   │   ├── const.ts
│   │   └── md5-calculator.worker.ts
│   ├── event-bus.ts
│   ├── store.ts
│   ├── tools.ts
│   ├── type.ts
│   ├── validator.ts
│   ├── format-time.ts
│   ├── logger.ts
│   ├── web-storage-helper.ts
│   ├── sse-client.ts
│   ├── websocket-client.ts
│   ├── carousel.ts
│   ├── draggable.ts
│   ├── virtual-scroller.ts
│   ├── convert-chinese-text.ts
│   └── index.ts
├── tests/                      22 个测试文件 + 后端辅助系统
└── docs/test-coverage-report.md
```

## 扩展点

| 需求 | 扩展方式 |
| --- | --- |
| 自定义请求头 / 日志 | `options.interceptors.request.onFulfilled` |
| 统一响应解包 | `options.responseHandler` |
| 按业务错误码处理 | `options.codeHandlers` |
| 自定义错误上报 | `options.onError` |
| 全局 Token | `options.tokenProvider` |
| 多后端 / 多租户 | `AxiosWrapperFactory.create(name, ...)` |
| 缓存替代实现 | 缓存逻辑集中在 `CacheManager`，可替换为外部实现后注入拦截器 |
| 状态派生 | `Store.derivedState` |
| 状态持久化 | `Store` 插件 `onStateChange` |
| 事件命名空间隔离 | `EventBus.registerNamespace` |
| 日志输出目标 | `createLogger({ handler })` |
| 全局日志级别 | `setGlobalLevel()` |

## 下一步

- [TypeScript 类型指南](/guide/typescript)
- [AxiosWrapper 架构与生命周期](/axios/)
- [测试与质量保障](/guide/testing)
