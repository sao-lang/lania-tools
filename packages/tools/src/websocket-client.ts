type WebSocketEventCallback = (event: Event) => void;
type WebSocketMessageCallback = (message: string) => void;

interface WebSocketOptions {
    url: string;
    reconnectInterval?: number; // Reconnect interval in milliseconds
    heartbeatInterval?: number; // Heartbeat interval in milliseconds
    maxReconnectAttempts?: number; // Maximum number of reconnect attempts
}

export class WebSocketClient {
    private ws: WebSocket | null = null;
    private url: string;
    private reconnectInterval: number;
    private heartbeatInterval: number;
    private maxReconnectAttempts: number;
    private reconnectAttempts: number = 0;
    // eslint-disable-next-line no-undef
    private heartbeatTimer: NodeJS.Timeout | null = null;

    private onOpen: WebSocketEventCallback = () => {};
    private onClose: WebSocketEventCallback = () => {};
    private onError: WebSocketEventCallback = () => {};
    private onMessage: WebSocketMessageCallback = () => {};

    constructor(options: WebSocketOptions) {
        this.url = options.url;
        this.reconnectInterval = options.reconnectInterval || 5000;
        this.heartbeatInterval = options.heartbeatInterval || 30000;
        this.maxReconnectAttempts = options.maxReconnectAttempts || Infinity;
    }

    private connect() {
        if (this.ws) {
            this.ws.close();
        }

        this.ws = new WebSocket(this.url);
        this.ws.onopen = this.handleOpen.bind(this);
        this.ws.onmessage = this.handleMessage.bind(this);
        this.ws.onerror = this.handleError.bind(this);
        this.ws.onclose = this.handleClose.bind(this);
    }

    private handleOpen(event: Event) {
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.onOpen(event);
    }

    private handleMessage(event: MessageEvent) {
        this.onMessage(event.data);
    }

    private handleError(event: Event) {
        this.onError(event);
    }

    private handleClose(event: CloseEvent) {
        this.stopHeartbeat();
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            setTimeout(() => this.connect(), this.reconnectInterval);
            this.reconnectAttempts++;
        } else {
            this.onClose(event);
        }
    }

    private startHeartbeat() {
        if (this.heartbeatInterval > 0) {
            this.heartbeatTimer = setInterval(() => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send('ping'); // Simple ping message or any other heartbeat message
                }
            }, this.heartbeatInterval);
        }
    }

    private stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    public send(message: string) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(message);
        }
    }

    public close() {
        if (this.ws) {
            this.ws.close();
        }
    }

    public on(event: 'open', callback: WebSocketEventCallback): void;
    public on(event: 'close', callback: WebSocketEventCallback): void;
    public on(event: 'error', callback: WebSocketEventCallback): void;
    public on(event: 'message', callback: WebSocketMessageCallback): void;
    public on(event: string, callback: any): void {
        if (event === 'open') {
            this.onOpen = callback;
        } else if (event === 'close') {
            this.onClose = callback;
        } else if (event === 'error') {
            this.onError = callback;
        } else if (event === 'message') {
            this.onMessage = callback;
        }
    }
}

export default WebSocketClient;
