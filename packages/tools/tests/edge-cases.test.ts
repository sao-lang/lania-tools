import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('type() fallback', () => {
    it('falls back to object for unknown Symbol.toStringTag values', async () => {
        const { type } = await import('../src/type');
        class Tagged {
            get [Symbol.toStringTag]() {
                return 'TotallyUnknownTag';
            }
        }
        expect(type(new Tagged())).toBe('object');
    });
});

describe('Validator uncovered branches', () => {
    it('maxLength rejects non-strings', async () => {
        const { Rules } = await import('../src/validator');
        expect(Rules.maxLength(3)(123 as any)).toMatchObject({ status: false });
    });

    it('max rejects non-numbers', async () => {
        const { Rules } = await import('../src/validator');
        expect(Rules.max(3)('abc' as any)).toMatchObject({ status: false });
    });

    it('min rejects non-numbers', async () => {
        const { Rules } = await import('../src/validator');
        expect(Rules.min(3)(null as any)).toMatchObject({ status: false });
    });

    it('uses a generic message when a failing rule omits one', async () => {
        const { Validator } = await import('../src/validator');
        const validator = new Validator({ name: () => ({ status: false }) });
        const result = await validator.validate({ name: 'x' });
        expect(result).toEqual({ isValid: false, errors: { name: 'Validation failed' } });
    });
});

describe('copy() error handling', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('logs and swallows clipboard write failures', async () => {
        const { copy } = await import('../src/tools');
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
            configurable: true,
        });

        await expect(copy({ text: 'hello' })).resolves.toBeUndefined();
        expect(consoleError).toHaveBeenCalledWith(
            'Failed to copy text: ',
            expect.any(Error),
        );
    });

    it('swallows execCommand failures in the fallback path', async () => {
        const { copy } = await import('../src/tools');
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
        Object.defineProperty(document, 'execCommand', {
            value: vi.fn(() => {
                throw new Error('execCommand blocked');
            }),
            configurable: true,
        });

        await expect(copy({ text: 'fallback' })).resolves.toBeUndefined();
        expect(consoleError).toHaveBeenCalledWith(
            'Fallback: Failed to copy text:',
            expect.any(Error),
        );
    });

    it('logs image copy failures', async () => {
        const { copy } = await import('../src/tools');
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.stubGlobal(
            'fetch',
            vi.fn().mockRejectedValue(new Error('network down')),
        );
        Object.defineProperty(navigator, 'clipboard', {
            value: { write: vi.fn().mockResolvedValue(undefined) },
            configurable: true,
        });

        await expect(copy({ imageUrl: 'https://example.com/a.png' })).resolves.toBeUndefined();
        expect(consoleError).toHaveBeenCalledWith(
            'Failed to copy image: ',
            expect.any(Error),
        );
    });

    it('warns when the clipboard cannot handle images', async () => {
        const { copy } = await import('../src/tools');
        const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });

        await copy({ imageUrl: 'https://example.com/a.png' });
        expect(consoleWarn).toHaveBeenCalledWith('Clipboard API not available for images');
    });

    it('throws when neither text nor imageUrl is provided', async () => {
        const { copy } = await import('../src/tools');
        await expect(copy({})).rejects.toThrow('Either text or imageUrl must be provided');
    });
});

describe('Store plugin errors and watchers', () => {
    it('notifies plugins when a reducer throws and rethrows', async () => {
        const { Store } = await import('../src/store');
        const onError = vi.fn();
        const store = new Store({
            initialState: { count: 0 },
            reducers: {
                boom: () => {
                    throw new Error('reducer failed');
                },
            },
            plugins: [{ onError }],
        });

        await expect(store.dispatch({ type: 'boom' } as any)).rejects.toThrow('reducer failed');
        expect(onError).toHaveBeenCalledWith(store, expect.any(Error));
        expect((onError.mock.calls[0][1] as Error).message).toBe('reducer failed');
    });

    it('keeps other watchers when one of them unsubscribes', async () => {
        const { Store } = await import('../src/store');
        const store = new Store({
            initialState: { count: 0 },
            reducers: {
                increment: (state: any) => ({ ...state, count: state.count + 1 }),
            },
        });

        const first = vi.fn();
        const second = vi.fn();
        const unsubscribeFirst = store.watchProperty('count', first);
        store.watchProperty('count', second);

        await store.actions.increment(undefined as any);
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);

        unsubscribeFirst();
        await store.actions.increment(undefined as any);
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(2);
    });
});

describe('Draggable touch teardown', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('removes touch listeners and cancels a pending animation frame', async () => {
        const { Draggable } = await import('../src/draggable');
        const element = document.createElement('div');
        document.body.appendChild(element);

        const cancelAnimationFrame = vi.fn();
        vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);

        const draggable = new Draggable(element, { enableTouch: true });
        draggable.bindEvents();
        (draggable as any).requestId = 42;

        const removeSpy = vi.spyOn(element, 'removeEventListener');
        expect(() => draggable.unbindEvents()).not.toThrow();
        expect(removeSpy).toHaveBeenCalledWith('touchstart', expect.any(Function), {
            passive: false,
        });
        expect(removeSpy).toHaveBeenCalledWith('touchend', expect.any(Function));
        expect(cancelAnimationFrame).toHaveBeenCalledWith(42);
        expect((draggable as any).requestId).toBeNull();

        element.remove();
        vi.unstubAllGlobals();
    });

    it('does nothing extra when touch support is disabled', async () => {
        const { Draggable } = await import('../src/draggable');
        const element = document.createElement('div');
        document.body.appendChild(element);
        const draggable = new Draggable(element, { enableTouch: false });
        draggable.bindEvents();
        expect(() => draggable.unbindEvents()).not.toThrow();
        element.remove();
    });
});

/** Waits for an assertion-style condition (vitest 0.33 has no vi.waitFor). */
async function waitUntil(condition: () => boolean, timeout = 2000, interval = 10) {
    const startedAt = Date.now();
    while (!condition()) {
        if (Date.now() - startedAt > timeout) throw new Error('waitUntil timed out');
        await new Promise((resolve) => setTimeout(resolve, interval));
    }
}

describe('VirtualScroller edge cases', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        container.id = 'edge-scroller';
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('logs when the initial load returns no items', async () => {
        const { VirtualScroller } = await import('../src/virtual-scroller');
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const loadMore = vi.fn().mockResolvedValue([]);
        new VirtualScroller({
            containerSelector: '#edge-scroller',
            estimatedItemHeight: 50,
            bufferSize: 2,
            loadMoreCallback: loadMore,
        });
        await waitUntil(() => log.mock.calls.length > 0);
        expect(log).toHaveBeenCalledWith('No initial data to display.');
    });

    it('logs and recovers when the loader rejects', async () => {
        const { VirtualScroller } = await import('../src/virtual-scroller');
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const loadMore = vi.fn().mockRejectedValue(new Error('load failed'));
        const scroller = new VirtualScroller({
            containerSelector: '#edge-scroller',
            estimatedItemHeight: 50,
            bufferSize: 2,
            loadMoreCallback: loadMore,
        });

        await waitUntil(() => error.mock.calls.length > 0);
        expect(error).toHaveBeenCalledWith('Error loading data:', expect.any(Error));

        // isLoading was reset, so a new call is allowed.
        loadMore.mockResolvedValue([{ id: 1, text: 'Item' }]);
        await scroller.loadMore();
        expect(loadMore).toHaveBeenCalledTimes(2);
    });

    it('ignores concurrent loadMore calls while loading', async () => {
        const { VirtualScroller } = await import('../src/virtual-scroller');
        let resolveLoad: (items: any[]) => void = () => {};
        const loadMore = vi.fn(
            () =>
                new Promise<any[]>((resolve) => {
                    resolveLoad = resolve;
                }),
        );
        const scroller = new VirtualScroller({
            containerSelector: '#edge-scroller',
            estimatedItemHeight: 50,
            bufferSize: 2,
            loadMoreCallback: loadMore,
        });

        const first = scroller.loadMore();
        await scroller.loadMore();
        expect(loadMore).toHaveBeenCalledTimes(1);
        resolveLoad([{ id: 1, text: 'Item' }]);
        await first;
    });

    it('recalculates the visible range on resize', async () => {
        const { VirtualScroller } = await import('../src/virtual-scroller');
        const loadMore = vi
            .fn()
            .mockResolvedValue(Array.from({ length: 30 }, (_, i) => ({ id: i, text: `Item ${i}` })));
        const scroller = new VirtualScroller({
            containerSelector: '#edge-scroller',
            estimatedItemHeight: 50,
            bufferSize: 2,
            loadMoreCallback: loadMore,
        });
        await waitUntil(() => (scroller as any).allItems.length === 30);

        const updateRange = vi.spyOn(scroller as any, 'updateVisibleRange');
        Object.defineProperty(container, 'clientHeight', { value: 500, configurable: true });
        (scroller as any).onResize();
        expect(updateRange).toHaveBeenCalled();
        expect((scroller as any).viewportHeight).toBe(500);

        // Same height again: nothing recomputed.
        updateRange.mockClear();
        (scroller as any).onResize();
        expect(updateRange).not.toHaveBeenCalled();
    });
});

describe('IndexedDBHelper branches', () => {
    let originalIndexedDB: any;

    beforeEach(() => {
        originalIndexedDB = (globalThis as any).indexedDB;
    });

    afterEach(() => {
        (globalThis as any).indexedDB = originalIndexedDB;
        vi.restoreAllMocks();
    });

    function createStore(record?: any, options: { failGet?: boolean } = {}) {
        const request: any = {
            onsuccess: null,
            onerror: null,
        };
        if (!options.failGet) {
            request.result = record;
        }
        const store = {
            get: vi.fn(() => request),
            put: vi.fn(),
            delete: vi.fn(),
            clear: vi.fn(),
            getAllKeys: vi.fn(),
            count: vi.fn(),
            openCursor: vi.fn(),
        };
        const transaction: any = {
            objectStore: vi.fn(() => store),
            oncomplete: null,
            onerror: null,
            error: new Error('tx failed'),
        };
        const db: any = {
            transaction: vi.fn(() => transaction),
            createObjectStore: vi.fn(),
        };
        const openRequest: any = {
            onupgradeneeded: null,
            onsuccess: null,
            onerror: null,
            result: db,
            error: new Error('open failed'),
        };
        (globalThis as any).indexedDB = { open: vi.fn(() => openRequest) };
        return { request, store, transaction, db, openRequest };
    }

    it('creates the object store on upgrade', async () => {
        const { IndexedDBHelper } = await import('../src/web-storage-helper');
        const { db, openRequest, transaction } = createStore();

        const promise = IndexedDBHelper.set('id', { a: 1 });
        openRequest.onupgradeneeded({ target: openRequest } as any);
        expect(db.createObjectStore).toHaveBeenCalledWith('myStore', { keyPath: 'id' });
        openRequest.onsuccess({ target: openRequest } as any);
        await new Promise((resolve) => setTimeout(resolve, 0));
        transaction.oncomplete?.();
        await expect(promise).resolves.toBeUndefined();
    });

    it('rejects when opening the database fails', async () => {
        const { IndexedDBHelper } = await import('../src/web-storage-helper');
        const { openRequest } = createStore();
        const promise = IndexedDBHelper.get('id');
        expect(() => openRequest.onerror({ target: openRequest } as any)).not.toThrow();
        await expect(promise).rejects.toThrow('open failed');
    });

    it('deletes an expired record and resolves null', async () => {
        const { IndexedDBHelper } = await import('../src/web-storage-helper');
        const expired = JSON.stringify({ value: 'old', expiresAt: Date.now() - 1000 });
        const { request, openRequest } = createStore({ value: expired });
        const deleteSpy = vi.spyOn(IndexedDBHelper, 'delete').mockResolvedValue(undefined);

        const promise = IndexedDBHelper.get('id');
        openRequest.onsuccess({ target: openRequest } as any);
        await new Promise((resolve) => setTimeout(resolve, 0));
        request.onsuccess();

        await expect(promise).resolves.toBeNull();
        expect(deleteSpy).toHaveBeenCalledWith('id');
    });
});

describe('SSEClient lifecycle', () => {
    let originalEventSource: any;

    beforeEach(() => {
        originalEventSource = (globalThis as any).EventSource;
    });

    afterEach(() => {
        (globalThis as any).EventSource = originalEventSource;
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    function installEventSource() {
        const created: any[] = [];
        const MockEventSource = vi.fn(() => {
            const source: any = {
                onmessage: null,
                onerror: null,
                onopen: null,
                close: vi.fn(),
            };
            created.push(source);
            return source;
        });
        (globalThis as any).EventSource = MockEventSource;
        return { created, MockEventSource };
    }

    it('logs on open and clears a pending reconnect timer', async () => {
        const { SSEClient } = await import('../src/sse-client');
        vi.useFakeTimers();
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { created } = installEventSource();

        new SSEClient({ url: '/sse', reconnectInterval: 100 });
        created[0].onerror({ type: 'error' } as any);

        created[0].onopen();
        expect(log).toHaveBeenCalledWith('SSE connected');

        await vi.advanceTimersByTimeAsync(200);
        expect(created).toHaveLength(1);
    });

    it('reconnects after an error and closes the previous EventSource', async () => {
        const { SSEClient } = await import('../src/sse-client');
        vi.useFakeTimers();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const { created } = installEventSource();

        new SSEClient({ url: '/sse', reconnectInterval: 50 });
        created[0].onerror({ type: 'error' } as any);

        await vi.advanceTimersByTimeAsync(60);
        expect(created).toHaveLength(2);
        expect(created[0].close).toHaveBeenCalled();
    });

    it('does not reconnect after close()', async () => {
        const { SSEClient } = await import('../src/sse-client');
        vi.useFakeTimers();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { created } = installEventSource();

        const client = new SSEClient({ url: '/sse', reconnectInterval: 50 });
        client.on('error', vi.fn());
        client.close();
        created[0].onerror({ type: 'error' } as any);

        await vi.advanceTimersByTimeAsync(200);
        expect(created).toHaveLength(1);
    });

    it('defaults the reconnect interval to 5s', async () => {
        const { SSEClient } = await import('../src/sse-client');
        vi.useFakeTimers();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const { created } = installEventSource();

        new SSEClient({ url: '/sse' });
        created[0].onerror({ type: 'error' } as any);

        await vi.advanceTimersByTimeAsync(4_900);
        expect(created).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(200);
        expect(created).toHaveLength(2);
    });
});

describe('WebSocketClient lifecycle', () => {
    let originalWebSocket: any;

    beforeEach(() => {
        originalWebSocket = (globalThis as any).WebSocket;
    });

    afterEach(() => {
        (globalThis as any).WebSocket = originalWebSocket;
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    function installWebSocket() {
        const created: any[] = [];
        class MockWebSocket {
            static OPEN = 1;
            static CLOSED = 3;
            onopen: any = null;
            onmessage: any = null;
            onerror: any = null;
            onclose: any = null;
            readyState = 1;
            send = vi.fn();
            close = vi.fn(() => {
                this.readyState = 3;
            });
            constructor(public url: string) {
                created.push(this);
            }
        }
        (globalThis as any).WebSocket = MockWebSocket as any;
        return { created };
    }

    it('connects automatically on construction', async () => {
        const { WebSocketClient } = await import('../src/websocket-client');
        const { created } = installWebSocket();
        new WebSocketClient({ url: 'ws://localhost/auto' });
        expect(created).toHaveLength(1);
        expect(created[0].url).toBe('ws://localhost/auto');
    });

    it('sends heartbeats only while the socket is open', async () => {
        const { WebSocketClient } = await import('../src/websocket-client');
        vi.useFakeTimers();
        const { created } = installWebSocket();
        new WebSocketClient({ url: 'ws://localhost/hb', heartbeatInterval: 100 });

        created[0].onopen({} as any);
        await vi.advanceTimersByTimeAsync(250);
        expect(created[0].send).toHaveBeenCalledTimes(2);
        expect(created[0].send).toHaveBeenCalledWith('ping');

        created[0].readyState = 3;
        await vi.advanceTimersByTimeAsync(100);
        expect(created[0].send).toHaveBeenCalledTimes(2);
    });

    it('does not start a heartbeat when the interval is 0', async () => {
        const { WebSocketClient } = await import('../src/websocket-client');
        vi.useFakeTimers();
        const { created } = installWebSocket();
        new WebSocketClient({ url: 'ws://localhost/nohb', heartbeatInterval: 0 });
        created[0].onopen({} as any);
        await vi.advanceTimersByTimeAsync(1000);
        expect(created[0].send).not.toHaveBeenCalled();
    });

    it('reconnects until the attempt budget is exhausted, then fires close', async () => {
        const { WebSocketClient } = await import('../src/websocket-client');
        vi.useFakeTimers();
        const { created } = installWebSocket();
        const onClose = vi.fn();
        const client = new WebSocketClient({
            url: 'ws://localhost/reconnect',
            reconnectInterval: 50,
            maxReconnectAttempts: 2,
            heartbeatInterval: 0,
        });
        client.on('close', onClose);

        created[0].onclose({ code: 1006 } as any);
        await vi.advanceTimersByTimeAsync(60);
        expect(created).toHaveLength(2);

        created[1].onclose({ code: 1006 } as any);
        await vi.advanceTimersByTimeAsync(60);
        expect(created).toHaveLength(3);

        created[2].onclose({ code: 1006 } as any);
        await vi.advanceTimersByTimeAsync(200);
        expect(created).toHaveLength(3);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('resets the reconnect counter after a successful open', async () => {
        const { WebSocketClient } = await import('../src/websocket-client');
        vi.useFakeTimers();
        const { created } = installWebSocket();
        new WebSocketClient({
            url: 'ws://localhost/reset',
            reconnectInterval: 20,
            maxReconnectAttempts: 1,
            heartbeatInterval: 0,
        });

        created[0].onclose({} as any);
        await vi.advanceTimersByTimeAsync(30);
        expect(created).toHaveLength(2);

        created[1].onopen({} as any);
        created[1].onclose({} as any);
        await vi.advanceTimersByTimeAsync(30);
        expect(created).toHaveLength(3);
    });

    it('manual close stops reconnection and heartbeat', async () => {
        const { WebSocketClient } = await import('../src/websocket-client');
        vi.useFakeTimers();
        const { created } = installWebSocket();
        const client = new WebSocketClient({
            url: 'ws://localhost/manual',
            reconnectInterval: 20,
            heartbeatInterval: 50,
        });
        created[0].onopen({} as any);
        client.close();
        created[0].onclose({} as any);

        await vi.advanceTimersByTimeAsync(200);
        expect(created).toHaveLength(1);
        expect(created[0].send).not.toHaveBeenCalled();
    });

    it('closes a previous socket without triggering its reconnect', async () => {
        const { WebSocketClient } = await import('../src/websocket-client');
        vi.useFakeTimers();
        const { created } = installWebSocket();
        const client = new WebSocketClient({ url: 'ws://localhost/again', reconnectInterval: 20 });
        (client as any).connect();

        expect(created).toHaveLength(2);
        created[0].onclose?.({} as any);
        await vi.advanceTimersByTimeAsync(100);
        expect(created).toHaveLength(2);
    });

    it('ignores send() when the socket is not open', async () => {
        const { WebSocketClient } = await import('../src/websocket-client');
        const { created } = installWebSocket();
        const client = new WebSocketClient({ url: 'ws://localhost/closed' });
        created[0].readyState = 3;
        client.send('nope');
        expect(created[0].send).not.toHaveBeenCalled();
    });
});

describe('Additional branch coverage', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('exports a cancel error usable without Object.setPrototypeOf', async () => {
        const original = (Object as any).setPrototypeOf;
        delete (Object as any).setPrototypeOf;
        try {
            const { DebounceThrottleCancelError } = await import(
                '../src/axios/DebounceThrottleManager'
            );
            const error = new DebounceThrottleCancelError('legacy', 'debounce');
            expect(error.isCancel).toBe(true);
            expect(error.type).toBe('debounce');
        } finally {
            (Object as any).setPrototypeOf = original;
        }
    });

    it('rejects with a generic message when FileReader has no error object', async () => {
        const { UploadManager } = await import('../src/axios/UploadManager');
        const { GlobalConcurrencyController } = await import(
            '../src/axios/GlobalConcurrencyController'
        );
        const manager = new UploadManager({} as any, new GlobalConcurrencyController(1));
        const fakeBlob: any = { size: 1, arrayBuffer: undefined, slice: () => fakeBlob };

        class ReaderWithoutError {
            public error = null;
            public onload: any = null;
            public onerror: (() => void) | null = null;
            readAsArrayBuffer() {
                this.onerror?.();
            }
        }
        vi.stubGlobal('FileReader', ReaderWithoutError);
        await expect(manager.calculateChunkMd5(fakeBlob)).rejects.toThrow('Failed to read blob.');
    });

    it('tolerates a resume endpoint that omits the uploaded list', async () => {
        const { UploadManager } = await import('../src/axios/UploadManager');
        const { GlobalConcurrencyController } = await import(
            '../src/axios/GlobalConcurrencyController'
        );
        const post = vi.fn().mockResolvedValue({ data: {} });
        const get = vi.fn().mockResolvedValue({ data: {} });
        const manager = new UploadManager({ post, get } as any, new GlobalConcurrencyController(2));

        const file = new File(['abcdefghij'], 'file.txt');
        const result = await manager.uploadFile('/upload', file, {
            enableResume: true,
            getUploadedChunksUrl: '/uploaded',
        });
        expect(result.totalChunks).toBe(Math.ceil(file.size / (5 * 1024 * 1024)));
        expect(post).toHaveBeenCalledTimes(1);
    });

    it('falls back to 0 when axios omits the upload total', async () => {
        const { UploadManager } = await import('../src/axios/UploadManager');
        const { GlobalConcurrencyController } = await import(
            '../src/axios/GlobalConcurrencyController'
        );
        const onChunkProgress = vi.fn();
        const post = vi.fn(async (_url: string, _data: any, config: any) => {
            config.onUploadProgress({ loaded: 5 });
            return { data: {} };
        });
        const { default: axios } = await import('axios');
        const manager = new UploadManager({ post } as any, new GlobalConcurrencyController(1));

        await manager.uploadChunk(
            '/upload',
            new Blob(['abcde']),
            0,
            1,
            axios.CancelToken.source(),
            undefined,
            undefined,
            onChunkProgress,
        );
        expect(onChunkProgress).toHaveBeenCalledWith(5, 0);
    });

    it('injects tokens into plain object headers', async () => {
        const { InterceptorManager } = await import('../src/axios/InterceptorManager');
        const manager: any = new InterceptorManager({
            instance: {} as any,
            cacheManager: { get: () => null, set: () => {} } as any,
            debounceThrottleManager: {} as any,
            instanceOptions: { tokenProvider: () => 'plain-token' } as any,
        } as any);
        const config: any = { headers: {} };
        await manager.tokenMiddleware({ config });
        expect(config.headers.Authorization).toBe('Bearer plain-token');
    });

    it('ignores a request error interceptor that does not return a config', async () => {
        const { InterceptorManager } = await import('../src/axios/InterceptorManager');
        const manager: any = new InterceptorManager({
            instance: {} as any,
            cacheManager: { get: () => null, set: () => {} } as any,
            debounceThrottleManager: {} as any,
            instanceOptions: {
                interceptors: { request: { onRejected: () => undefined } },
            } as any,
        } as any);
        await expect(manager.handleRequestError(new Error('nope'))).rejects.toThrow('nope');
    });

    it('returns raw text when filename* cannot be decoded', async () => {
        const { AxiosWrapper } = await import('../src/axios');
        const wrapper = new AxiosWrapper({});
        const instance: any = (wrapper as any).instance;
        instance.defaults.adapter = async (config: any) => ({
            data: new Blob(['x']),
            status: 200,
            statusText: 'OK',
            headers: { 'content-disposition': 'attachment; filename*=UTF-8\'\'%E0%A4%A' },
            config,
            request: {},
        });
        const clicks: string[] = [];
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
            this: HTMLAnchorElement,
        ) {
            clicks.push(this.download);
        });
        Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:x', writable: true });
        Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, writable: true });

        await wrapper.downloadFile('/download/file.bin');
        expect(clicks[0]).toBe('%E0%A4%A');
    });

    it('falls back to the url when Content-Disposition has no filename', async () => {
        const { AxiosWrapper } = await import('../src/axios');
        const wrapper = new AxiosWrapper({});
        const instance: any = (wrapper as any).instance;
        instance.defaults.adapter = async (config: any) => ({
            data: new Blob(['x']),
            status: 200,
            statusText: 'OK',
            headers: { 'content-disposition': 'attachment' },
            config,
            request: {},
        });
        const clicks: string[] = [];
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
            this: HTMLAnchorElement,
        ) {
            clicks.push(this.download);
        });
        Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:x', writable: true });
        Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, writable: true });

        await wrapper.downloadFile('/files/archive.tar.gz');
        expect(clicks[0]).toBe('archive.tar.gz');
    });

    it('clears a pending throttle timer before running immediately', async () => {
        const { throttle } = await import('../src/tools');
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const fn = vi.fn();
        const throttled = throttle(fn, 100, { trailing: true });

        throttled(); // schedules a trailing call
        vi.setSystemTime(200);
        throttled(); // remaining <= 0, must clear the pending timer
        expect(fn).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(200);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('renders custom item content as an element', async () => {
        const { VirtualScroller } = await import('../src/virtual-scroller');
        const container = document.createElement('div');
        container.id = 'render-scroller';
        document.body.appendChild(container);

        const items = Array.from({ length: 10 }, (_, i) => ({ id: i, label: `custom-${i}` }));
        const loadMore = vi.fn().mockResolvedValue(items);
        const renderItemContent = vi.fn((data: any) => {
            const span = document.createElement('span');
            span.textContent = data.label;
            return span;
        });
        new VirtualScroller({
            containerSelector: '#render-scroller',
            estimatedItemHeight: 40,
            bufferSize: 2,
            loadMoreCallback: loadMore,
            renderItemContent,
        });

        await waitUntil(() => container.querySelectorAll('[data-id]').length > 0);
        expect(renderItemContent).toHaveBeenCalledWith({ id: 0, label: 'custom-0' });
        expect(container.querySelector('span')?.textContent).toBe('custom-0');
        container.remove();
    });

    it('sets a cookie with an explicit expiry', async () => {
        const { CookieHelper } = await import('../src/web-storage-helper');
        const setSpy = vi.spyOn(document, 'cookie', 'set');
        CookieHelper.set('token', { a: 1 }, { expiresInSeconds: 10 });
        expect(setSpy).toHaveBeenCalled();
        const cookieValue = String(setSpy.mock.calls[0][0]);
        expect(cookieValue).toContain('token=');
        expect(cookieValue).toContain('expires=');
    });

    it('reuses the derived state cache and reports missing keys', async () => {
        const { Store } = await import('../src/store');
        const store = new Store({
            initialState: { count: 2 },
            reducers: {},
            derivedState: { double: (state: any) => state.count * 2 },
        });
        expect(store.getDerivedState('double')).toBe(4);
        expect(store.getDerivedState()).toEqual({ double: 4 });
        expect((store as any).getDerivedState('missing')).toBeUndefined();
    });

    it('accepts a single plugin in addPlugin', async () => {
        const { Store } = await import('../src/store');
        const onInit = vi.fn();
        const store = new Store({ initialState: { count: 0 }, reducers: {} });
        store.addPlugin({ onInit });
        expect(onInit).toHaveBeenCalledWith(store);
    });

    it('uses 1 as a fallback when WebSocket.OPEN is unavailable', async () => {
        const { WebSocketClient } = await import('../src/websocket-client');
        const created: any[] = [];
        class NoOpenWebSocket {
            onopen: any = null;
            onmessage: any = null;
            onerror: any = null;
            onclose: any = null;
            readyState = 1;
            send = vi.fn();
            close = vi.fn();
            constructor(public url: string) {
                created.push(this);
            }
        }
        vi.stubGlobal('WebSocket', NoOpenWebSocket as any);

        const client = new WebSocketClient({ url: 'ws://x', heartbeatInterval: 0, reconnectInterval: 10 });
        client.send('hello');
        expect(created[0].send).toHaveBeenCalledWith('hello');
    });

    it('does nothing when the socket has been removed', async () => {
        const { WebSocketClient } = await import('../src/websocket-client');
        class MockWebSocket {
            static OPEN = 1;
            onopen: any = null;
            onmessage: any = null;
            onerror: any = null;
            onclose: any = null;
            readyState = 1;
            send = vi.fn();
            close = vi.fn();
        }
        vi.stubGlobal('WebSocket', MockWebSocket as any);
        const client = new WebSocketClient({ url: 'ws://y', heartbeatInterval: 0 });
        (client as any).ws = null;
        expect(() => client.send('x')).not.toThrow();
    });

    it('ignores a second SSE error while a reconnect is already scheduled', async () => {
        const originalEventSource = (globalThis as any).EventSource;
        const created: any[] = [];
        vi.stubGlobal(
            'EventSource',
            vi.fn(() => {
                const source: any = { onmessage: null, onerror: null, onopen: null, close: vi.fn() };
                created.push(source);
                return source;
            }),
        );
        vi.useFakeTimers();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});

        const { SSEClient } = await import('../src/sse-client');
        new SSEClient({ url: '/sse', reconnectInterval: 100 });
        created[0].onerror({ type: 'error' } as any);
        created[0].onerror({ type: 'error' } as any);

        await vi.advanceTimersByTimeAsync(150);
        expect(created).toHaveLength(2);
        (globalThis as any).EventSource = originalEventSource;
    });
});
