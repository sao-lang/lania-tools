/**
 * ============================
 * 🔹 数据加密和解密工具函数
 * ============================
 */

/**
 * @description 简单将字符串转换为十六进制字符串
 * @param str 待加密字符串
 * @returns 十六进制表示的字符串
 */
const encrypt = (str: string): string => {
    const encoder = new TextEncoder();
    const uint8Array = encoder.encode(str);
    return Array.from(uint8Array)
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
};

/**
 * @description 将十六进制字符串解密为原始字符串
 * @param hex 十六进制字符串
 * @returns 原始字符串
 */
const decrypt = (hex: string): string => {
    if (!isHexString(hex)) return hex;
    const uint8Array = new Uint8Array(
        hex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)),
    );
    const decoder = new TextDecoder();
    return decoder.decode(uint8Array);
};

/**
 * @description 判断字符串是否为合法的十六进制字符串
 * @param str 待检查字符串
 * @returns 是否为十六进制字符串
 */
const isHexString = (str: string): boolean => {
    if (str.length % 2 !== 0) return false;
    return /^[0-9a-fA-F]+$/.test(str);
};

/**
 * 存储数据类型接口
 */

/** 存储数据结构 */
interface StoredData<T> {
    value: T;
    expiresAt: number | null; // 到期时间戳，null 表示永不过期
}

/** 存储选项 */
interface StorageOptions {
    expiresInSeconds?: number; // 数据过期时间（秒）
    encryptData?: boolean;      // 是否加密存储
}

/**
 * LocalStorage Helper
 */
export class LocalStorageHelper {
    /**
     * @description 设置单个值
     * @param key 存储键
     * @param value 存储值
     * @param options 额外选项
     */
    static set(key: string, value: any, options: StorageOptions = {}): void {
        const dataToStore: StoredData<any> = {
            value,
            expiresAt: options.expiresInSeconds
                ? Date.now() + options.expiresInSeconds * 1000
                : null,
        };
        const stringValue = JSON.stringify(dataToStore);
        const storageValue = options.encryptData ? encrypt(stringValue) : stringValue;
        localStorage.setItem(key, storageValue);
    }

    /**
     * @description 获取存储值
     * @param key 存储键
     * @returns 存储值或 null
     */
    static get<T>(key: string): T | null {
        try {
            const storageValue = localStorage.getItem(key);
            if (!storageValue) return null;
            const stringValue = decrypt(storageValue);
            const data: StoredData<any> = JSON.parse(stringValue);
            if (data.expiresAt === null || Date.now() < data.expiresAt) {
                return data.value;
            } else {
                this.delete(key);
                return null;
            }
        } catch (e) {
            console.error(e);
            return null;
        }
    }

    /** 删除单个键 */
    static delete(key: string): void {
        localStorage.removeItem(key);
    }

    /** 清空所有 localStorage 数据 */
    static clear(): void {
        localStorage.clear();
    }

    /** 获取所有 key */
    static keys(): string[] {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            keys.push(localStorage.key(i) || '');
        }
        return keys;
    }

    /** 获取本地存储总大小（字符数） */
    static size(): number {
        let size = 0;
        this.keys().forEach((key) => {
            size += localStorage.getItem(key)?.length || 0;
        });
        return size;
    }

    /** 批量设置 */
    static setMultiple(items: { [key: string]: any }, options: StorageOptions = {}): void {
        Object.keys(items).forEach((key) => this.set(key, items[key], options));
    }

    /** 批量获取 */
    static getMultiple<T>(keys: string[]): { [key: string]: T | null } {
        const results: { [key: string]: T | null } = {};
        keys.forEach((key) => {
            results[key] = this.get<T>(key);
        });
        return results;
    }
}

/**
 * SessionStorage Helper
 */
export class SessionStorageHelper {
    /** @see LocalStorageHelper.set */
    static set(key: string, value: any, options: StorageOptions = {}): void {
        const dataToStore: StoredData<any> = {
            value,
            expiresAt: options.expiresInSeconds
                ? Date.now() + options.expiresInSeconds * 1000
                : null,
        };
        const stringValue = JSON.stringify(dataToStore);
        const storageValue = options.encryptData ? encrypt(stringValue) : stringValue;
        sessionStorage.setItem(key, storageValue);
    }

    /** @see LocalStorageHelper.get */
    static get<T>(key: string): T | null {
        try {
            const storageValue = sessionStorage.getItem(key);
            if (!storageValue) return null;
            const stringValue = decrypt(storageValue);
            const data: StoredData<any> = JSON.parse(stringValue);
            if (data.expiresAt === null || Date.now() < data.expiresAt) {
                return data.value as T;
            } else {
                this.delete(key);
                return null;
            }
        } catch (e) {
            console.error(e);
            return null;
        }
    }

    /** @see LocalStorageHelper.delete */
    static delete(key: string): void {
        sessionStorage.removeItem(key);
    }

    /** @see LocalStorageHelper.clear */
    static clear(): void {
        sessionStorage.clear();
    }

    /** @see LocalStorageHelper.keys */
    static keys(): string[] {
        const keys: string[] = [];
        for (let i = 0; i < sessionStorage.length; i++) {
            keys.push(sessionStorage.key(i) || '');
        }
        return keys;
    }

    /** @see LocalStorageHelper.size */
    static size(): number {
        let size = 0;
        this.keys().forEach((key) => {
            size += sessionStorage.getItem(key)?.length || 0;
        });
        return size;
    }

    /** @see LocalStorageHelper.setMultiple */
    static setMultiple(items: { [key: string]: any }, options: StorageOptions = {}): void {
        Object.keys(items).forEach((key) => this.set(key, items[key], options));
    }

    /** @see LocalStorageHelper.getMultiple */
    static getMultiple<T>(keys: string[]): { [key: string]: T | null } {
        const results: { [key: string]: T | null } = {};
        keys.forEach((key) => {
            results[key] = this.get<T>(key);
        });
        return results;
    }
}

/**
 * Cookie Helper
 */
export class CookieHelper {
    /** 设置 Cookie */
    static set(name: string, value: any, options: StorageOptions = {}): void {
        const expires = new Date();
        expires.setTime(
            options.expiresInSeconds
                ? expires.getTime() + options.expiresInSeconds * 1000
                : expires.getTime() + 10 * 365 * 24 * 60 * 60 * 1000, // 默认10年
        );
        const dataToStore: StoredData<any> = { value, expiresAt: expires.getTime() };
        const stringValue = options.encryptData ? encrypt(JSON.stringify(dataToStore)) : JSON.stringify(dataToStore);
        document.cookie = `${name}=${encodeURIComponent(stringValue)}; expires=${expires.toUTCString()}; path=/`;
    }

    /** 获取 Cookie */
    static get<T>(name: string): T | null {
        try {
            const nameEQ = `${name}=`;
            const ca = document.cookie.split(';');
            for (let i = 0; i < ca.length; i++) {
                const c = ca[i].trim();
                if (c.indexOf(nameEQ) === 0) {
                    const stringValue = decrypt(c.substring(nameEQ.length));
                    const data: StoredData<any> = JSON.parse(stringValue);
                    return data.value as T;
                }
            }
            return null;
        } catch (e) {
            console.error(e);
            return null;
        }
    }

    /** 删除 Cookie */
    static delete(name: string): void {
        document.cookie = `${name}=; Max-Age=-99999999;`;
    }

    /** 清空所有 Cookie */
    static clear(): void {
        const cookies = this.getAll();
        Object.keys(cookies).forEach((key) => this.delete(key));
    }

    /** 获取所有 Cookie key */
    static keys(): string[] {
        return Object.keys(this.getAll());
    }

    /** 获取 Cookie 总长度 */
    static size(): number {
        let size = 0;
        this.keys().forEach((key) => {
            size += document.cookie.split(';').find((cookie) => cookie.trim().startsWith(`${key}=`))?.length || 0;
        });
        return size;
    }

    /** 批量设置 Cookie */
    static setMultiple(items: { [key: string]: any }, options: StorageOptions = {}): void {
        Object.keys(items).forEach((key) => this.set(key, items[key], options));
    }

    /** 批量获取 Cookie */
    static getMultiple<T>(keys: string[]): { [key: string]: T | null } {
        const results: { [key: string]: T | null } = {};
        keys.forEach((key) => {
            results[key] = this.get<T>(key);
        });
        return results;
    }

    /** 获取所有 Cookie 数据 */
    private static getAll(): { [key: string]: any } {
        const cookies: { [key: string]: any } = {};
        document.cookie.split(';').forEach((cookie) => {
            const [name, value] = cookie.split('=');
            if (name && value) {
                const stringValue = decrypt(decodeURIComponent(value));
                const data: StoredData<any> = JSON.parse(stringValue);
                cookies[name.trim()] = data.value;
            }
        });
        return cookies;
    }
}

/**
 * IndexedDB Helper
 */
export class IndexedDBHelper {
    private static dbName = 'myDatabase';
    private static storeName = 'myStore';

    /** 初始化数据库 */
    private static async initDB(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);
            request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
                const db = (event.target as IDBOpenDBRequest).result;
                db.createObjectStore(this.storeName, { keyPath: 'id' });
            };
            request.onsuccess = (event: Event) => resolve((event.target as IDBOpenDBRequest).result);
            request.onerror = (event: Event) => reject((event.target as IDBOpenDBRequest).error);
        });
    }

    /** @description 设置单个数据 */
    static async set(id: string, value: any, options: StorageOptions = {}): Promise<void> {
        const dataToStore: StoredData<any> = {
            value,
            expiresAt: options.expiresInSeconds ? Date.now() + options.expiresInSeconds * 1000 : null,
        };
        const stringValue = JSON.stringify(dataToStore);
        const storageValue = options.encryptData ? encrypt(stringValue) : stringValue;
        const db = await this.initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            store.put({ id, value: storageValue });
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    /** @description 获取单个数据 */
    static async get<T>(id: string): Promise<T | null> {
        const db = await this.initDB();
        return new Promise((resolve, reject) => {
            try {
                const transaction = db.transaction([this.storeName]);
                const store = transaction.objectStore(this.storeName);
                const request = store.get(id);
                request.onsuccess = () => {
                    const stringValue = decrypt(request.result.value);
                    const data: StoredData<any> = JSON.parse(stringValue);
                    if (data.expiresAt === null || Date.now() < data.expiresAt) {
                        resolve(data.value as T);
                    } else {
                        this.delete(id).then(() => resolve(null)).catch(reject);
                    }
                };
                request.onerror = () => reject(request.error);
            } catch (e) {
                reject(e);
            }
        });
    }

    /** @description 删除单个数据 */
    static async delete(id: string): Promise<void> {
        const db = await this.initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([this.storeName], 'readwrite');
            transaction.objectStore(this.storeName).delete(id);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    /** 清空整个 store */
    static async clear(): Promise<void> {
        const db = await this.initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([this.storeName], 'readwrite');
            transaction.objectStore(this.storeName).clear();
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    /** 获取所有 key */
    static async keys(): Promise<string[]> {
        const db = await this.initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([this.storeName]);
            const store = transaction.objectStore(this.storeName);
            const keys: string[] = [];
            store.openCursor().onsuccess = (event: Event) => {
                const cursor = (event.target as IDBRequest).result;
                if (cursor) {
                    keys.push(cursor.primaryKey.toString());
                    cursor.continue();
                } else {
                    resolve(keys);
                }
            };
            store.openCursor().onerror = () => reject(store.openCursor().error);
        });
    }

    /** 获取存储大小 */
    static async size(): Promise<number> {
        const keys = await this.keys();
        let size = 0;
        for (const key of keys) {
            const item = await this.get(key);
            size += JSON.stringify(item).length;
        }
        return size;
    }

    /** 批量设置数据 */
    static async setMultiple(items: { [key: string]: any }, options: StorageOptions = {}): Promise<void> {
        const db = await this.initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            Object.keys(items).forEach((key) => {
                const dataToStore: StoredData<any> = {
                    value: items[key],
                    expiresAt: options.expiresInSeconds ? Date.now() + options.expiresInSeconds * 1000 : null,
                };
                const stringValue = JSON.stringify(dataToStore);
                const storageValue = options.encryptData ? encrypt(stringValue) : stringValue;
                store.put({ id: key, value: storageValue });
            });
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    /** 批量获取数据 */
    static async getMultiple<T>(keys: string[]): Promise<{ [key: string]: T | null }> {
        const results: { [key: string]: T | null } = {};
        for (const key of keys) {
            results[key] = await this.get<T>(key);
        }
        return results;
    }
}
