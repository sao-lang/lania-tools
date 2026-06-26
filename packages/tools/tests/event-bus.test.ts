import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../src/event-bus';

describe('EventBus', () => {
    it('should register and trigger an event', async () => {
        const bus = new EventBus();
        const handler = vi.fn();
        bus.on('test', handler);
        await bus.emit('test', { data: 'hello' });
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith({ data: 'hello' }, {});
    });

    it('should handle multiple handlers for the same event', async () => {
        const bus = new EventBus();
        const handler1 = vi.fn();
        const handler2 = vi.fn();
        bus.on('test', handler1);
        bus.on('test', handler2);
        await bus.emit('test');
        expect(handler1).toHaveBeenCalledTimes(1);
        expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should handle events by priority', async () => {
        const bus = new EventBus();
        const order: string[] = [];
        bus.on('test', () => order.push('low'), { priority: 0 });
        bus.on('test', () => order.push('high'), { priority: 10 });
        bus.on('test', () => order.push('mid'), { priority: 5 });
        await bus.emit('test');
        expect(order).toEqual(['high', 'mid', 'low']);
    });

    it('should support once events', async () => {
        const bus = new EventBus();
        const handler = vi.fn();
        bus.on('test', handler, { once: true });
        await bus.emit('test');
        await bus.emit('test');
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should support async event handlers', async () => {
        const bus = new EventBus();
        let resolved = false;
        const handler = async () => {
            await new Promise((r) => setTimeout(r, 10));
            resolved = true;
        };
        bus.on('test', handler);
        await bus.emit('test');
        expect(resolved).toBe(true);
    });

    it('should remove event handler with off', async () => {
        const bus = new EventBus();
        const handler = vi.fn();
        bus.on('test', handler);
        bus.off('test', handler);
        await bus.emit('test');
        expect(handler).not.toHaveBeenCalled();
    });

    it('should support namespaces', async () => {
        const bus = new EventBus();
        bus.registerNamespace('ns1');
        const handler = vi.fn();
        bus.on('test', handler, { namespace: 'ns1' });
        await bus.emit('test', undefined, { namespace: 'ns1' });
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should throw error for unregistered namespace in on', () => {
        const bus = new EventBus();
        expect(() => bus.on('test', vi.fn(), { namespace: 'unknown' })).toThrow(
            'Namespace unknown is not registered',
        );
    });

    it('should throw error for unregistered namespace in emit', async () => {
        const bus = new EventBus();
        await expect(
            bus.emit('test', undefined, { namespace: 'unknown' }),
        ).rejects.toThrow('Namespace unknown is not registered');
    });

    it('should track event count', async () => {
        const bus = new EventBus();
        bus.on('test', vi.fn());
        await bus.emit('test');
        await bus.emit('test');
        expect(bus.getEventCount('global', 'test')).toBe(2);
    });

    it('should emit batch events', async () => {
        const bus = new EventBus();
        const handler1 = vi.fn();
        const handler2 = vi.fn();
        bus.on('event1', handler1);
        bus.on('event2', handler2);
        await bus.emitBatch([
            { event: 'event1', data: 'a' },
            { event: 'event2', data: 'b' },
        ]);
        expect(handler1).toHaveBeenCalledWith('a', {});
        expect(handler2).toHaveBeenCalledWith('b', {});
    });

    it('should clear all events', async () => {
        const bus = new EventBus();
        const handler = vi.fn();
        bus.on('test', handler);
        bus.clear();
        await bus.emit('test');
        expect(handler).not.toHaveBeenCalled();
        expect(bus.getEventCount('global', 'test')).toBe(0);
    });

    it('should handle errors in event handlers gracefully', async () => {
        const bus = new EventBus();
        const errorHandler = () => {
            throw new Error('Handler error');
        };
        const normalHandler = vi.fn();
        bus.on('test', errorHandler);
        bus.on('test', normalHandler);
        await bus.emit('test');
        expect(normalHandler).toHaveBeenCalledTimes(1);
    });

    it('should emit event without data', async () => {
        const bus = new EventBus();
        const handler = vi.fn();
        bus.on('test', handler);
        await bus.emit('test');
        expect(handler).toHaveBeenCalledWith(undefined, {});
    });
});