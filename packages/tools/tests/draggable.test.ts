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

    it('should apply boundary limits during touch', () => {
        const draggable = new Draggable(element, {
            enableTouch: true,
            boundary: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
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
            clientX: 200,
            clientY: 200,
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
        expect(element.style.transform).toBe('translate(100px, 100px)');
    });

    it('should trigger onBoundaryHit callback during touch', () => {
        const onBoundaryHit = vi.fn();
        const draggable = new Draggable(element, {
            enableTouch: true,
            boundary: { minX: 0, maxX: 50 },
            onBoundaryHit,
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
            clientX: 100,
            clientY: 0,
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
        expect(onBoundaryHit).toHaveBeenCalled();
    });

    it('should constrain to parent container', () => {
        const parent = document.createElement('div');
        parent.style.width = '300px';
        parent.style.height = '300px';
        parent.style.position = 'relative';
        parent.appendChild(element);
        document.body.appendChild(parent);

        const draggable = new Draggable(element, {
            constrainToParent: true,
        });

        vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
            width: 100,
            height: 100,
            top: 0,
            left: 0,
            bottom: 100,
            right: 100,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        });
        vi.spyOn(parent, 'getBoundingClientRect').mockReturnValue({
            width: 300,
            height: 300,
            top: 0,
            left: 0,
            bottom: 300,
            right: 300,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        });

        draggable.bindEvents();
        element.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, button: 0 }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 500, clientY: 500 }));
        advanceAnimationFrame();
        expect(element.style.transform).toBe('translate(200px, 200px)');

        parent.remove();
    });

    it('should constrain to parent container with partial boundary', () => {
        const parent = document.createElement('div');
        parent.style.width = '300px';
        parent.style.height = '300px';
        parent.style.position = 'relative';
        parent.appendChild(element);
        document.body.appendChild(parent);

        const draggable = new Draggable(element, {
            constrainToParent: true,
            boundary: { maxX: 150 },
        });

        vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
            width: 100,
            height: 100,
            top: 0,
            left: 0,
            bottom: 100,
            right: 100,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        });
        vi.spyOn(parent, 'getBoundingClientRect').mockReturnValue({
            width: 300,
            height: 300,
            top: 0,
            left: 0,
            bottom: 300,
            right: 300,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        });

        draggable.bindEvents();
        element.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, button: 0 }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 500, clientY: 500 }));
        advanceAnimationFrame();
        expect(element.style.transform).toBe('translate(150px, 200px)');

        parent.remove();
    });

    it('should snap when distance is exactly threshold', () => {
        const draggable = new Draggable(element, {
            enableSnap: true,
            snapToGrid: { x: 50, y: 50 },
            snapThreshold: 5,
        });
        draggable.bindEvents();
        element.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, button: 0 }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 55, clientY: 55 }));
        advanceAnimationFrame();
        expect(element.style.transform).toBe('translate(50px, 50px)');
    });

    it('should not snap when distance is exactly over threshold', () => {
        const draggable = new Draggable(element, {
            enableSnap: true,
            snapToGrid: { x: 50, y: 50 },
            snapThreshold: 5,
        });
        draggable.bindEvents();
        element.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, button: 0 }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 56, clientY: 56 }));
        advanceAnimationFrame();
        expect(element.style.transform).toBe('translate(56px, 56px)');
    });

    it('should snap to negative grid positions', () => {
        const draggable = new Draggable(element, {
            enableSnap: true,
            snapToGrid: { x: 50, y: 50 },
            snapThreshold: 100,
        });
        draggable.bindEvents();
        element.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, button: 0 }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: -48, clientY: -48 }));
        advanceAnimationFrame();
        expect(element.style.transform).toBe('translate(-50px, -50px)');
    });

    it('should not apply snap when enableSnap is false', () => {
        const draggable = new Draggable(element, {
            enableSnap: false,
            snapToGrid: { x: 50, y: 50 },
            snapThreshold: 100,
        });
        draggable.bindEvents();
        element.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, button: 0 }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 27, clientY: 27 }));
        advanceAnimationFrame();
        expect(element.style.transform).toBe('translate(27px, 27px)');
    });

    it('should not apply snap when snapToGrid is null', () => {
        const draggable = new Draggable(element, {
            enableSnap: true,
            snapToGrid: null,
            snapThreshold: 100,
        });
        draggable.bindEvents();
        element.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, button: 0 }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 27, clientY: 27 }));
        advanceAnimationFrame();
        expect(element.style.transform).toBe('translate(27px, 27px)');
    });

    it('should disable animation by default', () => {
        const draggable = new Draggable(element);
        expect(element.style.transition).toBe('');
    });

    it('should clear animation on destroy', () => {
        const draggable = new Draggable(element, { enableAnimation: true });
        draggable.bindEvents();
        expect(element.style.transition).toBe('transform 0.15s ease');
        draggable.destroy();
        expect(element.style.transition).toBe('');
    });

    it('should reset boundary hit status when moving within boundary', () => {
        const onBoundaryHit = vi.fn();
        const draggable = new Draggable(element, {
            boundary: { minX: 0, maxX: 100 },
            onBoundaryHit,
        });
        draggable.bindEvents();

        element.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, button: 0 }));

        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 0 }));
        advanceAnimationFrame();
        expect(onBoundaryHit).toHaveBeenCalledTimes(1);

        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 150, clientY: 0 }));
        advanceAnimationFrame();
        expect(onBoundaryHit).toHaveBeenCalledTimes(1);

        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 0 }));
        advanceAnimationFrame();

        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 0 }));
        advanceAnimationFrame();
        expect(onBoundaryHit).toHaveBeenCalledTimes(2);
    });

    it('should not trigger touchmove when not dragging', () => {
        const onDrag = vi.fn();
        const draggable = new Draggable(element, {
            enableTouch: true,
            onDrag,
        });
        draggable.bindEvents();
        const touch = new Touch({
            identifier: 1,
            target: element,
            clientX: 50,
            clientY: 50,
        });
        document.dispatchEvent(new TouchEvent('touchmove', {
            touches: [touch],
            cancelable: true,
        }));
        advanceAnimationFrame();
        expect(onDrag).not.toHaveBeenCalled();
    });

    it('should not trigger touchend when not dragging', () => {
        const onDragEnd = vi.fn();
        const draggable = new Draggable(element, {
            enableTouch: true,
            onDragEnd,
        });
        draggable.bindEvents();
        document.dispatchEvent(new TouchEvent('touchend', {}));
        expect(onDragEnd).not.toHaveBeenCalled();
    });
});