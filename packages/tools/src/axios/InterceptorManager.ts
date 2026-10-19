import axios, { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { CacheManager } from './CacheManager';
// 假设 DebounceThrottleManager 导出了自定义的 CancelError
import { DebounceThrottleCancelError, DebounceThrottleManager } from './DebounceThrottleManager';
import type { WrapperOptions } from '..';

interface InterceptorManagerOptions {
    instanceOptions: WrapperOptions & {
        // 核心业务逻辑（Token刷新和重试）由父级 AxiosWrapper 提供，以保证职责分离
        requestWithRefreshToken: (res: AxiosResponse<any, any>) => Promise<AxiosResponse<any, any>>;
        retryRequest: (err: any) => Promise<AxiosResponse<any, any>>;
    };
    instance: AxiosInstance;
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
    private cacheManager: CacheManager;
    private debounceThrottleManager: DebounceThrottleManager;
    private errorLocks: Set<string> = new Set(); // 锁键统一使用 string 类型

    constructor(opts: InterceptorManagerOptions) {
        this.instanceOptions = opts.instanceOptions;
        this.instance = opts.instance;
        this.cacheManager = opts.cacheManager;
        this.debounceThrottleManager = opts.debounceThrottleManager;
    }

    /**
     * 判断是否为主动取消、防抖/节流取消或缓存命中的错误
     */
    private isCancelError(err: any): boolean {
        // 兼容三种取消来源：
        // 1. Axios 原生 CancelToken（axios.isCancel）
        // 2. DebounceThrottleCancelError 实例
        // 3. clear()/cancelDebounce() 抛出的普通对象（带 isCancel 标记）
        return (
            err instanceof DebounceThrottleCancelError ||
            err?.isCancel === true ||
            axios.isCancel(err)
        );
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
                try {
                    await this.runRequestMiddlewares(ctx);
                    return ctx.config;
                } catch (err) {
                    return this.handleRequestError(err, ctx.config);
                }
            },
            async (err) => {
                // Axios 会对“非本拦截器抛出且上游未处理”的错误走这里，
                // 也包括其他拦截器抛出的错误。统一交给同一套恢复逻辑。
                return this.handleRequestError(err);
            },
        );

        // --- Response Interceptor ---
        this.instance.interceptors.response.use(
            async (response) => {
                const ctx = { response };
                try {
                    await this.runResponseMiddlewares(ctx);
                    return ctx.response;
                } catch (err) {
                    // 响应中间件（双 Token 刷新、自定义响应拦截器）抛出的错误
                    // 不会回调本拦截器的 onRejected，必须在这里统一处理。
                    return this.handleResponseError(err);
                }
            },
            async (err) => {
                return this.handleResponseError(err);
            },
        );
    }

    /**
     * 统一的请求阶段错误处理。
     *
     * 说明：Axios 1.x 中，async 请求拦截器的 onFulfilled 抛错后不会回调同一个
     * 拦截器的 onRejected（与经典 Promise 语义不同）。因此错误恢复必须放在
     * onFulfilled 的 catch 里，onRejected 仅作为其他拦截器抛错的兜底入口。
     */
    private async handleRequestError(
        err: any,
        config?: InternalAxiosRequestConfig,
    ): Promise<InternalAxiosRequestConfig | never> {
        // 1. 缓存命中（历史路径兜底）：转为成功响应，转发到 Response.onFulfilled
        if (this.isCacheHitError(err)) {
            return Promise.resolve(err as any) as any;
        }
        // 2. 取消错误（防抖/节流/手动）直接返回，不触发后续错误中间件
        if (this.isCancelError(err)) {
            return Promise.reject(err);
        }
        // 3. 补齐 config，供自定义 onRejected 返回修复后的配置
        if (err && typeof err === 'object' && !err.config && config) {
            err.config = config;
        }
        const fixedConfig = await this.runRequestErrorMiddlewares({ err });
        if (fixedConfig) {
            // 返回 config 后 Axios 会用它继续 dispatch 请求
            return fixedConfig;
        }
        return Promise.reject(err);
    }

    /**
     * 统一的响应阶段错误处理：
     * 1. 取消错误直接抛出（不触发 onError / 重试）
     * 2. 尝试自定义响应错误拦截器与自动重试，成功则返回恢复后的响应
     * 3. 仍失败则调用全局 onError 并抛出最终错误
     */
    private async handleResponseError(err: any): Promise<AxiosResponse | never> {
        const ctx = { err };
        if (this.isCancelError(ctx.err)) {
            return Promise.reject(ctx.err);
        }
        try {
            // 重试或自定义错误拦截器可能成功恢复请求，此时必须把
            // 恢复后的响应返回给调用方，而不是继续抛出原错误。
            const recovered = await this.runResponseErrorMiddlewares(ctx);
            if (recovered) {
                return recovered;
            }
        } catch (finalError) {
            ctx.err = finalError;
        }
        // 触发全局 onError 回调
        this.instanceOptions.onError?.(ctx.err);
        return Promise.reject(ctx.err);
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

    private async runRequestErrorMiddlewares(ctx: {
        err: any;
    }): Promise<InternalAxiosRequestConfig | void> {
        const middlewares = [this.customRequestErrorMiddleware];
        for (const m of middlewares) {
            const result = await m.call(this, ctx);
            // 如果任何中间件返回了配置对象，说明错误被修复，立即返回该配置，检查result.url说明返回的是一个正常的config对象
            if (result && (result as InternalAxiosRequestConfig).url) {
                return result as InternalAxiosRequestConfig;
            }
        }
    }

    private tokenMiddleware = async (ctx: { config: InternalAxiosRequestConfig }) => {
        const { tokenProvider } = this.instanceOptions;
        // 双 Token 刷新后的重放请求已经带有新 Token。
        // 此时若再次调用 tokenProvider，很容易用闭包里的旧 Token 覆盖新 Token，
        // 导致重放必然失败，因此跳过注入。
        if ((ctx.config as any).__gotAccessToken) return;
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
            // 关键：Axios 的请求拦截器无法直接“返回响应”来短路请求，
            // 它返回的值会被当作新的 config 继续 dispatch。
            // 因此这里替换 adapter，让请求根本不离开进程，
            // 同时仍能完整地走一遍 Response 拦截器链。
            const fakeResponse: CacheHitError = {
                __fromCache: true,
                data: cached,
                status: 200,
                statusText: 'Cache Hit',
                headers: {},
                config: ctx.config,
                request: {},
            } as any;
            ctx.config.adapter = async () => fakeResponse;
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
            try {
                ctx.config = await interceptor.onFulfilled(ctx.config);
            } catch (error: any) {
                // Axios 的请求拦截器错误默认不携带 config，
                // 补上以后自定义 onRejected 才有机会返回修复后的 config 重试。
                if (error && typeof error === 'object' && !error.config) {
                    error.config = ctx.config;
                }
                throw error;
            }
        }
    };

    // 确保这个中间件的签名告诉 TypeScript 它可以返回 InternalAxiosRequestConfig
    private customRequestErrorMiddleware = async (ctx: {
        err: any;
    }): Promise<InternalAxiosRequestConfig | void> => {
        const interceptor = this.instanceOptions.interceptors?.request;
        if (interceptor?.onRejected) {
            // 捕获潜在的配置返回值
            const result = await interceptor.onRejected(ctx.err);
            // 返回它，让 runRequestErrorMiddlewares 捕获
            // 关键：如果 result 是一个配置对象，这里就返回它
            if (result && (result as InternalAxiosRequestConfig).url) {
                return result as InternalAxiosRequestConfig;
            }
        }
        // 如果没有返回配置，则函数隐式返回 Promise<void>
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

    private async runResponseErrorMiddlewares(ctx: { err: any }): Promise<AxiosResponse | void> {
        // 注意：isCancelError 已经在 Response Interceptor 外部处理，这里无需再次检查。
        const middlewares = [this.customResponseErrorMiddleware, this.retryMiddleware];
        for (const m of middlewares) {
            // 关键修改：检查中间件的返回值
            // 这里的 m.call(this, ctx) 需要接受 AxiosResponse 的返回类型
            const result = await m.call(this, ctx);
            // 如果 retryMiddleware 成功返回了一个响应 (AxiosResponse)，则立即返回该响应，
            // 从而退出 Response Interceptor 的 onRejected 链，并进入 onFulfilled 链。
            if (result && (result as AxiosResponse).config) {
                // 简单检查是否为 AxiosResponse
                return result as AxiosResponse;
            }
        }

        // 如果所有中间件都运行完毕，没有返回成功的响应，则返回 void
    }

    private flagMiddleware = (ctx: { response: AxiosResponse }) => {
        const { responseHandler, codeHandlers } = this.instanceOptions;
        const code = ctx.response.data?.code;
        // 1. 全局响应处理器 (responseHandler)
        if (responseHandler) {
            const res = responseHandler(ctx.response);
            res && (ctx.response = res);
            return;
        }
        // 2. 业务状态码处理器 (codeHandlers)
        if (codeHandlers && code !== undefined && code !== null) {
            const codeStr = String(code); // 统一将 key 转换为 string
            // 检查 codeHandlers 中是否存在对应的处理器
            if (codeStr in codeHandlers) {
                // 检查锁：防止短时间内对同一种错误码触发多次处理逻辑（如弹窗/跳转）
                if (this.errorLocks.has(codeStr)) return;
                this.errorLocks.add(codeStr);
                try {
                    // 执行业务处理器
                    const res = codeHandlers[codeStr]?.(ctx.response);
                    res && (ctx.response = res);
                } finally {
                    // 延迟清理锁
                    setTimeout(() => this.errorLocks.delete(codeStr), 1000);
                }
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
                this.cacheManager.set(
                    ctx.response.config,
                    ctx.response.data,
                    this.instanceOptions.cacheTTL,
                );
            }
        }
    };

    private customResponseMiddleware = async (ctx: { response: AxiosResponse }) => {
        const interceptor = this.instanceOptions.interceptors?.response;
        if (interceptor?.onFulfilled) {
            ctx.response = await interceptor.onFulfilled(ctx.response);
        }
    };

    private customResponseErrorMiddleware = async (ctx: {
        err: any;
    }): Promise<AxiosResponse<any, any> | void> => {
        const interceptor = this.instanceOptions.interceptors?.response;
        if (interceptor?.onRejected) {
            // 如果自定义拦截器处理了错误（返回了 response），则返回该 response
            const result = await interceptor.onRejected(ctx.err);
            if (result && (result as AxiosResponse).data) {
                // 检查是否返回了响应对象
                return result as AxiosResponse;
            }
        }
    };

    // 并且修改 retryMiddleware 的签名，显式地声明返回值类型
    private retryMiddleware = async (ctx: {
        err: any;
    }): Promise<AxiosResponse<any, any> | void> => {
        if (this.instanceOptions.enableRetry) {
            // 调用父级提供的重试核心逻辑。
            // retryRequest 内部会处理重试计数、延迟和重新进入 GlobalConcurrencyController
            return this.instanceOptions.retryRequest(ctx.err); // 返回 Promise<AxiosResponse>
        }
    };
}
