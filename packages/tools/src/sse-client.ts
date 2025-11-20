type SSEEventCallback = (data: any) => void;
type SSEErrorCallback = (error: Event) => void;

interface SSEOptions {
    url: string;
    reconnectInterval?: number; // Reconnect interval in milliseconds
}

export class SSEClient {
    private eventSource: EventSource | null = null;
    private url: string;
    private reconnectInterval: number;
    private reconnectTimer: NodeJS.Timeout | null = null;

    private onMessage: SSEEventCallback = () => {};
    private onError: SSEErrorCallback = () => {};

    constructor(options: SSEOptions) {
        this.url = options.url;
        this.reconnectInterval = options.reconnectInterval || 5000;
        this.connect();
    }

    private connect() {
        if (this.eventSource) {
            this.eventSource.close();
        }

        this.eventSource = new EventSource(this.url);
        this.eventSource.onmessage = this.handleMessage.bind(this);
        this.eventSource.onerror = this.handleError.bind(this);
        this.eventSource.onopen = () => {
            console.log('SSE connected');
            this.stopReconnect();
        };
    }

    private handleMessage(event: MessageEvent) {
        this.onMessage(event.data);
    }

    private handleError(event: Event) {
        console.error('SSE error:', event);
        this.startReconnect();
        this.onError(event);
    }

    private startReconnect() {
        if (!this.reconnectTimer) {
            this.reconnectTimer = setTimeout(() => {
                this.connect();
            }, this.reconnectInterval);
        }
    }

    private stopReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    public on(event: 'message', callback: SSEEventCallback): void;
    public on(event: 'error', callback: SSEErrorCallback): void;
    public on(event: string, callback: any): void {
        if (event === 'message') {
            this.onMessage = callback;
        } else if (event === 'error') {
            this.onError = callback;
        }
    }

    public close() {
        if (this.eventSource) {
            this.eventSource.close();
        }
    }
}

export default SSEClient;