import { deepClone, isDeepEqual } from './tools';

/**
 * 异步或同步动作对象。
 * - 可用于 dispatch 时携带 type、payload 或 asyncFunc。
 * - 如果 asyncFunc 存在，会先执行 asyncFunc(state) 得到 payload。
 *
 * @template R - Reducers 映射类型，用于约束 type 的取值范围。
 */
export interface AsyncAction<R extends Record<string, any> = any> {
    /** 动作类型，必须是 reducers 的 key */
    type: keyof R;
    /** 动作参数 */
    payload?: any;
    /**
     * 可选的异步函数，用于生成 payload。
     * 若存在，会在 reducer 执行前被 await。
     */
    asyncFunc?: (state: any) => Promise<any>;
}

/**
 * Store 插件接口。
 * 插件可以注册生命周期钩子，用于监听 Store 的各种事件。
 */
export type StorePlugin<
    S extends Record<string, any> = any,
    D extends Record<string, any> = any,
> = {
    /**
     * Store 初始化时触发的钩子。
     * @param store - 当前 Store 实例
     */
    onInit?: (store: Store<S, D, any>) => void;

    /**
     * 每次状态变更都会触发。
     * @param store - 当前 Store 实例
     * @param newState - 更新后的状态
     * @param oldState - 更新前的状态
     */
    onStateChange?: (store: Store<S, D, any>, newState: S, oldState: S) => void;

    /**
     * dispatch 过程中出现异常时触发。
     * @param error - 错误对象
     */
    onError?: (store: Store<S, D, any>, error: Error) => void;
};

/**
 * 支持通过字符串路径获取嵌套对象的属性类型。
 *
 * 示例:
 * type A = { x: { y: number } }
 * PathType<A, "x.y"> => number
 */
export type PathType<T, P extends string> = P extends `${infer Key}.${infer Rest}`
    ? Key extends keyof T
        ? PathType<T[Key], Rest>
        : never
    : P extends keyof T
      ? T[P]
      : never;

/**
 * 允许空路径时返回整个对象类型。
 */
export type FromPathType<P extends string, S, K> = P extends '' ? S : PathType<K, P>;

/**
 * 派生状态：每个字段是一个函数，接收 state，返回一个值。
 * 类似于 Vue 的 computed、Redux 的 selector。
 */
type DerivedState<S, D> = {
    [K in keyof D]: (state: S) => D[K];
};

/** 获取派生状态函数的返回值类型 */
type GetDerivedStateValue<S, D, K extends keyof D> = ReturnType<DerivedState<S, D>[K]>;

/**
 * 获取派生状态的值类型：
 * - 如果传入 key，返回对应派生值类型
 * - 如果 path=''，返回整个派生对象
 */
type GetDerivedStateType<S, D, P extends keyof D | ''> = P extends keyof D
    ? GetDerivedStateValue<S, D, P>
    : P extends ''
      ? { [K in keyof D]: GetDerivedStateValue<S, D, K> }
      : never;

/** Reducer 映射类型：key → reducer 函数 */
type ReducersMap<S> = Record<string, (state: S, payload?: any) => S>;

/** 提取 reducer 的 payload 类型 */
type ReducerPayload<F> = F extends (state: any, payload: infer P) => any ? P : undefined;

/**
 * 自动从 reducers 映射出 actions：
 * - 每个 action 是一个函数
 * - 调用后会 dispatch 对应 reducer
 */
export type ActionsFromReducers<S, R extends ReducersMap<S>> = {
    [K in keyof R]: (payload: ReducerPayload<R[K]>) => Promise<void>;
};

/** Dispatch 类型定义（类型安全的 Action） */
type DispatchFromReducers<S, R extends ReducersMap<S>> = <K extends keyof R>(action: {
    type: K;
    payload: ReducerPayload<R[K]>;
}) => Promise<void>;

/**
 * Store 类
 * - 管理全局状态
 * - 支持订阅、watch、插件、中间件
 * - 提供 actions、dispatch、derivedState
 *
 * @template S - State 类型
 * @template D - DerivedState 类型
 * @template R - Reducers 类型
 */
export class Store<
    S extends Record<string, any>,
    D extends Record<string, any>,
    R extends ReducersMap<S> = ReducersMap<S>,
> {
    private state: S;
    private reducers: R;
    private plugins: StorePlugin<S>[];
    private subscribers: Set<(state: S) => void>;

    // 状态监听器集合：移除 deep 代理相关的复杂性
    private watchedProperties: Map<
        string,
        {
            callback: (newValue: any, oldValue: any) => void;
            options: { immediate: boolean; deep: boolean };
            value: any; // 存储上一次的值
        }[]
    >;

    private derivedState: DerivedState<S, D>;
    private snapshots: S[] = [];

    // --- 新增：派生状态缓存字段 ---
    private derivedStateCache: {
        value: D | null;
        lastStateReference: S | null;
    } = { value: null, lastStateReference: null };

    public actions: ActionsFromReducers<S, R>;
    public dispatch: DispatchFromReducers<S, R>;

    /**
     * @param initialState - 初始的state。
     * @param reducers - 状态派发器。
     * @param derivedState - 衍生状态。
     * @param plugins - 插件。
     */
    constructor({
        initialState,
        reducers,
        derivedState = {} as DerivedState<S, D>,
        plugins = [],
    }: {
        initialState: S;
        reducers: R;
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

        /** 改造后的 dispatch：更清晰地处理状态更新和通知 */
        this.dispatch = async (action: any) => {
            try {
                const actions = Array.isArray(action) ? action : [action];
                const oldState = this.state; // 引用旧状态

                let newState = this.state; // 使用一个临时变量来累积更新

                for (const act of actions) {
                    // 1. 执行异步函数（若存在）
                    if (act.asyncFunc) {
                        // 注意：asyncFunc 传入的是当前累积的状态
                        act.payload = await act.asyncFunc(newState);
                    }

                    // 2. 执行 reducer
                    const reducer = this.reducers?.[act.type];
                    if (!reducer) {
                        console.warn(`No reducer found for action type: ${act.type}`);
                        continue;
                    }

                    // 累积状态更新
                    newState = reducer(newState, act.payload);
                }

                // 如果状态引用未改变，则不进行后续通知（仅针对严格不可变数据）
                if (newState === oldState) {
                    return;
                }

                // 最终更新状态
                this.state = newState;

                // 3. 通知 Watchers 和 Subscribers
                this.notifyWatchers(this.state);
                this.subscribers.forEach((subscriber) => subscriber(this.state));

                // 4. 插件 onStateChange
                this.plugins.forEach((plugin) =>
                    plugin.onStateChange?.(this, this.state, oldState),
                );

                // 5. 清除 derivedState 缓存，强制下次重新计算
                this.derivedStateCache.value = null;
            } catch (e) {
                this.plugins.forEach((plugin) => plugin?.onError?.(this, e as Error));
                throw e;
            }
        };

        /** 自动根据 reducers 生成 actions */
        this.actions = {} as ActionsFromReducers<S, R>;
        (Object.keys(reducers) as (keyof R)[]).forEach((type) => {
            this.actions[type] = this.createAction(type);
        });
    }

    private createAction<K extends keyof R>(
        type: K,
    ): (payload: ReducerPayload<R[K]>) => Promise<void> {
        return (payload) => this.dispatch({ type, payload } as any);
    }

    /**
     * @description 获取state
     * @param path 匹配state的嵌套的key，类似a.b.c，不传返回整个派生状态对象。
     */
    public getState<P extends string = ''>(path?: P): FromPathType<P, S, S> {
        return path
            ? (this.getNestedValue(this.state, path) as PathType<S, P>)
            : (this.state as any);
    }

    /**
     * @description 获取衍生状态
     * @param path - 匹配derivedState的嵌套的key，类似a.b.c，不传返回整个派生状态对象。
     */
    public getDerivedState<P extends keyof D | '' = ''>(path?: P): GetDerivedStateType<S, D, P> {
        const { value, lastStateReference } = this.derivedStateCache;

        // 检查缓存是否有效：如果 state 引用未变，则使用缓存
        if (value && lastStateReference === this.state) {
            if (!path) return value as any;
            // eslint-disable-next-line no-prototype-builtins
            return value.hasOwnProperty(path) ? value[path] : (undefined as never);
        }

        // 缓存失效或首次访问，重新计算所有派生状态
        const calculatedDerivedState = Object.fromEntries(
            Object.entries(this.derivedState).map(([key, func]) => [key, func(this.state)]),
        ) as D;

        // 更新缓存
        this.derivedStateCache.value = calculatedDerivedState;
        this.derivedStateCache.lastStateReference = this.state;

        if (!path) {
            return calculatedDerivedState as any;
        }

        // eslint-disable-next-line no-prototype-builtins
        if (!calculatedDerivedState.hasOwnProperty(path)) return undefined as never;
        return calculatedDerivedState[path] as any;
    }

    /**
     * @description 添加中间件
     * @param plugin 要添加的中间件
     */
    public addPlugin(plugin: StorePlugin<S> | StorePlugin<S>[]): void {
        const plugins = Array.isArray(plugin) ? plugin : [plugin];
        plugins.forEach((plugin) => plugin?.onInit?.(this));
        this.plugins.push(...plugins);
    }

    private initializePlugins(): void {
        this.plugins.forEach((plugin) => plugin.onInit?.(this));
    }

    /**
     * @description 订阅属性变化
     * @param subscriber 订阅的回调，有state改变时都会执行
     */
    public subscribe(subscriber: (state: S) => void): () => void {
        this.subscribers.add(subscriber);
        return () => this.subscribers.delete(subscriber);
    }

    /**
     * @description 监听变化
     * @param path 匹配state的嵌套的key，类似a.b.c，不传返回整个派生状态对象。
     * @param callback 监听的回调。
     * @param options 配置，immediate 立即响应修改， deep 监听嵌套对象内部值的修改
     */
    public watchProperty<P extends string>(
        path: P,
        callback: (newValue: FromPathType<P, S, S>, oldValue: FromPathType<P, S, S>) => void,
        options: { immediate?: boolean; deep?: boolean } = {},
    ): () => void {
        const { immediate = false, deep = false } = options;
        const initialValue = this.getNestedValue(this.state, path);

        const watchList = this.watchedProperties.get(path) || [];
        watchList.push({ callback, options: { immediate, deep }, value: initialValue });
        this.watchedProperties.set(path, watchList);

        immediate && callback(initialValue, initialValue);

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

    /**
     * 改造后的通知属性监听器：
     * - 接收旧状态，以便进行比较。
     * - 对于 deep watch，使用 isDeepEqual 进行检查。
     */
    private notifyWatchers(newState: S): void {
        this.watchedProperties.forEach((watchList, path) => {
            const newValue = this.getNestedValue(newState, path);
            watchList.forEach((data) => {
                const { deep } = data.options;

                let hasChanged = false;
                if (deep) {
                    // Deep Watch：使用深度比较
                    hasChanged = !isDeepEqual(newValue, data.value);
                } else {
                    // Shallow Watch：简单引用或值比较
                    hasChanged = newValue !== data.value;
                }

                if (hasChanged) {
                    data.callback(newValue, data.value);
                    // 必须更新存储的值，以便下次比较
                    data.value = deep ? deepClone(newValue) : newValue;
                }
            });
        });
    }

    // 移除 applyDeepProxy 方法
    // private applyDeepProxy...

    private getNestedValue(obj: any, path: string): any {
        return path.split('.').reduce((o, p) => o && o[p], obj);
    }

    /**
     * @description 存储快照
     */
    public saveSnapshot(): void {
        this.snapshots.push(deepClone(this.state));
    }
    /**
     * @description 回退快照
     */
    public restoreSnapshot(): void {
        if (this.snapshots.length > 0) {
            this.state = this.snapshots.pop()!;

            // 恢复快照后，仍需通知相关监听器
            this.notifyWatchers(this.state);
            this.subscribers.forEach((subscriber) => subscriber(this.state));

            // 清除 derivedState 缓存
            this.derivedStateCache.value = null;
        } else {
            console.warn('No snapshots available to restore.');
        }
    }
}

export default Store;
