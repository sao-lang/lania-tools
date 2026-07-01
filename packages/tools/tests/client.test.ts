import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SSEClient } from '../src/sse-client';
import { WebSocketClient } from '../src/websocket-client';

describe('SSEClient', () => {
    let originalEventSource: any;

    beforeEach(() => {
        originalEventSource = (globalThis as any).EventSource;
    });

    afterEach(() => {
        (globalThis as any).EventSource = originalEventSource;
        vi.restoreAllMocks();
    });

    it('should register message and error handlers', () => {
        const onmessage = vi.fn();
        const onerror = vi.fn();
        const fakeEventSource: {
            onmessage: (evt: any) => void;
            onerror: (evt: any) => void;
            onopen: any;
            close: any;
        } = {
            onmessage: vi.fn(),
            onerror: vi.fn(),
            onopen: null,
            close: vi.fn(),
        };
        (globalThis as any).EventSource = vi.fn(() => fakeEventSource);

        const client = new SSEClient({ url: '/sse', reconnectInterval: 1000 });
        client.on('message', onmessage);
        client.on('error', onerror);

        fakeEventSource.onmessage({ data: 'hello' } as any);
        fakeEventSource.onerror({ type: 'error' } as any);

        expect(onmessage).toHaveBeenCalledWith('hello');
        expect(onerror).toHaveBeenCalled();
        client.close();
        expect(fakeEventSource.close).toHaveBeenCalled();
    });
});

describe('WebSocketClient', () => {
    let originalWebSocket: any;

    beforeEach(() => {
        originalWebSocket = (globalThis as any).WebSocket;
    });

    afterEach(() => {
        (globalThis as any).WebSocket = originalWebSocket;
        vi.restoreAllMocks();
    });

    it('should handle open, message, error, and close events', () => {
        let createdWebSocket: any = null;
        const MockWebSocket = vi.fn(function (this: any, url: string) {
            createdWebSocket = {
                url,
                onopen: null,
                onmessage: null,
                onerror: null,
                onclose: null,
                readyState: 1,
                send: vi.fn(),
                close: vi.fn(),
            };
            return createdWebSocket;
        }) as any;
        (MockWebSocket as any).OPEN = 1;
        (globalThis as any).WebSocket = MockWebSocket;

        const client = new WebSocketClient({ url: 'ws://localhost', reconnectInterval: 100, heartbeatInterval: 100, maxReconnectAttempts: 1 });
        (client as any).connect();
        const onOpen = vi.fn();
        const onMessage = vi.fn();
        const onError = vi.fn();
        const onClose = vi.fn();

        client.on('open', onOpen);
        client.on('message', onMessage);
        client.on('error', onError);
        client.on('close', onClose);

        createdWebSocket.onopen?.({} as any);
        createdWebSocket.onmessage?.({ data: 'data' } as any);
        createdWebSocket.onerror?.({ type: 'error' } as any);
        createdWebSocket.onclose?.({ code: 1000 } as any);

        expect(onOpen).toHaveBeenCalled();
        expect(onMessage).toHaveBeenCalledWith('data');
        expect(onError).toHaveBeenCalled();
        client.close();
        expect(createdWebSocket.close).toHaveBeenCalled();
    });

    it('should send message only when socket is open', () => {
        let createdWebSocket: any = null;
        const MockWebSocket = vi.fn(function (this: any, url: string) {
            createdWebSocket = {
                url,
                onopen: null,
                onmessage: null,
                onerror: null,
                onclose: null,
                readyState: 1,
                send: vi.fn(),
                close: vi.fn(),
            };
            return createdWebSocket;
        }) as any;
        (MockWebSocket as any).OPEN = 1;
        (globalThis as any).WebSocket = MockWebSocket;

        const client = new WebSocketClient({ url: 'ws://localhost', reconnectInterval: 100, heartbeatInterval: 100, maxReconnectAttempts: 1 });
        (client as any).connect();
        client.send('hello');
        expect(createdWebSocket.send).toHaveBeenCalledWith('hello');
    });
});
