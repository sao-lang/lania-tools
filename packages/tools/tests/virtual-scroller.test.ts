import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VirtualScroller } from '../src/virtual-scroller';

describe('VirtualScroller', () => {
    let container: HTMLElement;

    beforeEach(() => {
        vi.useFakeTimers();
        container = document.createElement('div');
        container.id = 'virtual-scroll-container';
        container.style.width = '400px';
        container.style.height = '300px';
        document.body.appendChild(container);
    });

    afterEach(() => {
        vi.useRealTimers();
        if (container.parentNode) {
            container.parentNode.removeChild(container);
        }
    });

    it('should create a VirtualScroller instance', () => {
        const loadMore = vi.fn().mockResolvedValue([]);
        const scroller = new VirtualScroller({
            containerSelector: '#virtual-scroll-container',
            estimatedItemHeight: 50,
            bufferSize: 3,
            loadMoreCallback: loadMore,
        });
        expect(scroller).toBeDefined();
    });

    it('should throw error for invalid container', () => {
        const loadMore = vi.fn();
        expect(() => {
            new VirtualScroller({
                containerSelector: '#nonexistent',
                estimatedItemHeight: 50,
                bufferSize: 3,
                loadMoreCallback: loadMore,
            });
        }).toThrow('VirtualScroller: Container element not found.');
    });

    it('should accept HTMLElement as container', () => {
        const loadMore = vi.fn().mockResolvedValue([]);
        const scroller = new VirtualScroller({
            containerSelector: container,
            estimatedItemHeight: 50,
            bufferSize: 3,
            loadMoreCallback: loadMore,
        });
        expect(scroller).toBeDefined();
    });

    it('should call loadMoreCallback on init', () => {
        const loadMore = vi.fn().mockResolvedValue([]);
        new VirtualScroller({
            containerSelector: '#virtual-scroll-container',
            estimatedItemHeight: 50,
            bufferSize: 3,
            loadMoreCallback: loadMore,
        });
        expect(loadMore).toHaveBeenCalled();
    });

    it('should handle loadMoreCallback returning items', async () => {
        const items = Array.from({ length: 10 }, (_, i) => ({
            id: i,
            text: `Item ${i}`,
        }));
        const loadMore = vi.fn().mockResolvedValue(items);
        new VirtualScroller({
            containerSelector: '#virtual-scroll-container',
            estimatedItemHeight: 50,
            bufferSize: 3,
            loadMoreCallback: loadMore,
        });
        await vi.runAllTimersAsync();
        expect(loadMore).toHaveBeenCalled();
    });

    it('should handle scroll event', async () => {
        const items = Array.from({ length: 50 }, (_, i) => ({
            id: i,
            text: `Item ${i}`,
        }));
        const loadMore = vi.fn().mockResolvedValue(items);
        new VirtualScroller({
            containerSelector: '#virtual-scroll-container',
            estimatedItemHeight: 50,
            bufferSize: 3,
            loadMoreCallback: loadMore,
        });
        await vi.runAllTimersAsync();
        container.scrollTop = 200;
        container.dispatchEvent(new Event('scroll'));
    });

    it('should clear data', async () => {
        const items = [{ id: 1, text: 'Item 1' }];
        const loadMore = vi.fn().mockResolvedValue(items);
        const scroller = new VirtualScroller({
            containerSelector: '#virtual-scroll-container',
            estimatedItemHeight: 50,
            bufferSize: 3,
            loadMoreCallback: loadMore,
        });
        await vi.runAllTimersAsync();
        scroller.clear();
        expect(container.querySelectorAll('[data-id]').length).toBe(0);
    });
});