import { AxiosRequestConfig, AxiosResponse } from 'axios';

interface CacheEntry {
    data: any;
    expireAt?: number;
}

export class CacheManager {
    private cache: Map<string, CacheEntry> = new Map();
    public getCacheKey(req: AxiosRequestConfig): string {
        const method = req.method || 'get';
        const url = req.url || '';
        // 简单序列化，如果对参数顺序敏感请使用 qs.stringify
        const params = req.params ? JSON.stringify(req.params) : '';
        const data = req.data ? JSON.stringify(req.data) : ''; 
        return `${method}:${url}:${params}:${data}`;
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

