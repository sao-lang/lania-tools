import axios, { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { GlobalConcurrencyController } from './GlobalConcurrencyController';
import { CacheManager } from './CacheManager';
// 假设 DebounceThrottleManager 导出了自定义的 CancelError 
import { DebounceThrottleManager, CancelError } from './DebounceThrottleManager'; 
import type { WrapperOptions } from '..';

interface InterceptorManagerOptions {
    instanceOptions: WrapperOptions & {
        // 核心业务逻辑（Token刷新和重试）由父级 AxiosWrapper 提供，以保证职责分离
        requestWithRefreshToken: (
            res: AxiosResponse<any, any>,
        ) => Promise<AxiosResponse<any, any>>;
        retryRequest: (err: any) => Promise<AxiosResponse<any, any>>;
    };
    instance: AxiosInstance;
    concurrencyController: GlobalConcurrencyController;
    cacheManager: CacheManager;
    debounceThrottleManager: DebounceThrottleManager;
}

// 缓存命中时，返回的假响应错误对象必须包含这个标志
// 确保它不会被 ResponseError 拦截器捕获
interface CacheHitError extends AxiosResponse {
    __fromCache: true;
}

export class InterceptorManager {
    private instanceOptions: InterceptorManagerOptions['instanceOptions'];
    private instance: AxiosInstance;
    private concurrencyController: GlobalConcurrencyController;
    private cacheManager: CacheManager;
    private debounceThrottleManager: DebounceThrottleManager;
    private errorLocks: Set<string> = new Set(); // 锁键统一使用 string 类型

    constructor(opts: InterceptorManagerOptions) {
        this.instanceOptions = opts.instanceOptions;
        this.instance = opts.instance;
        this.concurrencyController = opts.concurrencyController;
        this.cacheManager = opts.cacheManager;
        this.debounceThrottleManager = opts.debounceThrottleManager;
    }
    
    /**
     * 判断是否为主动取消、防抖/节流取消或缓存命中的错误
     */
    private isCancelError(err: any): boolean {
        // 兼容 Axios 原生 CancelToken (axios.isCancel) 和 我们自定义的防抖错误 (err.isCancel)
        return (err && err.isCancel === true) || axios.isCancel(err);
    }
    
    /**
     * 检查是否为缓存命中产生的假错误对象
     */
    private isCacheHitError(err: any): err is CacheHitError {
        return err && err.__fromCache === true;
    }


    public attachInterceptors() {
        // --- Request Interceptor ---
        this.instance.interceptors.request.use(
            async (config) => {
                const ctx = { config };
                await this.runRequestMiddlewares(ctx);
                return ctx.config;
            },
            async (err) => {
                const ctx = { err };
                
                // 1. 致命修复：如果错误是缓存命中，将其转为成功Promise，转发到 Response.onFulfilled 路径
                if (this.isCacheHitError(ctx.err)) {
                    // Promise.resolve(AxiosResponse) 才能进入 Response.onFulfilled
                    return Promise.resolve(ctx.err); 
                }
                
                // 2. 健壮性修复：如果是取消错误（防抖/节流/手动），直接返回，不触发后续错误中间件
                if (this.isCancelError(ctx.err)) {
                    return Promise.reject(ctx.err);
                }
                
                // 3. 运行自定义请求错误中间件
                await this.runRequestErrorMiddlewares(ctx);
                return Promise.reject(ctx.err);
            },
        );

        // --- Response Interceptor ---
        this.instance.interceptors.response.use(
            async (response) => {
                const ctx = { response };
                await this.runResponseMiddlewares(ctx);
                return ctx.response;
            },
            async (err) => {
                const ctx = { err };
                
                // 1. 健壮性修复：如果是取消错误，直接返回，不触发全局错误和重试
                if (this.isCancelError(ctx.err)) {
                    return Promise.reject(ctx.err);
                }

                await this.runResponseErrorMiddlewares(ctx);
                
                // 触发全局 onError 回调
                this.instanceOptions.onError?.(ctx.err);
                
                return Promise.reject(ctx.err);
            },
        );
    }

    // ===================== 请求中间件 =====================
    private async runRequestMiddlewares(ctx: { config: InternalAxiosRequestConfig }) {
        const middlewares = [
            this.tokenMiddleware,
            this.cacheRequestMiddleware,
            this.debounceMiddleware,
            this.throttleMiddleware,
            this.customRequestMiddleware,
        ];
        for (const m of middlewares) await m.call(this, ctx);
    }

    private async runRequestErrorMiddlewares(ctx: { err: any }) {
        const middlewares = [this.customRequestErrorMiddleware];
        for (const m of middlewares) await m.call(this, ctx);
    }

    private tokenMiddleware = async (ctx: { config: InternalAxiosRequestConfig }) => {
        const { tokenProvider } = this.instanceOptions;
        if (tokenProvider) {
            const token = await tokenProvider();
            ctx.config.headers = ctx.config.headers || {};
            
            // 兼容 Axios 新旧版本 headers 结构
            const headers = ctx.config.headers as any; 
            if (typeof headers.set === 'function') {
                 // Axios 1.x+ Headers 对象
                 headers.set('Authorization', `Bearer ${token}`);
            } else {
                 // 兼容 Axios 0.x 或普通对象
                 headers['Authorization'] = `Bearer ${token}`;
            }
        }
    };

    private cacheRequestMiddleware = async (ctx: { config: InternalAxiosRequestConfig }) => {
        if (!this.instanceOptions.enableCache) return;
        
        const cached = this.cacheManager.get(ctx.config);
        
        if (cached !== null) {
            // 致命修复：返回一个 Promise.reject，但包含 __fromCache 标志。
            // 这会导致它进入 Request.onError，然后被转发到 Response.onFulfilled。
            // 这样才能触发 cacheResponseMiddleware 之后的响应中间件。
            const fakeResponse: CacheHitError = {
                __fromCache: true,
                data: cached,
                status: 200,
                statusText: 'Cache Hit',
                headers: {},
                config: ctx.config,
                request: {},
            } as any;
            return Promise.reject(fakeResponse);
        }
    };

    private debounceMiddleware = async (ctx: { config: InternalAxiosRequestConfig }) => {
        if (this.instanceOptions.enableDebounce) {
            // 注意：debounceRequest/throttleRequest 内部可能通过 Promise.reject(CancelError) 拒绝，
            // 该错误会在 Request Interceptor 中被 isCancelError 捕获并处理。
            ctx.config = (await this.debounceThrottleManager.debounceRequest(
                ctx.config,
                this.instanceOptions.debounceInterval,
            )) as InternalAxiosRequestConfig;
        }
    };

    private throttleMiddleware = async (ctx: { config: InternalAxiosRequestConfig }) => {
        if (this.instanceOptions.enableThrottle) {
            ctx.config = (await this.debounceThrottleManager.throttleRequest(
                ctx.config,
                this.instanceOptions.throttleInterval,
            )) as InternalAxiosRequestConfig;
        }
    };

    private customRequestMiddleware = async (ctx: { config: InternalAxiosRequestConfig }) => {
        const interceptor = this.instanceOptions.interceptors?.request;
        if (interceptor?.onFulfilled) {
            ctx.config = await interceptor.onFulfilled(ctx.config);
        }
    };

    private customRequestErrorMiddleware = async (ctx: { err: any }) => {
        const interceptor = this.instanceOptions.interceptors?.request;
        if (interceptor?.onRejected) {
            await interceptor.onRejected(ctx.err);
        }
    };

    // ===================== 响应中间件 =====================
    private async runResponseMiddlewares(ctx: { response: AxiosResponse }) {
        const middlewares = [
            this.flagMiddleware,
            this.doubleTokenMiddleware,
            this.customResponseMiddleware,
            this.cacheResponseMiddleware,
        ];
        for (const m of middlewares) await m.call(this, ctx);
    }

    private async runResponseErrorMiddlewares(ctx: { err: any }) {
        // 注意：isCancelError 已经在 Response Interceptor 外部处理，这里无需再次检查。
        
        const middlewares = [this.customResponseErrorMiddleware, this.retryMiddleware];
        for (const m of middlewares) await m.call(this, ctx);
    }

    private flagMiddleware = (ctx: { response: AxiosResponse }) => {
        const { responseHandler, codeHandlers } = this.instanceOptions;
        const code = ctx.response.data?.code;
        let handled = false;

        // 1. 全局响应处理器 (responseHandler)
        if (responseHandler) {
            ctx.response = responseHandler(ctx.response);
            handled = true;
        }
        
        // 2. 业务状态码处理器 (codeHandlers)
        if (!handled && codeHandlers && code !== undefined && code !== null) {
            const codeStr = String(code); // 统一将 key 转换为 string
            
            // 检查 codeHandlers 中是否存在对应的处理器
            if (codeStr in codeHandlers) {
                // 检查锁：防止短时间内对同一种错误码触发多次处理逻辑（如弹窗/跳转）
                if (this.errorLocks.has(codeStr)) return;
                
                this.errorLocks.add(codeStr);

                try {
                    // 执行业务处理器
                    ctx.response = codeHandlers[codeStr]?.(ctx.response);
                } finally {
                    // 延迟清理锁
                    setTimeout(() => this.errorLocks.delete(codeStr), 1000); 
                }
                handled = true;
            }
        }
    };

    private doubleTokenMiddleware = async (ctx: { response: AxiosResponse }) => {
        const opt = this.instanceOptions;
        const code = ctx.response.data?.code;
        
        // 只有在启用双 Token 且捕获到 Access/Refresh Token 过期码时才触发
        if (
            opt.enableDoubleToken &&
            (opt.accessTokenExpiredCodes?.includes(code) ||
                opt.refreshTokenExpiredCodes?.includes(code))
        ) {
            // 调用父级提供的核心刷新逻辑，等待其重试请求返回
            ctx.response = await opt.requestWithRefreshToken(ctx.response);
        }
    };

    private cacheResponseMiddleware = (ctx: { response: AxiosResponse }) => {
        if (this.instanceOptions.enableCache) {
            // 只有非缓存命中的请求才需要写入新缓存
            if (!(ctx.response as any).__fromCache) {
                this.cacheManager.set(ctx.response.config, ctx.response.data, this.instanceOptions.cacheTTL);
            }
        }
    };

    private customResponseMiddleware = async (ctx: { response: AxiosResponse }) => {
        const interceptor = this.instanceOptions.interceptors?.response;
        if (interceptor?.onFulfilled) {
            ctx.response = await interceptor.onFulfilled(ctx.response);
        }
    };

    private customResponseErrorMiddleware = async (ctx: { err: any }) => {
        const interceptor = this.instanceOptions.interceptors?.response;
        if (interceptor?.onRejected) {
            await interceptor.onRejected(ctx.err);
        }
    };

    private retryMiddleware = async (ctx: { err: any }) => {
        if (this.instanceOptions.enableRetry) {
            // 调用父级提供的重试核心逻辑。
            // retryRequest 内部会处理重试计数、延迟和重新进入 GlobalConcurrencyController
            return this.instanceOptions.retryRequest(ctx.err);
        }
    };
}
