import { AxiosRequestConfig, AxiosResponse } from 'axios';

interface CacheEntry {
    data: any;
    expireAt?: number;
}

export class CacheManager {
    private cache: Map<string, CacheEntry> = new Map();

    public getCacheKey(config: AxiosRequestConfig) {
        return `${config.method}:${config.url}:${JSON.stringify(config.params)}:${JSON.stringify(config.data)}`;
    }

    public get(config: AxiosRequestConfig) {
        const key = this.getCacheKey(config);
        const entry = this.cache.get(key);
        if (entry) {
            if (!entry.expireAt || entry.expireAt > Date.now())
                return entry.data;
            this.cache.delete(key);
        }
        return null;
    }

    public set(
        config: AxiosRequestConfig,
        data: AxiosResponse<any>,
        ttl?: number,
    ) {
        const key = this.getCacheKey(config);
        this.cache.set(key, {
            data,
            expireAt: ttl ? Date.now() + ttl : undefined,
        });
    }

    public clear() {
        this.cache.clear();
    }
}
