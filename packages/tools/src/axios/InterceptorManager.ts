import axios, {
    AxiosInstance,
    AxiosRequestConfig,
    AxiosResponse,
    CreateAxiosDefaults,
    InternalAxiosRequestConfig,
    AxiosHeaders,
} from 'axios';
import { GlobalConcurrencyController } from './GlobalConcurrencyController';
import { CacheManager } from './CacheManager';
import { DebounceThrottleManager } from './DebounceThrottleManager';
import { UploadManager, UploadFileOptions } from './UploadManager';
import { PollingConfig, PollingManager } from './PollingManager';
import { CancelTokenManager } from './CancelTokenManager';
import { InterceptorManager } from './InterceptorManager';
import { DEFAULT_MAX_RETRIES, DEFAULT_RETRY_DELAY } from './const';

/**
 * 扩展的 Axios 请求配置
 */
type AxiosWrapperMethodConfig = AxiosRequestConfig & {
    /**
     * 自定义取消请求的唯一标识。
     * 如果提供了此 ID，后续可以通过 `cancelRequest(id)` 单独取消该请求。
     * @example cancelTokenId: 'user-list-request'
     */
    cancelTokenId?: string;
};

/**
 * AxiosWrapper 的全局配置选项接口
 * 用于控制并发、缓存、重试、Token 刷新等高级功能
 */
export interface WrapperOptions {
    // --- 并发控制 ---
    /**
     * 系统允许的最大并发请求数。
     * 超过此数量的请求将进入队列等待，直到有空闲槽位。
     * @default Infinity (无限制)
     */
    maxConcurrent?: number;

    // --- 缓存控制 ---
    /**
     * 是否启用 GET 请求的缓存机制。
     * 启用后，相同 URL 和参数的请求在 cacheTTL 内将直接返回缓存数据。
     * @default false
     */
    enableCache?: boolean;
    /**
     * 缓存数据的有效期（毫秒）。
     * 仅在 `enableCache` 为 true 时生效。
     * @default 300000 (5分钟)
     */
    cacheTTL?: number;

    // --- 防抖与节流 ---
    /**
     * 是否启用防抖 (Debounce)。
     * 启用后，短时间内多次触发相同请求，只会在最后一次触发后执行。
     * @default false
     */
    enableDebounce?: boolean;
    /**
     * 防抖的时间窗口（毫秒）。
     * @default 1000
     */
    debounceInterval?: number;
    /**
     * 是否启用节流 (Throttle)。
     * 启用后，规定时间内只能执行一次该请求。
     * @default false
     */
    enableThrottle?: boolean;
    /**
     * 节流的时间间隔（毫秒）。
     * @default 1000
     */
    throttleInterval?: number;

    // --- 重试机制 ---
    /**
     * 是否启用请求失败自动重试。
     * 通常用于解决网络波动导致的临时失败。
     * @default false
     */
    enableRetry?: boolean;
    /**
     * 最大重试次数。
     * @default DEFAULT_MAX_RETRIES (通常为 3)
     */
    retryTimes?: number;
    /**
     * 每次重试之间的等待延迟（毫秒）。
     * @default DEFAULT_RETRY_DELAY (通常为 1000)
     */
    retryDelay?: number;

    // --- Token 与 认证 ---
    /**
     * 获取基础 Access Token 的函数。
     * 用于在每次请求的 `Authorization` Header 中自动注入 Token。
     */
    tokenProvider?: () => string | Promise<string>;
    /**
     * 是否启用双 Token (Access + Refresh) 自动刷新机制。
     * @default false
     */
    enableDoubleToken?: boolean;
    /**
     * 执行刷新 Token 的具体逻辑。
     * 应返回新的 Access Token 字符串。
     */
    refreshAccessToken?: () => Promise<string>;
    /**
     * 后端返回的标志 Access Token 过期的状态码列表。
     * @example [401, 40101]
     */
    accessTokenExpiredCodes?: (number | string)[];
    /**
     * 后端返回的标志 Refresh Token 也已过期的状态码列表。
     * 此时无法自动刷新，通常需要登出用户。
     * @example [40102]
     */
    refreshTokenExpiredCodes?: (number | string)[];
    /**
     * 当 Refresh Token 过期（即无法再自动刷新）时的回调。
     * 通常在此处执行跳转登录页或清除本地存储的操作。
     */
    onRefreshTokenExpired?: () => void;

    // --- 错误与响应处理 ---
    /**
     * 全局错误回调。
     * 当请求失败（且重试也无效）时触发。
     */
    onError?: (err: any) => void;
    /**
     * 全局响应成功预处理函数。
     * 可用于统一解包后端数据结构，例如 `res.data.data`。
     */
    responseHandler?: (res: AxiosResponse<any>) => any;
    /**
     * 针对特定业务状态码（res.data.code）的特殊处理函数映射。
     * 优先级高于 `responseHandler`。
     */
    codeHandlers?: Record<number | string, (res: AxiosResponse<any>) => any>;

    // --- 自定义拦截器 ---
    /**
     * 允许用户注入额外的 Axios 拦截器，用于处理特定的业务逻辑。
     */
    interceptors?: AxiosWrapperInterceptors;
}

/**
 * 自定义拦截器定义
 * 对应 Axios 的 interceptors.request 和 interceptors.response
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
 * 创建实例时的完整配置对象
 */
interface AxiosWrapperCreateOptions extends CreateAxiosDefaults, WrapperOptions {}

/**
 * **AxiosWrapper 核心类**
 *
 * 对 Axios 进行了深度封装，提供了企业级的 HTTP 请求处理能力。
 *
 * @class AxiosWrapper
 * @features
 * - 🚀 **并发控制**: 限制最大并行请求数
 * - 💾 **缓存管理**: 内存级请求缓存
 * - ⏱️ **防抖/节流**: 避免重复请求
 * - 🔄 **自动重试**: 网络异常自动重试
 * - 🔐 **无感刷新**: 双 Token 自动续期
 * - 📁 **文件处理**: 封装上传与下载
 * - 📡 **轮询机制**: 简单的轮询管理器
 * - 🛑 **取消机制**: 基于 Token 的请求取消
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
     * @param config - Axios 原生配置 (baseURL, timeout 等)
     * @param options - Wrapper 高级功能配置
     */
    constructor(config?: any, options?: WrapperOptions) {
        this.instance = axios.create(config);
        this.options = options || {};
        this.initManager();
    }

    /**
     * 初始化内部各个 Manager 模块
     * 并装载拦截器
     */
    private initManager() {
        this.concurrencyController = new GlobalConcurrencyController(
            this.options.maxConcurrent || Infinity,
        );
        this.uploadManager = new UploadManager(this.instance, this.concurrencyController);
        this.pollingManager = new PollingManager(this.instance, this.concurrencyController);

        // 初始化拦截器管理器，注入必要的依赖
        this.interceptorManager = new InterceptorManager({
            instance: this.instance,
            cacheManager: this.cacheManager,
            concurrencyController: this.concurrencyController,
            debounceThrottleManager: this.debounceThrottleManager,
            instanceOptions: {
                ...this.options,
                // 绑定 this 以确保在拦截器回调中能访问类实例属性
                requestWithRefreshToken: this.requestWithRefreshToken.bind(this),
                retryRequest: this.retryRequest.bind(this),
            },
        });
    }

    /**
     * **双 Token 刷新核心逻辑**
     *
     * 当响应拦截器捕获到 Token 过期错误时调用此方法。
     * 使用 Promise 单例模式处理并发请求：
     * 当多个请求几乎同时发现 Token 过期时，只有一个请求会去执行刷新逻辑，
     * 其他请求会等待刷新完成后，使用新 Token 重试。
     *
     * @param res - 包含错误码的响应对象
     * @returns Promise<AxiosResponse> - 重试后的响应或拒绝的 Promise
     */
    private async requestWithRefreshToken(res: AxiosResponse<any>) {
        const { code } = res.data || {};
        const {
            accessTokenExpiredCodes = [],
            refreshTokenExpiredCodes = [],
            refreshAccessToken,
            onRefreshTokenExpired,
        } = this.options;

        // 如果状态码不在过期列表中，直接返回原响应（交给后续业务处理）
        if (!accessTokenExpiredCodes.includes(code) && !refreshTokenExpiredCodes.includes(code)) {
            return res;
        }

        // 1. Refresh Token 也过期了：强制登出
        if (refreshTokenExpiredCodes.includes(code)) {
            try {
                onRefreshTokenExpired?.();
            } finally {
                // eslint-disable-next-line no-unsafe-finally
                return Promise.reject(new Error('Refresh token expired'));
            }
        }

        // 2. Access Token 过期：尝试刷新
        if (accessTokenExpiredCodes.includes(code)) {
            const originalConfig = res.config as InternalAxiosRequestConfig & {
                __gotAccessToken?: boolean;
            };

            // 防止死循环：如果已经重试过一次但依然报错，不再重试
            if (originalConfig.__gotAccessToken) {
                return Promise.reject(new Error('Request already retried after refresh'));
            }
            // 标记该配置已进行过 Token 获取
            originalConfig.__gotAccessToken = true;

            if (typeof refreshAccessToken !== 'function') {
                return Promise.reject(new Error('No refreshAccessToken provided'));
            }

            // 如果当前没有正在进行的刷新任务，则创建一个
            if (!this.refreshTokenPromise) {
                const p = (async () => {
                    const token = await refreshAccessToken();
                    if (!token || typeof token !== 'string') {
                        throw new Error('refreshAccessToken did not return a valid token');
                    }
                    return token;
                })();

                // 将 promise 保存，无论成功失败最终都要清理
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

            // 等待刷新结果（所有并发请求在此处 await）
            let newToken: string;
            try {
                newToken = await this.refreshTokenPromise!;
            } catch (e) {
                // 刷新失败，通常意味着需要重新登录
                onRefreshTokenExpired?.();
                return Promise.reject(e);
            }

            // 更新 Header (兼容新旧版本 Axios 写法)
            const authValue = `Bearer ${newToken}`;
            if (originalConfig.headers && typeof (originalConfig.headers as any).set === 'function') {
                (originalConfig.headers as any).set('Authorization', authValue);
            } else {
                originalConfig.headers = {
                    ...originalConfig.headers,
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
     *
     * 在请求失败时触发，根据配置的 `retryTimes` 和 `retryDelay` 进行指数退避或固定延迟重试。
     *
     * @param err - Axios 错误对象
     * @returns Promise - 重试的请求结果
     */
    private async retryRequest(err: any) {
        const config = err.config;
        // 初始化重试计数
        config.__retryCount = config.__retryCount || 0;

        if (config.__retryCount < (this.options.retryTimes || DEFAULT_MAX_RETRIES)) {
            config.__retryCount++;
            // 延迟等待
            await new Promise((r) => setTimeout(r, this.options.retryDelay || DEFAULT_RETRY_DELAY));
            
            // 重新将请求放入并发控制器运行
            return this.concurrencyController.run(() => this.instance(config));
        }
        // 超过重试次数，抛出原错误
        throw err;
    }

    /**
     * 通用请求包装器
     * 统一处理：CancelToken 注入、并发控制队列
     */
    private async requestWrapper<T>(
        method: 'get' | 'post' | 'put' | 'delete',
        url: string,
        data?: any,
        config?: AxiosWrapperMethodConfig,
    ) {
        // 1. 处理取消令牌
        const cancelTokenSource = axios.CancelToken.source();
        if (config?.cancelTokenId) {
            config.cancelToken = cancelTokenSource.token;
            this.cancelTokenManager.set(config.cancelTokenId, cancelTokenSource);
        }

        // 2. 放入并发控制器执行
        const req = this.concurrencyController
            .run(() => {
                // 严格区分 GET/DELETE 和 POST/PUT 的参数签名
                if (method === 'get' || method === 'delete') {
                    return this.instance[method]<T>(url, config);
                } else {
                    return this.instance[method]<T>(url, data, config);
                }
            })
            .finally(() => {
                // 3. 请求完成后清理取消令牌
                if (config?.cancelTokenId) this.cancelTokenManager.delete(config.cancelTokenId);
            });

        return req;
    }

    /**
     * 发起 GET 请求
     * @template T - 响应数据类型
     * @param url - 请求路径
     * @param config - Axios 配置
     */
    public get<T>(url: string, config?: AxiosRequestConfig) {
        return this.requestWrapper<T>('get', url, undefined, config);
    }

    /**
     * 发起 POST 请求
     * @template T - 响应数据类型
     * @param url - 请求路径
     * @param data - 请求体数据 (Payload)
     * @param config - Axios 配置
     */
    public post<T>(url: string, data?: any, config?: AxiosRequestConfig) {
        return this.requestWrapper<T>('post', url, data, config);
    }

    /**
     * 发起 PUT 请求
     * @template T - 响应数据类型
     * @param url - 请求路径
     * @param data - 请求体数据
     * @param config - Axios 配置
     */
    public put<T>(url: string, data?: any, config?: AxiosRequestConfig) {
        return this.requestWrapper<T>('put', url, data, config);
    }

    /**
     * 发起 DELETE 请求
     * @template T - 响应数据类型
     * @param url - 请求路径
     * @param config - Axios 配置
     */
    public delete<T>(url: string, config?: AxiosRequestConfig) {
        return this.requestWrapper<T>('delete', url, undefined, config);
    }

    /**
     * 上传文件
     * 自动处理 FormData 封装
     * @param url - 上传地址
     * @param file - File 对象
     * @param options - 上传配置 (如进度回调)
     */
    public uploadFile(url: string, file: File, options?: UploadFileOptions) {
        return this.uploadManager.uploadFile(url, file, options);
    }

    /**
     * 开启轮询请求
     * @template T - 响应类型
     * @param config - 轮询配置 (ID, url, interval, callback 等)
     */
    public startPolling<T>(config: PollingConfig<T>) {
        this.pollingManager.poll(config);
    }

    /**
     * 停止指定的轮询
     * @param key - 轮询任务的唯一标识 Key
     */
    public stopPolling(key: string) {
        this.pollingManager.stopPolling(key);
    }

    /**
     * 取消指定的请求
     * @param tokenId - 在请求配置中传入的 `cancelTokenId`
     */
    public cancelRequest(tokenId: string) {
        this.cancelTokenManager.cancelById(tokenId);
    }

    /**
     * 取消所有正在进行的请求
     * 常用于页面切换时清理未完成的请求
     */
    public cancelAllRequests() {
        this.cancelTokenManager.cancelAll();
    }

    /**
     * 强制清除所有缓存
     */
    public clearCache() {
        this.cacheManager.clear();
    }

    /**
     * 下载文件
     * 自动处理 Blob 流，并尝试触发浏览器下载行为。
     *
     * @param url - 下载地址
     * @param method - 请求方法 (默认为 GET)
     * @param filename - 强制指定文件名 (如果不传，尝试从 Content-Disposition 或 URL 解析)
     * @param config - 额外配置
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
                    // 尝试解析 filename= 或 filename*=UTF-8''
                    const match = disposition.match(/filename\*?=['"]?(?:UTF-\d['"]*)?([^;\r\n"']*)['"]?;?/i);
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
 *
 * 使用单例模式管理多个 AxiosWrapper 实例。
 * 适用于需要连接多个不同后端服务（如：业务API、埋点API、第三方API）的场景。
 */
export class AxiosWrapperFactory {
    private static instances: Map<string, AxiosWrapper> = new Map();

    /**
     * 创建或获取已存在的 AxiosWrapper 实例
     *
     * @param name - 实例名称 (例如 'api', 'analytics')
     * @param config - 实例配置
     * @returns {AxiosWrapper} 对应的实例
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
