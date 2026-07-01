import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fakeInstance: any = vi.fn((config: any) => {
    return Promise.resolve({ data: config.method, headers: {}, config, request: {} });
});
fakeInstance.interceptors = {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
};
fakeInstance.get = vi.fn((url: string, config?: any) => Promise.resolve({ data: 'get', headers: {}, config: { ...config, url, method: 'get' }, request: {} }));
fakeInstance.post = vi.fn((url: string, data?: any, config?: any) => Promise.resolve({ data: 'post', headers: {}, config: { ...config, url, data, method: 'post' }, request: {} }));
fakeInstance.put = vi.fn((url: string, data?: any, config?: any) => Promise.resolve({ data: 'put', headers: {}, config: { ...config, url, data, method: 'put' }, request: {} }));
fakeInstance.delete = vi.fn((url: string, config?: any) => Promise.resolve({ data: 'delete', headers: {}, config: { ...config, url, method: 'delete' }, request: {} }));

const createMock = vi.fn(() => fakeInstance);
const cancelFn = vi.fn();
const source = { token: { promise: Promise.resolve() }, cancel: cancelFn };
const CancelToken = { source: vi.fn(() => source) };
const isCancel = vi.fn(() => false);

vi.mock('axios', () => ({
    default: { create: createMock, CancelToken, isCancel },
    create: createMock,
    CancelToken,
    isCancel,
}));

describe('AxiosWrapper', () => {
    let AxiosWrapperModule: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        AxiosWrapperModule = await import('../src/axios/index');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should create wrapper instance and call axios.create', () => {
        const wrapper = new AxiosWrapperModule.AxiosWrapper({ baseURL: 'http://localhost' });
        expect(createMock).toHaveBeenCalled();
        expect(wrapper).toBeDefined();
    });

    it('should expose factory and return same instance', () => {
        const factory = AxiosWrapperModule.AxiosWrapperFactory.create('test', { baseURL: 'http://localhost' });
        const factory2 = AxiosWrapperModule.AxiosWrapperFactory.create('test');
        expect(factory).toBe(factory2);
    });

    it('should support get/post/put/delete methods', async () => {
        const wrapper = new AxiosWrapperModule.AxiosWrapper({ baseURL: 'http://localhost' });

        const getResult = await wrapper.get('/path');
        expect(getResult.data).toBe('get');
        const postResult = await wrapper.post('/path', { a: 1 });
        expect(postResult.data).toBe('post');
        const putResult = await wrapper.put('/path', { a: 1 });
        expect(putResult.data).toBe('put');
        const deleteResult = await wrapper.delete('/path');
        expect(deleteResult.data).toBe('delete');
    });

    it('should pass cancelTokenId to request and cleanup after request', async () => {
        const wrapper = new AxiosWrapperModule.AxiosWrapper({ baseURL: 'http://localhost' });
        await wrapper.get('/path', undefined, { cancelTokenId: 'abc' });
        expect(CancelToken.source).toHaveBeenCalled();
    });

    it('should clear cache without error', () => {
        const wrapper = new AxiosWrapperModule.AxiosWrapper({ baseURL: 'http://localhost' });
        expect(() => wrapper.clearCache()).not.toThrow();
    });

    it('should download file and cleanup resources', async () => {
        vi.useFakeTimers();
        const clickSpy = vi.fn();
        const createObjectURLSpy = vi.fn(() => 'blob://url');
        const revokeObjectURLSpy = vi.fn();
        const originalClick = HTMLAnchorElement.prototype.click;

        HTMLAnchorElement.prototype.click = clickSpy;
        Object.defineProperty(URL, 'createObjectURL', {
            value: createObjectURLSpy,
            writable: true,
        });
        Object.defineProperty(URL, 'revokeObjectURL', {
            value: revokeObjectURLSpy,
            writable: true,
        });

        fakeInstance.mockResolvedValueOnce({
            data: new Blob(['ok'], { type: 'application/octet-stream' }),
            headers: {},
            config: {},
            request: {},
        });

        const wrapper = new AxiosWrapperModule.AxiosWrapper({ baseURL: 'http://localhost' });
        const response = await wrapper.downloadFile('/download', 'get');
        expect(response.data).toBeInstanceOf(Blob);
        expect(createObjectURLSpy).toHaveBeenCalled();
        expect(clickSpy).toHaveBeenCalled();

        await vi.runAllTimersAsync();
        expect(revokeObjectURLSpy).toHaveBeenCalled();

        HTMLAnchorElement.prototype.click = originalClick;
        vi.useRealTimers();
    });
});
