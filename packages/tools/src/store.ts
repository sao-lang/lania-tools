import { deepClone } from './tools';

type ActionType = string;

export interface AsyncAction {
    type: ActionType;
    payload?: any;
    asyncFunc?: (state: any) => Promise<any>;
}

export type StorePlugin<
    S extends Record<string, any> = any,
    D extends Record<string, any> = any,
> = {
    onInit?: (store: Store<S, D>) => void;
    onStateChange?: (store: Store<S, D>, newState: S, oldState: S) => void;
    onError?: (store: Store<S, D>, error: Error) => void;
};

export type PathType<T, P extends string> = P extends `${infer Key}.${infer Rest}`
    ? Key extends keyof T
        ? PathType<T[Key], Rest>
        : never
    : P extends keyof T
      ? T[P]
      : never;

export type FromPathType<P extends string, S, K> = P extends '' ? S : PathType<K, P>;

// 每个派生状态键的值是一个接受状态并返回某个值的函数
type DerivedState<S, D> = {
    [K in keyof D]: (state: S) => D[K];
};

// 获取某个派生状态值的类型
type GetDerivedStateValue<S, D, K extends keyof D> = ReturnType<DerivedState<S, D>[K]>;

// 如果 path 存在，则返回对应的值类型；如果 path 不存在，则返回整个派生状态对象
type GetDerivedStateType<S, D, P extends keyof D | ''> = P extends keyof D
    ? GetDerivedStateValue<S, D, P>
    : P extends ''
      ? { [K in keyof D]: GetDerivedStateValue<S, D, K> }
      : never;

export class Store<S extends Record<string, any>, D extends Record<string, any>> {
    private state: S;
    private reducers?: Record<ActionType, (state: S, payload?: any) => S>;
    private plugins: StorePlugin<S>[];
    private subscribers: Set<(state: S) => void>;
    private watchedProperties: Map<
        string,
        {
            callback: (newValue: any, oldValue: any) => void;
            options: { immediate: boolean; deep: boolean };
            value: any;
        }[]
    >;
    private derivedState: DerivedState<S, D>;
    private snapshots: S[] = [];

    constructor({
        initialState,
        reducers,
        derivedState = {} as DerivedState<S, D>,
        plugins = [],
    }: {
        initialState: S;
        reducers?: Record<ActionType, (state: S, payload?: any) => S>;
        derivedState?: DerivedState<S, D>;
        plugins?: StorePlugin<S>[];
    }) {
        this.state = initialState;
        this.reducers = reducers;
        this.derivedState = derivedState;
        this.plugins = plugins;
        this.subscribers = new Set();
        this.watchedProperties = new Map();
        this.initializePlugins();
    }

    public getState<P extends string = ''>(path?: P): FromPathType<P, S, S> {
        return path
            ? (this.getNestedValue(this.state, path) as PathType<S, P>)
            : (this.state as any);
    }

    public getDerivedState<P extends keyof D | '' = ''>(path?: P): GetDerivedStateType<S, D, P> {
        if (!path) {
            // 如果没有 path，则返回整个 derivedState 对象
            return Object.fromEntries(
                Object.entries(this.derivedState).map(([key, func]) => [key, func(this.state)]),
            ) as { [K in keyof D]: GetDerivedStateValue<S, D, K> } as any;
        }
        // eslint-disable-next-line no-prototype-builtins
        if (!this.derivedState.hasOwnProperty(path)) {
            return undefined as never;
        }
        const func = this.derivedState[path];
        return func(this.state) as GetDerivedStateType<S, D, typeof path>;
    }

    public async dispatch(actionOrActions: AsyncAction | AsyncAction[]): Promise<void> {
        try {
            const actions = Array.isArray(actionOrActions) ? actionOrActions : [actionOrActions];
            const oldState = { ...this.state };
            for (const action of actions) {
                if (action.asyncFunc) {
                    action.payload = await action.asyncFunc(this.state);
                }
                const reducer = this.reducers?.[action.type];
                if (!reducer) {
                    console.warn(`No reducer found for action type: ${action.type}`);
                    continue;
                }
                this.state = reducer(this.state, action.payload);
            }
            this.notifyWatchers(this.state);
            this.subscribers.forEach((subscriber) => subscriber(this.state));
            this.plugins.forEach((plugin) => plugin.onStateChange?.(this, this.state, oldState));
        } catch (e) {
            this.plugins.forEach((plugin) => {
                plugin?.onError?.(this, e as Error);
            });
            throw e;
        }
    }

    private notifyWatchers(newState: S): void {
        this.watchedProperties.forEach((watchList, path) => {
            const newValue = this.getNestedValue(newState, path);
            watchList.forEach((data) => {
                if (newValue !== data.value) {
                    data.callback(newValue, data.value);
                    data.value = newValue;
                }
            });
        });
    }

    public addPlugin(plugin: StorePlugin<S> | StorePlugin<S>[]): void {
        const plugins = Array.isArray(plugin) ? plugin : [plugin];
        plugins.forEach((plugin) => {
            plugin?.onInit?.(this);
        });
        this.plugins.push(...(Array.isArray(plugin) ? plugin : [plugin]));
    }

    private initializePlugins(): void {
        this.plugins.forEach((plugin) => plugin.onInit?.(this));
    }

    public subscribe(subscriber: (state: S) => void): () => void {
        this.subscribers.add(subscriber);
        return () => this.subscribers.delete(subscriber);
    }

    public watchProperty<P extends string>(
        path: P,
        callback: (newValue: FromPathType<P, S, S>, oldValue: FromPathType<P, S, S>) => void,
        options: { immediate?: boolean; deep?: boolean } = {},
    ): () => void {
        const { immediate = false, deep = false } = options;
        const initialValue = this.getNestedValue(this.state, path);
        const watchList = this.watchedProperties.get(path) || [];
        // 添加新监听到 watchList 中
        watchList.push({ callback, options: { immediate, deep }, value: initialValue });
        this.watchedProperties.set(path, watchList);

        deep && this.applyDeepProxy(path, initialValue);
        immediate && callback(initialValue, initialValue);

        // 返回一个函数用于解除监听
        return () => {
            const updatedWatchList = this.watchedProperties
                .get(path)
                ?.filter((item) => item.callback !== callback);
            if (updatedWatchList && updatedWatchList.length > 0) {
                this.watchedProperties.set(path, updatedWatchList);
            } else {
                this.watchedProperties.delete(path);
            }
        };
    }

    private applyDeepProxy(path: string, obj: any): void {
        const handler = {
            set: (target: any, prop: string | symbol, value: any): boolean => {
                const oldValue = target[prop];
                if (oldValue !== value) {
                    target[prop] = value;
                    const fullPath = `${path}.${String(prop)}`;
                    const watchData = this.watchedProperties.get(fullPath);
                    if (watchData) {
                        watchData.forEach((data) => {
                            data.callback(value, oldValue);
                        });
                        this.notifyWatchers(this.state);
                    }
                    if (typeof value === 'object' && value !== null) {
                        this.applyDeepProxy(fullPath, value);
                    }
                }
                return true;
            },
        };

        // 为对象的每个子对象应用代理
        Object.keys(obj).forEach((key) => {
            if (typeof obj[key] === 'object' && obj[key] !== null) {
                obj[key] = new Proxy(obj[key], handler);
            }
        });

        this.state = new Proxy(this.state, handler);
    }

    private getNestedValue(obj: any, path: string): any {
        return path.split('.').reduce((o, p) => o && o[p], obj);
    }

    // 状态快照和恢复功能
    public saveSnapshot(): void {
        this.snapshots.push(deepClone(this.state));
    }

    public restoreSnapshot(): void {
        if (this.snapshots.length > 0) {
            this.state = this.snapshots.pop()!;
            this.notifyWatchers(this.state);
            this.subscribers.forEach((subscriber) => subscriber(this.state));
        } else {
            console.warn('No snapshots available to restore.');
        }
    }
}

export default Store;
