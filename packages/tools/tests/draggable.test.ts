import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Draggable } from '../src/draggable';

class MockTouch {
    identifier: number;
    target: EventTarget;
    clientX: number;
    clientY: number;
    pageX: number;
    pageY: number;

    constructor(init: TouchInit) {
        this.identifier = init.identifier;
        this.target = init.target!;
        this.clientX = init.clientX || 0;
        this.clientY = init.clientY || 0;
        this.pageX = init.pageX || this.clientX;
        this.pageY = init.pageY || this.clientY;
    }
}

(globalThis as any).Touch = MockTouch;

function advanceAnimationFrame() {
    vi.advanceTimersByTime(16);
}

describe('Draggable', () => {
    let element: HTMLElement;

    beforeEach(() => {
        vi.useFakeTimers();
        element = document.createElement('div');
        element.style.width = '100px';
        element.style.height = '100px';
        document.body.appendChild(element);
    });

    afterEach(() => {
        vi.useRealTimers();
        if (element.parentNode) {
            element.parentNode.removeChild(element);
        }
    });

    it('should create a Draggable instance', () => {
        const draggable = new Draggable(element);
        expect(draggable).toBeDefined();
    });

    it('should set initial position', () => {
        const draggable = new Draggable(element, {
            initialPosition: { x: 50, y: 100 },
        });
        expect(element.style.transform).toBe('translate(50px, 100px)');
    });

    it('should set position to 0,0 by default', () => {
        const draggable = new Draggable(element);
        expect(element.style.transform).toBe('translate(0px, 0px)');
    });

    it('should set position via setPosition', () => {
        const draggable = new Draggable(element);
        draggable.setPosition(30, 40);
        expect(element.style.transform).toBe('translate(30px, 40px)');
    });

    it('should set position to relative if static', () => {
        element.style.position = 'static';
        const draggable = new Draggable(element);
        expect(element.style.position).toBe('relative');
    });

    it('should enable animation', () => {
        const draggable = new Draggable(element, { enableAnimation: true });
        expect(element.style.transition).toBe('transform 0.15s ease');
    });

    it('should bind and unbind events', () => {
        const draggable = new Draggable(element);
        draggable.bindEvents();
        draggable.unbindEvents();
    });

    it('should destroy properly', () => {
        const draggable = new Draggable(element);
        draggable.bindEvents();
        draggable.destroy();
        expect(element.style.transition).toBe('');
        expect(element.style.cursor).toBe('');
    });

    it('should trigger onDragStart callback on mousedown', () => {
        const onDragStart = vi.fn();
        const draggable = new Draggable(element, { onDragStart });
        draggable.bindEvents();
        element.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, button: 0 }));
        expect(onDragStart).toHaveBeenCalledWith({
            type: 'dragstart',
            x: 0,
            y: 0,
        });
    });

    it('should not trigger dragstart on right click', () => {
        const onDragStart = vi.fn();
        const draggable = new Draggable(element, { onDragStart });
        draggable.bindEvents();
        element.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, button: 2 }));
        expect(onDragStart).not.toHaveBeenCalled();
    });

    it('should trigger onDrag callback on mousemove', () => {
        const onDrag = vi.fn();
        const draggable = new Draggable(element, { onDrag });
        draggable.bindEvents();
        element.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, button: 0 }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 50 }));
        advanceAnimationFrame();
        expect(onDrag).toHaveBeenCalled();
    });

    it('should trigger onDragEnd callback on mouseup', () => {
        const onDragEnd = vi.fn();
        const draggable = new Draggable(element, { onDragEnd });
        draggable.bindEvents();
        element.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, button: 0 }));
        document.dispatchEvent(new MouseEvent('mouseup', {}));
        expect(onDragEnd).toHaveBeenCalledWith({
            type: 'dragend',
            x: 0,
            y: 0,
        });
    });

    it('should apply boundary limits', () => {
        const draggable = new Draggable(element, {
            boundary: { minX: 0, maxX: 200, minY: 0, maxY: 200 },
        });
        draggable.bindEvents();
        element.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, button: 0 }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 500, clientY: 500 }));
        advanceAnimationFrame();
        expect(element.style.transform).toBe('translate(200px, 200px)');
    });

    it('should trigger onBoundaryHit callback', () => {
        const onBoundaryHit = vi.fn();
        const draggable = new Draggable(element, {
            boundary: { minX: 0, maxX: 100 },
            onBoundaryHit,
        });
        draggable.bindEvents();
        element.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, button: 0 }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 50 }));
        advanceAnimationFrame();
        expect(onBoundaryHit).toHaveBeenCalled();
    });

    it('should apply snap to grid', () => {
        const draggable = new Draggable(element, {
            enableSnap: true,
            snapToGrid: { x: 50, y: 50 },
            snapThreshold: 100,
        });
        draggable.bindEvents();
        element.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, button: 0 }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 52, clientY: 48 }));
        advanceAnimationFrame();
        expect(element.style.transform).toBe('translate(50px, 50px)');
    });

    it('should not snap when distance exceeds threshold', () => {
        const draggable = new Draggable(element, {
            enableSnap: true,
            snapToGrid: { x: 50, y: 50 },
            snapThreshold: 5,
        });
        draggable.bindEvents();
        element.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, button: 0 }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 30, clientY: 30 }));
        advanceAnimationFrame();
        expect(element.style.transform).toBe('translate(30px, 30px)');
    });

    it('should handle touch events', () => {
        const onDragStart = vi.fn();
        const draggable = new Draggable(element, {
            enableTouch: true,
            onDragStart,
        });
        draggable.bindEvents();
        const touch = new Touch({
            identifier: 1,
            target: element,
            clientX: 100,
            clientY: 200,
        });
        element.dispatchEvent(new TouchEvent('touchstart', {
            touches: [touch],
            cancelable: true,
        }));
        expect(onDragStart).toHaveBeenCalled();
    });

    it('should handle touch move', () => {
        const onDrag = vi.fn();
        const draggable = new Draggable(element, {
            enableTouch: true,
            onDrag,
        });
        draggable.bindEvents();
        const touch1 = new Touch({
            identifier: 1,
            target: element,
            clientX: 0,
            clientY: 0,
        });
        const touch2 = new Touch({
            identifier: 1,
            target: element,
            clientX: 50,
            clientY: 50,
        });
        element.dispatchEvent(new TouchEvent('touchstart', {
            touches: [touch1],
            cancelable: true,
        }));
        document.dispatchEvent(new TouchEvent('touchmove', {
            touches: [touch2],
            cancelable: true,
        }));
        advanceAnimationFrame();
        expect(onDrag).toHaveBeenCalled();
    });

    it('should handle touch end', () => {
        const onDragEnd = vi.fn();
        const draggable = new Draggable(element, {
            enableTouch: true,
            onDragEnd,
        });
        draggable.bindEvents();
        const touch = new Touch({
            identifier: 1,
            target: element,
            clientX: 0,
            clientY: 0,
        });
        element.dispatchEvent(new TouchEvent('touchstart', {
            touches: [touch],
            cancelable: true,
        }));
        document.dispatchEvent(new TouchEvent('touchend', {}));
        expect(onDragEnd).toHaveBeenCalled();
    });
});