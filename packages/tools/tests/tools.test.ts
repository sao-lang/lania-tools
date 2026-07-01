import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounce, throttle, deepClone, isDeepEqual, copy } from '../src/tools';

describe('debounce', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should call the function after the specified wait time', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 500);
        debounced();
        expect(fn).not.toHaveBeenCalled();
        vi.advanceTimersByTime(500);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should call the function immediately when immediate is true', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 500, true);
        debounced();
        expect(fn).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(500);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should reset the timer on subsequent calls', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 500);
        debounced();
        vi.advanceTimersByTime(200);
        debounced();
        vi.advanceTimersByTime(200);
        debounced();
        vi.advanceTimersByTime(500);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should use default wait of 1000ms when not specified', () => {
        const fn = vi.fn();
        const debounced = debounce(fn);
        debounced();
        vi.advanceTimersByTime(999);
        expect(fn).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should pass arguments to the original function', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 500);
        debounced('hello', 42);
        vi.advanceTimersByTime(500);
        expect(fn).toHaveBeenCalledWith('hello', 42);
    });

    it('should return the result of the original function', () => {
        const fn = vi.fn((x: number) => x * 2);
        const debounced = debounce(fn, 500);
        debounced(5);
        vi.advanceTimersByTime(500);
        const result = debounced(10);
        vi.advanceTimersByTime(500);
        expect(result).toBe(10);
    });

    it('should cancel the pending execution', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 500);
        debounced();
        debounced.cancel();
        vi.advanceTimersByTime(500);
        expect(fn).not.toHaveBeenCalled();
    });

    it('should handle immediate mode with multiple calls', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 500, true);
        debounced();
        expect(fn).toHaveBeenCalledTimes(1);
        debounced();
        expect(fn).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(500);
        debounced();
        expect(fn).toHaveBeenCalledTimes(2);
    });
});

describe('throttle', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should call the function immediately on first call (leading)', () => {
        const fn = vi.fn();
        const throttled = throttle(fn, 500);
        throttled();
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should not call the function again within the wait time', () => {
        const fn = vi.fn();
        const throttled = throttle(fn, 500);
        throttled();
        throttled();
        throttled();
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should call the function again after the wait time', () => {
        const fn = vi.fn();
        const throttled = throttle(fn, 500);
        throttled();
        vi.advanceTimersByTime(500);
        throttled();
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should respect leading: false option', () => {
        const fn = vi.fn();
        const throttled = throttle(fn, 500, { leading: false });
        throttled();
        expect(fn).not.toHaveBeenCalled();
        vi.advanceTimersByTime(500);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should respect trailing: false option', () => {
        const fn = vi.fn();
        const throttled = throttle(fn, 500, { trailing: false });
        throttled();
        expect(fn).toHaveBeenCalledTimes(1);
        throttled();
        vi.advanceTimersByTime(500);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should use default wait of 1000ms when not specified', () => {
        const fn = vi.fn();
        const throttled = throttle(fn);
        throttled();
        expect(fn).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(999);
        throttled();
        expect(fn).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(1);
        throttled();
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should pass arguments to the original function', () => {
        const fn = vi.fn();
        const throttled = throttle(fn, 500);
        throttled('test', 123);
        expect(fn).toHaveBeenCalledWith('test', 123);
    });

    it('should cancel the pending execution', () => {
        const fn = vi.fn();
        const throttled = throttle(fn, 500, { leading: false });
        throttled();
        throttled.cancel();
        vi.advanceTimersByTime(500);
        expect(fn).not.toHaveBeenCalled();
    });

    it('should handle trailing call correctly', () => {
        const fn = vi.fn();
        const throttled = throttle(fn, 500);
        throttled();
        throttled();
        vi.advanceTimersByTime(500);
        expect(fn).toHaveBeenCalledTimes(2);
    });
});

describe('deepClone', () => {
    it('should clone primitive values', () => {
        expect(deepClone(42)).toBe(42);
        expect(deepClone('hello')).toBe('hello');
        expect(deepClone(true)).toBe(true);
        expect(deepClone(null)).toBe(null);
        expect(deepClone(undefined)).toBe(undefined);
    });

    it('should clone plain objects', () => {
        const obj = { a: 1, b: { c: 2 } };
        const cloned = deepClone(obj);
        expect(cloned).toEqual(obj);
        expect(cloned).not.toBe(obj);
        expect(cloned.b).not.toBe(obj.b);
    });

    it('should clone arrays', () => {
        const arr = [1, [2, 3], { a: 4 }];
        const cloned = deepClone(arr);
        expect(cloned).toEqual(arr);
        expect(cloned).not.toBe(arr);
        expect(cloned[1]).not.toBe(arr[1]);
        expect(cloned[2]).not.toBe(arr[2]);
    });

    it('should clone Date objects', () => {
        const date = new Date('2024-01-01');
        const cloned = deepClone(date);
        expect(cloned).toEqual(date);
        expect(cloned).not.toBe(date);
        expect(cloned.getTime()).toBe(date.getTime());
    });

    it('should clone RegExp objects', () => {
        const regex = /hello/gi;
        const cloned = deepClone(regex);
        expect(cloned).toEqual(regex);
        expect(cloned).not.toBe(regex);
        expect(cloned.source).toBe(regex.source);
        expect(cloned.flags).toBe(regex.flags);
    });

    it('should clone Map objects', () => {
        const map = new Map([['a', 1], ['b', { c: 2 }]]);
        const cloned = deepClone(map);
        expect(cloned).toEqual(map);
        expect(cloned).not.toBe(map);
        expect(cloned.get('b')).not.toBe(map.get('b'));
    });

    it('should clone Set objects', () => {
        const set = new Set([1, { a: 2 }]);
        const cloned = deepClone(set);
        expect(cloned).toEqual(set);
        expect(cloned).not.toBe(set);
    });

    it('should handle circular references', () => {
        const obj: any = { a: 1 };
        obj.self = obj;
        const cloned = deepClone(obj);
        expect(cloned.a).toBe(1);
        expect(cloned.self).toBe(cloned);
    });

    it('should clone nested arrays and objects', () => {
        const complex = {
            arr: [1, { b: new Date('2024-01-01') }],
            map: new Map([['key', new Set([1, 2])]]),
        };
        const cloned = deepClone(complex);
        expect(cloned).toEqual(complex);
        expect(cloned.arr[1].b).not.toBe(complex.arr[1].b);
    });
});

describe('isDeepEqual', () => {
    it('should return true for identical primitives', () => {
        expect(isDeepEqual(1, 1)).toBe(true);
        expect(isDeepEqual('hello', 'hello')).toBe(true);
        expect(isDeepEqual(true, true)).toBe(true);
        expect(isDeepEqual(null, null)).toBe(true);
        expect(isDeepEqual(undefined, undefined)).toBe(true);
    });

    it('should return false for different primitives', () => {
        expect(isDeepEqual(1, 2)).toBe(false);
        expect(isDeepEqual('a', 'b')).toBe(false);
        expect(isDeepEqual(true, false)).toBe(false);
        expect(isDeepEqual(null, undefined)).toBe(false);
    });

    it('should handle NaN correctly', () => {
        expect(isDeepEqual(NaN, NaN)).toBe(true);
        expect(isDeepEqual(NaN, 1)).toBe(false);
    });

    it('should compare plain objects deeply', () => {
        expect(isDeepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
        expect(isDeepEqual({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
        expect(isDeepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    });

    it('should compare nested objects', () => {
        expect(isDeepEqual({ a: { b: { c: 1 } } }, { a: { b: { c: 1 } } })).toBe(true);
        expect(isDeepEqual({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } })).toBe(false);
    });

    it('should compare arrays', () => {
        expect(isDeepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
        expect(isDeepEqual([1, 2, 3], [1, 2, 4])).toBe(false);
        expect(isDeepEqual([1, 2], [1, 2, 3])).toBe(false);
    });

    it('should compare Date objects', () => {
        expect(isDeepEqual(new Date('2024-01-01'), new Date('2024-01-01'))).toBe(true);
        expect(isDeepEqual(new Date('2024-01-01'), new Date('2024-01-02'))).toBe(false);
    });

    it('should compare RegExp objects', () => {
        expect(isDeepEqual(/abc/gi, /abc/gi)).toBe(true);
        expect(isDeepEqual(/abc/gi, /abc/g)).toBe(false);
        expect(isDeepEqual(/abc/, /def/)).toBe(false);
    });

    it('should compare Map objects', () => {
        const map1 = new Map([['a', 1]]);
        const map2 = new Map([['a', 1]]);
        const map3 = new Map([['a', 2]]);
        expect(isDeepEqual(map1, map2)).toBe(true);
        expect(isDeepEqual(map1, map3)).toBe(false);
    });

    it('should compare Set objects', () => {
        const set1 = new Set([1, 2, 3]);
        const set2 = new Set([1, 2, 3]);
        const set3 = new Set([1, 2, 4]);
        expect(isDeepEqual(set1, set2)).toBe(true);
        expect(isDeepEqual(set1, set3)).toBe(false);
    });

    it('should handle circular references', () => {
        const obj1: any = { a: 1 };
        obj1.self = obj1;
        const obj2: any = { a: 1 };
        obj2.self = obj2;
        expect(isDeepEqual(obj1, obj2)).toBe(true);
    });

    it('should return false for different types', () => {
        expect(isDeepEqual({}, [])).toBe(false);
        expect(isDeepEqual(new Date(), {})).toBe(false);
    });

    it('should compare nested Map and Set', () => {
        const map1 = new Map([['key', new Set([1, 2])]]);
        const map2 = new Map([['key', new Set([1, 2])]]);
        const map3 = new Map([['key', new Set([1, 3])]]);
        expect(isDeepEqual(map1, map2)).toBe(true);
        expect(isDeepEqual(map1, map3)).toBe(false);
    });
});

describe('copy', () => {
    const originalClipboard = (globalThis as any).navigator?.clipboard;
    const originalFetch = (globalThis as any).fetch;
    const originalClipboardItem = (globalThis as any).ClipboardItem;

    afterEach(() => {
        if (originalClipboard !== undefined) {
            Object.defineProperty(globalThis.navigator, 'clipboard', {
                value: originalClipboard,
                configurable: true,
                writable: true,
            });
        } else {
            delete (globalThis.navigator as any).clipboard;
        }

        if (originalFetch !== undefined) {
            globalThis.fetch = originalFetch;
        } else {
            delete (globalThis as any).fetch;
        }

        if (originalClipboardItem !== undefined) {
            (globalThis as any).ClipboardItem = originalClipboardItem;
        } else {
            delete (globalThis as any).ClipboardItem;
        }

        vi.restoreAllMocks();
    });

    it('should copy text using navigator.clipboard.writeText', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(globalThis.navigator, 'clipboard', {
            value: { writeText },
            configurable: true,
        });

        await copy({ text: 'hello' });
        expect(writeText).toHaveBeenCalledWith('hello');
    });

    it('should copy text using fallback when clipboard is unavailable', async () => {
        const execCommand = vi.fn(() => true);
        (document as any).execCommand = execCommand;
        delete (globalThis.navigator as any).clipboard;

        await copy({ text: 'fallback' });
        expect(execCommand).toHaveBeenCalledWith('copy');
    });

    it('should throw when neither text nor imageUrl provided', async () => {
        await expect(copy({} as any)).rejects.toThrow('Either text or imageUrl must be provided');
    });

    it('should copy image when ClipboardItem is available', async () => {
        const write = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(globalThis.navigator, 'clipboard', {
            value: { write },
            configurable: true,
        });

        (globalThis as any).ClipboardItem = class {
            constructor(public items: any) {}
        };

        globalThis.fetch = vi.fn().mockResolvedValue({
            blob: vi.fn().mockResolvedValue(new Blob(['data'], { type: 'image/png' })),
        } as any);

        await copy({ imageUrl: 'http://example.com/image.png' });
        expect(write).toHaveBeenCalled();
        expect((globalThis.fetch as any)).toHaveBeenCalledWith('http://example.com/image.png');
    });
});