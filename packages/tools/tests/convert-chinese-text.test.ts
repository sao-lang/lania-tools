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
        // Access 'a' again to make it most recently used
        converter('a', dict);
        // Add 'c' - should evict 'b' (least recently used)
        converter('c', dict);
        // 'a' should still be cached, 'b' was evicted
        const result = converter('b', dict);
        expect(result).toBe('B');
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
});