import axios, { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { GlobalConcurrencyController } from './GlobalConcurrencyController';
import { CacheManager } from './CacheManager';
import { DebounceThrottleManager, CancelError } from './DebounceThrottleManager'; // 导入新的 Manager 和 CancelError
import type { WrapperOptions } from '..';

interface InterceptorManagerOptions {
    instanceOptions: WrapperOptions & {
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

export class InterceptorManager {
    private instanceOptions: InterceptorManagerOptions['instanceOptions'];
    private instance: AxiosInstance;
    private concurrencyController: GlobalConcurrencyController;
    private cacheManager: CacheManager;
    private debounceThrottleManager: DebounceThrottleManager;
    private errorLocks: Set<string | number> = new Set(); // 保留原有逻辑

    constructor(opts: InterceptorManagerOptions) {
        this.instanceOptions = opts.instanceOptions;
        this.instance = opts.instance;
        this.concurrencyController = opts.concurrencyController;
        this.cacheManager = opts.cacheManager;
        this.debounceThrottleManager = opts.debounceThrottleManager;
    }
    
    /**
     * 判断是否为主动取消或防抖/节流取消的错误
     */
    private isCancelError(err: any): boolean {
        // 兼容 Axios 原生 CancelToken 的错误 (axios.isCancel) 和 我们自定义的防抖错误
        return (err && err.isCancel === true) || axios.isCancel(err);
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
                
                // 修复：如果是在前置中间件（如防抖）中被拒绝，直接返回，不触发后续请求错误逻辑
                if (this.isCancelError(ctx.err)) {
                    return Promise.reject(ctx.err);
                }
                
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
                
                // 修复：如果是防抖/节流取消，直接返回，不触发全局错误和重试
                if (this.isCancelError(ctx.err)) {
                    return Promise.reject(ctx.err);
                }

                await this.runResponseErrorMiddlewares(ctx);
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
            // 兼容 Axios 0.x/1.x headers 写法
            const headers = ctx.config.headers as any; 
            if (typeof headers.set === 'function') {
                 headers.set('Authorization', `Bearer ${token}`);
            } else {
                 headers['Authorization'] = `Bearer ${token}`;
            }
        }
    };

    private cacheRequestMiddleware = async (ctx: { config: InternalAxiosRequestConfig }) => {
        if (!this.instanceOptions.enableCache) return;
        const cached = this.cacheManager.get(ctx.config);
        if (cached !== null) {
            // 返回一个假响应，模拟缓存命中
            return Promise.reject({
                __fromCache: true,
                data: cached,
                status: 200,
                statusText: 'OK',
                headers: {},
                config: ctx.config,
                request: {},
            });
        }
    };

    private debounceMiddleware = async (ctx: { config: InternalAxiosRequestConfig }) => {
        if (this.instanceOptions.enableDebounce) {
            // 此处 await 可能会因为 Manager 内部 reject 而抛出异常
            ctx.config = (await this.debounceThrottleManager.debounceRequest(
                ctx.config,
                this.instanceOptions.debounceInterval,
            )) as InternalAxiosRequestConfig;
        }
    };

    private throttleMiddleware = async (ctx: { config: InternalAxiosRequestConfig }) => {
        if (this.instanceOptions.enableThrottle) {
            // 此处 await 可能会因为 Manager 内部 reject 而抛出异常
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
        // 修复：如果是 Cancel 错误，避免触发其他错误中间件（如重试）
        if (this.isCancelError(ctx.err)) {
            return;
        }
        
        const middlewares = [this.customResponseErrorMiddleware, this.retryMiddleware];
        for (const m of middlewares) await m.call(this, ctx);
    }

    private flagMiddleware = (ctx: { response: AxiosResponse }) => {
        const { responseHandler, codeHandlers } = this.instanceOptions;
        const code = ctx.response.data?.code;
        let handled = false;

        if (responseHandler) {
            ctx.response = responseHandler(ctx.response);
            handled = true;
        }

        if (!handled && codeHandlers && (code in codeHandlers || code?.toString() in codeHandlers)) {
            const key = code?.toString() in codeHandlers ? code.toString() : code; // 兼容数字和字符串key
            if (this.errorLocks?.has(key)) return;
            this.errorLocks?.add(key);
            try {
                ctx.response = codeHandlers[key]?.(ctx.response);
            } finally {
                // 延迟清理锁，防止短时间内收到大量相同状态码响应
                setTimeout(() => this.errorLocks?.delete(key), 1000); 
            }
            handled = true;
        }
    };

    private doubleTokenMiddleware = async (ctx: { response: AxiosResponse }) => {
        const opt = this.instanceOptions;
        const code = ctx.response.data?.code;
        if (
            opt.enableDoubleToken &&
            (opt.accessTokenExpiredCodes?.includes(code) ||
                opt.refreshTokenExpiredCodes?.includes(code))
        ) {
            ctx.response = await opt.requestWithRefreshToken(ctx.response);
        }
    };

    private cacheResponseMiddleware = (ctx: { response: AxiosResponse }) => {
        if (this.instanceOptions.enableCache) {
            this.cacheManager.set(ctx.response.config, ctx.response, this.instanceOptions.cacheTTL);
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
            // 直接调用 retryRequest，因为 InterceptorManager 构造时已绑定了 this
            return this.instanceOptions.retryRequest(ctx.err);
        }
    };
}
        this.instance.interceptors.request.use(
            async (config) => {
                const ctx = { config };
                await this.runRequestMiddlewares(ctx);
                return ctx.config;
            },
            async (err) => {
                const ctx = { err };
                await this.runRequestErrorMiddlewares(ctx);
                return Promise.reject(ctx.err);
            },
        );

        this.instance.interceptors.response.use(
            async (response) => {
                const ctx = { response };
                await this.runResponseMiddlewares(ctx);
                return ctx.response;
            },
            async (err) => {
                const ctx = { err };
                await this.runResponseErrorMiddlewares(ctx);
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
            ctx.config.headers['Authorization'] = `Bearer ${token}`;
        }
    };

    private cacheRequestMiddleware = async (ctx: { config: InternalAxiosRequestConfig }) => {
        if (!this.instanceOptions.enableCache) return;
        const cached = this.cacheManager.get(ctx.config);
        if (cached !== null) {
            return Promise.reject({
                __fromCache: true,
                data: cached,
                status: 200,
                statusText: 'OK',
                headers: {},
                config: ctx.config,
                request: {},
            });
        }
    };

    private debounceMiddleware = async (ctx: { config: InternalAxiosRequestConfig }) => {
        if (this.instanceOptions.enableDebounce) {
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
        const middlewares = [this.customResponseErrorMiddleware, this.retryMiddleware];
        for (const m of middlewares) await m.call(this, ctx);
    }

    private flagMiddleware = (ctx: { response: AxiosResponse }) => {
        const { responseHandler, codeHandlers } = this.instanceOptions;
        const code = ctx.response.data?.code;
        let handled = false;

        if (responseHandler) {
            ctx.response = responseHandler(ctx.response);
            handled = true;
        }

        if (!handled && codeHandlers && code in codeHandlers) {
            if (this.errorLocks?.has(code)) return;
            this.errorLocks?.add(code);
            try {
                ctx.response = codeHandlers[code]?.(ctx.response);
            } finally {
                setTimeout(() => this.errorLocks?.delete(code), 1000);
            }
            handled = true;
        }
    };

    private doubleTokenMiddleware = async (ctx: { response: AxiosResponse }) => {
        const opt = this.instanceOptions;
        const code = ctx.response.data?.code;
        if (
            opt.enableDoubleToken &&
            (opt.accessTokenExpiredCodes?.includes(code) ||
                opt.refreshTokenExpiredCodes?.includes(code))
        ) {
            ctx.response = await opt.requestWithRefreshToken(ctx.response);
        }
    };

    private cacheResponseMiddleware = (ctx: { response: AxiosResponse }) => {
        if (this.instanceOptions.enableCache) {
            this.cacheManager.set(ctx.response.config, ctx.response, this.instanceOptions.cacheTTL);
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
            return this.concurrencyController.run(() => this.instanceOptions.retryRequest(ctx.err));
        }
    };
}

