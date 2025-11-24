// AxiosWrapper.ts (或 index.ts)

import axios, {
    AxiosInstance,
    AxiosRequestConfig,
    AxiosResponse,
    CreateAxiosDefaults,
    InternalAxiosRequestConfig,
} from 'axios';
// 假设这些 Manager 文件是存在的，并且已经使用了我们讨论过的最终版本：
import { GlobalConcurrencyController } from './GlobalConcurrencyController';
import { CacheManager } from './CacheManager';
import { DebounceThrottleManager } from './DebounceThrottleManager';
import { UploadManager, UploadFileOptions } from './UploadManager';
import { PollingConfig, PollingManager } from './PollingManager';
import { CancelTokenManager } from './CancelTokenManager';
import { InterceptorManager } from './InterceptorManager';
import { DEFAULT_MAX_RETRIES, DEFAULT_RETRY_DELAY } from './const';

/**
 * 扩展的 Axios 请求配置，用于公共方法
 */
type AxiosWrapperMethodConfig = AxiosRequestConfig & {
    /**
     * 自定义取消请求的唯一标识。
     */
    cancelTokenId?: string;
};

/**
 * 自定义拦截器定义
 */
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

/**
 * AxiosWrapper 的全局配置选项接口
 */
export interface WrapperOptions {
    // --- 并发控制 ---
    maxConcurrent?: number;

    // --- 缓存控制 ---
    enableCache?: boolean;
    cacheTTL?: number;

    // --- 防抖与节流 ---
    enableDebounce?: boolean;
    debounceInterval?: number;
    enableThrottle?: boolean;
    throttleInterval?: number;

    // --- 重试机制 ---
    enableRetry?: boolean;
    retryTimes?: number;
    retryDelay?: number;

    // --- Token 与 认证 ---
    tokenProvider?: () => string | Promise<string>;
    enableDoubleToken?: boolean;
    getRefreshToken?: () => string | Promise<string>;
    refreshAccessToken?: (refreshToken: string) => string | Promise<string>;
    accessTokenExpiredCodes?: (number | string)[];
    refreshTokenExpiredCodes?: (number | string)[];
    onRefreshTokenExpired?: () => void;

    // --- 错误与响应处理 ---
    onError?: (err: any) => void;
    responseHandler?: (res: AxiosResponse<any>) => any;
    codeHandlers?: Record<number | string, (res: AxiosResponse<any>) => any>;

    // --- 自定义拦截器 ---
    interceptors?: AxiosWrapperInterceptors;
}

/**
 * 创建实例时的完整配置对象
 */
interface AxiosWrapperCreateOptions extends CreateAxiosDefaults, WrapperOptions {}

/**
 * **AxiosWrapper 核心类**
 */
export class AxiosWrapper {
    /** 内部 Axios 实例 */
    private instance: AxiosInstance;
    /** 并发控制器 */
    private concurrencyController!: GlobalConcurrencyController;
    /** 缓存管理器 */
    private cacheManager = new CacheManager();
    /** 防抖节流管理器 */
    private debounceThrottleManager = new DebounceThrottleManager();
    /** 上传管理器 */
    private uploadManager!: UploadManager;
    /** 轮询管理器 */
    private pollingManager!: PollingManager;
    /** 取消令牌管理器 */
    private cancelTokenManager = new CancelTokenManager();
    /** 配置选项 */
    private options: WrapperOptions;
    /** 刷新 Token 的 Promise 单例，防止并发刷新 */
    private refreshTokenPromise: Promise<string> | null = null;
    /** 拦截器管理器 */
    private interceptorManager!: InterceptorManager;

    /**
     * 初始化 AxiosWrapper
     */
    constructor(config?: CreateAxiosDefaults, options?: WrapperOptions) {
        this.instance = axios.create(config);
        this.options = options || {};
        this.initManager();
        // 挂载拦截器，确保在构造函数结束前完成
        this.interceptorManager.attachInterceptors();
    }

    /**
     * 初始化内部各个 Manager 模块
     */
    private initManager() {
        this.concurrencyController = new GlobalConcurrencyController(
            this.options.maxConcurrent || Infinity,
        );
        this.uploadManager = new UploadManager(this.instance, this.concurrencyController);
        this.pollingManager = new PollingManager(this.instance, this.concurrencyController);

        // 初始化拦截器管理器，注入必要的依赖和核心回调
        this.interceptorManager = new InterceptorManager({
            instance: this.instance,
            cacheManager: this.cacheManager,
            debounceThrottleManager: this.debounceThrottleManager,
            instanceOptions: {
                ...this.options,
                // 核心业务逻辑通过回调传入 InterceptorManager
                requestWithRefreshToken: this.requestWithRefreshToken.bind(this),
                retryRequest: this.retryRequest.bind(this),
            },
        });
    }

    /**
     * **双 Token 刷新核心逻辑**
     * 此方法在 InterceptorManager.doubleTokenMiddleware 中被调用。
     */
    private async requestWithRefreshToken(res: AxiosResponse<any>) {
        const { code } = res.data || {};
        const {
            accessTokenExpiredCodes = [],
            refreshTokenExpiredCodes = [],
            refreshAccessToken,
            onRefreshTokenExpired,
            getRefreshToken,
        } = this.options;

        const isAccessExpired = accessTokenExpiredCodes.includes(code);
        const isRefreshExpired = refreshTokenExpiredCodes.includes(code);

        if (!isAccessExpired && !isRefreshExpired) {
            return res;
        }

        // 1. Refresh Token 过期：强制登出
        if (isRefreshExpired) {
            try {
                onRefreshTokenExpired?.();
            } finally {
                // eslint-disable-next-line no-unsafe-finally
                return Promise.reject(new Error('Refresh token expired'));
            }
        }

        // 2. Access Token 过期：尝试刷新 (使用 Promise 单例模式)
        if (isAccessExpired) {
            const originalConfig = res.config as InternalAxiosRequestConfig & {
                __gotAccessToken?: boolean;
            };

            // 防止死循环
            if (originalConfig.__gotAccessToken) {
                return Promise.reject(new Error('Request already retried after refresh'));
            }
            originalConfig.__gotAccessToken = true; // 标记已重试

            if (typeof refreshAccessToken !== 'function') {
                return Promise.reject(new Error('No refreshAccessToken provided'));
            }

            // --- 刷新任务单例 ---
            if (!this.refreshTokenPromise) {
                this.refreshTokenPromise = (async () => {
                    const refreshToken = await getRefreshToken?.();
                    if (!refreshToken) throw new Error('Missing refresh token.');

                    const token = await refreshAccessToken(refreshToken);
                    if (!token || typeof token !== 'string')
                        throw new Error('Invalid new access token.');

                    return token;
                })().finally(() => {
                    this.refreshTokenPromise = null; // 无论成功失败都清除单例
                });
            }

            // 等待刷新完成
            let newToken: string;
            try {
                newToken = await this.refreshTokenPromise;
            } catch (e) {
                onRefreshTokenExpired?.();
                return Promise.reject(e);
            }

            // 更新原请求的 Header
            const authValue = `Bearer ${newToken}`;
            const headers = originalConfig.headers as any;
            if (headers && typeof headers.set === 'function') {
                headers.set('Authorization', authValue);
            } else {
                originalConfig.headers = {
                    ...headers,
                    Authorization: authValue,
                } as any;
            }

            // 使用新 Token 重试原请求
            try {
                return await this.instance(originalConfig);
            } catch (e) {
                return Promise.reject(e);
            }
        }

        return res;
    }

    /**
     * **请求自动重试逻辑**
     * 此方法在 InterceptorManager.retryMiddleware 中被调用。
     */
    private async retryRequest(err: any) {
        const config = err.config as InternalAxiosRequestConfig & {
            __retryCount?: number;
        };

        config.__retryCount = config.__retryCount || 0;

        if (config.__retryCount < (this.options.retryTimes || DEFAULT_MAX_RETRIES)) {
            config.__retryCount++;

            // 延迟等待
            await new Promise((r) => setTimeout(r, this.options.retryDelay || DEFAULT_RETRY_DELAY));

            // 核心：重新将请求放入 GlobalConcurrencyController 队列
            return this.concurrencyController.run(() => this.instance(config));
        }

        // 超过重试次数，抛出原错误
        throw err;
    }

    /**
     * 通用请求包装器
     * 统一处理：CancelToken 注入、并发控制队列
     */
    public async request<T>(config: AxiosWrapperMethodConfig) {
        const { method, url, data, params, cancelTokenId } = config;

        // 1. 处理取消令牌
        const cancelTokenSource = axios.CancelToken.source();
        if (config?.cancelTokenId) {
            config.cancelToken = cancelTokenSource.token;
            this.cancelTokenManager.set(config.cancelTokenId, cancelTokenSource);
        }

        // 2. 放入并发控制器执行
        const req = await this.concurrencyController
            .run(() => {
                // 严格区分 GET/DELETE 和 POST/PUT 的参数签名
                if (method === 'get' || method === 'delete') {
                    return this.instance[method]<T>(url!, { ...(config ?? {}), params });
                } else {
                    return this.instance[method as 'post' | 'put']<T>(url!, data, config);
                }
            })
            .finally(() => {
                // 3. 请求完成后清理取消令牌
                if (cancelTokenId) this.cancelTokenManager.delete(cancelTokenId);
            });

        return req;
    }

    // --- 快捷方法 API ---

    public get<T>(url: string, data?: any, config: AxiosRequestConfig = {}) {
        config.url = url ?? config.url;
        config.params = data ?? config.data;
        return this.request<T>({ ...config, method: 'get' });
    }

    public post<T>(url: string, data?: any, config: AxiosRequestConfig = {}) {
        config.url = url ?? config.url;
        config.data = data ?? config.data;
        return this.request<T>({ ...config, method: 'post' });
    }

    public put<T>(url: string, data?: any, config: AxiosRequestConfig = {}) {
        config.url = url ?? config.url;
        config.data = data ?? config.data;
        return this.request<T>({ ...config, method: 'put' });
    }

    public delete<T>(url: string, data?: any, config: AxiosRequestConfig = {}) {
        config.url = url ?? config.url;
        config.params = data ?? config.data;
        return this.request<T>({ ...config, method: 'delete' });
    }

    // --- Manager API ---

    public uploadFile(url: string, file: File, options?: UploadFileOptions) {
        return this.uploadManager.uploadFile(url, file, options);
    }

    public startPolling<T>(config: PollingConfig<T>) {
        this.pollingManager.poll(config);
    }

    public stopPolling(key: string) {
        this.pollingManager.stopPolling(key);
    }

    public cancelRequest(tokenId: string) {
        this.cancelTokenManager.cancelById(tokenId);
    }

    public cancelAllRequests() {
        this.cancelTokenManager.cancelAll();
    }

    public clearCache() {
        this.cacheManager.clear();
    }

    /**
     * 下载文件
     * 自动处理 Blob 流，并触发浏览器下载行为。
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

            // 强制设置 responseType 为 blob
            const response = await this.instance<Blob>(url, {
                ...config,
                method,
                responseType: 'blob',
            });

            // 文件名解析策略
            let finalFilename = filename;
            if (!finalFilename) {
                const disposition = response.headers['content-disposition'];
                if (disposition) {
                    const match = disposition.match(
                        /filename\*?=['"]?(?:UTF-\d['"]*)?([^;\r\n"']*)['"]?;?/i,
                    );
                    if (match && match[1]) {
                        finalFilename = decodeURIComponent(match[1]);
                    }
                }
            }
            finalFilename = finalFilename || url.split('/').pop() || 'download_file';

            // 创建 Blob URL 并触发下载
            const blobUrl = URL.createObjectURL(response.data);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = finalFilename;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();

            // 延迟清理资源
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(blobUrl);
            }, 100);

            return response;
        } finally {
            if (config?.cancelTokenId) this.cancelTokenManager.delete(config.cancelTokenId);
        }
    }
}

/**
 * **AxiosWrapper 工厂类**
 */
export class AxiosWrapperFactory {
    private static instances: Map<string, AxiosWrapper> = new Map();

    /**
     * 创建或获取已存在的 AxiosWrapper 实例
     */
    public static create(
        name: string,
        config?: AxiosWrapperCreateOptions & { maxConcurrent?: number },
    ) {
        if (!this.instances.has(name)) {
            // 注意：将 config 传递两次，第一次是 AxiosDefaults，第二次是 WrapperOptions
            const instance = new AxiosWrapper(config, config);
            this.instances.set(name, instance);
        }
        return this.instances.get(name)!;
    }
}
