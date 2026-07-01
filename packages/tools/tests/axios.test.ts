import axios from 'axios';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateRequestKey } from '../src/axios/helper';
import { CacheManager } from '../src/axios/CacheManager';
import { CancelTokenManager } from '../src/axios/CancelTokenManager';
import {
    DebounceThrottleManager,
    DebounceThrottleCancelError,
} from '../src/axios/DebounceThrottleManager';
import { GlobalConcurrencyController } from '../src/axios/GlobalConcurrencyController';
import { PollingManager } from '../src/axios/PollingManager';

describe('Axios helpers and managers', () => {
    describe('generateRequestKey', () => {
        it('should generate same key regardless of params or data object order', () => {
            const req1 = {
                method: 'GET',
                url: '/api/test',
                params: { b: 2, a: 1 },
                data: { y: 'yes', x: 'no' },
            };
            const req2 = {
                method: 'GET',
                url: '/api/test',
                params: { a: 1, b: 2 },
                data: { x: 'no', y: 'yes' },
            };
            expect(generateRequestKey(req1 as any)).toBe(generateRequestKey(req2 as any));
        });

        it('should include method and url when params/data are missing', () => {
            const req = { method: 'POST', url: '/api/test' };
            expect(generateRequestKey(req as any)).toBe('post:/api/test::');
        });
    });

    describe('CacheManager', () => {
        let cacheManager: CacheManager;

        beforeEach(() => {
            cacheManager = new CacheManager();
            vi.useFakeTimers();
            vi.setSystemTime(0);
        });

        afterEach(() => {
            vi.useRealTimers();
            vi.restoreAllMocks();
        });

        it('should store and retrieve cached responses', () => {
            const config = { method: 'get', url: '/api/test' } as any;
            const cachedData = { hello: 'world' };
            const response: any = {
                data: cachedData,
                status: 200,
                statusText: 'OK',
                headers: {},
                config,
                request: {},
            };
            cacheManager.set(config, response, 1000);
            expect(cacheManager.get(config)).toEqual(cachedData);
        });

        it('should expire cached entries after ttl', () => {
            const config = { method: 'get', url: '/api/test' } as any;
            const response = {
                data: 'expired',
                status: 200,
                statusText: 'OK',
                headers: {},
                config,
                request: {},
            } as any;
            cacheManager.set(config, response as any, 1000);
            vi.advanceTimersByTime(1001);
            expect(cacheManager.get(config)).toBeNull();
        });
    });

    describe('CancelTokenManager', () => {
        let manager: CancelTokenManager;

        beforeEach(() => {
            manager = new CancelTokenManager();
        });

        it('should store, retrieve, and delete cancel token sources', () => {
            const source = axios.CancelToken.source();
            manager.set('token-id', source);
            expect(manager.has('token-id')).toBe(true);
            expect(manager.get('token-id')).toBe(source);
            manager.delete('token-id');
            expect(manager.has('token-id')).toBe(false);
        });

        it('should cancel token by id and remove it', async () => {
            const source = axios.CancelToken.source();
            manager.set('token-id', source);
            manager.cancelById('token-id');
            expect(manager.has('token-id')).toBe(false);
            const err = await source.token.promise.catch((e) => e);
            expect(err.message).toContain('token-id');
        });

        it('should cancel all tokens', async () => {
            const source1 = axios.CancelToken.source();
            const source2 = axios.CancelToken.source();
            manager.set('one', source1);
            manager.set('two', source2);
            manager.cancelAll();
            expect(manager.has('one')).toBe(false);
            expect(manager.has('two')).toBe(false);
            const [err1, err2] = await Promise.all([
                source1.token.promise.catch((e) => e),
                source2.token.promise.catch((e) => e),
            ]);
            expect(err1.message).toContain('one');
            expect(err2.message).toContain('two');
        });
    });

    describe('DebounceThrottleManager', () => {
        let manager: DebounceThrottleManager;

        beforeEach(() => {
            manager = new DebounceThrottleManager();
            vi.useFakeTimers();
            vi.setSystemTime(0);
        });

        afterEach(() => {
            vi.useRealTimers();
            vi.restoreAllMocks();
        });

        it('should debounce requests and cancel the previous one', async () => {
            const req = { method: 'get', url: '/api/test' } as any;
            const p1 = manager.debounceRequest(req, 500);
            const p2 = manager.debounceRequest(req, 500);
            await expect(p1).rejects.toBeInstanceOf(DebounceThrottleCancelError);
            vi.advanceTimersByTime(500);
            await expect(p2).resolves.toBe(req);
        });

        it('should throttle requests and reject repeated calls within interval', async () => {
            const req = { method: 'get', url: '/api/test' } as any;
            await expect(manager.throttleRequest(req, 500)).resolves.toBe(req);
            await expect(manager.throttleRequest(req, 500)).rejects.toBeInstanceOf(DebounceThrottleCancelError);
            vi.advanceTimersByTime(500);
            await expect(manager.throttleRequest(req, 500)).resolves.toBe(req);
        });

        it('should cancel pending debounce requests', async () => {
            const req = { method: 'get', url: '/api/test' } as any;
            const promise = manager.debounceRequest(req, 500);
            manager.cancelDebounce(req);
            await expect(promise).rejects.toMatchObject({ type: 'debounce' });
        });

        it('should clear pending debounce and throttle state', async () => {
            const req = { method: 'get', url: '/api/test' } as any;
            const promise = manager.debounceRequest(req, 1000);
            manager.clear();
            await expect(promise).rejects.toMatchObject({ type: 'debounce' });
            await expect(manager.throttleRequest(req, 500)).resolves.toBe(req);
        });
    });

    describe('GlobalConcurrencyController', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
            vi.restoreAllMocks();
        });

        it('should queue tasks when maxConcurrent is reached', async () => {
            const controller = new GlobalConcurrencyController(1);
            const order: string[] = [];
            const p1 = controller.run(
                () =>
                    new Promise<string>((resolve) => {
                        setTimeout(() => {
                            order.push('first');
                            resolve('first');
                        }, 100);
                    }),
            );
            const p2 = controller.run(
                () =>
                    new Promise<string>((resolve) => {
                        setTimeout(() => {
                            order.push('second');
                            resolve('second');
                        }, 100);
                    }),
            );

            await vi.runAllTimersAsync();
            expect(await p1).toBe('first');
            expect(await p2).toBe('second');
            expect(order).toEqual(['first', 'second']);
        });
    });

    describe('PollingManager', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
            vi.restoreAllMocks();
        });

        it('should execute polling the configured number of times', async () => {
            const axiosInstance = {
                get: vi.fn().mockResolvedValue({ data: { updated: true } }),
            } as any;
            const concurrencyController = new GlobalConcurrencyController(1);
            const manager = new PollingManager(axiosInstance, concurrencyController);
            const onSuccess = vi.fn();

            manager.poll({
                key: 'poll-1',
                url: '/poll',
                onSuccess,
                interval: 100,
                maxPollingTimes: 2,
            });

            await vi.runAllTimersAsync();
            expect(axiosInstance.get).toHaveBeenCalledTimes(2);
            expect(onSuccess).toHaveBeenCalledTimes(2);
        });

        it('should stop polling when stopPolling is called', async () => {
            const axiosInstance = {
                get: vi.fn().mockResolvedValue({ data: { updated: true } }),
            } as any;
            const concurrencyController = new GlobalConcurrencyController(1);
            const manager = new PollingManager(axiosInstance, concurrencyController);
            const onSuccess = vi.fn();

            manager.poll({
                key: 'poll-2',
                url: '/poll',
                onSuccess,
                interval: 100,
                maxPollingTimes: 3,
            });

            manager.stopPolling('poll-2');
            await vi.runAllTimersAsync();
            expect(onSuccess).toHaveBeenCalledTimes(1);
        });
    });

    describe('UploadManager', () => {
        it('should calculate chunk md5 correctly', async () => {
            const manager = new (await import('../src/axios/UploadManager')).UploadManager(
                {} as any,
                new GlobalConcurrencyController(1),
            );
            const blob = new Blob(['hello world'], { type: 'text/plain' });
            const hash = await manager.calculateChunkMd5(blob);
            expect(typeof hash).toBe('string');
            expect(hash.length).toBe(32);
        });

        it('should upload chunk and call progress callback', async () => {
            const post = vi.fn().mockResolvedValue({});
            const axiosInstance = { post } as any;
            const concurrencyController = { run: vi.fn((task: any) => task()) } as any;
            const manager = new (await import('../src/axios/UploadManager')).UploadManager(
                axiosInstance,
                concurrencyController,
            );
            const cancelToken = axios.CancelToken.source();
            const progress = vi.fn();

            const chunk = new Blob(['data'], { type: 'text/plain' });
            await manager.uploadChunk('/upload', chunk, 0, 1, cancelToken, undefined, undefined, progress);

            expect(post).toHaveBeenCalled();
        });

        it('should retry failed uploads before success', async () => {
            let attempt = 0;
            const post = vi.fn().mockImplementation(() => {
                attempt += 1;
                if (attempt < 2) {
                    return Promise.reject(new Error('network error'));
                }
                return Promise.resolve({});
            });
            const axiosInstance = { post } as any;
            const concurrencyController = { run: vi.fn((task: any) => task()) } as any;
            const manager = new (await import('../src/axios/UploadManager')).UploadManager(
                axiosInstance,
                concurrencyController,
            );
            const cancelToken = axios.CancelToken.source();

            const chunk = new Blob(['data'], { type: 'text/plain' });
            await manager.uploadChunk('/upload', chunk, 0, 1, cancelToken, undefined, undefined, undefined, 2, 0);
            expect(post).toHaveBeenCalledTimes(2);
        });
    });
});
