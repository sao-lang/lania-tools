/**
 * ============================
 * 🔹 WebSocketClient 通用封装
 * ============================
 */

/** WebSocket 事件回调类型 */
type WebSocketEventCallback = (event: Event) => void;

/** WebSocket 消息回调类型 */
type WebSocketMessageCallback = (message: string) => void;

/** WebSocket 客户端选项 */
interface WebSocketOptions {
    url: string; // WebSocket 连接 URL
    reconnectInterval?: number; // 重连间隔（毫秒），默认 5000
    heartbeatInterval?: number; // 心跳间隔（毫秒），默认 30000
    maxReconnectAttempts?: number; // 最大重连次数，默认无限
}

/**
 * @class WebSocketClient
 * @description 封装 WebSocket，支持自动重连、心跳检测、事件回调
 */
export class WebSocketClient {
    private ws: WebSocket | null = null;
    private url: string;
    private reconnectInterval: number;
    private heartbeatInterval: number;
    private maxReconnectAttempts: number;
    private reconnectAttempts: number = 0;
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    private onOpen: WebSocketEventCallback = () => {};
    private onClose: WebSocketEventCallback = () => {};
    private onError: WebSocketEventCallback = () => {};
    private onMessage: WebSocketMessageCallback = () => {};

    /**
     * @constructor
     * @param options WebSocket 客户端配置
     */
    constructor(options: WebSocketOptions) {
        this.url = options.url;
        this.reconnectInterval = options.reconnectInterval || 5000;
        this.heartbeatInterval = options.heartbeatInterval || 30000;
        this.maxReconnectAttempts = options.maxReconnectAttempts || Infinity;
    }

    /** 建立 WebSocket 连接 */
    private connect() {
        if (this.ws) this.ws.close();
        this.ws = new WebSocket(this.url);
        this.ws.onopen = this.handleOpen.bind(this);
        this.ws.onmessage = this.handleMessage.bind(this);
        this.ws.onerror = this.handleError.bind(this);
        this.ws.onclose = this.handleClose.bind(this);
    }

    /** 连接成功回调 */
    private handleOpen(event: Event) {
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.onOpen(event);
    }

    /** 消息接收回调 */
    private handleMessage(event: MessageEvent) {
        this.onMessage(event.data);
    }

    /** 错误回调 */
    private handleError(event: Event) {
        this.onError(event);
    }

    /** 连接关闭回调 */
    private handleClose(event: CloseEvent) {
        this.stopHeartbeat();
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            setTimeout(() => this.connect(), this.reconnectInterval);
            this.reconnectAttempts++;
        } else {
            this.onClose(event);
        }
    }

    /** 启动心跳检测 */
    private startHeartbeat() {
        if (this.heartbeatInterval > 0) {
            this.heartbeatTimer = setInterval(() => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send('ping'); // 可自定义心跳消息
                }
            }, this.heartbeatInterval);
        }
    }

    /** 停止心跳检测 */
    private stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    /**
     * @description 发送消息
     * @param message 待发送的字符串
     */
    public send(message: string) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(message);
        }
    }

    /** 主动关闭 WebSocket 连接 */
    public close() {
        if (this.ws) this.ws.close();
    }

    /**
     * @description 注册事件回调
     * @param event 事件类型：'open' | 'close' | 'error' | 'message'
     * @param callback 回调函数
     */
    public on(event: 'open', callback: WebSocketEventCallback): void;
    public on(event: 'close', callback: WebSocketEventCallback): void;
    public on(event: 'error', callback: WebSocketEventCallback): void;
    public on(event: 'message', callback: WebSocketMessageCallback): void;
    public on(event: string, callback: any): void {
        if (event === 'open') this.onOpen = callback;
        else if (event === 'close') this.onClose = callback;
        else if (event === 'error') this.onError = callback;
        else if (event === 'message') this.onMessage = callback;
    }
}

export default WebSocketClient;
