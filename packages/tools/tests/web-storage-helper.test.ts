import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LocalStorageHelper, SessionStorageHelper, CookieHelper, IndexedDBHelper } from '../src/web-storage-helper';

describe('LocalStorageHelper', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('should set and get a value', () => {
        LocalStorageHelper.set('key1', 'value1');
        expect(LocalStorageHelper.get('key1')).toBe('value1');
    });

    it('should set and get a number', () => {
        LocalStorageHelper.set('num', 42);
        expect(LocalStorageHelper.get('num')).toBe(42);
    });

    it('should set and get an object', () => {
        const obj = { a: 1, b: { c: 2 } };
        LocalStorageHelper.set('obj', obj);
        expect(LocalStorageHelper.get('obj')).toEqual(obj);
    });

    it('should return null for non-existent key', () => {
        expect(LocalStorageHelper.get('nonexistent')).toBeNull();
    });

    it('should delete a key', () => {
        LocalStorageHelper.set('key1', 'value1');
        LocalStorageHelper.delete('key1');
        expect(LocalStorageHelper.get('key1')).toBeNull();
    });

    it('should clear all keys', () => {
        LocalStorageHelper.set('k1', 'v1');
        LocalStorageHelper.set('k2', 'v2');
        LocalStorageHelper.clear();
        expect(LocalStorageHelper.get('k1')).toBeNull();
        expect(LocalStorageHelper.get('k2')).toBeNull();
    });

    it('should get all keys', () => {
        LocalStorageHelper.set('k1', 'v1');
        LocalStorageHelper.set('k2', 'v2');
        const keys = LocalStorageHelper.keys();
        expect(keys).toContain('k1');
        expect(keys).toContain('k2');
    });

    it('should calculate size', () => {
        LocalStorageHelper.set('k1', 'hello');
        const size = LocalStorageHelper.size();
        expect(size).toBeGreaterThan(0);
    });

    it('should set multiple items', () => {
        LocalStorageHelper.setMultiple({ k1: 'v1', k2: 'v2' });
        expect(LocalStorageHelper.get('k1')).toBe('v1');
        expect(LocalStorageHelper.get('k2')).toBe('v2');
    });

    it('should get multiple items', () => {
        LocalStorageHelper.setMultiple({ k1: 'v1', k2: 'v2', k3: 'v3' });
        const result = LocalStorageHelper.getMultiple(['k1', 'k2']);
        expect(result).toEqual({ k1: 'v1', k2: 'v2' });
    });

    it('should handle expired data', () => {
        LocalStorageHelper.set('key', 'value', { expiresInSeconds: -1 });
        expect(LocalStorageHelper.get('key')).toBeNull();
    });

    it('should handle encrypted data', () => {
        LocalStorageHelper.set('key', 'secret', { encryptData: true });
        const raw = localStorage.getItem('key');
        expect(raw).not.toBeNull();
        expect(LocalStorageHelper.get('key')).toBe('secret');
    });

    it('should handle corrupted data gracefully', () => {
        localStorage.setItem('corrupt', 'not-valid-hex');
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(LocalStorageHelper.get('corrupt')).toBeNull();
        spy.mockRestore();
    });

    it('should handle special characters with encryption', () => {
        const specialStr = 'hello world!@#$%^&*()_+-=[]{}|;:,.<>?';
        LocalStorageHelper.set('special', specialStr, { encryptData: true });
        expect(LocalStorageHelper.get('special')).toBe(specialStr);
    });

    it('should handle empty string with encryption', () => {
        LocalStorageHelper.set('empty', '', { encryptData: true });
        expect(LocalStorageHelper.get('empty')).toBe('');
    });

    it('should handle null expiresAt', () => {
        LocalStorageHelper.set('no-expire', 'value');
        const raw = localStorage.getItem('no-expire');
        const parsed = JSON.parse(raw!);
        expect(parsed.expiresAt).toBeNull();
    });
});

describe('SessionStorageHelper', () => {
    beforeEach(() => {
        sessionStorage.clear();
    });

    it('should set and get a value', () => {
        SessionStorageHelper.set('key1', 'value1');
        expect(SessionStorageHelper.get('key1')).toBe('value1');
    });

    it('should return null for non-existent key', () => {
        expect(SessionStorageHelper.get('nonexistent')).toBeNull();
    });

    it('should delete a key', () => {
        SessionStorageHelper.set('key1', 'value1');
        SessionStorageHelper.delete('key1');
        expect(SessionStorageHelper.get('key1')).toBeNull();
    });

    it('should clear all keys', () => {
        SessionStorageHelper.set('k1', 'v1');
        SessionStorageHelper.set('k2', 'v2');
        SessionStorageHelper.clear();
        expect(SessionStorageHelper.get('k1')).toBeNull();
    });

    it('should get all keys', () => {
        SessionStorageHelper.set('k1', 'v1');
        const keys = SessionStorageHelper.keys();
        expect(keys).toContain('k1');
    });

    it('should set and get multiple', () => {
        SessionStorageHelper.setMultiple({ k1: 'v1', k2: 'v2' });
        const result = SessionStorageHelper.getMultiple(['k1', 'k2']);
        expect(result).toEqual({ k1: 'v1', k2: 'v2' });
    });

    it('should handle expired data', () => {
        SessionStorageHelper.set('key', 'value', { expiresInSeconds: -1 });
        expect(SessionStorageHelper.get('key')).toBeNull();
    });

    it('should handle encrypted data', () => {
        SessionStorageHelper.set('key', 'secret', { encryptData: true });
        expect(SessionStorageHelper.get('key')).toBe('secret');
    });

    it('should calculate size', () => {
        SessionStorageHelper.set('k1', 'hello');
        const size = SessionStorageHelper.size();
        expect(size).toBeGreaterThan(0);
    });

    it('should handle corrupted data gracefully', () => {
        sessionStorage.setItem('corrupt', 'not-valid-hex');
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(SessionStorageHelper.get('corrupt')).toBeNull();
        spy.mockRestore();
    });
});

describe('CookieHelper', () => {
    beforeEach(() => {
        document.cookie = '';
    });

    it('should set a cookie value via document.cookie', () => {
        CookieHelper.set('testKey', 'testValue');
        expect(document.cookie).toContain('testKey=');
    });

    it('should return null for non-existent cookie', () => {
        expect(CookieHelper.get('nonexistent')).toBeNull();
    });

    it('should get a cookie value', () => {
        CookieHelper.set('testKey', 'testValue');
        expect(CookieHelper.get('testKey')).toBe('testValue');
    });

    it('should delete a cookie', () => {
        CookieHelper.set('key', 'value');
        CookieHelper.delete('key');
        expect(document.cookie).not.toContain('key=');
    });

    it('should clear all cookies', () => {
        CookieHelper.set('k1', 'v1');
        CookieHelper.set('k2', 'v2');
        CookieHelper.clear();
        expect(CookieHelper.keys()).toHaveLength(0);
    });

    it('should get all keys when cookies exist', () => {
        CookieHelper.set('k1', 'v1');
        const keys = CookieHelper.keys();
        expect(keys).toContain('k1');
    });

    it('should get size', () => {
        CookieHelper.set('k1', 'hello');
        const size = CookieHelper.size();
        expect(size).toBeGreaterThan(0);
    });

    it('should set multiple cookies', () => {
        CookieHelper.setMultiple({ k1: 'v1', k2: 'v2' });
        expect(document.cookie).toContain('k1=');
        expect(document.cookie).toContain('k2=');
    });

    it('should get multiple cookies', () => {
        CookieHelper.set('k1', 'v1');
        CookieHelper.set('k2', 'v2');
        const result = CookieHelper.getMultiple(['k1', 'k2']);
        expect(result).toEqual({ k1: 'v1', k2: 'v2' });
    });

    it('should handle encrypted cookies', () => {
        CookieHelper.set('key', 'secret', { encryptData: true });
        expect(document.cookie).toContain('key=');
    });

    it('should get encrypted cookie value', () => {
        CookieHelper.set('key', 'secret', { encryptData: true });
        expect(CookieHelper.get('key')).toBe('secret');
    });

    it('should handle corrupted cookie data gracefully', () => {
        document.cookie = 'corrupt=not-valid-json';
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(CookieHelper.get('corrupt')).toBeNull();
        spy.mockRestore();
    });
});

describe('IndexedDBHelper', () => {
    let originalIndexedDB: any;

    beforeEach(() => {
        originalIndexedDB = (globalThis as any).indexedDB;
    });

    afterEach(() => {
        (globalThis as any).indexedDB = originalIndexedDB;
        vi.restoreAllMocks();
    });

    it('should set a value', async () => {
        const mockTransaction: any = {
            objectStore: vi.fn(() => ({ put: vi.fn() })),
            oncomplete: null,
            onerror: null,
        };
        const mockDB: any = {
            transaction: vi.fn(() => mockTransaction),
        };
        const mockOpenRequest: any = {
            onupgradeneeded: null,
            onsuccess: null,
            onerror: null,
            result: mockDB,
        };
        (globalThis as any).indexedDB = {
            open: vi.fn(() => mockOpenRequest),
        };

        const promise = IndexedDBHelper.set('key', 'value');

        setTimeout(() => {
            mockOpenRequest.onsuccess?.({ target: mockOpenRequest });
        }, 0);
        setTimeout(() => {
            mockTransaction.oncomplete?.();
        }, 10);

        await promise;
        expect(mockDB.transaction).toHaveBeenCalled();
    });

    it('should get a value', async () => {
        const storedValue = JSON.stringify({ value: 'hello', expiresAt: null });
        const mockGetRequest: any = {
            onsuccess: null,
            onerror: null,
            result: { value: storedValue },
        };
        const mockTransaction: any = {
            objectStore: vi.fn(() => ({ get: vi.fn(() => mockGetRequest) })),
            oncomplete: null,
            onerror: null,
        };
        const mockDB: any = {
            transaction: vi.fn(() => mockTransaction),
        };
        const mockOpenRequest: any = {
            onupgradeneeded: null,
            onsuccess: null,
            onerror: null,
            result: mockDB,
        };
        (globalThis as any).indexedDB = {
            open: vi.fn(() => mockOpenRequest),
        };

        const promise = IndexedDBHelper.get('key');

        setTimeout(() => {
            mockOpenRequest.onsuccess?.({ target: mockOpenRequest });
        }, 0);
        setTimeout(() => {
            mockGetRequest.onsuccess?.({ target: mockGetRequest });
        }, 10);

        const result = await promise;
        expect(result).toBe('hello');
    });

    it('should return null for non-existent key', async () => {
        const mockGetRequest: any = {
            onsuccess: null,
            onerror: null,
            result: undefined,
        };
        const mockTransaction: any = {
            objectStore: vi.fn(() => ({ get: vi.fn(() => mockGetRequest) })),
            oncomplete: null,
            onerror: null,
        };
        const mockDB: any = {
            transaction: vi.fn(() => mockTransaction),
        };
        const mockOpenRequest: any = {
            onupgradeneeded: null,
            onsuccess: null,
            onerror: null,
            result: mockDB,
        };
        (globalThis as any).indexedDB = {
            open: vi.fn(() => mockOpenRequest),
        };

        const promise = IndexedDBHelper.get('nonexistent');

        setTimeout(() => {
            mockOpenRequest.onsuccess?.({ target: mockOpenRequest });
        }, 0);
        setTimeout(() => {
            mockGetRequest.onsuccess?.({ target: mockGetRequest });
        }, 10);

        const result = await promise;
        expect(result).toBeNull();
    });

    it('should delete a key', async () => {
        const mockTransaction: any = {
            objectStore: vi.fn(() => ({ delete: vi.fn() })),
            oncomplete: null,
            onerror: null,
        };
        const mockDB: any = {
            transaction: vi.fn(() => mockTransaction),
        };
        const mockOpenRequest: any = {
            onupgradeneeded: null,
            onsuccess: null,
            onerror: null,
            result: mockDB,
        };
        (globalThis as any).indexedDB = {
            open: vi.fn(() => mockOpenRequest),
        };

        const promise = IndexedDBHelper.delete('key');

        setTimeout(() => {
            mockOpenRequest.onsuccess?.({ target: mockOpenRequest });
        }, 0);
        setTimeout(() => {
            mockTransaction.oncomplete?.();
        }, 10);

        await promise;
        expect(mockDB.transaction).toHaveBeenCalled();
    });

    it('should handle encrypted data', async () => {
        const mockTransaction: any = {
            objectStore: vi.fn(() => ({ put: vi.fn() })),
            oncomplete: null,
            onerror: null,
        };
        const mockDB: any = {
            transaction: vi.fn(() => mockTransaction),
        };
        const mockOpenRequest: any = {
            onupgradeneeded: null,
            onsuccess: null,
            onerror: null,
            result: mockDB,
        };
        (globalThis as any).indexedDB = {
            open: vi.fn(() => mockOpenRequest),
        };

        const promise = IndexedDBHelper.set('key', 'secret', { encryptData: true });

        setTimeout(() => {
            mockOpenRequest.onsuccess?.({ target: mockOpenRequest });
        }, 0);
        setTimeout(() => {
            mockTransaction.oncomplete?.();
        }, 10);

        await promise;
        expect(mockDB.transaction).toHaveBeenCalled();
    });

    it('should handle expired data', async () => {
        const storedValue = JSON.stringify({ value: 'expired', expiresAt: Date.now() - 10000 });
        const mockGetRequest: any = {
            onsuccess: null,
            onerror: null,
            result: { value: storedValue },
        };
        const mockTransaction1: any = {
            objectStore: vi.fn(() => ({ get: vi.fn(() => mockGetRequest) })),
            oncomplete: null,
            onerror: null,
        };
        const mockTransaction2: any = {
            objectStore: vi.fn(() => ({ delete: vi.fn() })),
            oncomplete: null,
            onerror: null,
        };
        const mockDB1: any = { transaction: vi.fn(() => mockTransaction1) };
        const mockDB2: any = { transaction: vi.fn(() => mockTransaction2) };
        const mockOpenRequest1: any = {
            onupgradeneeded: null,
            onsuccess: null,
            onerror: null,
            result: mockDB1,
        };
        const mockOpenRequest2: any = {
            onupgradeneeded: null,
            onsuccess: null,
            onerror: null,
            result: mockDB2,
        };
        let openCount = 0;
        (globalThis as any).indexedDB = {
            open: vi.fn(() => {
                openCount++;
                return openCount === 1 ? mockOpenRequest1 : mockOpenRequest2;
            }),
        };

        const promise = IndexedDBHelper.get('key');

        setTimeout(() => mockOpenRequest1.onsuccess?.({ target: mockOpenRequest1 }), 0);
        setTimeout(() => mockGetRequest.onsuccess?.({ target: mockGetRequest }), 10);
        setTimeout(() => mockOpenRequest2.onsuccess?.({ target: mockOpenRequest2 }), 20);
        setTimeout(() => mockTransaction2.oncomplete?.(), 30);

        const result = await promise;
        expect(result).toBeNull();
    });

    it('should clear all data', async () => {
        const mockTransaction: any = {
            objectStore: vi.fn(() => ({ clear: vi.fn() })),
            oncomplete: null,
            onerror: null,
        };
        const mockDB: any = {
            transaction: vi.fn(() => mockTransaction),
        };
        const mockOpenRequest: any = {
            onupgradeneeded: null,
            onsuccess: null,
            onerror: null,
            result: mockDB,
        };
        (globalThis as any).indexedDB = {
            open: vi.fn(() => mockOpenRequest),
        };

        const promise = IndexedDBHelper.clear();

        setTimeout(() => {
            mockOpenRequest.onsuccess?.({ target: mockOpenRequest });
        }, 0);
        setTimeout(() => {
            mockTransaction.oncomplete?.();
        }, 10);

        await promise;
        expect(mockDB.transaction).toHaveBeenCalled();
    });

    it('should get all keys', async () => {
        const mockCursorRequest: any = {
            onsuccess: null,
            onerror: null,
        };
        const mockTransaction: any = {
            objectStore: vi.fn(() => ({ openCursor: vi.fn(() => mockCursorRequest) })),
            oncomplete: null,
            onerror: null,
        };
        const mockDB: any = {
            transaction: vi.fn(() => mockTransaction),
        };
        const mockOpenRequest: any = {
            onupgradeneeded: null,
            onsuccess: null,
            onerror: null,
            result: mockDB,
        };
        (globalThis as any).indexedDB = {
            open: vi.fn(() => mockOpenRequest),
        };

        const promise = IndexedDBHelper.keys();

        setTimeout(() => {
            mockOpenRequest.onsuccess?.({ target: mockOpenRequest });
        }, 0);
        setTimeout(() => {
            mockCursorRequest.onsuccess?.({ target: { result: { primaryKey: 'key1', continue: vi.fn() } } });
        }, 10);
        setTimeout(() => {
            mockCursorRequest.onsuccess?.({ target: { result: null } });
        }, 20);

        const keys = await promise;
        expect(keys).toContain('key1');
    });

    it('should set multiple items', async () => {
        const mockTransaction: any = {
            objectStore: vi.fn(() => ({ put: vi.fn() })),
            oncomplete: null,
            onerror: null,
        };
        const mockDB: any = {
            transaction: vi.fn(() => mockTransaction),
        };
        const mockOpenRequest: any = {
            onupgradeneeded: null,
            onsuccess: null,
            onerror: null,
            result: mockDB,
        };
        (globalThis as any).indexedDB = {
            open: vi.fn(() => mockOpenRequest),
        };

        const promise = IndexedDBHelper.setMultiple({ k1: 'v1', k2: 'v2' });

        setTimeout(() => {
            mockOpenRequest.onsuccess?.({ target: mockOpenRequest });
        }, 0);
        setTimeout(() => {
            mockTransaction.oncomplete?.();
        }, 10);

        await promise;
        expect(mockDB.transaction).toHaveBeenCalled();
    });

    it('should get multiple items', async () => {
        const storedValue1 = JSON.stringify({ value: 'v1', expiresAt: null });
        const storedValue2 = JSON.stringify({ value: 'v2', expiresAt: null });
        let getCallCount = 0;
        const mockGetRequest1: any = {
            onsuccess: null,
            onerror: null,
            result: { value: storedValue1 },
        };
        const mockGetRequest2: any = {
            onsuccess: null,
            onerror: null,
            result: { value: storedValue2 },
        };
        const mockTransaction: any = {
            objectStore: vi.fn(() => ({
                get: vi.fn(() => {
                    getCallCount++;
                    return getCallCount === 1 ? mockGetRequest1 : mockGetRequest2;
                }),
            })),
            oncomplete: null,
            onerror: null,
        };
        const mockDB: any = {
            transaction: vi.fn(() => mockTransaction),
        };
        const mockOpenRequest: any = {
            onupgradeneeded: null,
            onsuccess: null,
            onerror: null,
            result: mockDB,
        };
        (globalThis as any).indexedDB = {
            open: vi.fn(() => mockOpenRequest),
        };

        const promise = IndexedDBHelper.getMultiple(['k1', 'k2']);

        setTimeout(() => {
            mockOpenRequest.onsuccess?.({ target: mockOpenRequest });
        }, 0);
        setTimeout(() => {
            mockGetRequest1.onsuccess?.({ target: mockGetRequest1 });
        }, 10);
        setTimeout(() => {
            mockOpenRequest.onsuccess?.({ target: mockOpenRequest });
        }, 20);
        setTimeout(() => {
            mockGetRequest2.onsuccess?.({ target: mockGetRequest2 });
        }, 30);

        const result = await promise;
        expect(result).toEqual({ k1: 'v1', k2: 'v2' });
    });

    it('should get size', async () => {
        const mockCursorRequest: any = {
            onsuccess: null,
            onerror: null,
        };
        const mockGetRequest: any = {
            onsuccess: null,
            onerror: null,
            result: { value: JSON.stringify({ value: 'test', expiresAt: null }) },
        };
        let callCount = 0;
        const mockTransaction: any = {
            objectStore: vi.fn(() => ({
                openCursor: vi.fn(() => {
                    callCount++;
                    return mockCursorRequest;
                }),
                get: vi.fn(() => mockGetRequest),
            })),
            oncomplete: null,
            onerror: null,
        };
        const mockDB: any = {
            transaction: vi.fn(() => mockTransaction),
        };
        const mockOpenRequest: any = {
            onupgradeneeded: null,
            onsuccess: null,
            onerror: null,
            result: mockDB,
        };
        (globalThis as any).indexedDB = {
            open: vi.fn(() => mockOpenRequest),
        };

        const promise = IndexedDBHelper.size();

        setTimeout(() => mockOpenRequest.onsuccess?.({ target: mockOpenRequest }), 0);
        setTimeout(() => mockCursorRequest.onsuccess?.({ target: { result: { primaryKey: 'key1', continue: vi.fn() } } }), 10);
        setTimeout(() => mockCursorRequest.onsuccess?.({ target: { result: null } }), 20);
        setTimeout(() => mockOpenRequest.onsuccess?.({ target: mockOpenRequest }), 30);
        setTimeout(() => mockGetRequest.onsuccess?.({ target: mockGetRequest }), 40);

        const size = await promise;
        expect(size).toBeGreaterThan(0);
    });
});