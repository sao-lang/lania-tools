import axios, {
    AxiosAdapter,
    AxiosInstance,
    AxiosRequestConfig,
    AxiosResponse,
    CreateAxiosDefaults,
    InternalAxiosRequestConfig,
} from 'axios';
import { GlobalConcurrencyController } from './GlobalConcurrencyController';
import { CacheManager } from './CacheManager';
import { DebounceThrottleManager } from './DebounceThrottleManager';
import { UploadManager, UploadFileOptions } from './UploadManager';
import { PollingConfig, PollingManager } from './PollingManager';
import { CancelTokenManager } from './CancelTokenManager';
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000;

type AxiosWrapperMethodConfig = AxiosRequestConfig & {
    cancelTokenId?: string;
};

interface WrapperOptions {
    maxConcurrent?: number;
    enableCache?: boolean;
    cacheTTL?: number;
    enableDebounce?: boolean;
    debounceInterval?: number;
    enableThrottle?: boolean;
    throttleInterval?: number;
    enableRetry?: boolean;
    retryTimes?: number;
    retryDelay?: number;
    tokenProvider?: () => string | Promise<string>;
    onError?: (err: any) => void;
    responseHandler?: (res: AxiosResponse<any>) => any;
    codeHandlers?: Record<number | string, (res: AxiosResponse<any>) => any>;
    interceptors?: AxiosWrapperInterceptors;
    enableDoubleToken?: boolean;
    refreshAccessToken?: () => Promise<string>;
    accessTokenExpiredCodes?: (number | string)[];
    refreshTokenExpiredCodes?: (number | string)[];
    onRefreshTokenExpired?: () => void;
}

interface AxiosWrapperInterceptors {
    request?: {
        onFulfilled?: (
            value: InternalAxiosRequestConfig<any>,
        ) => InternalAxiosRequestConfig<any> | Promise<InternalAxiosRequestConfig<any>>;
        onRejected?: (error: any) => any;
    };
    response?: {
        onFulfilled?: (
            value: AxiosResponse<any, any>,
        ) => AxiosResponse<any, any> | Promise<AxiosResponse<any, any>>;
        onRejected?: (error: any) => any;
    };
}

interface AxiosWrapperCreateOptions extends CreateAxiosDefaults, WrapperOptions {}

export class AxiosWrapper {
    private instance: AxiosInstance;
    // 并发管理器
    private concurrencyController!: GlobalConcurrencyController;
    // 缓存管理器
    private cacheManager = new CacheManager();
    // 防抖节流
    private debounceThrottleManager = new DebounceThrottleManager();
    // 上传文件
    private uploadManager!: UploadManager;
    private pollingManager!: PollingManager;
    private cancelTokenManager = new CancelTokenManager();
    private options: WrapperOptions;
    /** 全局错误处理锁，防止重复触发 */
    private static errorLocks: Set<string | number> = new Set();
    private refreshTokenPromise: Promise<string> | null = null;

    constructor(config?: any, options?: WrapperOptions) {
        this.instance = axios.create(config);
        this.options = options || {};
        this.initMamager();
        this.instanceHandler();
    }

    private initMamager() {
        this.concurrencyController = new GlobalConcurrencyController(
            this.options.maxConcurrent || Infinity,
        );
        this.uploadManager = new UploadManager(this.instance, this.concurrencyController);
        this.pollingManager = new PollingManager(this.instance, this.concurrencyController);
    }
    private instanceHandler() {
        // this.instance.defaults.adapter = async (config) => {
        //     if (this.options.enableCache) {
        //         const cached = this.cacheManager.get(config);
        //         if (cached !== null) {
        //             return {
        //                 data: cached,
        //                 status: 200,
        //                 statusText: 'OK',
        //                 headers: {},
        //                 config,
        //                 request: {},
        //             };
        //         }
        //     }
        //     const defaultAdapter = axios.defaults.adapter as AxiosAdapter;
        //     return defaultAdapter(config);
        // };
        // 请求拦截器
        this.instance.interceptors.request.use(
            async (req: InternalAxiosRequestConfig<any>) => {
                // 1️⃣ 默认逻辑：Token、防抖/节流、缓存
                if (this.options.tokenProvider) {
                    const token = await this.options.tokenProvider();
                    req.headers = req.headers || {};
                    req.headers['Authorization'] = `Bearer ${token}`;
                }
                if (this.options.enableCache) {
                    const cached = this.cacheManager.get(req);
                    if (cached !== null) {
                        // 构造一个类似 axios 的响应对象
                        return Promise.reject({
                            __fromCache: true, // 标记是缓存
                            data: cached,
                            status: 200,
                            statusText: 'OK',
                            headers: {},
                            config: req,
                            request: {},
                        });
                    }
                }
                if (this.options.enableDebounce) {
                    req = (await this.debounceThrottleManager.debounceRequest(
                        req,
                        this.options.debounceInterval,
                    )) as InternalAxiosRequestConfig<any>;
                }
                if (this.options.enableThrottle) {
                    req = (await this.debounceThrottleManager.throttleRequest(
                        req,
                        this.options.throttleInterval,
                    )) as InternalAxiosRequestConfig<any>;
                }
                return req;
            },
            (err) => Promise.reject(err),
        );
        // 注册用户自定义请求拦截器
        if (this.options.interceptors?.request) {
            this.instance.interceptors.request.use(
                this.options.interceptors.request.onFulfilled,
                this.options.interceptors.request.onRejected,
            );
        }
        // 响应拦截器
        this.instance.interceptors.response.use(
            async (res: AxiosResponse<any>) => {
                if (this.options.enableCache) {
                    this.cacheManager.set(res.config, res, this.options.cacheTTL);
                }
                if (this.options.enableDoubleToken) {
                    return await this.requestWithRefreshToken(res);
                }
                const { res: cbResult, flag } = this.responseCallback(res);
                if (flag) {
                    return cbResult;
                }
                const { code, message } = res.data || {};
                if (code && code !== 0 && code !== 200) {
                    const err = new Error(message || `Request failed with code ${code}`);
                    (err as any).code = code;
                    throw err;
                }

                return res;
            },
            async (err: any) => {
                if (err.__fromCache) return Promise.resolve(err.data);
                this.options.onError?.(err);
                if (this.options.enableRetry) {
                    return this.concurrencyController.run(() => this.retryRequest(err));
                }
                return Promise.reject(err);
            },
        );
        // 注册用户自定义响应拦截器
        if (this.options.interceptors?.response) {
            this.instance.interceptors.response.use(
                this.options.interceptors.response.onFulfilled,
                this.options.interceptors.response.onRejected,
            );
        }
    }

    private async requestWithRefreshToken(res: AxiosResponse<any>) {
        const { code } = res.data || {};
        const {
            accessTokenExpiredCodes = [],
            refreshTokenExpiredCodes = [],
            refreshAccessToken,
            onRefreshTokenExpired,
        } = this.options;

        // 不是 token 相关的 code，直接原样返回
        if (!accessTokenExpiredCodes.includes(code) && !refreshTokenExpiredCodes.includes(code)) {
            return res;
        }

        // refreshToken 过期 —— 触发登出/回调并 reject
        if (refreshTokenExpiredCodes.includes(code)) {
            try {
                onRefreshTokenExpired?.();
            } finally {
                // eslint-disable-next-line no-unsafe-finally
                return Promise.reject(new Error('Refresh token expired'));
            }
        }

        // accessToken 过期 —— 需要刷新 accessToken 后重试
        if (accessTokenExpiredCodes.includes(code)) {
            const originalConfig = res.config as InternalAxiosRequestConfig & {
                __gotAccessToken?: boolean;
            };

            // 防止同一个请求无限循环刷新
            if (originalConfig.__gotAccessToken) {
                return Promise.reject(new Error('Request already retried after refresh'));
            }
            originalConfig.__gotAccessToken = true;

            // refreshAccessToken 必须是函数
            if (typeof refreshAccessToken !== 'function') {
                return Promise.reject(new Error('No refreshAccessToken provided'));
            }

            // 若没有正在进行的刷新，就发起一次并把 Promise 保存为锁
            if (!this.refreshTokenPromise) {
                // 注意：refreshAccessToken 可能返回 string 或 Promise<string>
                const p = (async () => {
                    const token = await refreshAccessToken();
                    if (!token || typeof token !== 'string') {
                        // 规范化错误：如果刷新没拿到 token 视为失败
                        throw new Error('refreshAccessToken did not return a valid token');
                    }
                    return token;
                })();

                // 覆盖成会在 settle 后清理自身的 promise
                this.refreshTokenPromise = p.then(
                    (t) => {
                        this.refreshTokenPromise = null;
                        return t;
                    },
                    (e) => {
                        this.refreshTokenPromise = null;
                        throw e;
                    },
                );
            }

            // 等待刷新结果（所有并发请求都会在这里 await 同一个 Promise）
            let newToken: string;
            try {
                newToken = await this.refreshTokenPromise!;
            } catch (e) {
                // 刷新失败，触发退出/回调
                onRefreshTokenExpired?.();
                return Promise.reject(e);
            }

            // 合并 header（谨慎处理各种 headers 结构）
            if (originalConfig.headers) {
                (originalConfig.headers as any).set('Authorization', `Bearer ${newToken}`);
            } else {
                originalConfig.headers = {
                    Authorization: `Bearer ${newToken}`,
                } as any;
            }

            // 重新发送请求（会走普通的 axios 流程，但由于 _retry 已经设为 true，避免二次刷新）
            try {
                const retryResp = await this.instance(originalConfig);
                return retryResp;
            } catch (e) {
                // 如果重试失败，根据场景可以把错误抛出或进一步处理
                return Promise.reject(e);
            }
        }

        // 兜底：直接返回
        return res;
    }

    private responseCallback(res: AxiosResponse<any>) {
        const { code } = res.data || {};
        const { responseHandler, codeHandlers } = this.options;
        if (responseHandler) return { res: responseHandler(res), flag: true };
        if (codeHandlers && code in codeHandlers) {
            const handler = codeHandlers[code];
            if (AxiosWrapper.errorLocks.has(code)) return { res, flag: true };
            AxiosWrapper.errorLocks.add(code);

            try {
                return { res: handler?.(res), flag: true };
            } finally {
                setTimeout(() => AxiosWrapper.errorLocks.delete(code), 1000);
            }
        }
        return { res, flag: false };
    }

    private async retryRequest(err: any) {
        const config = err.config;
        config.__retryCount = config.__retryCount || 0;
        if (config.__retryCount < (this.options.retryTimes || DEFAULT_MAX_RETRIES)) {
            config.__retryCount++;
            await new Promise((r) => setTimeout(r, this.options.retryDelay || DEFAULT_RETRY_DELAY));
            return this.concurrencyController.run(() => this.instance(config));
        }
        throw err;
    }

    private async requestWrapper<T>(
        method: 'get' | 'post' | 'put' | 'delete',
        url: string,
        data?: any,
        config?: AxiosWrapperMethodConfig,
    ) {
        const cancelTokenSource = axios.CancelToken.source();
        if (config?.cancelTokenId) {
            config.cancelToken = cancelTokenSource.token;
            this.cancelTokenManager.set(config?.cancelTokenId, cancelTokenSource);
        }

        const req = this.concurrencyController
            .run(() => this.instance[method]<T>(url, data, config))
            .finally(() => {
                if (config?.cancelTokenId) this.cancelTokenManager.delete(config.cancelTokenId);
            });
        return req;
    }

    public get<T>(url: string, config?: AxiosRequestConfig) {
        return this.requestWrapper<T>('get', url, undefined, config);
    }
    public post<T>(url: string, data?: any, config?: AxiosRequestConfig) {
        return this.requestWrapper<T>('post', url, data, config);
    }
    public put<T>(url: string, data?: any, config?: AxiosRequestConfig) {
        return this.requestWrapper<T>('put', url, data, config);
    }
    public delete<T>(url: string, config?: AxiosRequestConfig) {
        return this.requestWrapper<T>('delete', url, undefined, config);
    }

    // ---------------- 文件上传 ----------------
    public uploadFile(url: string, file: File, options?: UploadFileOptions) {
        return this.uploadManager.uploadFile(url, file, options);
    }

    // ---------------- 轮询 ----------------
    public startPolling<T>(config: PollingConfig<T>) {
        this.pollingManager.poll(config);
    }
    public stopPolling(key: string) {
        this.pollingManager.stopPolling(key);
    }

    // ---------------- 取消请求 ----------------
    public cancelRequest(tokenId: string) {
        this.cancelTokenManager.cancelById(tokenId);
    }

    public cancelAllRequests() {
        this.cancelTokenManager.cancelAll();
    }

    public clearCache() {
        this.cacheManager.clear();
    }
    public async downloadFile(
        url: string,
        method: 'get' | 'post' = 'get',
        filename?: string,
        config?: AxiosRequestConfig & { cancelTokenId?: string },
    ) {
        try {
            const cancelTokenSource = axios.CancelToken.source();
            if (config?.cancelTokenId) {
                config.cancelToken = cancelTokenSource.token;
                this.cancelTokenManager.set(config.cancelTokenId, cancelTokenSource);
            }
            const response = await this.instance[method]<Blob>(url, {
                ...config,
                responseType: 'blob', // 必须设置为 blob
            });

            // 自动创建下载链接
            const blobUrl = URL.createObjectURL(response.data);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = filename || url.split('/').pop() || 'file';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(blobUrl);

            return response;
        } finally {
            if (config?.cancelTokenId) this.cancelTokenManager.delete(config.cancelTokenId);
        }
    }
}

/**
 * 工厂模式
 * 适用项目里面多套api的情况
 */
export class AxiosWrapperFactory {
    private static instances: Map<string, AxiosWrapper> = new Map();

    public static create(
        name: string,
        config?: AxiosWrapperCreateOptions & { maxConcurrent?: number },
    ) {
        if (!this.instances.has(name)) {
            const instance = new AxiosWrapper(config, config);
            this.instances.set(name, instance);
        }
        return this.instances.get(name)!;
    }
}
