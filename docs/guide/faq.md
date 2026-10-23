# 常见问题 FAQ

## 安装与引入

### 为什么 `import { EventBus } from '@lania-tool/tools'` 在某些构建器里失败？

优先使用子路径（`@lania-tool/tools/event-bus`）。全量入口会引入所有模块的类型与副作用，部分构建器对 `exports` 条件解析较严格，子路径最稳。

### 可以在 Node 服务端使用吗？

可以，但仅限纯逻辑模块（`type`、`tools`、`validator`、`format-time`、`store`、`event-bus`、`axios-wrapper` 的非浏览器能力）。存储、SSE、WebSocket、UI 组件在构造时就访问 DOM。

### 是否需要配置 polyfill？

- `axios-wrapper` 依赖 `Promise`、`CancelToken`（axios 内置）。
- 分片上传依赖 `Blob.prototype.slice` 与 `Blob.prototype.arrayBuffer`（无 `arrayBuffer` 时回退 `FileReader`）。
- 其他模块只依赖 ES2018 语法。

## 请求层

### 缓存命中后为什么 `onError` 没触发？

缓存命中不是错误。请求根本没有离开进程，直接返回 `statusText: 'Cache Hit'` 的响应，并完整经过响应拦截器。

### 为什么缓存不到不同参数顺序的请求？

不会。Key 使用稳定序列化（递归按键排序），`{ b: 2, a: 1 }` 与 `{ a: 1, b: 2 }` 得到同一个 Key。

### 取消请求后为什么还收到错误？

取消一定 reject（`CanceledError` 或 `DebounceThrottleCancelError`），但**不会**触发 `onError`、不会重试。业务侧用 `catch` 处理即可。

```ts
try {
    await http.get('/slow', undefined, { cancelTokenId: 'x' });
} catch (error) {
    if (axios.isCancel(error) || error?.isCancel) return;
    throw error;
}
```

### 重试为什么没有生效？

检查：

1. `enableRetry` 是否为 `true`；
2. 失败是否发生在网络层（HTTP 4xx/5xx 或网络错误）；业务 code 错误默认不重试；
3. `retryTimes` 是否为 0。

### 双 Token 为什么没刷新？

双 Token 只识别 **HTTP 200 + `data.code`**。如果后端用 HTTP 401 表示过期，Axios 会先 reject，刷新逻辑不触发。两种解决方式：

```ts
// A. 后端统一 HTTP 200 + 业务 code
// B. 在自定义响应错误拦截器中转换
interceptors: {
    response: {
        onRejected: (error) => {
            if (error.response?.status === 401) {
                return { ...error.response, data: { code: 40101 } };
            }
            return Promise.reject(error);
        },
    },
}
```

### 刷新接口本身也过期了怎么办？

刷新接口必须使用**裸 axios** 或独立实例。用被包装的实例会递归触发刷新。

### 上传完成后为什么没有合并？

`uploadFile` 只负责分片上传，返回 `{ fileMd5, totalChunks }`。合并协议因后端而异，需要调用方自己发请求。

### 上传取消为什么还抛出 `Request canceled`？

分片请求被取消时，`UploadManager` 会把它转换成 `Upload canceled by user signal.`；如果是排队中的分片，可能在进入网络前就被令牌拒绝。两种情况都会 reject，且不会继续重试。

### 下载的文件名是乱码？

服务端应使用 RFC 5987：

```http
Content-Disposition: attachment; filename*=UTF-8''%E6%B5%8B%E8%AF%95.txt
```

本库优先解析 `filename*`，其次 `filename`，最后回退 URL。

### 为什么 `downloadFile` 拿到了一个 JSON 字符串？

后端出错时返回了 JSON，但 `responseType` 是 `blob`。检查 `error.response.data.type`，或让后端用 HTTP 状态码表示失败。

## 状态与事件

### Store 更新后订阅者没触发？

reducer 必须返回**新对象**。原地修改并返回同一引用会被判定为「无变化」：

```ts
// ❌
(state) => { state.count++; return state; }

// ✅
(state) => ({ ...state, count: state.count + 1 })
```

### `watchProperty` 的 `deep` 什么时候用？

监听嵌套对象内部变化时用 `deep: true`。每次变化都会做深比较并保存深拷贝快照，深层大对象慎用。

### EventBus 的处理器报错会影响其他处理器吗？

不会。每个处理器单独 `try/catch` 并打印 `console.error`。需要感知错误请在处理器内部自行处理。

### 命名空间为什么必须注册？

这是刻意的设计：拼写错误会立刻抛错，而不是变成「事件永远不触发」的静默 bug。

## 浏览器组件

### Carousel 不显示 / 不滚动？

- 容器或子项选择器错误会抛错 / 警告；
- 容器 `display: none` 时宽度为 0，需要在显示后重建实例或触发 resize；
- slide 模式至少需要 1 个子项（建议 2 个以上）。

### Draggable 为什么拖不动？

- 是否调用了 `bindEvents()`；
- 元素是否被其他元素遮挡（`z-index`）；
- 是否与其他库的 `transform` 冲突（本库会覆盖 `transform`）。

### VirtualScroller 为什么不渲染？

`clientHeight` 为 0 是最常见原因：容器必须设置高度。其次检查 `loadMoreCallback` 是否返回非空数组。

### SSE 收不到自定义事件？

`SSEClient` 只监听默认的 `message` 事件。后端的 `event: done` 这类具名事件不会触发回调，需要扩展或改用原生 `EventSource`。

### WebSocket 的 `send` 没反应？

只有 `readyState === OPEN` 时才会发送，其余状态静默忽略。需要在 `open` 回调之后再发送，或自行缓存消息队列。

## 测试

### 为什么集成测试要启动真实服务端？

缓存、重试、双 Token、分片上传都依赖真实的 Axios 行为与网络时序，mock 很容易验证错误的东西。详见 [测试与质量保障](/guide/testing)。

### 测试偶发失败怎么办？

避免固定 `setTimeout` 后断言，改为轮询等待；并行执行时尤其明显。测试服务端也提供了 `refreshDelayMs` / `uploadDelayMs` 用于稳定复现竞态。

## 其他

### 加密存储安全吗？

不安全。`encryptData` 只是把字符串转成十六进制编码，能避免肉眼直读，不防篡改。敏感数据请使用 HttpOnly Cookie 或服务端会话。

### 生产环境怎么关掉日志？

```ts
import { setGlobalLevel } from '@lania-tool/tools/logger';

if (import.meta.env.PROD) setGlobalLevel('warn');
```

需要完全静默时使用 `setGlobalLevel('silent')`。注意 `setLevel` 只影响单个实例及其 child。

### 日志能上报到服务端吗？

可以，替换 handler 即可：

```ts
createLogger({
    level: 'warn',
    handler: (record) => {
        void fetch('/api/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                level: record.level,
                name: record.name,
                message: record.message,
                context: record.context,
                time: record.time,
            }),
            keepalive: true,
        }).catch(() => {});
    },
});
```

详见 [日志 Logger](/tools/logger)。

### 可以只引入某个函数吗？

可以：

```ts
import { debounce } from '@lania-tool/tools/tools';
```

子路径入口 + ESM 可以精确到单个函数。
