import { AxiosRequestConfig } from 'axios';
import { debounce, throttle } from '../tools';

type Fn = (...args: any) => any;
export class DebounceThrottleManager {
    private debounceMap = new Map<string, Fn>();
    private throttleMap = new Map<string, Fn>();
    debounceRequest(req: AxiosRequestConfig, delay = 300): Promise<AxiosRequestConfig> {
        const key = `${req.method}:${req.url}`;

        if (!this.debounceMap.has(key)) {
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
    throttleRequest(req: AxiosRequestConfig, interval = 300): Promise<AxiosRequestConfig> {
        const key = `${req.method}:${req.url}`;

        if (!this.throttleMap.has(key)) {
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