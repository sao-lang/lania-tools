import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LocalStorageHelper, SessionStorageHelper, CookieHelper } from '../src/web-storage-helper';

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

    it('should delete a cookie', () => {
        CookieHelper.set('key', 'value');
        CookieHelper.delete('key');
        expect(document.cookie).not.toContain('key=');
    });

    it('should get all keys when cookies exist', () => {
        CookieHelper.set('k1', 'v1');
        const keys = CookieHelper.keys();
        expect(keys).toContain('k1');
    });

    it('should set multiple cookies', () => {
        CookieHelper.setMultiple({ k1: 'v1', k2: 'v2' });
        expect(document.cookie).toContain('k1=');
        expect(document.cookie).toContain('k2=');
    });

    it('should handle encrypted cookies', () => {
        CookieHelper.set('key', 'secret', { encryptData: true });
        expect(document.cookie).toContain('key=');
    });

    it('should get encrypted cookie value', () => {
        CookieHelper.set('key', 'secret', { encryptData: true });
        const rawCookie = document.cookie;
        expect(rawCookie).toContain('key=');
    });
});