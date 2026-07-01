import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IndexedDBHelper } from '../src/web-storage-helper';

const mockDB = {
    transaction: vi.fn().mockReturnThis(),
    objectStore: vi.fn().mockReturnThis(),
    put: vi.fn().mockReturnThis(),
    get: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    clear: vi.fn().mockReturnThis(),
    openCursor: vi.fn().mockReturnThis(),
} as any;

let openRequest: any;

const createMockOpenRequest = () => {
    openRequest = {
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        result: mockDB,
    };
    setTimeout(() => {
        openRequest.onsuccess?.({ target: openRequest });
    }, 0);
    return openRequest;
};

describe('IndexedDBHelper', () => {
    let originalIndexedDB: any;

    beforeEach(() => {
        originalIndexedDB = (globalThis as any).indexedDB;
        (globalThis as any).indexedDB = {
            open: vi.fn(createMockOpenRequest),
        };
        mockDB.transaction.mockClear();
        mockDB.objectStore.mockClear();
        mockDB.get.mockClear();
    });

    afterEach(() => {
        (globalThis as any).indexedDB = originalIndexedDB;
        vi.restoreAllMocks();
    });

    it('should initialize the database and resolve get request', async () => {
        const getRequest: any = {
            onsuccess: null,
            onerror: null,
        };
        mockDB.get.mockReturnValueOnce(getRequest);
        mockDB.objectStore.mockReturnValueOnce(mockDB);

        const openReq: any = {
            onupgradeneeded: null,
            onsuccess: null,
            onerror: null,
            result: mockDB,
        };
        (globalThis as any).indexedDB.open = vi.fn(() => openReq);

        setTimeout(() => {
            openReq.onsuccess?.({ target: openReq });
        }, 0);
        const storedValue = JSON.stringify({ value: 'hello', expiresAt: null });
        setTimeout(() => {
            getRequest.onsuccess?.({ target: { result: { value: storedValue } } });
        }, 0);

        const result = await IndexedDBHelper.get('key');
        expect(result).toBe('hello');
    });
});
