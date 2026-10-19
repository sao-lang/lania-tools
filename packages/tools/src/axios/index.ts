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
 * **AxiosWrapper 核心类**
 */
export class AxiosWrapper {
    /** 内部 Axios 实例 */
    private instance: AxiosInstance;
    /**
     * 专用于重试的 Axios 实例（不挂载拦截器）。
     * 若重试仍走 this.instance，会再次进入 retryMiddleware 形成递归重试，
     * 并让 onError / 响应中间件被重复执行。
     */
    private retryInstance: AxiosInstance;
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
        this.retryInstance = axios.create(config);
        this.options = options || {};
        this.initManager();
        // 挂载拦截器，确保在构造函数结束前完成
        this.interceptorManager.attachInterceptors();
    }

    /**
     * 初始化内部各个 Manager 模块
     */
    private initManager() {
        this.concurrencyController = new GlobalConcurrencyController(this.options.maxConcurrent);
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
            // onRefreshTokenExpired 放在单例内部，保证一次刷新失败只通知一次，
            // 而不是每个等待中的并发请求各通知一次（避免重复弹窗 / 重复跳转）。
            if (!this.refreshTokenPromise) {
                this.refreshTokenPromise = (async () => {
                    const refreshToken = await getRefreshToken?.();
                    if (!refreshToken) throw new Error('Missing refresh token.');

                    const token = await refreshAccessToken(refreshToken);
                    if (!token || typeof token !== 'string')
                        throw new Error('Invalid new access token.');

                    return token;
                })()
                    .catch((error) => {
                        onRefreshTokenExpired?.();
                        throw error;
                    })
                    .finally(() => {
                        this.refreshTokenPromise = null; // 无论成功失败都清除单例
                    });
            }

            // 等待刷新完成
            let newToken: string;
            try {
                newToken = await this.refreshTokenPromise;
            } catch (e) {
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
        const config = err?.config as
            | (InternalAxiosRequestConfig & { __retryCount?: number })
            | undefined;

        // 没有 config 的错误（例如配置阶段抛错）无法重放，直接抛出。
        if (!config) throw err;

        const maxRetries = this.options.retryTimes ?? DEFAULT_MAX_RETRIES;
        const retryDelay = this.options.retryDelay ?? DEFAULT_RETRY_DELAY;
        config.__retryCount = config.__retryCount || 0;

        let lastError = err;
        while (config.__retryCount < maxRetries) {
            config.__retryCount += 1;

            // 延迟等待
            await new Promise((r) => setTimeout(r, retryDelay));

            try {
                // 核心：重新将请求放入 GlobalConcurrencyController 队列。
                // 使用无拦截器的 retryInstance，避免递归进入 retryMiddleware。
                return await this.concurrencyController.run(() => this.retryInstance(config));
            } catch (retryError) {
                lastError = retryError;
                // 用户主动取消时立即停止重试。
                if ((retryError as any)?.isCancel || (retryError as any)?.__CANCEL__) {
                    throw retryError;
                }
            }
        }

        // 超过重试次数，抛出最后一次错误
        throw lastError;
    }

    /**
     * 通用请求包装器
     * 统一处理：CancelToken 注入、并发控制队列
     */
    public async request<T = any>(config: AxiosWrapperMethodConfig) {
        const { cancelTokenId } = config;

        // 1. 处理取消令牌
        if (config?.cancelTokenId) {
            const cancelTokenSource = axios.CancelToken.source();
            config.cancelToken = cancelTokenSource.token;
            this.cancelTokenManager.set(config.cancelTokenId, cancelTokenSource);
        }

        // 2. 放入并发控制器执行
        const req = await this.concurrencyController
            .run(() => {
                return this.instance(config);
            })
            .finally(() => {
                // 3. 请求完成后清理取消令牌
                if (cancelTokenId) this.cancelTokenManager.delete(cancelTokenId);
            });

        return req as AxiosResponse<T>;
    }

    // --- 快捷方法 API ---

    public get<T = any>(url: string, data?: any, config: AxiosWrapperMethodConfig = {}) {
        return this.request<T>({
            ...config,
            method: 'get',
            url: url ?? config.url,
            // GET 的第二个参数是 query params，回退目标也必须是 config.params，
            // 而不是 config.data（后者是请求体）。
            params: data ?? config.params,
        });
    }

    public post<T = any>(url: string, data?: any, config: AxiosWrapperMethodConfig = {}) {
        return this.request<T>({
            ...config,
            method: 'post',
            url: url ?? config.url,
            data: data ?? config.data,
        });
    }

    public put<T = any>(url: string, data?: any, config: AxiosWrapperMethodConfig = {}) {
        config.url = url ?? config.url;
        config.data = data ?? config.data;
        return this.request<T>({
            ...config,
            method: 'put',
            url: url ?? config.url,
            data: data ?? config.data,
        });
    }

    public delete<T = any>(url: string, data?: any, config: AxiosWrapperMethodConfig = {}) {
        return this.request<T>({
            ...config,
            method: 'delete',
            url: url ?? config.url,
            data: data ?? config.data,
        });
    }

    // --- Manager API ---

    public uploadFile(url: string, file: File, options: UploadFileOptions = {}) {
        const { cancelTokenId } = options;
        if (!cancelTokenId) {
            return this.uploadManager.uploadFile(url, file, options);
        }

        // 通过 cancelTokenId 复用统一的取消令牌管理，支持 cancelRequest(id)。
        const cancelTokenSource = axios.CancelToken.source();
        this.cancelTokenManager.set(cancelTokenId, cancelTokenSource);

        return this.uploadManager
            .uploadFile(url, file, { ...options, cancelToken: cancelTokenSource })
            .finally(() => this.cancelTokenManager.delete(cancelTokenId));
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
                    finalFilename = parseContentDispositionFilename(disposition) || undefined;
                }
            }
            // URL 回退时先去掉 query / hash，否则文件名会带上 ?a=1
            finalFilename =
                finalFilename ||
                url.split('#')[0].split('?')[0].split('/').pop() ||
                'download_file';

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
                // 组件/页面可能在此期间被卸载，先确认节点仍在文档中
                a.parentNode?.removeChild(a);
                URL.revokeObjectURL(blobUrl);
            }, 100);

            return response;
        } finally {
            if (config?.cancelTokenId) this.cancelTokenManager.delete(config.cancelTokenId);
        }
    }
}

/**
 * 从 Content-Disposition 头中解析文件名。
 *
 * 按 RFC 6266 优先使用 `filename*=UTF-8''...`（可携带非 ASCII 字符），
 * 再回退到普通 `filename="..."`。
 */
function parseContentDispositionFilename(disposition: string): string | null {
    const utf8Match = /filename\*\s*=\s*(?:UTF-\d['"]*)?([^;\r\n]+)/i.exec(disposition);
    if (utf8Match) {
        const raw = utf8Match[1].trim().replace(/^['"]|['"]$/g, '');
        try {
            return decodeURIComponent(raw);
        } catch {
            return raw;
        }
    }

    const asciiMatch = /filename\s*=\s*"?([^";\r\n]*)"?/i.exec(disposition);
    if (asciiMatch && asciiMatch[1]) {
        return asciiMatch[1].trim();
    }

    return null;
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
        config?: CreateAxiosDefaults,
        options?: WrapperOptions & { maxConcurrent?: number },
    ) {
        if (!this.instances.has(name)) {
            // 注意：将 config 传递两次，第一次是 AxiosDefaults，第二次是 WrapperOptions
            const instance = new AxiosWrapper(config, options);
            this.instances.set(name, instance);
        }
        return this.instances.get(name)!;
    }
}

export { DebounceThrottleCancelError } from './DebounceThrottleManager';
export type { UploadFileOptions } from './UploadManager';
export type { PollingConfig } from './PollingManager';
