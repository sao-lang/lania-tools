# 速查表

一页查完所有导出、方法与配置。需要原理与示例时点对应链接。

## 全部导出

| 模块 | 值导出 | 类型导出 |
| --- | --- | --- |
| `axios-wrapper` | `AxiosWrapper`、`AxiosWrapperFactory`、`DebounceThrottleCancelError` | `WrapperOptions`、`UploadFileOptions`、`PollingConfig` |
| `event-bus` | `EventBus` | `EventContext`、`EventHandler`、`AsyncEventHandler` |
| `store` | `Store` | `AsyncAction`、`StorePlugin`、`PathType`、`FromPathType`、`DerivedState`、`ReducersMap`、`ActionsFromReducers` |
| `tools` | `debounce`、`throttle`、`deepClone`、`isDeepEqual`、`copy` | — |
| `type` | `type`、`isFunction`、`isBoolean`、`isNumber`、`isString`、`isArray`、`isObject`、`isEmptyObject`、`isArrayLike`、`isWindow`、`isHTMLElement`、`isPrimitive`、`isFalsy` | `VarTypes` |
| `validator` | `Validator`、`Rules` | `ValidationResult`、`ValidationRuleResult`、`ValidationRuleFn`、`ValidationRules` |
| `format-time` | `formatTime` | `TimeFormatter` |
| `logger` | `createLogger`、`getLogger`、`Logger`、`safeStringify`、`formatLogRecord`、`defaultLogHandler`、`setGlobalLevel`、`getGlobalLevel`、`clearLoggers`、`LOG_LEVEL_ORDER` | `LogLevel`、`ActiveLogLevel`、`LogRecord`、`LogHandler`、`LoggerOptions` |
| `web-storage-helper` | `LocalStorageHelper`、`SessionStorageHelper`、`CookieHelper`、`IndexedDBHelper` | `StorageOptions` |
| `sse-client` | `SSEClient` | `SSEOptions` |
| `websocket-client` | `WebSocketClient` | `WebSocketOptions` |
| `convert-chinese-text` | `createChineseConverter`、`convertPageChinese` | `ConvertOptions` |
| `carousel` | `Carousel` | `SuperCarouselOptions` |
| `draggable` | `Draggable` | `DraggableOptions`、`DragBoundary`、`CustomDragEvent` |
| `virtual-scroller` | `VirtualScroller` | `VirtualScrollerOptions` |

## AxiosWrapper 配置

```ts
new AxiosWrapper(config?, {
    // 并发
    maxConcurrent: 5,
    // 缓存
    enableCache: false, cacheTTL: undefined,
    // 防抖 / 节流
    enableDebounce: false, debounceInterval: 300,
    enableThrottle: false, throttleInterval: 1000,
    // 重试
    enableRetry: false, retryTimes: 3, retryDelay: 1000,
    // 认证
    tokenProvider: () => string,
    enableDoubleToken: false,
    getRefreshToken: () => string,
    refreshAccessToken: (refreshToken) => string,
    accessTokenExpiredCodes: [40101],
    refreshTokenExpiredCodes: [40102],
    onRefreshTokenExpired: () => void,
    // 响应
    onError: (error) => void,
    responseHandler: (response) => any,
    codeHandlers: { 50001: (response) => any },
    interceptors: { request: {...}, response: {...} },
})
```

## AxiosWrapper 方法

| 方法 | 签名 | 返回 |
| --- | --- | --- |
| `request` | `(config: AxiosRequestConfig & { cancelTokenId? })` | `Promise<AxiosResponse<T>>` |
| `get` | `(url, params?, config?)` | `Promise<AxiosResponse<T>>` |
| `post` | `(url, data?, config?)` | `Promise<AxiosResponse<T>>` |
| `put` | `(url, data?, config?)` | `Promise<AxiosResponse<T>>` |
| `delete` | `(url, data?, config?)` | `Promise<AxiosResponse<T>>` |
| `uploadFile` | `(url, file, options?)` | `Promise<{ fileMd5, totalChunks }>` |
| `downloadFile` | `(url, method?, filename?, config?)` | `Promise<AxiosResponse<Blob>>` |
| `startPolling` | `(config: PollingConfig<T>)` | `void` |
| `stopPolling` | `(key)` | `void` |
| `cancelRequest` | `(tokenId)` | `void` |
| `cancelAllRequests` | `()` | `void` |
| `clearCache` | `()` | `void` |
| `AxiosWrapperFactory.create` | `(name, config?, options?)` | `AxiosWrapper` |

## EventBus

```ts
new EventBus()
.on(event, handler, { namespace?, priority?, once? })
.emit(event, data?, { namespace? })        // Promise<void>
.emitBatch([{ event, data?, options? }])   // Promise<void>
.off(event, handler, { namespace? })
.getEventCount(namespace, event)           // number
.registerNamespace(namespace)
.clear()
```

## Store

```ts
new Store({ initialState, reducers, derivedState?, plugins? })
.actions.<reducerName>(payload)            // Promise<void>
.dispatch(action | action[])               // Promise<void>
.getState(path?)                           // S | 字段值
.getDerivedState(path?)                    // D | 派生值
.addPlugin(plugin | plugin[])              // void
.subscribe(fn)                             // () => void
.watchProperty(path, fn, { immediate?, deep? }) // () => void
.saveSnapshot() / .restoreSnapshot()
```

## 函数工具

| 函数 | 签名 |
| --- | --- |
| `debounce` | `(fn, wait = 1000, immediate = false) => fn & { cancel }` |
| `throttle` | `(fn, wait = 1000, { leading = true, trailing = true }) => fn & { cancel }` |
| `deepClone` | `<T>(value: T) => T` |
| `isDeepEqual` | `<T>(a: T, b: T) => boolean` |
| `copy` | `({ text?, imageUrl? }) => Promise<void>` |

## 类型判断

```ts
type(value) // 18 种类型字符串
isFunction / isBoolean / isNumber / isString / isArray
isObject / isEmptyObject / isArrayLike / isWindow / isHTMLElement
isPrimitive / isFalsy
```

## Validator

```ts
new Validator<T>(rules)
.validate(data)                 // Promise<{ isValid, errors }>
.setDynamicRules(rules)
.getErrors()                    // Record<string, string>
.clearCache()

Rules.required(message?)
Rules.minLength(min, message?) / Rules.maxLength(max, message?)
Rules.pattern(regexp, message?) / Rules.email(message?) / Rules.phone(message?)
Rules.range(min, max, message?) / Rules.min(min, message?) / Rules.max(max, message?)
Rules.integer(message?) / Rules.url(message?) / Rules.date(message?)
Rules.matchField(otherField, message?) / Rules.custom(fn, message?)
```

## 时间格式化

```ts
formatTime(time: Date | number, formatter?: string | ((date: Date) => string))
// YYYY MM M DD D HH H hh h mm m SS S
```

## 日志 Logger

```ts
createLogger({ name?, level?, context?, timestamp?, timeFormatter?, handler?, historySize? })
getLogger(name = 'app')            // 同名共享实例
setGlobalLevel(level) / getGlobalLevel() / clearLoggers()

logger.debug/info/warn/error(message, ...args)
logger.log(level, message, ...args)
logger.child(name, context?)       // 命名空间 'parent:child'
logger.withContext(context)        // 名称不变
logger.getLevel() / setLevel(level) / isLevelEnabled(level)
logger.setHandler(handler)
logger.assert(condition, message, ...args)
logger.time(label?)                // () => duration
logger.getHistory() / clearHistory()

safeStringify(value)               // 永不抛错的结构化序列化
formatLogRecord(record)            // 单行字符串
defaultLogHandler(record)          // 默认 console 输出
```

| 级别 | 阈值 |
| --- | --- |
| `debug` | 10 |
| `info` | 20（默认） |
| `warn` | 30 |
| `error` | 40 |
| `silent` | 100 |

默认输出：

```text
[08:05:03.007] [api] [WARN] slow request {"path":"/users"} {"ms":1200}
```

## 存储

```ts
LocalStorageHelper / SessionStorageHelper / CookieHelper
    .set(key, value, { expiresInSeconds?, encryptData? })
    .get<T>(key)                    // T | null
    .setMultiple(items, options?) / .getMultiple<T>(keys)
    .delete(key) / .clear() / .keys() / .size()

IndexedDBHelper   // 同名方法，全部返回 Promise
```

## SSE / WebSocket

```ts
new SSEClient({ url, reconnectInterval? })
.on('message' | 'error', cb)
.close()

new WebSocketClient({ url, reconnectInterval?, heartbeatInterval?, maxReconnectAttempts? })
.on('open' | 'message' | 'error' | 'close', cb)
.send(message)
.close()
```

## 文本替换

```ts
createChineseConverter(maxCacheSize?)(text, dictionary, useCache?)
convertPageChinese(dictionary, targetElement?, options?) // () => void

// options: { observeMutations?, batchSize?, excludeSelectors?, useCache?, maxCacheSize? }
```

## Carousel

```ts
new Carousel({ mode, containerSelector, itemSelector, speed?, autoplayInterval?, pauseOnHover?, paginationSelector? })
.start() / .stop()
.nextSlide() / .prevSlide() / .goToSlide(index, useTransition?)
.startAutoplay() / .stopAutoplay()
.startMarquee() / .stopMarquee()
.destroy()
```

## Draggable

```ts
new Draggable(element, {
    boundary?, initialPosition?, enableTouch?, enableAnimation?,
    enableSnap?, snapToGrid?, snapThreshold?, constrainToParent?,
    onDragStart?, onDrag?, onDragEnd?, onBoundaryHit?,
})
.bindEvents() / .unbindEvents()
.setPosition(x, y)
.destroy()
```

## VirtualScroller

```ts
new VirtualScroller({
    containerSelector, estimatedItemHeight, bufferSize,
    loadMoreCallback, renderItemContent?,
})
.loadMore()   // Promise<void>
.clear()
```

## 默认值总表

| 项 | 默认值 |
| --- | --- |
| `maxConcurrent` | `5` |
| `debounceInterval` | `300` |
| `throttleInterval` | `1000` |
| `retryTimes` | `3` |
| `retryDelay` | `1000` |
| `CHUNK_SIZE` | `5MB` |
| 轮询 `interval` | `5000` |
| 轮询 `maxPollingTimes` | `3` |
| SSE `reconnectInterval` | `5000` |
| WebSocket `reconnectInterval` | `5000` |
| WebSocket `heartbeatInterval` | `30000` |
| Carousel `speed` | `300` |
| Carousel `autoplayInterval` | `3000` |
| Draggable `snapThreshold` | `10` |
| `debounce` `wait` | `1000` |
| `throttle` `wait` | `1000` |
| 存储默认过期 | 永不过期（Cookie 为 10 年） |
| 转换缓存上限 | `500` |
| 日志级别 | `info` |
| 日志时间戳 | 关闭 |
| 时间格式 | `HH:mm:ss.SSS` |
| 日志历史缓冲 | `0`（关闭） |

## 常见错误消息

| 消息 | 出处 |
| --- | --- |
| `Missing refresh token.` | 双 Token |
| `No refreshAccessToken provided` | 双 Token |
| `Invalid new access token.` | 双 Token |
| `Refresh token expired` | 双 Token |
| `Request already retried after refresh` | 双 Token |
| `Upload canceled by user signal.` | 上传 |
| `Request canceled by debounce` | 防抖 |
| `Request canceled by throttle` | 节流 |
| `Either text or imageUrl must be provided` | copy |
| `VirtualScroller: Container element not found.` | 虚拟滚动 |
| `Carousel container not found for selector: ...` | 轮播 |
| `Namespace xxx is not registered` | EventBus |
| `Invalid log level: xxx` | Logger |
| `[logger] log handler threw an error:` | Logger（handler 抛错时） |
