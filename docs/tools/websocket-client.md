# WebSocket 客户端 WebSocketClient

## 定位

对原生 `WebSocket` 的封装：**自动连接、断线重连、心跳保活、事件回调**。

| 与 SSE 对比 | SSE | WebSocket |
| --- | --- | --- |
| 方向 | 服务端 → 客户端 | 双向 |
| 协议 | HTTP | ws / wss |
| 自动重连 | 浏览器原生支持 | 需自行实现 |
| 二进制 | 不支持 | 支持 |
| 代理友好 | 好 | 需要升级支持 |

## 导入

```ts
import { WebSocketClient } from '@lania-tool/tools/websocket-client';
```

## 快速开始

```ts
const ws = new WebSocketClient({
    url: 'wss://example.com/ws',
    reconnectInterval: 5000,
    heartbeatInterval: 30_000,
    maxReconnectAttempts: 10,
});

ws.on('open', () => console.log('已连接'));
ws.on('message', (data) => console.log('消息', data));
ws.on('error', (event) => console.warn('错误', event));
ws.on('close', (event) => console.log('连接关闭'));

ws.send(JSON.stringify({ type: 'subscribe', channel: 'news' }));

// 主动断开（不会重连）
ws.close();
```

**构造时立即连接**。

## API

### `new WebSocketClient(options: WebSocketOptions)`

```ts
interface WebSocketOptions {
    url: string;
    reconnectInterval?: number;
    heartbeatInterval?: number;
    maxReconnectAttempts?: number;
}
```

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `url` | `string` | 必填 | `ws://` 或 `wss://` |
| `reconnectInterval` | `number` | `5000` | 重连间隔（毫秒） |
| `heartbeatInterval` | `number` | `30000` | 心跳间隔；`0` 表示禁用 |
| `maxReconnectAttempts` | `number` | `Infinity` | 最大重连次数 |

### `on('open' | 'message' | 'error' | 'close', callback)`

```ts
ws.on('open', (event: Event) => {});
ws.on('message', (data: string) => {});
ws.on('error', (event: Event) => {});
ws.on('close', (event: CloseEvent) => {});
```

- **替换语义**：每个事件只保留最后一个回调；
- `message` 回调收到 `event.data`（字符串）。

### `send(message: string)`

```ts
ws.send('ping');
```

仅在 `readyState === OPEN` 时发送，其他状态**静默忽略**。

### `close()`

```ts
ws.close();
```

- 设置 `manuallyClosed = true`；
- 清除重连定时器；
- 停止心跳；
- 关闭 socket。

之后不会再自动重连。

## 状态机

```text
constructor
  └ connect()
      ├─ manuallyClosed = false
      ├─ 已有 socket → 解绑 onclose → close()
      └─ new WebSocket(url)
           ├─ onopen  → OPEN
           │    ├─ reconnectAttempts = 0
           │    ├─ startHeartbeat()
           │    └─ onOpen(event)
           ├─ onmessage → onMessage(data)
           ├─ onerror  → onError(event)     // 不自动关闭
           └─ onclose  → CLOSED
                ├─ stopHeartbeat()
                ├─ 未手动关闭 且 attempts < max
                │    └─ attempts++ → setTimeout(connect)
                └─ 否则 → onClose(event)
```

## 关键行为

### 1. 构造即连接

```ts
const ws = new WebSocketClient({ url: 'ws://localhost/ws' });
// 此时连接已开始建立
```

### 2. 重连计数与重置

```text
连接断开 → attempts++ → 等待 → 重连
重连成功 → attempts = 0
```

成功后清零意味着：长时间运行期间经历多次抖动，每次都能重新使用完整预算。

### 3. 达到上限

```ts
const ws = new WebSocketClient({
    url,
    maxReconnectAttempts: 2,
    reconnectInterval: 1000,
});

ws.on('close', () => {
    // 第 3 次断开后触发，表示彻底放弃
});
```

### 4. 心跳

```ts
this.heartbeatTimer = setInterval(() => {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send('ping');
    }
}, this.heartbeatInterval);
```

作用：

1. 防止中间代理因长时间无数据断开；
2. 尽早发现「已死但未收到 close」的连接。

服务端需要能处理或忽略文本消息 `'ping'`。

### 5. 替换连接不会触发旧连接重连

```ts
connect() {
    this.manuallyClosed = false;
    if (this.ws) {
        this.ws.onclose = null; // 防止旧 socket 的关闭触发重连链
        this.ws.close();
    }
    this.ws = new WebSocket(this.url);
}
```

### 6. `send` 的静默忽略

```ts
ws.send('x'); // socket 未 OPEN：不发送、不排队、不抛错
```

需要在连接建立后再发送：

```ts
ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'auth', token }));
});
```

## 完整示例：带鉴权与重连状态的通知客户端

```ts
import { WebSocketClient } from '@lania-tool/tools/websocket-client';
import { EventBus } from '@lania-tool/tools/event-bus';

const bus = new EventBus();
bus.registerNamespace('realtime');

const ws = new WebSocketClient({
    url: `wss://example.com/ws?token=${encodeURIComponent(token)}`,
    reconnectInterval: 2000,
    heartbeatInterval: 25_000,
    maxReconnectAttempts: 8,
});

let pending: string[] = [];

ws.on('open', () => {
    // 重连后重新订阅，并补发未发送的消息
    ws.send(JSON.stringify({ type: 'subscribe', channels: ['news', 'order'] }));
    pending.forEach((message) => ws.send(message));
    pending = [];
});

ws.on('message', (raw) => {
    const message = JSON.parse(raw) as { type: string; payload: unknown };
    if (message.type === 'pong') return;
    void bus.emit(message.type, message.payload, { namespace: 'realtime' });
});

ws.on('close', () => {
    // 达到重连上限，提示用户
    bus.emit('connection:lost', undefined, { namespace: 'realtime' });
});

export function send(message: string) {
    if ((ws as any).readyState === 1) ws.send(message);
    else pending.push(message);
}
```

> `readyState` 是私有字段，上面的判断只是示例。更简单的做法是维护自己的 `connected` 标记，在 `open` / `close` 回调里切换。

## 注意事项

| 问题 | 说明 |
| --- | --- |
| 认证 | 浏览器 `WebSocket` 不支持自定义 header；常用 URL 参数或握手后首条消息认证 |
| `send` 静默失败 | 非 OPEN 状态不会排队 |
| 心跳内容 | 固定 `'ping'`，服务端需兼容 |
| 重复 `close()` | 安全 |
| 消息格式 | 回调收到字符串；二进制需自行设置 `binaryType` |
| 页签休眠 | 浏览器可能降低定时器频率，心跳不精确 |
| 重连风暴 | 多个页面同时重连会给服务端压力，建议加随机抖动 |

### 指数退避

组件只支持固定间隔。需要退避时关闭内置重连，自行调度：

```ts
let attempt = 0;

function connectWithBackoff() {
    const ws = new WebSocketClient({ url, maxReconnectAttempts: 0 });
    ws.on('open', () => (attempt = 0));
    ws.on('close', () => {
        attempt++;
        const delay = Math.min(1000 * 2 ** attempt, 30_000);
        setTimeout(connectWithBackoff, delay);
    });
}
```

## 测试覆盖

`packages/tools/tests/client.test.ts` 与 `edge-cases.test.ts`：

- 构造即连接；
- open / message / error / close 回调；
- 心跳仅在 OPEN 时发送、间隔为 0 不启动；
- 重连次数耗尽后触发 close；
- 成功连接后重置重连计数；
- 主动关闭后不再重连、心跳停止；
- 替换连接时旧连接不触发重连；
- 非 OPEN 状态 `send` 不发送；
- `WebSocket.OPEN` 缺失时回退为 1。
