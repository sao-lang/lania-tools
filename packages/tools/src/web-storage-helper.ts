// 数据加密和解密的简化示例
const encrypt = (str: string) => {
    const encoder = new TextEncoder();
    const uint8Array = encoder.encode(str);
    return Array.from(uint8Array)
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
};
const decrypt = (hex: string) => {
    if (!isHexString(hex)) {
        return hex;
    }
    // 将十六进制字符串转换为字节数组
    const uint8Array = new Uint8Array(
        hex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)),
    );
    // 使用 TextDecoder 将字节数组解码为字符串
    const decoder = new TextDecoder();
    return decoder.decode(uint8Array);
};
const isHexString = (str: string) => {
    // 检查长度是否为偶数
    if (str.length % 2 !== 0) {
        return false;
    }
    // 检查是否仅包含有效的十六进制字符
    return /^[0-9a-fA-F]+$/.test(str);
};

// 类型标记接口
interface StoredData<T> {
    value: T;
    expiresAt: number | null;
}

interface StorageOptions {
    expiresInSeconds?: number; // 过期时间（秒）
    encryptData?: boolean; // 是否加密数据
}

// LocalStorage Helper
export class LocalStorageHelper {
    static set(key: string, value: any, options: StorageOptions = {}): void {
        const dataToStore: StoredData<any> = {
            value,
            expiresAt: options.expiresInSeconds
                ? Date.now() + options.expiresInSeconds * 1000
                : null,
        };
        const stringValue = JSON.stringify(dataToStore);
        const storageValue = options.encryptData
            ? encrypt(stringValue)
            : stringValue;
        localStorage.setItem(key, storageValue);
    }

    static get<T>(key: string): T | null {
        try {
            const storageValue = localStorage.getItem(key);
            if (storageValue) {
                const stringValue = decrypt(storageValue);
                const data: StoredData<any> = JSON.parse(stringValue);
                if (data.expiresAt === null || Date.now() < data.expiresAt) {
                    return data.value;
                } else {
                    this.delete(key);
                    return null;
                }
            }
            return null;
        } catch (e) {
            console.error(e);
            return null;
        }
    }

    static delete(key: string): void {
        localStorage.removeItem(key);
    }

    static clear(): void {
        localStorage.clear();
    }

    static keys(): string[] {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            keys.push(localStorage.key(i) || '');
        }
        return keys;
    }

    static size(): number {
        let size = 0;
        this.keys().forEach((key) => {
            size += localStorage.getItem(key)?.length || 0;
        });
        return size;
    }

    static setMultiple(
        items: { [key: string]: any },
        options: StorageOptions = {},
    ): void {
        Object.keys(items).forEach((key) => this.set(key, items[key], options));
    }

    static getMultiple<T>(keys: string[]): { [key: string]: T | null } {
        const results: { [key: string]: T | null } = {};
        keys.forEach((key) => {
            results[key] = this.get<T>(key);
        });
        return results;
    }
}

// SessionStorage Helper
export class SessionStorageHelper {
    static set(key: string, value: any, options: StorageOptions = {}): void {
        const dataToStore: StoredData<any> = {
            value,
            expiresAt: options.expiresInSeconds
                ? Date.now() + options.expiresInSeconds * 1000
                : null,
        };
        const stringValue = JSON.stringify(dataToStore);
        const storageValue = options.encryptData
            ? encrypt(stringValue)
            : stringValue;
        sessionStorage.setItem(key, storageValue);
    }

    static get<T>(key: string): T | null {
        try {
            const storageValue = sessionStorage.getItem(key);
            if (storageValue) {
                const stringValue = decrypt(storageValue);
                const data: StoredData<any> = JSON.parse(stringValue);
                if (data.expiresAt === null || Date.now() < data.expiresAt) {
                    return data.value as T;
                } else {
                    this.delete(key);
                    return null;
                }
            }
            return null;
        } catch (e) {
            console.error(e);
            return null;
        }
    }

    static delete(key: string): void {
        sessionStorage.removeItem(key);
    }

    static clear(): void {
        sessionStorage.clear();
    }

    static keys(): string[] {
        const keys: string[] = [];
        for (let i = 0; i < sessionStorage.length; i++) {
            keys.push(sessionStorage.key(i) || '');
        }
        return keys;
    }

    static size(): number {
        let size = 0;
        this.keys().forEach((key) => {
            size += sessionStorage.getItem(key)?.length || 0;
        });
        return size;
    }

    static setMultiple(
        items: { [key: string]: any },
        options: StorageOptions = {},
    ): void {
        Object.keys(items).forEach((key) => this.set(key, items[key], options));
    }

    static getMultiple<T>(keys: string[]): { [key: string]: T | null } {
        const results: { [key: string]: T | null } = {};
        keys.forEach((key) => {
            results[key] = this.get<T>(key);
        });
        return results;
    }
}

// Cookie Helper
export class CookieHelper {
    static set(name: string, value: any, options: StorageOptions = {}): void {
        const expires = new Date();
        expires.setTime(
            options.expiresInSeconds
                ? expires.getTime() + options.expiresInSeconds * 1000
                : expires.getTime() + 10 * 365 * 24 * 60 * 60 * 1000,
        ); // 默认保存10年
        const dataToStore: StoredData<any> = {
            value,
            expiresAt: expires.getTime(),
        };
        const stringValue = options.encryptData
            ? encrypt(JSON.stringify(dataToStore))
            : JSON.stringify(dataToStore);
        document.cookie = `${name}=${encodeURIComponent(stringValue)}; expires=${expires.toUTCString()}; path=/`;
    }

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
            console.log(e);
            return null;
        }
    }

    static delete(name: string): void {
        document.cookie = `${name}=; Max-Age=-99999999;`;
    }

    static clear(): void {
        const cookies = this.getAll();
        Object.keys(cookies).forEach((key) => this.delete(key));
    }

    static keys(): string[] {
        return Object.keys(this.getAll());
    }

    static size(): number {
        let size = 0;
        this.keys().forEach((key) => {
            size +=
                document.cookie
                    .split(';')
                    .find((cookie) => cookie.trim().startsWith(`${key}=`))
                    ?.length || 0;
        });
        return size;
    }

    static setMultiple(
        items: { [key: string]: any },
        options: StorageOptions = {},
    ): void {
        Object.keys(items).forEach((key) => this.set(key, items[key], options));
    }

    static getMultiple<T>(keys: string[]): { [key: string]: T | null } {
        const results: { [key: string]: T | null } = {};
        keys.forEach((key) => {
            results[key] = this.get<T>(key);
        });
        return results;
    }

    private static getAll(): { [key: string]: any } {
        const cookies: { [key: string]: any } = {};
        const ca = document.cookie.split(';');
        ca.forEach((cookie) => {
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

// IndexedDB Helper
export class IndexedDBHelper {
    private static dbName = 'myDatabase';
    private static storeName = 'myStore';

    private static async initDB(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);

            request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
                const db = (event.target as IDBOpenDBRequest).result;
                db.createObjectStore(this.storeName, { keyPath: 'id' });
            };

            request.onsuccess = (event: Event) => {
                resolve((event.target as IDBOpenDBRequest).result);
            };

            request.onerror = (event: Event) => {
                reject((event.target as IDBOpenDBRequest).error);
            };
        });
    }

    static async set(
        id: string,
        value: any,
        options: StorageOptions = {},
    ): Promise<void> {
        const dataToStore: StoredData<any> = {
            value,
            expiresAt: options.expiresInSeconds
                ? Date.now() + options.expiresInSeconds * 1000
                : null,
        };
        const stringValue = JSON.stringify(dataToStore);
        const storageValue = options.encryptData
            ? encrypt(stringValue)
            : stringValue;
        const db = await this.initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            store.put({ id, value: storageValue });
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

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
                    if (
                        data.expiresAt === null ||
                        Date.now() < data.expiresAt
                    ) {
                        resolve(data.value as T);
                    } else {
                        this.delete(id)
                            .then(() => resolve(null))
                            .catch(reject);
                    }
                };
                request.onerror = () => reject(request.error);
            } catch (e) {
                reject(e);
            }
        });
    }

    static async delete(id: string): Promise<void> {
        const db = await this.initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            store.delete(id);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    static async clear(): Promise<void> {
        const db = await this.initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            store.clear();
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

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

    static async size(): Promise<number> {
        const keys = await this.keys();
        let size = 0;
        for (const key of keys) {
            const item = await this.get(key);
            size += JSON.stringify(item).length;
        }
        return size;
    }

    static async setMultiple(
        items: { [key: string]: any },
        options: StorageOptions = {},
    ): Promise<void> {
        const db = await this.initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            Object.keys(items).forEach((key) => {
                const dataToStore: StoredData<any> = {
                    value: items[key],
                    expiresAt: options.expiresInSeconds
                        ? Date.now() + options.expiresInSeconds * 1000
                        : null,
                };
                const stringValue = JSON.stringify(dataToStore);
                const storageValue = options.encryptData
                    ? encrypt(stringValue)
                    : stringValue;
                store.put({ id: key, value: storageValue });
            });
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    static async getMultiple<T>(
        keys: string[],
    ): Promise<{ [key: string]: T | null }> {
        const results: { [key: string]: T | null } = {};
        for (const key of keys) {
            results[key] = await this.get<T>(key);
        }
        return results;
    }
}
