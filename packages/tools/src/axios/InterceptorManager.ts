import type { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { GlobalConcurrencyController } from './GlobalConcurrencyController';
import { CacheManager } from './CacheManager';
import { DebounceThrottleManager } from './DebounceThrottleManager';
import type { WrapperOptions } from '..';

interface InterceptorManagerOptions {
    instanceOptions: WrapperOptions & {
        requestWithRefreshToken?: (
            res: AxiosResponse<any, any>,
        ) => Promise<AxiosResponse<any, any>>;
        retryRequest?: (err: any) => Promise<AxiosResponse<any, any>>;
    };
    instance: AxiosInstance;
    concurrencyController: GlobalConcurrencyController;
    cacheManager: CacheManager;
    debounceThrottleManager: DebounceThrottleManager;
}

export class InterceptorManager {
    private instanceOptions: any;
    private instance: AxiosInstance;
    private concurrencyController: GlobalConcurrencyController;
    private cacheManager: CacheManager;
    private debounceThrottleManager: DebounceThrottleManager;
    private errorLocks: Set<string | number> = new Set();

    constructor(opts: InterceptorManagerOptions) {
        this.instanceOptions = opts.instanceOptions;
        this.instance = opts.instance;
        this.concurrencyController = opts.concurrencyController;
        this.cacheManager = opts.cacheManager;
        this.debounceThrottleManager = opts.debounceThrottleManager;
    }

    public attachInterceptors() {
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
