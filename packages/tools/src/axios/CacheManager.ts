import { AxiosRequestConfig } from 'axios';
import { generateRequestKey } from './helper';
interface CacheEntry {
    data: any;
    expireAt?: number;
}

export class CacheManager {
    private cache: Map<string, CacheEntry> = new Map();

    public get(config: AxiosRequestConfig) {
        const key = generateRequestKey(config);
        const entry = this.cache.get(key);
        if (entry) {
            if (!entry.expireAt || entry.expireAt > Date.now()) return entry.data;
            this.cache.delete(key);
        }
        return null;
    }

    public set(config: AxiosRequestConfig, data: any, ttl?: number) {
        const key = generateRequestKey(config);
        this.cache.set(key, {
            data: this.unwrapResponse(data),
            expireAt: ttl ? Date.now() + ttl : undefined,
        });
    }

    /**
     * 兼容两种调用方式：既可以直接缓存业务数据，也可以传入完整的 AxiosResponse。
     * 只解包真正的 AxiosResponse，避免把业务 payload 中的 `data` 字段误当成响应体
     * （例如 `{ code: 0, data: {...} }` 被错误缓存成 `{...}`）。
     */
    private unwrapResponse(data: any) {
        const isAxiosResponse =
            data &&
            typeof data === 'object' &&
            data.config !== undefined &&
            data.status !== undefined &&
            data.headers !== undefined;
        return isAxiosResponse ? data.data : data;
    }

    public clear() {
        this.cache.clear();
    }
}
