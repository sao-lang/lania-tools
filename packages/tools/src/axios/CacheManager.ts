import { AxiosRequestConfig, AxiosResponse } from 'axios';
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

    public set(config: AxiosRequestConfig, data: AxiosResponse<any>, ttl?: number) {
        const key = generateRequestKey(config);
        this.cache.set(key, {
            data,
            expireAt: ttl ? Date.now() + ttl : undefined,
        });
    }

    public clear() {
        this.cache.clear();
    }
}
