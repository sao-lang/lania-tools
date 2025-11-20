import { AxiosRequestConfig } from 'axios';
import { debounce, throttle } from '../tools';

type Fn = (...args: any) => any;
export class DebounceThrottleManager {
    private debounceMap = new Map<string, Fn>();
    private throttleMap = new Map<string, Fn>();

    /**
     * 防抖请求：多次调用只执行最后一次
     */
    debounceRequest(req: AxiosRequestConfig, delay = 300): Promise<AxiosRequestConfig> {
        const key = `${req.method}:${req.url}`;

        if (!this.debounceMap.has(key)) {
            // 使用通用 debounce 包裹一个返回 Promise 的函数
            const debouncedFn = debounce(
                (resolve: (req: AxiosRequestConfig) => void) => {
                    resolve(req);
                },
                delay,
            );
            this.debounceMap.set(key, debouncedFn);
        }

        return new Promise((resolve) => {
            const debouncedFn = this.debounceMap.get(key)!;
            // @ts-ignore
            debouncedFn(resolve);
        });
    }

    /**
     * 节流请求：固定间隔内最多执行一次
     */
    throttleRequest(req: AxiosRequestConfig, interval = 300): Promise<AxiosRequestConfig> {
        const key = `${req.method}:${req.url}`;

        if (!this.throttleMap.has(key)) {
            // 使用通用 throttle 包裹一个返回 Promise 的函数
            const throttledFn = throttle(
                (resolve: (req: AxiosRequestConfig) => void) => {
                    resolve(req);
                },
                interval,
            );
            this.throttleMap.set(key, throttledFn);
        }

        return new Promise((resolve) => {
            const throttledFn = this.throttleMap.get(key)!;
            // @ts-ignore
            throttledFn(resolve);
        });
    }

    /**
     * 可选：取消某个防抖/节流
     */
    cancelDebounce(req: AxiosRequestConfig) {
        const key = `${req.method}:${req.url}`;
        const fn = this.debounceMap.get(key) as any;
        fn?.cancel?.();
        this.debounceMap.delete(key);
    }

    cancelThrottle(req: AxiosRequestConfig) {
        const key = `${req.method}:${req.url}`;
        const fn = this.throttleMap.get(key) as any;
        fn?.cancel?.();
        this.throttleMap.delete(key);
    }
}