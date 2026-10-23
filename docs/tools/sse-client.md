# SSE 客户端 SSEClient

## 定位

对浏览器 `EventSource` 的封装：连接管理、消息分发、断线重连。

SSE（Server-Sent Events）是**单向**推送：服务端持续向客户端发送文本事件流，客户端不需要轮询。

| 适合 | 不适合 |
| --- | --- |
| 消息通知、任务进度、日志流 | 需要客户端实时上行（用 WebSocket） |
| 服务端主动推送 | 二进制数据 |

## 导入

```ts
import { SSEClient } from '@lania-tool/tools/sse-client';
```

## 快速开始

```ts
const sse = new SSEClient({
    url: '/api/events',
    reconnectInterval: 3000,
});

sse.on('message', (data) => {
    console.log('收到推送', JSON.parse(data));
});

sse.on('error', (event) => {
    console.warn('连接异常', event);
});

// 组件卸载
sse.close();
```

**构造时立即连接**，不需要手动 `open()`。

## API

### `new SSEClient(options: SSEOptions)`

```ts
interface SSEOptions {
    /** SSE 服务端 URL */
    url: string;
    /** 自动重连间隔（毫秒），默认 5000 */
    reconnectInterval?: number;
}
```

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `url` | `string` | 必填 | 支持相对路径与绝对路径 |
| `reconnectInterval` | `number` | `5000` | 错误后等待多久重连 |

构造时会：

1. 若已有 `EventSource`，先 `close()`；
2. `new EventSource(url)`；
3. 绑定 `onmessage` / `onerror` / `onopen`。

### `on('message', callback)`

```ts
sse.on('message', (data: string) => {});
```

- 回调参数是原始字符串（`event.data`），需要自行 `JSON.parse`；
- **替换语义**：再次调用会覆盖之前的回调。

### `on('error', callback)`

```ts
sse.on('error', (event: Event) => {});
```

错误回调会在内部开始重连之后调用。

### `close()`

```ts
sse.close();
```

行为：

1. 设置 `closed = true`（后续错误不再重连）；
2. 清除重连定时器；
3. 关闭并置空 `eventSource`。

关闭后不能复用，需要重新 `new SSEClient()`。

## 连接与重连时序

```text
constructor
  └ connect()
      ├─ 已有 EventSource → close()
      ├─ new EventSource(url)
      ├─ onmessage → handleMessage → onMessage(event.data)
      ├─ onerror   → handleError
      │    ├─ 已关闭 → 忽略
      │    ├─ startReconnect()
      │    └─ onError(event)
      └─ onopen    → console.log('SSE connected') → stopReconnect()
```

`startReconnect`：

```ts
if (this.closed || this.reconnectTimer) return;
this.reconnectTimer = setTimeout(() => {
    this.reconnectTimer = null;
    this.connect();
}, this.reconnectInterval);
```

两个细节：

1. **去重**：连续多次 `onerror` 只会创建一个定时器。
2. **连接成功会取消待执行的重连**。

## 消息格式

服务端返回 `text/event-stream`：

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream

data: {"seq":1}

data: {"seq":2}

event: done
data: {}

```

- `data:` 后同一行是消息内容；
- 空行表示一条消息结束；
- `event: done` 是**具名事件**，不会触发 `message` 回调。

```ts
sse.on('message', (raw) => {
    const message = JSON.parse(raw);
    // { seq: 1 }
});
```

## 完整示例：带心跳状态的任务进度

```ts
import { SSEClient } from '@lania-tool/tools/sse-client';

export function subscribeTask(
    taskId: string,
    onProgress: (progress: number) => void,
    onDone: () => void,
) {
    const sse = new SSEClient({
        url: `/api/tasks/${taskId}/stream`,
        reconnectInterval: 2000,
    });

    sse.on('message', (raw) => {
        try {
            const event = JSON.parse(raw);
            if (event.type === 'progress') onProgress(event.progress);
            if (event.type === 'done') {
                onDone();
                sse.close();
            }
        } catch (error) {
            console.error('invalid SSE payload', error);
        }
    });

    sse.on('error', () => {
        // 内部会自动重连，这里只做提示
    });

    return () => sse.close();
}
```

## 限流与生命周期

- `reconnectInterval` 过大：断线后恢复慢；
- 过小：服务端不可用时会产生大量连接尝试，建议 ≥ 1s；
- 页面隐藏时浏览器会节流定时器，间隔不精确；
- 组件卸载务必 `close()`，否则会持续重连。

## 注意事项

| 问题 | 说明 |
| --- | --- |
| 浏览器原生重连 | `EventSource` 自带重连，本封装另有定时重连，两者可能叠加 |
| 认证 | `EventSource` 不支持自定义请求头，Token 只能放 URL 参数或依赖 Cookie |
| 具名事件 | 只监听 `message`，`event: xxx` 不会触发 |
| 消息格式 | 回调收到字符串 |
| 二进制 | 不支持 |
| `on` 语义 | 替换而非追加 |
| 关闭后复用 | 不可复用，需要重新创建 |

## 测试覆盖

`packages/tools/tests/client.test.ts` 与 `edge-cases.test.ts`：

- 消息 / 错误回调；
- `onopen` 停止重连；
- 错误后重连并关闭旧连接；
- `close()` 后不再重连；
- 重复错误只创建一个重连定时器；
- 默认 5s 重连间隔。
