import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Carousel } from '../src/carousel';

describe('Carousel', () => {
    let container: HTMLElement;

    beforeEach(() => {
        vi.useFakeTimers();
        container = document.createElement('div');
        container.id = 'carousel-container';
        container.style.width = '500px';
        container.style.height = '300px';
        container.style.overflow = 'hidden';

        for (let i = 0; i < 3; i++) {
            const item = document.createElement('div');
            item.className = 'carousel-item';
            item.textContent = `Item ${i}`;
            container.appendChild(item);
        }

        document.body.appendChild(container);
    });

    afterEach(() => {
        vi.useRealTimers();
        if (container.parentNode) {
            container.parentNode.removeChild(container);
        }
    });

    describe('Slide mode', () => {
        it('should create carousel in slide mode', () => {
            const carousel = new Carousel({
                mode: 'slide',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
            });
            expect(carousel).toBeDefined();
            carousel.destroy();
        });

        it('should throw error for invalid container selector', () => {
            expect(() => {
                new Carousel({
                    mode: 'slide',
                    containerSelector: '#nonexistent',
                    itemSelector: '.item',
                });
            }).toThrow('Carousel container not found');
        });

        it('should throw error for invalid mode', () => {
            expect(() => {
                new Carousel({
                    mode: 'invalid' as any,
                    containerSelector: '#carousel-container',
                    itemSelector: '.carousel-item',
                });
            }).toThrow("Invalid mode specified");
        });

        it('should start and stop autoplay', () => {
            const carousel = new Carousel({
                mode: 'slide',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
                autoplayInterval: 1000,
            });
            carousel.stop();
            carousel.start();
            carousel.destroy();
        });

        it('should handle pause on hover', () => {
            const carousel = new Carousel({
                mode: 'slide',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
                pauseOnHover: true,
            });
            container.dispatchEvent(new MouseEvent('mouseenter'));
            container.dispatchEvent(new MouseEvent('mouseleave'));
            carousel.destroy();
        });

        it('should destroy correctly', () => {
            const carousel = new Carousel({
                mode: 'slide',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
            });
            carousel.destroy();
            expect(container.style.transition).toBe('');
        });

        it('should handle resize', () => {
            const carousel = new Carousel({
                mode: 'slide',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
            });
            window.dispatchEvent(new Event('resize'));
            carousel.destroy();
        });
    });

    describe('Marquee mode', () => {
        it('should create carousel in marquee mode', () => {
            const carousel = new Carousel({
                mode: 'marquee',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
            });
            expect(carousel).toBeDefined();
            carousel.destroy();
        });

        it('should start and stop marquee', () => {
            const carousel = new Carousel({
                mode: 'marquee',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
                autoplayInterval: 1000,
            });
            carousel.stop();
            carousel.start();
            carousel.destroy();
        });

        it('should handle pause on hover in marquee mode', () => {
            const carousel = new Carousel({
                mode: 'marquee',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
                pauseOnHover: true,
            });
            container.dispatchEvent(new MouseEvent('mouseenter'));
            container.dispatchEvent(new MouseEvent('mouseleave'));
            carousel.destroy();
        });

        it('should destroy correctly in marquee mode', () => {
            const carousel = new Carousel({
                mode: 'marquee',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
            });
            carousel.destroy();
            expect(container.style.overflow).toBe('');
        });
    });

    describe('Edge cases', () => {
        it('should warn when no items found', () => {
            const emptyContainer = document.createElement('div');
            emptyContainer.id = 'empty';
            document.body.appendChild(emptyContainer);
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const carousel = new Carousel({
                mode: 'slide',
                containerSelector: '#empty',
                itemSelector: '.nonexistent',
            });
            expect(warnSpy).toHaveBeenCalled();
            carousel.destroy();
            warnSpy.mockRestore();
            document.body.removeChild(emptyContainer);
        });
    });
});