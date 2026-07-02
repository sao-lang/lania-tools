import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Carousel } from '../src/carousel';

describe('Carousel', () => {
    let container: HTMLElement;

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame'] });
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

    describe('Slide mode - Navigation', () => {
        it('should navigate to next slide', () => {
            const wrapper = document.createElement('div');
            wrapper.style.width = '500px';
            wrapper.appendChild(container);
            document.body.appendChild(wrapper);

            vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({
                width: 500,
                height: 300,
                top: 0,
                left: 0,
                bottom: 300,
                right: 500,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            });

            const carousel = new Carousel({
                mode: 'slide',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
                autoplayInterval: 10000,
            });

            carousel.stop();
            (carousel as any).goToSlide(1);

            container.dispatchEvent(new Event('transitionend'));

            expect((carousel as any).currentIndex).toBe(1);
            carousel.destroy();
            document.body.removeChild(wrapper);
        });

        it('should navigate to prev slide', () => {
            const wrapper = document.createElement('div');
            wrapper.style.width = '500px';
            wrapper.appendChild(container);
            document.body.appendChild(wrapper);

            vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({
                width: 500,
                height: 300,
                top: 0,
                left: 0,
                bottom: 300,
                right: 500,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            });

            const carousel = new Carousel({
                mode: 'slide',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
                autoplayInterval: 10000,
            });

            carousel.stop();
            (carousel as any).goToSlide(2);
            container.dispatchEvent(new Event('transitionend'));

            (carousel as any).goToSlide(1);
            container.dispatchEvent(new Event('transitionend'));

            expect((carousel as any).currentIndex).toBe(1);
            carousel.destroy();
            document.body.removeChild(wrapper);
        });

        it('should go to specific slide index', () => {
            const wrapper = document.createElement('div');
            wrapper.style.width = '500px';
            wrapper.appendChild(container);
            document.body.appendChild(wrapper);

            vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({
                width: 500,
                height: 300,
                top: 0,
                left: 0,
                bottom: 300,
                right: 500,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            });

            const carousel = new Carousel({
                mode: 'slide',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
                autoplayInterval: 10000,
            });

            carousel.stop();
            (carousel as any).goToSlide(1);
            container.dispatchEvent(new Event('transitionend'));

            expect((carousel as any).currentIndex).toBe(1);
            carousel.destroy();
            document.body.removeChild(wrapper);
        });

        it('should not navigate when animating', () => {
            const wrapper = document.createElement('div');
            wrapper.style.width = '500px';
            wrapper.appendChild(container);
            document.body.appendChild(wrapper);

            vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({
                width: 500,
                height: 300,
                top: 0,
                left: 0,
                bottom: 300,
                right: 500,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            });

            const carousel = new Carousel({
                mode: 'slide',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
                autoplayInterval: 10000,
            });

            carousel.stop();
            (carousel as any).isAnimating = true;
            const initialIndex = (carousel as any).currentIndex;

            (carousel as any).nextSlide();

            expect((carousel as any).currentIndex).toBe(initialIndex);
            carousel.destroy();
            document.body.removeChild(wrapper);
        });
    });

    describe('Slide mode - Pagination', () => {
        it('should create pagination dots', () => {
            const wrapper = document.createElement('div');
            wrapper.style.width = '500px';
            wrapper.appendChild(container);
            document.body.appendChild(wrapper);

            const paginationContainer = document.createElement('div');
            paginationContainer.id = 'pagination';
            document.body.appendChild(paginationContainer);

            vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({
                width: 500,
                height: 300,
                top: 0,
                left: 0,
                bottom: 300,
                right: 500,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            });

            const carousel = new Carousel({
                mode: 'slide',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
                paginationSelector: '#pagination',
                autoplayInterval: 10000,
            });

            expect(paginationContainer.querySelectorAll('.slide-dot').length).toBe(3);
            carousel.destroy();
            document.body.removeChild(paginationContainer);
            document.body.removeChild(wrapper);
        });

        it('should update pagination active state', () => {
            const wrapper = document.createElement('div');
            wrapper.style.width = '500px';
            wrapper.appendChild(container);
            document.body.appendChild(wrapper);

            const paginationContainer = document.createElement('div');
            paginationContainer.id = 'pagination';
            document.body.appendChild(paginationContainer);

            vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({
                width: 500,
                height: 300,
                top: 0,
                left: 0,
                bottom: 300,
                right: 500,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            });

            const carousel = new Carousel({
                mode: 'slide',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
                paginationSelector: '#pagination',
                autoplayInterval: 10000,
            });

            carousel.stop();
            (carousel as any).goToSlide(1);
            container.dispatchEvent(new Event('transitionend'));

            const dots = paginationContainer.querySelectorAll('.slide-dot');
            expect(dots[0].classList.contains('active')).toBe(false);
            expect(dots[1].classList.contains('active')).toBe(true);
            expect(dots[2].classList.contains('active')).toBe(false);

            carousel.destroy();
            document.body.removeChild(paginationContainer);
            document.body.removeChild(wrapper);
        });

        it('should navigate on pagination dot click', () => {
            const wrapper = document.createElement('div');
            wrapper.style.width = '500px';
            wrapper.appendChild(container);
            document.body.appendChild(wrapper);

            const paginationContainer = document.createElement('div');
            paginationContainer.id = 'pagination';
            document.body.appendChild(paginationContainer);

            vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({
                width: 500,
                height: 300,
                top: 0,
                left: 0,
                bottom: 300,
                right: 500,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            });

            const carousel = new Carousel({
                mode: 'slide',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
                paginationSelector: '#pagination',
                autoplayInterval: 10000,
            });

            carousel.stop();
            const dots = paginationContainer.querySelectorAll('.slide-dot');
            dots[2].click();

            container.dispatchEvent(new Event('transitionend'));

            expect((carousel as any).currentIndex).toBe(2);

            carousel.destroy();
            document.body.removeChild(paginationContainer);
            document.body.removeChild(wrapper);
        });
    });

    describe('Slide mode - Autoplay', () => {
        it('should auto play and trigger next slide', () => {
            const wrapper = document.createElement('div');
            wrapper.style.width = '500px';
            wrapper.appendChild(container);
            document.body.appendChild(wrapper);

            vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({
                width: 500,
                height: 300,
                top: 0,
                left: 0,
                bottom: 300,
                right: 500,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            });

            const carousel = new Carousel({
                mode: 'slide',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
                autoplayInterval: 1000,
            });

            vi.advanceTimersByTime(1000);
            vi.advanceTimersByTime(300);
            container.dispatchEvent(new Event('transitionend'));

            expect((carousel as any).currentIndex).toBe(1);

            carousel.destroy();
            document.body.removeChild(wrapper);
        });

        it('should pause autoplay on hover', () => {
            const wrapper = document.createElement('div');
            wrapper.style.width = '500px';
            wrapper.appendChild(container);
            document.body.appendChild(wrapper);

            vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({
                width: 500,
                height: 300,
                top: 0,
                left: 0,
                bottom: 300,
                right: 500,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            });

            const carousel = new Carousel({
                mode: 'slide',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
                autoplayInterval: 1000,
                pauseOnHover: true,
            });

            container.dispatchEvent(new MouseEvent('mouseenter'));
            vi.advanceTimersByTime(1000);

            expect((carousel as any).currentIndex).toBe(0);

            container.dispatchEvent(new MouseEvent('mouseleave'));
            vi.advanceTimersByTime(1000);
            vi.advanceTimersByTime(300);
            container.dispatchEvent(new Event('transitionend'));

            expect((carousel as any).currentIndex).toBe(1);

            carousel.destroy();
            document.body.removeChild(wrapper);
        });
    });

    describe('Slide mode - Infinite loop', () => {
        it('should loop from last to first slide', () => {
            const wrapper = document.createElement('div');
            wrapper.style.width = '500px';
            wrapper.appendChild(container);
            document.body.appendChild(wrapper);

            vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({
                width: 500,
                height: 300,
                top: 0,
                left: 0,
                bottom: 300,
                right: 500,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            });

            const carousel = new Carousel({
                mode: 'slide',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
                autoplayInterval: 10000,
            });

            carousel.stop();
            (carousel as any).goToSlide(2);
            container.dispatchEvent(new Event('transitionend'));

            expect((carousel as any).currentIndex).toBe(2);

            (carousel as any).nextSlide();
            container.dispatchEvent(new Event('transitionend'));

            expect((carousel as any).currentIndex).toBe(0);

            carousel.destroy();
            document.body.removeChild(wrapper);
        });

        it('should loop from first to last slide', () => {
            const wrapper = document.createElement('div');
            wrapper.style.width = '500px';
            wrapper.appendChild(container);
            document.body.appendChild(wrapper);

            vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({
                width: 500,
                height: 300,
                top: 0,
                left: 0,
                bottom: 300,
                right: 500,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            });

            const carousel = new Carousel({
                mode: 'slide',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
                autoplayInterval: 10000,
            });

            carousel.stop();
            expect((carousel as any).currentIndex).toBe(0);

            (carousel as any).prevSlide();
            container.dispatchEvent(new Event('transitionend'));

            expect((carousel as any).currentIndex).toBe(2);

            carousel.destroy();
            document.body.removeChild(wrapper);
        });
    });

    describe('Marquee mode - Animation', () => {
        it('should start and stop marquee animation', () => {
            vi.spyOn(container.firstElementChild!, 'getBoundingClientRect').mockReturnValue({
                width: 100,
                height: 50,
                top: 0,
                left: 0,
                bottom: 50,
                right: 100,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            });

            const carousel = new Carousel({
                mode: 'marquee',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
                speed: 100,
            });

            expect((carousel as any).animationFrameId).not.toBeNull();

            carousel.stop();

            expect((carousel as any).animationFrameId).toBeNull();

            carousel.destroy();
        });

        it('should reset lastTimestamp on restart', () => {
            vi.spyOn(container.firstElementChild!, 'getBoundingClientRect').mockReturnValue({
                width: 100,
                height: 50,
                top: 0,
                left: 0,
                bottom: 50,
                right: 100,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            });

            const carousel = new Carousel({
                mode: 'marquee',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
                speed: 100,
            });

            carousel.stop();
            expect((carousel as any).lastTimestamp).toBe(0);

            carousel.start();
            expect((carousel as any).animationFrameId).not.toBeNull();

            carousel.destroy();
        });

        it('should calculate offset correctly in marquee animate', () => {
            vi.spyOn(container.firstElementChild!, 'getBoundingClientRect').mockReturnValue({
                width: 100,
                height: 50,
                top: 0,
                left: 0,
                bottom: 50,
                right: 100,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            });

            const carousel = new Carousel({
                mode: 'marquee',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
                speed: 100,
            });

            carousel.stop();

            (carousel as any).marqueeAnimate(100);
            expect((carousel as any).lastTimestamp).toBe(100);

            (carousel as any).marqueeAnimate(200);
            expect((carousel as any).currentOffset).toBe(10);

            (carousel as any).marqueeAnimate(300);
            expect((carousel as any).currentOffset).toBe(20);

            carousel.destroy();
        });

        it('should loop marquee animation when offset exceeds content width', () => {
            vi.spyOn(container.firstElementChild!, 'getBoundingClientRect').mockReturnValue({
                width: 100,
                height: 50,
                top: 0,
                left: 0,
                bottom: 50,
                right: 100,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            });

            const carousel = new Carousel({
                mode: 'marquee',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
                speed: 1000,
            });

            carousel.stop();

            (carousel as any).currentOffset = 200;
            (carousel as any).lastTimestamp = 50;

            (carousel as any).marqueeAnimate(100);
            expect((carousel as any).currentOffset).toBe(250);

            (carousel as any).currentOffset = 350;
            (carousel as any).marqueeAnimate(200);
            expect((carousel as any).currentOffset).toBe(150);

            carousel.destroy();
        });

        it('should apply transform in marquee animate', () => {
            vi.spyOn(container.firstElementChild!, 'getBoundingClientRect').mockReturnValue({
                width: 100,
                height: 50,
                top: 0,
                left: 0,
                bottom: 50,
                right: 100,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            });

            const carousel = new Carousel({
                mode: 'marquee',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
                speed: 100,
            });

            carousel.stop();

            (carousel as any).marqueeAnimate(100);
            (carousel as any).marqueeAnimate(200);

            expect(container.style.transform).toBe('translateX(-10px)');

            carousel.destroy();
        });
    });

    describe('Slide mode - jumpTo', () => {
        it('should jump to specific slide without transition', () => {
            const wrapper = document.createElement('div');
            wrapper.style.width = '500px';
            wrapper.appendChild(container);
            document.body.appendChild(wrapper);

            vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({
                width: 500,
                height: 300,
                top: 0,
                left: 0,
                bottom: 300,
                right: 500,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            });

            const carousel = new Carousel({
                mode: 'slide',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
                autoplayInterval: 10000,
            });

            carousel.stop();
            (carousel as any).jumpTo(2);

            expect((carousel as any).currentIndex).toBe(2);
            expect(container.style.transition).toBe('none');

            carousel.destroy();
            document.body.removeChild(wrapper);
        });

        it('should set transform correctly in jumpTo', () => {
            const wrapper = document.createElement('div');
            wrapper.style.width = '500px';
            wrapper.appendChild(container);
            document.body.appendChild(wrapper);

            vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({
                width: 500,
                height: 300,
                top: 0,
                left: 0,
                bottom: 300,
                right: 500,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            });

            const carousel = new Carousel({
                mode: 'slide',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
                autoplayInterval: 10000,
            });

            carousel.stop();
            (carousel as any).jumpTo(2);

            expect(container.style.transform).toBe('translateX(-1500px)');
            expect((carousel as any).isAnimating).toBe(false);

            carousel.destroy();
            document.body.removeChild(wrapper);
        });

        it('should restore transition after jumpTo via requestAnimationFrame', () => {
            const wrapper = document.createElement('div');
            wrapper.style.width = '500px';
            wrapper.appendChild(container);
            document.body.appendChild(wrapper);

            vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({
                width: 500,
                height: 300,
                top: 0,
                left: 0,
                bottom: 300,
                right: 500,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            });

            const carousel = new Carousel({
                mode: 'slide',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
                autoplayInterval: 10000,
            });

            carousel.stop();
            (carousel as any).jumpTo(1);

            vi.runAllTimers();

            expect(container.style.transition).toBe('transform 300ms ease-in-out');

            carousel.destroy();
            document.body.removeChild(wrapper);
        });
    });

    describe('Slide mode - Boundary conditions', () => {
        it('should not goToSlide when mode is not slide', () => {
            vi.spyOn(container.firstElementChild!, 'getBoundingClientRect').mockReturnValue({
                width: 100,
                height: 50,
                top: 0,
                left: 0,
                bottom: 50,
                right: 100,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            });

            const carousel = new Carousel({
                mode: 'marquee',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
                speed: 100,
            });

            carousel.stop();
            carousel.goToSlide(1);

            expect((carousel as any).isAnimating).toBe(false);

            carousel.destroy();
        });

        it('should not goToSlide when animating', () => {
            const wrapper = document.createElement('div');
            wrapper.style.width = '500px';
            wrapper.appendChild(container);
            document.body.appendChild(wrapper);

            vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({
                width: 500,
                height: 300,
                top: 0,
                left: 0,
                bottom: 300,
                right: 500,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            });

            const carousel = new Carousel({
                mode: 'slide',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
                autoplayInterval: 10000,
            });

            carousel.stop();
            (carousel as any).isAnimating = true;
            carousel.goToSlide(1);

            expect((carousel as any).isAnimating).toBe(true);

            carousel.destroy();
            document.body.removeChild(wrapper);
        });

        it('should not prevSlide when mode is not slide', () => {
            vi.spyOn(container.firstElementChild!, 'getBoundingClientRect').mockReturnValue({
                width: 100,
                height: 50,
                top: 0,
                left: 0,
                bottom: 50,
                right: 100,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            });

            const carousel = new Carousel({
                mode: 'marquee',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
                speed: 100,
            });

            carousel.stop();
            carousel.prevSlide();

            expect((carousel as any).currentIndex).toBe(0);

            carousel.destroy();
        });

        it('should not prevSlide when animating', () => {
            const wrapper = document.createElement('div');
            wrapper.style.width = '500px';
            wrapper.appendChild(container);
            document.body.appendChild(wrapper);

            vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({
                width: 500,
                height: 300,
                top: 0,
                left: 0,
                bottom: 300,
                right: 500,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            });

            const carousel = new Carousel({
                mode: 'slide',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
                autoplayInterval: 10000,
            });

            carousel.stop();
            (carousel as any).isAnimating = true;
            carousel.prevSlide();

            expect((carousel as any).currentIndex).toBe(0);

            carousel.destroy();
            document.body.removeChild(wrapper);
        });

        it('should not startAutoplay when mode is not slide', () => {
            vi.spyOn(container.firstElementChild!, 'getBoundingClientRect').mockReturnValue({
                width: 100,
                height: 50,
                top: 0,
                left: 0,
                bottom: 50,
                right: 100,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            });

            const carousel = new Carousel({
                mode: 'marquee',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
                speed: 100,
            });

            carousel.stop();
            (carousel as any).startAutoplay();

            expect((carousel as any).autoPlayTimer).toBeNull();

            carousel.destroy();
        });

        it('should not startAutoplay when already playing', () => {
            const wrapper = document.createElement('div');
            wrapper.style.width = '500px';
            wrapper.appendChild(container);
            document.body.appendChild(wrapper);

            vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({
                width: 500,
                height: 300,
                top: 0,
                left: 0,
                bottom: 300,
                right: 500,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            });

            const carousel = new Carousel({
                mode: 'slide',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
                autoplayInterval: 1000,
            });

            const originalTimer = (carousel as any).autoPlayTimer;
            (carousel as any).startAutoplay();

            expect((carousel as any).autoPlayTimer).toBe(originalTimer);

            carousel.destroy();
            document.body.removeChild(wrapper);
        });
    });

    describe('Pagination', () => {
        it('should not create pagination when container does not exist', () => {
            const carousel = new Carousel({
                mode: 'slide',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
                paginationContainerSelector: '#nonexistent-pagination',
                autoplayInterval: 10000,
            });

            (carousel as any).createPagination();

            expect((carousel as any).paginationDots).toEqual([]);

            carousel.destroy();
        });
    });

    describe('Resize handling', () => {
        it('should save and restore running state on resize', () => {
            const wrapper = document.createElement('div');
            wrapper.style.width = '500px';
            wrapper.appendChild(container);
            document.body.appendChild(wrapper);

            vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({
                width: 500,
                height: 300,
                top: 0,
                left: 0,
                bottom: 300,
                right: 500,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            });

            const carousel = new Carousel({
                mode: 'slide',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
                autoplayInterval: 1000,
            });

            expect((carousel as any).autoPlayTimer).not.toBeNull();

            (carousel as any).handleResize();

            expect((carousel as any).autoPlayTimer).not.toBeNull();

            carousel.destroy();
            document.body.removeChild(wrapper);
        });

        it('should not restart when not running on resize', () => {
            const wrapper = document.createElement('div');
            wrapper.style.width = '500px';
            wrapper.appendChild(container);
            document.body.appendChild(wrapper);

            vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({
                width: 500,
                height: 300,
                top: 0,
                left: 0,
                bottom: 300,
                right: 500,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            });

            const carousel = new Carousel({
                mode: 'slide',
                containerSelector: '#carousel-container',
                itemSelector: '.carousel-item',
                autoplayInterval: 10000,
            });

            carousel.stop();
            expect((carousel as any).autoPlayTimer).toBeNull();

            (carousel as any).handleResize();

            expect((carousel as any).autoPlayTimer).toBeNull();

            carousel.destroy();
            document.body.removeChild(wrapper);
        });
    });
});