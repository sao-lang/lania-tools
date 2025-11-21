import axios, {
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
import { InterceptorManager } from './InterceptorManager';
import { DEFAULT_MAX_RETRIES, DEFAULT_RETRY_DELAY } from './const';

type AxiosWrapperMethodConfig = AxiosRequestConfig & {
    /** 自定义取消请求的标识，用于批量取消请求 */
    cancelTokenId?: string;
};

/** AxiosWrapper 可配置项 */
export interface WrapperOptions {
    /** 最大并发请求数，默认为无限制 */
    maxConcurrent?: number;
    /** 是否启用缓存机制 */
    enableCache?: boolean;
    /** 缓存有效期（毫秒），仅在 enableCache=true 时生效 */
    cacheTTL?: number;
    /** 是否启用防抖请求 */
    enableDebounce?: boolean;
    /** 防抖时间间隔（毫秒） */
    debounceInterval?: number;
    /** 是否启用节流请求 */
    enableThrottle?: boolean;
    /** 节流时间间隔（毫秒） */
    throttleInterval?: number;
    /** 是否启用请求失败重试 */
    enableRetry?: boolean;
    /** 重试次数，默认为 DEFAULT_MAX_RETRIES */
    retryTimes?: number;
    /** 重试间隔时间（毫秒），默认为 DEFAULT_RETRY_DELAY */
    retryDelay?: number;
    /** 获取 token 的函数，用于在请求头中添加 Authorization */
    tokenProvider?: () => string | Promise<string>;
    /** 请求或响应错误回调 */
    onError?: (err: any) => void;
    /** 全局响应处理函数 */
    responseHandler?: (res: AxiosResponse<any>) => any;
    /** 特定状态码处理函数 */
    codeHandlers?: Record<number | string, (res: AxiosResponse<any>) => any>;
    /** 自定义请求/响应拦截器 */
    interceptors?: AxiosWrapperInterceptors;
    /** 是否启用双 token 机制（accessToken + refreshToken） */
    enableDoubleToken?: boolean;
    /** 刷新 accessToken 的函数 */
    refreshAccessToken?: () => Promise<string>;
    /** accessToken 过期状态码 */
    accessTokenExpiredCodes?: (number | string)[];
    /** refreshToken 过期状态码 */
    refreshTokenExpiredCodes?: (number | string)[];
    /** refreshToken 过期时回调 */
    onRefreshTokenExpired?: () => void;
}

/** AxiosWrapper 拦截器配置 */
interface AxiosWrapperInterceptors {
    request?: {
        /** 请求成功时回调 */
        onFulfilled?: (
            value: InternalAxiosRequestConfig<any>,
        ) => InternalAxiosRequestConfig<any> | Promise<InternalAxiosRequestConfig<any>>;
        /** 请求失败时回调 */
        onRejected?: (error: any) => any;
    };
    response?: {
        /** 响应成功时回调 */
        onFulfilled?: (
            value: AxiosResponse<any, any>,
        ) => AxiosResponse<any, any> | Promise<AxiosResponse<any, any>>;
        /** 响应失败时回调 */
        onRejected?: (error: any) => any;
    };
}

/** AxiosWrapper 创建配置，包含 Axios 默认配置和 WrapperOptions */
interface AxiosWrapperCreateOptions extends CreateAxiosDefaults, WrapperOptions {}

/**
 * AxiosWrapper 封装类
 * 支持：
 * - 请求并发控制
 * - 缓存管理
 * - 防抖/节流
 * - 文件上传
 * - 轮询
 * - 请求取消
 * - 请求重试
 * - 双 token 刷新
 */
export class AxiosWrapper {
    private instance: AxiosInstance;
    private concurrencyController!: GlobalConcurrencyController;
    private cacheManager = new CacheManager();
    private debounceThrottleManager = new DebounceThrottleManager();
    private uploadManager!: UploadManager;
    private pollingManager!: PollingManager;
    private cancelTokenManager = new CancelTokenManager();
    private options: WrapperOptions;
    private refreshTokenPromise: Promise<string> | null = null;
    private interceptorManager!: InterceptorManager;

    /**
     * 创建 AxiosWrapper 实例
     * @param config Axios 原生配置
     * @param options WrapperOptions 扩展功能配置
     */
    constructor(config?: any, options?: WrapperOptions) {
        this.instance = axios.create(config);
        this.options = options || {};
        this.initManager();
    }

    /** 初始化管理器实例 */
    private initManager() {
        this.concurrencyController = new GlobalConcurrencyController(
            this.options.maxConcurrent || Infinity,
        );
        this.uploadManager = new UploadManager(this.instance, this.concurrencyController);
        this.pollingManager = new PollingManager(this.instance, this.concurrencyController);
        this.interceptorManager = new InterceptorManager({
            instance: this.instance,
            cacheManager: this.cacheManager,
            concurrencyController: this.concurrencyController,
            debounceThrottleManager: this.debounceThrottleManager,
            instanceOptions: {
                ...this.options,
                requestWithRefreshToken: this.requestWithRefreshToken,
                retryRequest: this.retryRequest,
            },
        });
    }

    /**
     * 双 token 刷新逻辑
     * - 当 accessToken 过期时，自动调用 refreshAccessToken
     * - 当 refreshToken 过期时，触发 onRefreshTokenExpired
     * @param res AxiosResponse 响应对象
     * @returns 响应结果或 Promise.reject
     */
    private async requestWithRefreshToken(res: AxiosResponse<any>) {
        const { code } = res.data || {};
        const {
            accessTokenExpiredCodes = [],
            refreshTokenExpiredCodes = [],
            refreshAccessToken,
            onRefreshTokenExpired,
        } = this.options;

        if (!accessTokenExpiredCodes.includes(code) && !refreshTokenExpiredCodes.includes(code)) {
            return res;
        }

        if (refreshTokenExpiredCodes.includes(code)) {
            try {
                onRefreshTokenExpired?.();
            } finally {
                // eslint-disable-next-line no-unsafe-finally
                return Promise.reject(new Error('Refresh token expired'));
            }
        }

        if (accessTokenExpiredCodes.includes(code)) {
            const originalConfig = res.config as InternalAxiosRequestConfig & {
                __gotAccessToken?: boolean;
            };
            if (originalConfig.__gotAccessToken) {
                return Promise.reject(new Error('Request already retried after refresh'));
            }
            originalConfig.__gotAccessToken = true;

            if (typeof refreshAccessToken !== 'function') {
                return Promise.reject(new Error('No refreshAccessToken provided'));
            }

            if (!this.refreshTokenPromise) {
                const p = (async () => {
                    const token = await refreshAccessToken();
                    if (!token || typeof token !== 'string') {
                        throw new Error('refreshAccessToken did not return a valid token');
                    }
                    return token;
                })();
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

            let newToken: string;
            try {
                newToken = await this.refreshTokenPromise!;
            } catch (e) {
                onRefreshTokenExpired?.();
                return Promise.reject(e);
            }

            if (originalConfig.headers) {
                (originalConfig.headers as any).set('Authorization', `Bearer ${newToken}`);
            } else {
                originalConfig.headers = { Authorization: `Bearer ${newToken}` } as any;
            }

            try {
                const retryResp = await this.instance(originalConfig);
                return retryResp;
            } catch (e) {
                return Promise.reject(e);
            }
        }

        return res;
    }

    /**
     * 请求重试逻辑
     * @param err Axios 错误对象
     * @returns 重试后的响应或抛出错误
     */
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

    /**
     * 请求封装
     * @param method 请求方法：'get' | 'post' | 'put' | 'delete'
     * @param url 请求地址
     * @param data 请求数据
     * @param config 请求配置，可含 cancelTokenId
     * @returns AxiosResponse
     */
    private async requestWrapper<T>(
        method: 'get' | 'post' | 'put' | 'delete',
        url: string,
        data?: any,
        config?: AxiosWrapperMethodConfig,
    ) {
        const cancelTokenSource = axios.CancelToken.source();
        if (config?.cancelTokenId) {
            config.cancelToken = cancelTokenSource.token;
            this.cancelTokenManager.set(config.cancelTokenId, cancelTokenSource);
        }

        const req = this.concurrencyController
            .run(() => this.instance[method]<T>(url, data, config))
            .finally(() => {
                if (config?.cancelTokenId) this.cancelTokenManager.delete(config.cancelTokenId);
            });

        return req;
    }

    /** GET 请求 */
    public get<T>(url: string, config?: AxiosRequestConfig) {
        return this.requestWrapper<T>('get', url, undefined, config);
    }

    /** POST 请求 */
    public post<T>(url: string, data?: any, config?: AxiosRequestConfig) {
        return this.requestWrapper<T>('post', url, data, config);
    }

    /** PUT 请求 */
    public put<T>(url: string, data?: any, config?: AxiosRequestConfig) {
        return this.requestWrapper<T>('put', url, data, config);
    }

    /** DELETE 请求 */
    public delete<T>(url: string, config?: AxiosRequestConfig) {
        return this.requestWrapper<T>('delete', url, undefined, config);
    }

    /**
     * 上传文件
     * @param url 上传地址
     * @param file 文件对象
     * @param options UploadFileOptions 上传配置
     */
    public uploadFile(url: string, file: File, options?: UploadFileOptions) {
        return this.uploadManager.uploadFile(url, file, options);
    }

    /** 开始轮询 */
    public startPolling<T>(config: PollingConfig<T>) {
        this.pollingManager.poll(config);
    }

    /** 停止轮询 */
    public stopPolling(key: string) {
        this.pollingManager.stopPolling(key);
    }

    /** 取消指定请求 */
    public cancelRequest(tokenId: string) {
        this.cancelTokenManager.cancelById(tokenId);
    }

    /** 取消所有请求 */
    public cancelAllRequests() {
        this.cancelTokenManager.cancelAll();
    }

    /** 清除缓存 */
    public clearCache() {
        this.cacheManager.clear();
    }

    /**
     * 下载文件
     * @param url 下载地址
     * @param method 请求方法
     * @param filename 文件名
     * @param config 请求配置，可含 cancelTokenId
     */
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
                responseType: 'blob',
            });

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
 * AxiosWrapper 工厂类
 * 支持多套 API 实例管理
 */
export class AxiosWrapperFactory {
    private static instances: Map<string, AxiosWrapper> = new Map();

    /**
     * 创建或获取 AxiosWrapper 实例
     * @param name 实例名称
     * @param config 创建配置
     * @returns AxiosWrapper 实例
     */
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
