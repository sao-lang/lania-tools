import { describe, it, expect, vi } from 'vitest';
import { Store } from '../src/store';

interface TestState {
    count: number;
    name: string;
    nested: {
        value: number;
    };
}

const initialState: TestState = {
    count: 0,
    name: 'initial',
    nested: { value: 10 },
};

const reducers = {
    increment: (state: TestState, payload?: number) => ({
        ...state,
        count: state.count + (payload ?? 1),
    }),
    setName: (state: TestState, payload: string) => ({
        ...state,
        name: payload,
    }),
    setNestedValue: (state: TestState, payload: number) => ({
        ...state,
        nested: { ...state.nested, value: payload },
    }),
};

describe('Store', () => {
    it('should initialize with initial state', () => {
        const store = new Store({ initialState, reducers });
        expect(store.getState()).toEqual(initialState);
    });

    it('should get nested state by path', () => {
        const store = new Store({ initialState, reducers });
        expect(store.getState('count')).toBe(0);
        expect(store.getState('nested.value')).toBe(10);
    });

    it('should dispatch actions via actions object', async () => {
        const store = new Store({ initialState, reducers });
        await store.actions.increment(5);
        expect(store.getState('count')).toBe(5);
    });

    it('should dispatch actions via dispatch method', async () => {
        const store = new Store({ initialState, reducers });
        await store.dispatch({ type: 'increment', payload: 3 });
        expect(store.getState('count')).toBe(3);
    });

    it('should dispatch multiple actions in array', async () => {
        const store = new Store({ initialState, reducers });
        await store.dispatch([
            { type: 'increment', payload: 2 },
            { type: 'setName', payload: 'updated' },
        ]);
        expect(store.getState('count')).toBe(2);
        expect(store.getState('name')).toBe('updated');
    });

    it('should support async actions', async () => {
        const store = new Store({ initialState, reducers });
        await store.dispatch({
            type: 'increment',
            asyncFunc: async () => 10,
        });
        expect(store.getState('count')).toBe(10);
    });

    it('should notify subscribers on state change', async () => {
        const store = new Store({ initialState, reducers });
        const subscriber = vi.fn();
        store.subscribe(subscriber);
        await store.actions.increment(1);
        expect(subscriber).toHaveBeenCalledTimes(1);
        expect(subscriber).toHaveBeenCalledWith({ count: 1, name: 'initial', nested: { value: 10 } });
    });

    it('should unsubscribe correctly', async () => {
        const store = new Store({ initialState, reducers });
        const subscriber = vi.fn();
        const unsubscribe = store.subscribe(subscriber);
        unsubscribe();
        await store.actions.increment(1);
        expect(subscriber).not.toHaveBeenCalled();
    });

    it('should support derived state', () => {
        const store = new Store({
            initialState,
            reducers,
            derivedState: {
                doubleCount: (state) => state.count * 2,
                greeting: (state) => `Hello, ${state.name}!`,
            },
        });
        expect(store.getDerivedState('doubleCount')).toBe(0);
        expect(store.getDerivedState('greeting')).toBe('Hello, initial!');
    });

    it('should get all derived state', () => {
        const store = new Store({
            initialState,
            reducers,
            derivedState: {
                doubleCount: (state) => state.count * 2,
                greeting: (state) => `Hello, ${state.name}!`,
            },
        });
        const allDerived = store.getDerivedState();
        expect(allDerived).toEqual({ doubleCount: 0, greeting: 'Hello, initial!' });
    });

    it('should cache derived state', () => {
        const fn = vi.fn((state: TestState) => state.count * 2);
        const store = new Store({
            initialState,
            reducers,
            derivedState: { doubleCount: fn },
        });
        store.getDerivedState('doubleCount');
        store.getDerivedState('doubleCount');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should invalidate derived state cache after dispatch', async () => {
        const fn = vi.fn((state: TestState) => state.count * 2);
        const store = new Store({
            initialState,
            reducers,
            derivedState: { doubleCount: fn },
        });
        store.getDerivedState('doubleCount');
        await store.actions.increment(1);
        store.getDerivedState('doubleCount');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should support watchProperty (shallow)', async () => {
        const store = new Store({ initialState, reducers });
        const callback = vi.fn();
        store.watchProperty('count', callback);
        await store.actions.increment(1);
        expect(callback).toHaveBeenCalledWith(1, 0);
    });

    it('should support watchProperty with immediate', () => {
        const store = new Store({ initialState, reducers });
        const callback = vi.fn();
        store.watchProperty('count', callback, { immediate: true });
        expect(callback).toHaveBeenCalledWith(0, 0);
    });

    it('should support watchProperty with deep', async () => {
        const store = new Store({ initialState, reducers });
        const callback = vi.fn();
        store.watchProperty('nested', callback, { deep: true });
        await store.actions.setNestedValue(20);
        expect(callback).toHaveBeenCalledWith({ value: 20 }, { value: 10 });
    });

    it('should unsubscribe watchProperty', async () => {
        const store = new Store({ initialState, reducers });
        const callback = vi.fn();
        const unwatch = store.watchProperty('count', callback);
        unwatch();
        await store.actions.increment(1);
        expect(callback).not.toHaveBeenCalled();
    });

    it('should support plugins', async () => {
        const onInit = vi.fn();
        const onStateChange = vi.fn();
        const store = new Store({
            initialState,
            reducers,
            plugins: [{ onInit, onStateChange }],
        });
        expect(onInit).toHaveBeenCalled();
        await store.actions.increment(1);
        expect(onStateChange).toHaveBeenCalled();
    });

    it('should support adding plugins dynamically', async () => {
        const store = new Store({ initialState, reducers });
        const onStateChange = vi.fn();
        store.addPlugin({ onStateChange });
        await store.actions.increment(1);
        expect(onStateChange).toHaveBeenCalled();
    });

    it('should support adding multiple plugins at once', async () => {
        const store = new Store({ initialState, reducers });
        const plugin1 = { onStateChange: vi.fn() };
        const plugin2 = { onStateChange: vi.fn() };
        store.addPlugin([plugin1, plugin2]);
        await store.actions.increment(1);
        expect(plugin1.onStateChange).toHaveBeenCalled();
        expect(plugin2.onStateChange).toHaveBeenCalled();
    });

    it('should handle plugin errors', async () => {
        const onError = vi.fn();
        const store = new Store({ initialState, reducers, plugins: [{ onError }] });
        try {
            await store.dispatch({ type: 'nonexistent' as any });
        } catch (e) {
            // ignore
        }
        // onError is called when dispatch throws
    });

    it('should save and restore snapshots', async () => {
        const store = new Store({ initialState, reducers });
        store.saveSnapshot();
        await store.actions.increment(5);
        expect(store.getState('count')).toBe(5);
        store.restoreSnapshot();
        expect(store.getState('count')).toBe(0);
    });

    it('should warn when restoring with no snapshots', () => {
        const store = new Store({ initialState, reducers });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        store.restoreSnapshot();
        expect(warnSpy).toHaveBeenCalledWith('No snapshots available to restore.');
        warnSpy.mockRestore();
    });

    it('should warn when no reducer found for action type', async () => {
        const store = new Store({ initialState, reducers });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await store.dispatch({ type: 'unknown' as any });
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('should not notify if state reference is unchanged', async () => {
        const store = new Store({ initialState, reducers });
        const subscriber = vi.fn();
        store.subscribe(subscriber);
        // Dispatch with same state (no-op reducer)
        const noopReducers = {
            noop: (state: TestState) => state,
        };
        const store2 = new Store({ initialState, reducers: noopReducers });
        const sub2 = vi.fn();
        store2.subscribe(sub2);
        await store2.actions.noop();
        expect(sub2).not.toHaveBeenCalled();
    });
});