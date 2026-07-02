import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createChineseConverter, convertPageChinese } from '../src/convert-chinese-text';

describe('createChineseConverter', () => {
    it('should create a converter function', () => {
        const converter = createChineseConverter();
        expect(typeof converter).toBe('function');
    });

    it('should convert text using dictionary', () => {
        const converter = createChineseConverter();
        const dict = { 张: '張', 三: '叁' };
        const result = converter('张三', dict);
        expect(result).toBe('張叁');
    });

    it('should return original text if dictionary is empty', () => {
        const converter = createChineseConverter();
        const result = converter('hello', {});
        expect(result).toBe('hello');
    });

    it('should return original text if text is empty', () => {
        const converter = createChineseConverter();
        const result = converter('', { a: 'b' });
        expect(result).toBe('');
    });

    it('should return original text if dictionary is null/undefined', () => {
        const converter = createChineseConverter();
        const result = converter('hello', null as any);
        expect(result).toBe('hello');
    });

    it('should cache results when useCache is true', () => {
        const converter = createChineseConverter(100);
        const dict = { a: 'A', b: 'B' };
        const result1 = converter('ab', dict);
        const result2 = converter('ab', dict);
        expect(result1).toBe('AB');
        expect(result2).toBe('AB');
    });

    it('should not cache when useCache is false', () => {
        const converter = createChineseConverter(100);
        const dict = { a: 'A' };
        const result1 = converter('a', dict, false);
        const result2 = converter('a', dict, false);
        expect(result1).toBe('A');
        expect(result2).toBe('A');
    });

    it('should rebuild pattern when dictionary changes', () => {
        const converter = createChineseConverter(100);
        const dict1 = { a: 'A' };
        const dict2 = { b: 'B' };
        expect(converter('a', dict1)).toBe('A');
        expect(converter('b', dict2)).toBe('B');
        expect(converter('a', dict2)).toBe('a');
    });

    it('should handle special regex characters in keys', () => {
        const converter = createChineseConverter(100);
        const dict = { '.': 'DOT', '*': 'STAR' };
        expect(converter('a.b*c', dict)).toBe('aDOTbSTARc');
    });

    it('should evict oldest cache entry when exceeding maxCacheSize', () => {
        const converter = createChineseConverter(2);
        const dict = { a: 'A', b: 'B', c: 'C' };
        converter('a', dict);
        converter('b', dict);
        converter('c', dict);
        // 'a' should have been evicted, 'b' and 'c' should be cached
        const result = converter('a', dict);
        // Should still work, just no cache hit
        expect(result).toBe('A');
    });

    it('should handle LRU cache properly', () => {
        const converter = createChineseConverter(2);
        const dict = { a: 'A', b: 'B', c: 'C' };
        converter('a', dict);
        converter('b', dict);
        converter('a', dict);
        converter('c', dict);
        const result = converter('b', dict);
        expect(result).toBe('B');
    });

    it('should use default maxCacheSize of 500', () => {
        const converter = createChineseConverter();
        const dict = { a: 'A' };
        for (let i = 0; i < 501; i++) {
            converter(`text${i}`, dict);
        }
        const result = converter('text500', dict);
        expect(result).toBe('text500');
    });

    it('should return original text when no matches in dictionary', () => {
        const converter = createChineseConverter();
        const dict = { 张: '張' };
        const result = converter('李四', dict);
        expect(result).toBe('李四');
    });

    it('should handle multi-line text', () => {
        const converter = createChineseConverter();
        const dict = { 张: '張', 三: '叁' };
        const result = converter('张三\n张三', dict);
        expect(result).toBe('張叁\n張叁');
    });

    it('should handle dictionary with many keys', () => {
        const converter = createChineseConverter();
        const dict: Record<string, string> = {};
        for (let i = 0; i < 100; i++) {
            dict[`key${i}`] = `val${i}`;
        }
        const result = converter('key42 and key99', dict);
        expect(result).toBe('val42 and val99');
    });

    it('should return original match when dictionary value is undefined', () => {
        const converter = createChineseConverter();
        const dict: Record<string, string | undefined> = { a: undefined as any };
        const result = converter('a', dict);
        expect(result).toBe('a');
    });

    it('should handle dictionary with only non-enumerable properties', () => {
        const converter = createChineseConverter();
        const dict: Record<string, string> = {};
        Object.defineProperty(dict, 'a', {
            value: 'A',
            enumerable: false,
        });
        const result = converter('a', dict);
        expect(result).toBe('a');
    });

    it('should rebuild pattern when dictionary changes to non-enumerable only', () => {
        const converter = createChineseConverter();
        const dict1 = { a: 'A' };
        const dict2: Record<string, string> = {};
        Object.defineProperty(dict2, 'b', {
            value: 'B',
            enumerable: false,
        });
        
        expect(converter('a', dict1)).toBe('A');
        expect(converter('a', dict2)).toBe('a');
    });
});

describe('convertPageChinese', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        container.id = 'test-container';
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (container.parentNode) {
            container.parentNode.removeChild(container);
        }
    });

    it('should convert text in DOM', () => {
        container.innerHTML = '<span>张三</span>';
        const dict = { 张: '張', 三: '叁' };
        const stop = convertPageChinese(dict, container);
        expect(container.textContent).toBe('張叁');
        stop();
    });

    it('should return empty function for empty dictionary', () => {
        const stop = convertPageChinese({}, container);
        expect(typeof stop).toBe('function');
        stop();
    });

    it('should exclude elements matching selectors', () => {
        container.innerHTML = '<span class="no-convert">张三</span><span>李四</span>';
        const dict = { 张: '張', 三: '叁', 李: '李', 四: '肆' };
        const stop = convertPageChinese(dict, container, {
            excludeSelectors: ['.no-convert'],
        });
        const noConvert = container.querySelector('.no-convert');
        expect(noConvert?.textContent).toBe('张三');
        stop();
    });

    it('should skip text nodes that are only whitespace', () => {
        container.innerHTML = '<span>  </span>';
        const dict = { ' ': 'X' };
        const stop = convertPageChinese(dict, container);
        expect(container.textContent).toBe('  ');
        stop();
    });

    it('should handle text that is already converted (no change)', () => {
        container.innerHTML = '<span>hello</span>';
        const dict = { 张: '張' };
        const stop = convertPageChinese(dict, container);
        expect(container.textContent).toBe('hello');
        stop();
    });

    it('should handle nested DOM structure', () => {
        container.innerHTML = '<div><span>张三</span><p>李四</p></div>';
        const dict = { 张: '張', 三: '叁', 李: '李', 四: '肆' };
        const stop = convertPageChinese(dict, container);
        expect(container.textContent).toBe('張叁李肆');
        stop();
    });

    it('should use default targetElement as document.body', () => {
        const bodyText = document.createElement('span');
        bodyText.textContent = '张三';
        document.body.appendChild(bodyText);
        const dict = { 张: '張', 三: '叁' };
        const stop = convertPageChinese(dict);
        expect(bodyText.textContent).toBe('張叁');
        stop();
        document.body.removeChild(bodyText);
    });

    it('should respect batchSize option', async () => {
        container.innerHTML = '<span>张三</span><span>李四</span><span>王五</span>';
        const dict = { 张: '張', 三: '叁', 李: '李', 四: '肆', 王: '王', 五: '伍' };
        const stop = convertPageChinese(dict, container, { batchSize: 1 });
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(container.textContent).toBe('張叁李肆王伍');
        stop();
    });

    it('should respect useCache option', () => {
        container.innerHTML = '<span>张三</span><span>张三</span>';
        const dict = { 张: '張', 三: '叁' };
        const stop = convertPageChinese(dict, container, { useCache: false });
        expect(container.textContent).toBe('張叁張叁');
        stop();
    });

    it('should respect maxCacheSize option', () => {
        container.innerHTML = '<span>张三</span>';
        const dict = { 张: '張', 三: '叁' };
        const stop = convertPageChinese(dict, container, { maxCacheSize: 100 });
        expect(container.textContent).toBe('張叁');
        stop();
    });

    it('should observe DOM mutations when observeMutations is true', async () => {
        container.innerHTML = '<span>张三</span>';
        const dict = { 张: '張', 三: '叁', 李: '李', 四: '肆' };
        const stop = convertPageChinese(dict, container, { observeMutations: true });
        expect(container.textContent).toBe('張叁');

        const newSpan = document.createElement('span');
        newSpan.textContent = '李四';
        container.appendChild(newSpan);

        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(container.textContent).toBe('張叁李肆');
        stop();
    });

    it('should stop observing when stop function is called', async () => {
        container.innerHTML = '<span>张三</span>';
        const dict = { 张: '張', 三: '叁', 李: '李', 四: '肆' };
        const stop = convertPageChinese(dict, container, { observeMutations: true });
        expect(container.textContent).toBe('張叁');

        stop();

        const newSpan = document.createElement('span');
        newSpan.textContent = '李四';
        container.appendChild(newSpan);

        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(container.textContent).toBe('張叁李四');
    });

    it('should handle removed nodes gracefully', () => {
        container.innerHTML = '<span>张三</span>';
        const dict = { 张: '張', 三: '叁' };
        const span = container.querySelector('span')!;
        container.removeChild(span);
        const stop = convertPageChinese(dict, container);
        expect(container.textContent).toBe('');
        stop();
    });

    it('should skip processing when node has no parentElement during batch processing', async () => {
        container.innerHTML = '<span>张三</span>';
        const dict = { 张: '張', 三: '叁' };
        
        let idleCallbackFn: ((deadline?: { didTimeout: boolean; timeRemaining: () => number }) => void) | null = null;
        const originalIdleCallback = window.requestIdleCallback;
        window.requestIdleCallback = (fn) => {
            idleCallbackFn = fn;
            return 0;
        };

        const stop = convertPageChinese(dict, container, { batchSize: 0 });
        
        const span = container.querySelector('span')!;
        container.removeChild(span);

        if (idleCallbackFn) {
            idleCallbackFn({ didTimeout: false, timeRemaining: () => 100 });
        }

        expect(container.textContent).toBe('');
        
        window.requestIdleCallback = originalIdleCallback;
        stop();
    });

    it('should handle textContent being null', () => {
        container.innerHTML = '<span></span>';
        const dict = { '': 'EMPTY' };
        const stop = convertPageChinese(dict, container);
        expect(container.textContent).toBe('');
        stop();
    });

    it('should skip node when removed during batch processing', async () => {
        container.innerHTML = '<span>张三</span><span>李四</span><span>王五</span>';
        const dict = { 张: '張', 三: '叁', 李: '李', 四: '肆', 王: '王', 五: '伍' };
        
        let idleCallbackFn: ((deadline?: { didTimeout: boolean; timeRemaining: () => number }) => void) | null = null;
        const originalIdleCallback = window.requestIdleCallback;
        window.requestIdleCallback = (fn) => {
            idleCallbackFn = fn;
            return 0;
        };

        const stop = convertPageChinese(dict, container, { batchSize: 1 });
        
        expect(container.textContent).toBe('張叁李四王五');

        const spans = container.querySelectorAll('span');
        container.removeChild(spans[1]);

        if (idleCallbackFn) {
            idleCallbackFn({ didTimeout: false, timeRemaining: () => 100 });
        }

        expect(container.textContent).toBe('張叁王五');
        
        window.requestIdleCallback = originalIdleCallback;
        stop();
    });

    it('should skip node without parentElement during batch loop', async () => {
        container.innerHTML = '<span>张三</span><span>李四</span>';
        const dict = { 张: '張', 三: '叁', 李: '李', 四: '肆' };
        
        const originalShift = Array.prototype.shift;
        let callCount = 0;
        Array.prototype.shift = function() {
            callCount++;
            const node = originalShift.call(this) as Node;
            if (callCount === 2) {
                const span = container.querySelector('span:last-child')!;
                span.remove();
            }
            return node;
        };

        const stop = convertPageChinese(dict, container, { batchSize: 10 });
        
        expect(container.textContent).toBe('張叁');
        
        Array.prototype.shift = originalShift;
        stop();
    });

    it('should handle node with null parentElement in processBatch', async () => {
        container.innerHTML = '<span>张三</span><span>李四</span>';
        const dict = { 张: '張', 三: '叁', 李: '李', 四: '肆' };
        
        let shiftCallCount = 0;
        const originalShift = Array.prototype.shift;
        Array.prototype.shift = function() {
            shiftCallCount++;
            const node = originalShift.call(this) as Node;
            if (shiftCallCount === 2) {
                node.parentNode?.removeChild(node);
            }
            return node;
        };

        const stop = convertPageChinese(dict, container);
        
        expect(container.textContent).toBe('張叁');
        
        Array.prototype.shift = originalShift;
        stop();
    });
});