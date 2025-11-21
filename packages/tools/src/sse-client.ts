/**
 * SSE（Server-Sent Events）客户端类型定义
 * 处理服务端推送事件，支持自动重连
 */

/** 消息回调类型 */
type SSEEventCallback = (data: any) => void;

/** 错误回调类型 */
type SSEErrorCallback = (error: Event) => void;

/** SSE 初始化选项 */
interface SSEOptions {
    url: string; // SSE 服务端 URL
    reconnectInterval?: number; // 自动重连间隔，单位毫秒，默认 5000
}

/**
 * SSEClient
 * - 自动连接 SSE 服务
 * - 自动处理消息与错误
 * - 支持可配置重连机制
 */
export class SSEClient {
    private eventSource: EventSource | null = null; // 原生 EventSource 对象
    private url: string; // SSE URL
    private reconnectInterval: number; // 重连间隔
    // eslint-disable-next-line no-undef
    private reconnectTimer: NodeJS.Timeout | null = null; // 重连定时器

    private onMessage: SSEEventCallback = () => {}; // 消息回调
    private onError: SSEErrorCallback = () => {}; // 错误回调

    constructor(options: SSEOptions) {
        this.url = options.url;
        this.reconnectInterval = options.reconnectInterval || 5000;
        this.connect();
    }

    /** 初始化连接 SSE */
    private connect() {
        // 如果已有连接，先关闭
        if (this.eventSource) {
            this.eventSource.close();
        }

        this.eventSource = new EventSource(this.url);

        // 消息事件处理
        this.eventSource.onmessage = this.handleMessage.bind(this);

        // 错误事件处理
        this.eventSource.onerror = this.handleError.bind(this);

        // 打开连接事件
        this.eventSource.onopen = () => {
            console.log('SSE connected');
            this.stopReconnect(); // 连接成功后停止重连
        };
    }

    /** 处理收到的消息 */
    private handleMessage(event: MessageEvent) {
        this.onMessage(event.data);
    }

    /** 处理错误事件，触发回调并开始重连 */
    private handleError(event: Event) {
        console.error('SSE error:', event);
        this.startReconnect();
        this.onError(event);
    }

    /** 启动自动重连 */
    private startReconnect() {
        if (!this.reconnectTimer) {
            this.reconnectTimer = setTimeout(() => {
                this.connect();
            }, this.reconnectInterval);
        }
    }

    /** 停止自动重连 */
    private stopReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    /**
     * 注册事件回调
     * @param event 'message' | 'error'
     * @param callback 回调函数
     */
    public on(event: 'message', callback: SSEEventCallback): void;
    public on(event: 'error', callback: SSEErrorCallback): void;
    public on(event: string, callback: any): void {
        if (event === 'message') {
            this.onMessage = callback;
        } else if (event === 'error') {
            this.onError = callback;
        }
    }

    /** 手动关闭 SSE 连接 */
    public close() {
        if (this.eventSource) {
            this.eventSource.close();
        }
    }
}

export default SSEClient;
