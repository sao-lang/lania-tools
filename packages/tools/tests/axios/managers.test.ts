import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheManager } from '../../src/axios/CacheManager';
import { CancelTokenManager } from '../../src/axios/CancelTokenManager';
import {
    DebounceThrottleCancelError,
    DebounceThrottleManager,
} from '../../src/axios/DebounceThrottleManager';
import { GlobalConcurrencyController } from '../../src/axios/GlobalConcurrencyController';
import { PollingManager } from '../../src/axios/PollingManager';
import { CHUNK_SIZE, DEFAULT_MAX_RETRIES, DEFAULT_RETRY_DELAY, MAX_CONCURRENT_REQUESTS } from '../../src/axios/const';
import { generateRequestKey } from '../../src/axios/helper';

describe('const defaults', () => {
    it('exposes stable default values', () => {
        expect(DEFAULT_MAX_RETRIES).toBe(3);
        expect(DEFAULT_RETRY_DELAY).toBe(1000);
        expect(CHUNK_SIZE).toBe(5 * 1024 * 1024);
        expect(MAX_CONCURRENT_REQUESTS).toBe(5);
    });
});

describe('generateRequestKey', () => {
    it('is stable for nested objects with different key insertion order', () => {
        const a = {
            method: 'post',
            url: '/api/users',
            params: { page: 1, filter: { role: 'admin', active: true } },
            data: { nested: { b: 2, a: 1 }, list: [1, 2, 3] },
        };
        const b = {
            method: 'post',
            url: '/api/users',
            params: { filter: { active: true, role: 'admin' }, page: 1 },
            data: { list: [1, 2, 3], nested: { a: 1, b: 2 } },
        };
        expect(generateRequestKey(a as any)).toBe(generateRequestKey(b as any));
    });

    it('defaults the method to get and the url to an empty string', () => {
        expect(generateRequestKey({} as any)).toBe('get:::');
    });

    it('lowercases the method', () => {
        expect(generateRequestKey({ method: 'DELETE', url: '/x' } as any)).toBe('delete:/x::');
    });

    it('preserves the order of arrays because it changes semantics', () => {
        const a = generateRequestKey({ method: 'get', url: '/x', params: { ids: [1, 2] } } as any);
        const b = generateRequestKey({ method: 'get', url: '/x', params: { ids: [2, 1] } } as any);
        expect(a).not.toBe(b);
    });

    it('distinguishes different urls, methods, params and data', () => {
        const base = { method: 'get', url: '/x' };
        const keys = new Set([
            generateRequestKey(base as any),
            generateRequestKey({ ...base, url: '/y' } as any),
            generateRequestKey({ ...base, method: 'post' } as any),
            generateRequestKey({ ...base, params: { a: 1 } } as any),
            generateRequestKey({ ...base, data: { a: 1 } } as any),
        ]);
        expect(keys.size).toBe(5);
    });

    it('handles primitive params and data values', () => {
        expect(
            generateRequestKey({ method: 'get', url: '/x', params: 'q=1', data: 0 } as any),
        ).toBe('get:/x:"q=1":0');
    });

    it('handles null params and data', () => {
        expect(generateRequestKey({ method: 'get', url: '/x', params: null, data: null } as any)).toBe(
            'get:/x::',
        );
    });
});

describe('CacheManager', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns null for a missing key', () => {
        const cache = new CacheManager();
        expect(cache.get({ method: 'get', url: '/missing' } as any)).toBeNull();
    });

    it('stores an AxiosResponse payload and unwraps data', () => {
        const cache = new CacheManager();
        const config = { method: 'get', url: '/x' } as any;
        cache.set(config, {
            data: { value: 1 },
            status: 200,
            statusText: 'OK',
            headers: {},
            config,
            request: {},
        });
        expect(cache.get(config)).toEqual({ value: 1 });
    });

    it('stores a plain payload unchanged', () => {
        const cache = new CacheManager();
        const config = { method: 'get', url: '/x' } as any;
        cache.set(config, { value: 1 });
        expect(cache.get(config)).toEqual({ value: 1 });
    });

    it('keeps a payload whose data property is undefined', () => {
        const cache = new CacheManager();
        const config = { method: 'get', url: '/x' } as any;
        const payload = { data: undefined, other: true };
        cache.set(config, payload);
        expect(cache.get(config)).toBe(payload);
    });

    it('does not unwrap a business payload that happens to have a data field', () => {
        const cache = new CacheManager();
        const config = { method: 'get', url: '/x' } as any;
        const payload = { code: 0, data: { value: 1 } };
        cache.set(config, payload);
        expect(cache.get(config)).toBe(payload);
    });

    it('never expires entries without ttl', () => {
        const cache = new CacheManager();
        const config = { method: 'get', url: '/x' } as any;
        cache.set(config, 'value');
        vi.advanceTimersByTime(10 * 365 * 24 * 60 * 60 * 1000);
        expect(cache.get(config)).toBe('value');
    });

    it('treats ttl=0 as "no expiry"', () => {
        const cache = new CacheManager();
        const config = { method: 'get', url: '/x' } as any;
        cache.set(config, 'value', 0);
        vi.advanceTimersByTime(10_000);
        expect(cache.get(config)).toBe('value');
    });

    it('expires entries exactly at the ttl boundary', () => {
        const cache = new CacheManager();
        const config = { method: 'get', url: '/x' } as any;
        cache.set(config, 'value', 500);
        vi.advanceTimersByTime(499);
        expect(cache.get(config)).toBe('value');
        vi.advanceTimersByTime(1);
        expect(cache.get(config)).toBeNull();
    });

    it('removes an expired entry so a later set can reuse the key', () => {
        const cache = new CacheManager();
        const config = { method: 'get', url: '/x' } as any;
        cache.set(config, 'old', 100);
        vi.advanceTimersByTime(101);
        expect(cache.get(config)).toBeNull();
        cache.set(config, 'new');
        expect(cache.get(config)).toBe('new');
    });

    it('overwrites an existing entry', () => {
        const cache = new CacheManager();
        const config = { method: 'get', url: '/x' } as any;
        cache.set(config, 'one');
        cache.set(config, 'two');
        expect(cache.get(config)).toBe('two');
    });

    it('keys requests by method, url, params and data', () => {
        const cache = new CacheManager();
        const first = { method: 'get', url: '/x', params: { a: 1 } } as any;
        const second = { method: 'get', url: '/x', params: { a: 2 } } as any;
        cache.set(first, 'first');
        expect(cache.get(second)).toBeNull();
    });

    it('clears every entry', () => {
        const cache = new CacheManager();
        const config = { method: 'get', url: '/x' } as any;
        cache.set(config, 'value');
        cache.clear();
        expect(cache.get(config)).toBeNull();
    });
});

describe('CancelTokenManager', () => {
    let manager: CancelTokenManager;

    beforeEach(() => {
        manager = new CancelTokenManager();
    });

    it('reports a missing token as absent and returns null', () => {
        expect(manager.has('missing')).toBe(false);
        expect(manager.get('missing')).toBeNull();
        expect(() => manager.delete('missing')).not.toThrow();
    });

    it('stores and overwrites a token source', () => {
        const first = axios.CancelToken.source();
        const second = axios.CancelToken.source();
        manager.set('id', first);
        manager.set('id', second);
        expect(manager.get('id')).toBe(second);
    });

    it('cancels by id, removes the registration and is idempotent', async () => {
        const source = axios.CancelToken.source();
        manager.set('upload', source);
        manager.cancelById('upload');
        expect(manager.has('upload')).toBe(false);
        const error = await source.token.promise.catch((e) => e);
        expect(axios.isCancel(error)).toBe(true);
        expect(error.message).toContain('upload');
        expect(() => manager.cancelById('upload')).not.toThrow();
    });

    it('cancels every registered source', async () => {
        const sources = ['a', 'b', 'c'].map((id) => {
            const source = axios.CancelToken.source();
            manager.set(id, source);
            return source;
        });
        manager.cancelAll();
        expect(manager.has('a')).toBe(false);
        expect(manager.has('b')).toBe(false);
        expect(manager.has('c')).toBe(false);
        const errors = await Promise.all(sources.map((s) => s.token.promise.catch((e) => e)));
        expect(errors.map((e) => e.message)).toEqual([
            expect.stringContaining('a'),
            expect.stringContaining('b'),
            expect.stringContaining('c'),
        ]);
    });

    it('clears registrations without cancelling the tokens', async () => {
        const source = axios.CancelToken.source();
        manager.set('id', source);
        manager.clear();
        expect(manager.has('id')).toBe(false);
        // The source itself was not cancelled, so the token stays pending.
        const result = await Promise.race([
            source.token.promise.then(() => 'cancelled'),
            Promise.resolve('pending'),
        ]);
        expect(result).toBe('pending');
    });
});

describe('DebounceThrottleCancelError', () => {
    it('carries axios-compatible cancel metadata', () => {
        const error = new DebounceThrottleCancelError('halted', 'throttle');
        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(DebounceThrottleCancelError);
        expect(error.name).toBe('CancelError');
        expect(error.isCancel).toBe(true);
        expect(error.type).toBe('throttle');
        expect(error.message).toBe('halted');
    });

    it('has a default message', () => {
        expect(new DebounceThrottleCancelError(undefined, 'debounce').message).toBe(
            'Request was cancelled.',
        );
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
    });

    it('rejects the previous request when the same key is debounced again', async () => {
        const key = { method: 'get', url: '/search', params: { q: 'a' } };
        const first = manager.debounceRequest(key as any, 100);
        const second = manager.debounceRequest({ ...key } as any, 100);

        await expect(first).rejects.toMatchObject({ type: 'debounce', isCancel: true });
        await vi.advanceTimersByTimeAsync(99);
        await expect(Promise.race([second.then(() => 'resolved'), Promise.resolve('pending')])).resolves.toBe(
            'pending',
        );
        await vi.advanceTimersByTimeAsync(1);
        await expect(second).resolves.toEqual(key);
    });

    it('does not cancel requests with different keys', async () => {
        const a = manager.debounceRequest({ method: 'get', url: '/a' } as any, 50);
        const b = manager.debounceRequest({ method: 'get', url: '/b' } as any, 50);
        await vi.advanceTimersByTimeAsync(50);
        await expect(a).resolves.toEqual({ method: 'get', url: '/a' });
        await expect(b).resolves.toEqual({ method: 'get', url: '/b' });
    });

    it('uses 300ms as the default delay', async () => {
        const request = manager.debounceRequest({ method: 'get', url: '/x' } as any);
        await vi.advanceTimersByTimeAsync(299);
        await expect(Promise.race([request.then(() => 'resolved'), Promise.resolve('pending')])).resolves.toBe(
            'pending',
        );
        await vi.advanceTimersByTimeAsync(1);
        await expect(request).resolves.toBeTruthy();
    });

    it('cancelDebounce rejects a pending request and removes it', async () => {
        const request = { method: 'get', url: '/x' } as any;
        const pending = manager.debounceRequest(request, 100);
        manager.cancelDebounce(request);
        await expect(pending).rejects.toMatchObject({
            isCancel: true,
            message: 'Manually canceled',
            type: 'debounce',
        });
        // Cancelling twice is a no-op.
        expect(() => manager.cancelDebounce(request)).not.toThrow();
        // A new request can start immediately.
        const next = manager.debounceRequest(request, 10);
        await vi.advanceTimersByTimeAsync(10);
        await expect(next).resolves.toBe(request);
    });

    it('clear rejects every pending debounce request and resets throttle state', async () => {
        const reqA = { method: 'get', url: '/a' } as any;
        const reqB = { method: 'get', url: '/b' } as any;
        const a = manager.debounceRequest(reqA, 1000);
        const b = manager.debounceRequest(reqB, 1000);
        const aRejected = expect(a).rejects.toMatchObject({ message: 'Manager cleared' });
        const bRejected = expect(b).rejects.toMatchObject({ message: 'Manager cleared' });
        manager.clear();
        await aRejected;
        await bRejected;

        // throttle state was cleared too
        await expect(manager.throttleRequest(reqA, 1000)).resolves.toBe(reqA);
    });

    it('allows the first throttle request and rejects requests inside the window', async () => {
        const request = { method: 'get', url: '/x' } as any;
        await expect(manager.throttleRequest(request, 500)).resolves.toBe(request);
        await expect(manager.throttleRequest(request, 500)).rejects.toMatchObject({
            type: 'throttle',
            isCancel: true,
        });
        await vi.advanceTimersByTimeAsync(499);
        await expect(manager.throttleRequest(request, 500)).rejects.toBeInstanceOf(
            DebounceThrottleCancelError,
        );
        await vi.advanceTimersByTimeAsync(1);
        await expect(manager.throttleRequest(request, 500)).resolves.toBe(request);
    });

    it('throttles each key independently', async () => {
        const a = { method: 'get', url: '/a' } as any;
        const b = { method: 'get', url: '/b' } as any;
        await expect(manager.throttleRequest(a, 500)).resolves.toBe(a);
        await expect(manager.throttleRequest(b, 500)).resolves.toBe(b);
    });

    it('uses 1000ms as the default throttle interval', async () => {
        const request = { method: 'get', url: '/x' } as any;
        await expect(manager.throttleRequest(request)).resolves.toBe(request);
        await expect(manager.throttleRequest(request)).rejects.toMatchObject({ type: 'throttle' });
        await vi.advanceTimersByTimeAsync(1000);
        await expect(manager.throttleRequest(request)).resolves.toBe(request);
    });

    it('cancelThrottle makes the next request immediate', async () => {
        const request = { method: 'get', url: '/x' } as any;
        await expect(manager.throttleRequest(request, 10_000)).resolves.toBe(request);
        manager.cancelThrottle(request);
        await expect(manager.throttleRequest(request, 10_000)).resolves.toBe(request);
    });
});

describe('GlobalConcurrencyController', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('defaults to MAX_CONCURRENT_REQUESTS for non-positive or invalid limits', () => {
        expect((new GlobalConcurrencyController() as any).maxConcurrent).toBe(
            MAX_CONCURRENT_REQUESTS,
        );
        expect((new GlobalConcurrencyController(0) as any).maxConcurrent).toBe(
            MAX_CONCURRENT_REQUESTS,
        );
        expect((new GlobalConcurrencyController(-2) as any).maxConcurrent).toBe(
            MAX_CONCURRENT_REQUESTS,
        );
        expect((new GlobalConcurrencyController('2' as any) as any).maxConcurrent).toBe(
            MAX_CONCURRENT_REQUESTS,
        );
    });

    it('runs no more than the configured number of tasks at once', async () => {
        const controller = new GlobalConcurrencyController(2);
        let active = 0;
        let maxActive = 0;
        const order: number[] = [];
        const tasks = Array.from({ length: 6 }, (_, i) =>
            controller.run(async () => {
                active += 1;
                maxActive = Math.max(maxActive, active);
                await new Promise((resolve) => setTimeout(resolve, 20));
                order.push(i);
                active -= 1;
                return i;
            }),
        );
        await expect(Promise.all(tasks)).resolves.toEqual([0, 1, 2, 3, 4, 5]);
        expect(maxActive).toBe(2);
        expect(order).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it('propagates a task error and continues the queue', async () => {
        const controller = new GlobalConcurrencyController(1);
        const failing = controller.run(async () => {
            await Promise.resolve();
            throw new Error('boom');
        });
        const following = controller.run(async () => 'ok');
        await expect(failing).rejects.toThrow('boom');
        await expect(following).resolves.toBe('ok');
    });

    it('keeps the queue alive when a queued task throws synchronously', async () => {
        const controller = new GlobalConcurrencyController(1);
        const first = controller.run(() => new Promise<string>((r) => setTimeout(() => r('first'), 10)));
        const second = controller.run((() => {
            throw new Error('sync boom');
        }) as () => Promise<string>);
        const third = controller.run(async () => 'third');
        await expect(first).resolves.toBe('first');
        await expect(second).rejects.toThrow('sync boom');
        await expect(third).resolves.toBe('third');
    });

    it('increments and decrements activeCount correctly for successes and failures', async () => {
        const controller = new GlobalConcurrencyController(3);
        const privateController = controller as any;
        await controller.run(async () => 1);
        expect(privateController.activeCount).toBe(0);
        await expect(
            controller.run(async () => {
                throw new Error('x');
            }),
        ).rejects.toThrow('x');
        expect(privateController.activeCount).toBe(0);
    });

    it('supports a very large number of queued tasks', async () => {
        const controller = new GlobalConcurrencyController(3);
        const results = await Promise.all(
            Array.from({ length: 50 }, (_, i) => controller.run(async () => i * 2)),
        );
        expect(results).toHaveLength(50);
        expect(results[49]).toBe(98);
    });
});

describe('PollingManager', () => {
    let get: any;
    let post: any;
    let del: any;
    let put: any;
    let instance: any;
    let controller: GlobalConcurrencyController;

    beforeEach(() => {
        vi.useFakeTimers();
        get = vi.fn().mockResolvedValue({ data: { ok: true } });
        post = vi.fn().mockResolvedValue({ data: { ok: true } });
        del = vi.fn().mockResolvedValue({ data: { ok: true } });
        put = vi.fn().mockResolvedValue({ data: { ok: true } });
        instance = { get, post, delete: del, put };
        controller = new GlobalConcurrencyController(5);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('ignores a config without a key and logs an error', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const manager = new PollingManager(instance, controller);
        manager.poll({ key: '', url: '/poll' });
        expect(consoleError).toHaveBeenCalledWith('Polling key must be provided.');
        expect(get).not.toHaveBeenCalled();
    });

    it('polls immediately, then at the interval, and stops at maxPollingTimes', async () => {
        const manager = new PollingManager(instance, controller);
        const onSuccess = vi.fn();
        manager.poll({ key: 'k', url: '/poll', onSuccess, interval: 100, maxPollingTimes: 3 });

        expect(get).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(100);
        expect(get).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(100);
        expect(get).toHaveBeenCalledTimes(3);
        expect(onSuccess).toHaveBeenCalledTimes(3);
        await vi.advanceTimersByTimeAsync(1000);
        expect(get).toHaveBeenCalledTimes(3);
    });

    it('uses 5s and 3 attempts by default', async () => {
        const manager = new PollingManager(instance, controller);
        manager.poll({ key: 'defaults', url: '/poll' });
        expect(get).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(4_999);
        expect(get).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(get).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(5_000);
        expect(get).toHaveBeenCalledTimes(3);
    });

    it('reports errors and keeps polling until the limit', async () => {
        get.mockRejectedValue(new Error('network'));
        const manager = new PollingManager(instance, controller);
        const onError = vi.fn();
        const onSuccess = vi.fn();
        manager.poll({ key: 'err', url: '/poll', onError, onSuccess, interval: 10, maxPollingTimes: 2 });
        await vi.runAllTimersAsync();
        expect(onError).toHaveBeenCalledTimes(2);
        expect(onSuccess).not.toHaveBeenCalled();
    });

    it('treats an error thrown by onSuccess as a polling error', async () => {
        const manager = new PollingManager(instance, controller);
        const onError = vi.fn();
        manager.poll({
            key: 'success-throws',
            url: '/poll',
            onSuccess: () => {
                throw new Error('callback');
            },
            onError,
            interval: 10,
            maxPollingTimes: 1,
        });
        await vi.runAllTimersAsync();
        expect(onError).toHaveBeenCalledTimes(1);
    });

    it('stops when stopPolling is called during the interval', async () => {
        const manager = new PollingManager(instance, controller);
        manager.poll({ key: 'stop', url: '/poll', interval: 100, maxPollingTimes: 5 });
        expect(get).toHaveBeenCalledTimes(1);
        manager.stopPolling('stop');
        await vi.advanceTimersByTimeAsync(1000);
        expect(get).toHaveBeenCalledTimes(1);
    });

    it('stopping an unknown key is a no-op', () => {
        const manager = new PollingManager(instance, controller);
        expect(() => manager.stopPolling('unknown')).not.toThrow();
    });

    it('restarting a key stops the previous task before starting a new one', async () => {
        const manager = new PollingManager(instance, controller);
        manager.poll({ key: 'restart', url: '/first', interval: 100, maxPollingTimes: 3 });
        manager.poll({ key: 'restart', url: '/second', interval: 100, maxPollingTimes: 2 });
        // The first request was already dispatched before the restart, so both
        // URLs have been hit once. The stopped task must not schedule more work.
        expect(get).toHaveBeenCalledTimes(2);
        expect(get).toHaveBeenLastCalledWith('/second', undefined);
        await vi.advanceTimersByTimeAsync(100);
        expect(get).toHaveBeenCalledTimes(3);
        expect(get.mock.calls.slice(1).every((call: any[]) => call[0] === '/second')).toBe(true);
    });

    it('supports post, put and delete polling', async () => {
        const manager = new PollingManager(instance, controller);
        manager.poll({ key: 'post', url: '/p', method: 'post', maxPollingTimes: 1 });
        manager.poll({ key: 'put', url: '/p', method: 'put', maxPollingTimes: 1 });
        manager.poll({ key: 'delete', url: '/p', method: 'delete', maxPollingTimes: 1 });
        await vi.runAllTimersAsync();
        expect(post).toHaveBeenCalledWith('/p', undefined);
        expect(put).toHaveBeenCalledWith('/p', undefined);
        expect(del).toHaveBeenCalledWith('/p', undefined);
    });

    it('does not start any request when maxPollingTimes is 0', async () => {
        const manager = new PollingManager(instance, controller);
        manager.poll({ key: 'zero', url: '/poll', maxPollingTimes: 0 });
        await vi.runAllTimersAsync();
        expect(get).not.toHaveBeenCalled();
    });

    it('forwards the axios config object', async () => {
        const manager = new PollingManager(instance, controller);
        const config = { headers: { 'x-poll': '1' } };
        manager.poll({ key: 'config', url: '/poll', config, maxPollingTimes: 1 });
        await vi.runAllTimersAsync();
        expect(get).toHaveBeenCalledWith('/poll', config);
    });

    it('does not schedule another request when stopped while a request is in flight', async () => {
        let resolveRequest: (value: any) => void = () => {};
        get.mockImplementation(
            () => new Promise((resolve) => {
                resolveRequest = resolve;
            }),
        );
        const manager = new PollingManager(instance, controller);
        manager.poll({ key: 'inflight', url: '/poll', interval: 100, maxPollingTimes: 5 });
        manager.stopPolling('inflight');
        resolveRequest({ data: { ok: true } });
        await vi.advanceTimersByTimeAsync(500);
        expect(get).toHaveBeenCalledTimes(1);
    });
});
