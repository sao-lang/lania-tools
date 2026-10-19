// @vitest-environment node
import axios from 'axios';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosWrapper, AxiosWrapperFactory, WrapperOptions } from '../../src/axios';
import { TestServer } from '../server/test-server';

const servers: TestServer[] = [];

async function startServer() {
    const server = new TestServer();
    await server.start();
    servers.push(server);
    return server;
}

function createWrapper(server: TestServer, options: WrapperOptions = {}) {
    return new AxiosWrapper(
        { baseURL: server.baseURL, adapter: 'http', timeout: 5000 },
        options,
    );
}

async function waitFor(condition: () => boolean, timeout = 3000, interval = 10) {
    const startedAt = Date.now();
    while (!condition()) {
        if (Date.now() - startedAt > timeout) {
            throw new Error('waitFor timed out');
        }
        await new Promise((resolve) => setTimeout(resolve, interval));
    }
}

afterAll(async () => {
    await Promise.all(servers.map((server) => server.stop()));
});

describe('AxiosWrapper HTTP methods against a real server', () => {
    let server: TestServer;
    let wrapper: AxiosWrapper;

    beforeAll(async () => {
        server = await startServer();
    });

    beforeEach(() => {
        server.reset();
        wrapper = createWrapper(server);
    });

    afterEach(() => {
        server.reset();
    });

    it('sends GET params and parses JSON', async () => {
        const response = await wrapper.get('/echo', { q: 'hello', page: 2 });
        expect(response.status).toBe(200);
        expect(response.data.data.method).toBe('GET');
        expect(response.data.data.query).toEqual({ q: 'hello', page: '2' });
    });

    it('sends POST, PUT and DELETE bodies', async () => {
        const post = await wrapper.post('/echo', { a: 1 });
        expect(post.data.data.method).toBe('POST');
        expect(post.data.data.body).toEqual({ a: 1 });

        const put = await wrapper.put('/echo', { b: 2 });
        expect(put.data.data.method).toBe('PUT');
        expect(put.data.data.body).toEqual({ b: 2 });

        const del = await wrapper.delete('/echo', { c: 3 });
        expect(del.data.data.method).toBe('DELETE');
        expect(del.data.data.body).toEqual({ c: 3 });
    });

    it('falls back to the url/data from the config object', async () => {
        const response = await wrapper.get(undefined as any, undefined, {
            url: '/echo',
            params: { fromConfig: 'yes' },
        });
        expect(response.data.data.query.fromConfig).toBe('yes');

        const post = await wrapper.post(undefined as any, undefined, {
            url: '/echo',
            data: { fromConfig: true },
        });
        expect(post.data.data.body).toEqual({ fromConfig: true });
    });

    it('injects the token from tokenProvider into the Authorization header', async () => {
        const tokenProvider = vi.fn(async () => 'unit-token');
        const tokenWrapper = createWrapper(server, { tokenProvider });
        const response = await tokenWrapper.get('/headers');
        expect(tokenProvider).toHaveBeenCalledTimes(1);
        expect(response.data.data.headers.authorization).toBe('Bearer unit-token');
    });

    it('supports request and response interceptors', async () => {
        const requestSpy = vi.fn();
        const responseSpy = vi.fn();
        const customWrapper = createWrapper(server, {
            interceptors: {
                request: {
                    onFulfilled: (config) => {
                        requestSpy(config.url);
                        config.headers.set('x-custom', 'request-header');
                        return config;
                    },
                },
                response: {
                    onFulfilled: (response) => {
                        responseSpy(response.status);
                        return {
                            ...response,
                            data: { transformed: response.data.data },
                        };
                    },
                },
            },
        });

        const response = await customWrapper.get('/headers');
        expect(requestSpy).toHaveBeenCalledWith('/headers');
        expect(responseSpy).toHaveBeenCalledWith(200);
        expect(response.data.transformed.headers['x-custom']).toBe('request-header');
    });

    it('recovers from a request interceptor error by returning a fixed config', async () => {
        let shouldFail = true;
        const customWrapper = createWrapper(server, {
            interceptors: {
                request: {
                    onFulfilled: (config) => {
                        if (shouldFail && config.headers.get('x-fail-once')) {
                            shouldFail = false;
                            throw new Error('request interceptor failure');
                        }
                        return config;
                    },
                    onRejected: (error) => {
                        const config = error.config;
                        const headers = { ...config.headers };
                        delete headers['x-fail-once'];
                        return { ...config, headers };
                    },
                },
            },
        });

        const response = await customWrapper.get('/headers', undefined, {
            headers: { 'x-fail-once': '1' },
        });
        expect(response.status).toBe(200);
        expect(response.data.data.headers['x-fail-once']).toBeUndefined();
    });

    it('recovers from a response error by returning a synthetic response', async () => {
        const onError = vi.fn();
        const customWrapper = createWrapper(server, {
            onError,
            interceptors: {
                response: {
                    onRejected: (error) => ({
                        data: { recovered: true, status: error.response?.status },
                        status: 200,
                        statusText: 'OK',
                        headers: {},
                        config: error.config,
                        request: {},
                    }),
                },
            },
        });

        const response = await customWrapper.get('/status', { code: 500 });
        expect(response.data).toEqual({ recovered: true, status: 500 });
        expect(onError).not.toHaveBeenCalled();
    });

    it('responseHandler replaces the response data', async () => {
        const customWrapper = createWrapper(server, {
            responseHandler: (response) => ({
                ...response,
                data: response.data.data,
            }),
        });
        const response = await customWrapper.get('/echo');
        expect(response.data).toEqual(
            expect.objectContaining({ method: 'GET', path: '/echo' }),
        );
    });

    it('responseHandler takes precedence over codeHandlers', async () => {
        const responseHandler = vi.fn((response) => ({ ...response, data: 'handled-globally' }));
        const codeHandler = vi.fn();
        const customWrapper = createWrapper(server, {
            responseHandler,
            codeHandlers: { '40001': codeHandler },
        });
        const response = await customWrapper.get('/business/40001');
        expect(response.data).toBe('handled-globally');
        expect(responseHandler).toHaveBeenCalledTimes(1);
        expect(codeHandler).not.toHaveBeenCalled();
    });

    it('runs a matching business code handler exactly once under concurrency', async () => {
        const handler = vi.fn((response) => ({ ...response, data: 'handled' }));
        const customWrapper = createWrapper(server, {
            codeHandlers: { '40001': handler },
        });

        const [first, second] = await Promise.all([
            customWrapper.get('/business/40001'),
            customWrapper.get('/business/40001'),
        ]);
        expect([first.data, second.data].filter((data) => data === 'handled')).toHaveLength(1);
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('keeps the response when a code handler returns undefined', async () => {
        const customWrapper = createWrapper(server, {
            codeHandlers: { '40002': () => undefined },
        });
        const response = await customWrapper.get('/business/40002');
        expect(response.data.code).toBe(40002);
    });

    it('ignores code handlers when the payload has no code', async () => {
        const handler = vi.fn();
        const customWrapper = createWrapper(server, {
            codeHandlers: { '0': handler },
        });
        const response = await customWrapper.get('/health');
        expect(response.data).toEqual({ ok: true });
        expect(handler).not.toHaveBeenCalled();
    });
});

describe('AxiosWrapper caching against a real server', () => {
    let server: TestServer;

    beforeAll(async () => {
        server = await startServer();
    });

    beforeEach(() => {
        server.reset();
    });

    it('serves the same request from cache without hitting the network', async () => {
        const wrapper = createWrapper(server, { enableCache: true });
        const before = server.requestCount;
        const first = await wrapper.get('/echo', { id: 1 });
        const second = await wrapper.get('/echo', { id: 1 });

        expect(server.requestCount - before).toBe(1);
        expect(second.data).toEqual(first.data);
        expect(second.status).toBe(200);
        expect(second.statusText).toBe('Cache Hit');
    });

    it('keeps the full business payload in cache', async () => {
        const wrapper = createWrapper(server, { enableCache: true });
        const first = await wrapper.get('/business/12345');
        const second = await wrapper.get('/business/12345');
        expect(first.data).toEqual({ code: 12345, message: 'business code 12345', data: { echo: '12345' } });
        expect(second.data).toEqual(first.data);
    });

    it('respects cacheTTL', async () => {
        const wrapper = createWrapper(server, { enableCache: true, cacheTTL: 40 });
        const before = server.requestCount;
        await wrapper.get('/echo', { id: 2 });
        await new Promise((resolve) => setTimeout(resolve, 60));
        await wrapper.get('/echo', { id: 2 });
        expect(server.requestCount - before).toBe(2);
    });

    it('clearCache forces a network request', async () => {
        const wrapper = createWrapper(server, { enableCache: true });
        const before = server.requestCount;
        await wrapper.get('/echo', { id: 3 });
        wrapper.clearCache();
        await wrapper.get('/echo', { id: 3 });
        expect(server.requestCount - before).toBe(2);
    });

    it('does not cache when enableCache is false', async () => {
        const wrapper = createWrapper(server);
        const before = server.requestCount;
        await wrapper.get('/echo', { id: 4 });
        await wrapper.get('/echo', { id: 4 });
        expect(server.requestCount - before).toBe(2);
    });
});

describe('AxiosWrapper debounce, throttle and retry', () => {
    let server: TestServer;

    beforeAll(async () => {
        server = await startServer();
    });

    beforeEach(() => {
        server.reset();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('debounces duplicated requests and cancels the earlier one', async () => {
        const wrapper = createWrapper(server, { enableDebounce: true, debounceInterval: 40 });
        const before = server.requestCount;
        const first = wrapper.get('/echo', { q: 'debounce' });
        const second = wrapper.get('/echo', { q: 'debounce' });

        await expect(first).rejects.toMatchObject({ type: 'debounce', isCancel: true });
        const response = await second;
        expect(response.data.data.query.q).toBe('debounce');
        expect(server.requestCount - before).toBe(1);
    });

    it('throttles requests inside the interval and allows the next window', async () => {
        const wrapper = createWrapper(server, { enableThrottle: true, throttleInterval: 60 });
        const first = await wrapper.get('/echo', { q: 'throttle' });
        expect(first.status).toBe(200);

        await expect(wrapper.get('/echo', { q: 'throttle' })).rejects.toMatchObject({
            type: 'throttle',
            isCancel: true,
        });

        await new Promise((resolve) => setTimeout(resolve, 70));
        await expect(wrapper.get('/echo', { q: 'throttle' })).resolves.toBeTruthy();
    });

    it('does not call onError for debounce/throttle cancellations', async () => {
        const onError = vi.fn();
        const wrapper = createWrapper(server, {
            enableThrottle: true,
            throttleInterval: 500,
            onError,
        });
        await wrapper.get('/echo');
        await expect(wrapper.get('/echo')).rejects.toBeTruthy();
        expect(onError).not.toHaveBeenCalled();
    });

    it('retries failed requests until they succeed', async () => {
        const key = 'retry-success-' + Math.random();
        const onError = vi.fn();
        const wrapper = createWrapper(server, {
            enableRetry: true,
            retryTimes: 3,
            retryDelay: 5,
            onError,
        });

        const response = await wrapper.get('/flaky', { key, failures: 2 });
        expect(response.data.data.attempt).toBe(3);
        expect(server.flakyAttempts.get(key)).toBe(3);
        expect(onError).not.toHaveBeenCalled();
    });

    it('rejects after the retry budget is exhausted and reports the final error once', async () => {
        const key = 'retry-fail-' + Math.random();
        const onError = vi.fn();
        const wrapper = createWrapper(server, {
            enableRetry: true,
            retryTimes: 2,
            retryDelay: 1,
            onError,
        });

        await expect(wrapper.get('/flaky', { key, failures: 10 })).rejects.toMatchObject({
            response: { status: 503 },
        });
        expect(server.flakyAttempts.get(key)).toBe(3);
        expect(onError).toHaveBeenCalledTimes(1);
    });

    it('retryTimes=0 means no retry', async () => {
        const key = 'retry-zero-' + Math.random();
        const wrapper = createWrapper(server, { enableRetry: true, retryTimes: 0 });
        await expect(wrapper.get('/flaky', { key, failures: 1 })).rejects.toBeTruthy();
        expect(server.flakyAttempts.get(key)).toBe(1);
    });

    it('does not retry when enableRetry is false', async () => {
        const key = 'retry-disabled-' + Math.random();
        const wrapper = createWrapper(server);
        await expect(wrapper.get('/flaky', { key, failures: 1 })).rejects.toBeTruthy();
        expect(server.flakyAttempts.get(key)).toBe(1);
    });
});

describe('AxiosWrapper cancellation', () => {
    let server: TestServer;

    beforeAll(async () => {
        server = await startServer();
    });

    beforeEach(() => {
        server.reset();
    });

    it('cancels a request by its cancelTokenId', async () => {
        const onError = vi.fn();
        const wrapper = createWrapper(server, { onError });
        const request = wrapper.get('/delay/400', undefined, { cancelTokenId: 'request-1' });

        await new Promise((resolve) => setTimeout(resolve, 30));
        wrapper.cancelRequest('request-1');

        const error = await request.catch((err) => err);
        expect(axios.isCancel(error)).toBe(true);
        expect(onError).not.toHaveBeenCalled();
        // Cleaning up twice is safe.
        expect(() => wrapper.cancelRequest('request-1')).not.toThrow();
    });

    it('cancels every in-flight request', async () => {
        const wrapper = createWrapper(server);
        const first = wrapper.get('/delay/400', undefined, { cancelTokenId: 'all-1' });
        const second = wrapper.get('/delay/400', undefined, { cancelTokenId: 'all-2' });

        await new Promise((resolve) => setTimeout(resolve, 30));
        wrapper.cancelAllRequests();

        const [firstError, secondError] = await Promise.all([
            first.catch((err) => err),
            second.catch((err) => err),
        ]);
        expect(axios.isCancel(firstError)).toBe(true);
        expect(axios.isCancel(secondError)).toBe(true);
    });

    it('does not cancel requests without a cancelTokenId', async () => {
        const wrapper = createWrapper(server);
        const request = wrapper.get('/delay/80');
        wrapper.cancelAllRequests();
        await expect(request).resolves.toBeTruthy();
    });
});

describe('AxiosWrapper concurrency control', () => {
    let server: TestServer;

    beforeAll(async () => {
        server = await startServer();
    });

    beforeEach(() => {
        server.reset();
    });

    it('limits HTTP requests to maxConcurrent', async () => {
        const wrapper = createWrapper(server, { maxConcurrent: 2 });
        await Promise.all(
            Array.from({ length: 6 }, () => wrapper.get('/delay/200')),
        );
        const stats = await axios.get(`${server.baseURL}/stats`);
        expect(stats.data.requestCount).toBe(6);
        expect(stats.data.maxActiveRequests).toBeLessThanOrEqual(2);
        expect(stats.data.maxActiveRequests).toBeGreaterThan(1);
    });

    it('uses the default concurrency limit of 5', async () => {
        const wrapper = createWrapper(server);
        await Promise.all(Array.from({ length: 9 }, () => wrapper.get('/delay/200')));
        const stats = await axios.get(`${server.baseURL}/stats`);
        expect(stats.data.maxActiveRequests).toBeLessThanOrEqual(5);
        expect(stats.data.maxActiveRequests).toBeGreaterThan(1);
    });

    it('keeps draining the queue after a failed request', async () => {
        const wrapper = createWrapper(server, { maxConcurrent: 1 });
        const results = await Promise.allSettled([
            wrapper.get('/status', { code: 500 }),
            wrapper.get('/delay/10'),
            wrapper.get('/echo'),
        ]);
        expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled', 'fulfilled']);
    });
});

describe('AxiosWrapper polling', () => {
    let server: TestServer;

    beforeAll(async () => {
        server = await startServer();
    });

    beforeEach(() => {
        server.reset();
    });

    it('polls until maxPollingTimes and reports every success', async () => {
        const wrapper = createWrapper(server);
        const onSuccess = vi.fn();
        wrapper.startPolling({
            key: 'poll-success',
            url: '/poll/poll-success',
            interval: 15,
            maxPollingTimes: 3,
            onSuccess,
        });

        await waitFor(() => server.pollCounts.get('poll-success') === 3);
        await waitFor(() => onSuccess.mock.calls.length === 3);
        expect(onSuccess).toHaveBeenCalledTimes(3);
        expect(onSuccess.mock.calls[2][0].data.data.count).toBe(3);
    });

    it('stops polling on demand', async () => {
        const wrapper = createWrapper(server);
        wrapper.startPolling({
            key: 'poll-stop',
            url: '/poll/poll-stop',
            interval: 20,
            maxPollingTimes: 100,
        });
        await waitFor(() => server.pollCounts.get('poll-stop') === 1);
        wrapper.stopPolling('poll-stop');
        const count = server.pollCounts.get('poll-stop');
        await new Promise((resolve) => setTimeout(resolve, 80));
        expect(server.pollCounts.get('poll-stop')).toBe(count);
    });

    it('reports polling errors and continues', async () => {
        const wrapper = createWrapper(server);
        const onError = vi.fn();
        const onSuccess = vi.fn();
        wrapper.startPolling({
            key: 'poll-error',
            url: '/poll/poll-error?failUntil=2',
            interval: 10,
            maxPollingTimes: 3,
            onError,
            onSuccess,
        });

        await waitFor(() => onSuccess.mock.calls.length === 1);
        expect(onError).toHaveBeenCalledTimes(2);
        expect(server.pollCounts.get('poll-error')).toBe(3);
    });
});

describe('AxiosWrapperFactory', () => {
    it('caches wrappers by name and keeps different names apart', () => {
        const name = `factory-${Date.now()}-${Math.random()}`;
        const first = AxiosWrapperFactory.create(name, { baseURL: 'http://127.0.0.1:1' });
        const second = AxiosWrapperFactory.create(name);
        const other = AxiosWrapperFactory.create(name + '-other');

        expect(first).toBe(second);
        expect(first).not.toBe(other);
    });
});
