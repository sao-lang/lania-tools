import { deepClone } from './tools';

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
    /** 当前状态对象（不可直接修改） */
    private state: S;

    /** reducers 映射表 */
    private reducers: R;

    /** 插件数组 */
    private plugins: StorePlugin<S>[];

    /** 状态订阅者列表 */
    private subscribers: Set<(state: S) => void>;

    /**
     * 属性监听器集合
     * key: 字符串路径
     * value: 监听器数组
     */
    private watchedProperties: Map<
        string,
        {
            callback: (newValue: any, oldValue: any) => void;
            options: { immediate: boolean; deep: boolean };
            value: any;
        }[]
    >;

    /** 派生状态定义（每个字段是一个函数） */
    private derivedState: DerivedState<S, D>;

    /** 用于保存状态快照（支持撤销功能） */
    private snapshots: S[] = [];

    /** 自动生成的 actions，类型安全 */
    public actions: ActionsFromReducers<S, R>;

    /** dispatch 方法（已类型安全） */
    public dispatch: DispatchFromReducers<S, R>;

    /**
     * 获取全量 state 或某一嵌套值（通过路径）。
     * @param initialState - 初始状态。
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

        /**
         * 自动生成 dispatch
         * - 支持 AsyncAction
         * - 支持数组格式的批量 dispatch
         * - 支持插件监听错误、状态变化
         */
        this.dispatch = async (action: any) => {
            try {
                const actions = Array.isArray(action) ? action : [action];
                const oldState = { ...this.state };

                for (const act of actions) {
                    // 1. 执行异步函数（若存在）
                    if (act.asyncFunc) {
                        act.payload = await act.asyncFunc(this.state);
                    }

                    // 2. 执行 reducer
                    const reducer = this.reducers?.[act.type];
                    if (!reducer) {
                        console.warn(`No reducer found for action type: ${act.type}`);
                        continue;
                    }

                    this.state = reducer(this.state, act.payload);
                }

                // 3. 通知 watchers
                this.notifyWatchers(this.state);

                // 4. 通知 subscribers
                this.subscribers.forEach((subscriber) => subscriber(this.state));

                // 5. 插件 onStateChange
                this.plugins.forEach((plugin) =>
                    plugin.onStateChange?.(this, this.state, oldState),
                );
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

    /**
     * 创建单个 action 函数。
     * @param type - reducer 的 key
     */
    private createAction<K extends keyof R>(
        type: K,
    ): (payload: ReducerPayload<R[K]>) => Promise<void> {
        return (payload) => this.dispatch({ type, payload });
    }

    /**
     * 获取全量 state 或某一嵌套值（通过路径）。
     * @param path - 如 "a.b.c"，不传则返回整个 state。
     */
    public getState<P extends string = ''>(path?: P): FromPathType<P, S, S> {
        return path
            ? (this.getNestedValue(this.state, path) as PathType<S, P>)
            : (this.state as any);
    }

    /**
     * 获取派生状态。
     * @param path - D 的 key，不传返回整个派生状态对象。
     */
    public getDerivedState<P extends keyof D | '' = ''>(path?: P): GetDerivedStateType<S, D, P> {
        if (!path) {
            return Object.fromEntries(
                Object.entries(this.derivedState).map(([key, func]) => [key, func(this.state)]),
            ) as any;
        }
        // eslint-disable-next-line no-prototype-builtins
        if (!this.derivedState.hasOwnProperty(path)) return undefined as never;
        return this.derivedState[path](this.state) as any;
    }

    /**
     * 添加插件。
     */
    public addPlugin(plugin: StorePlugin<S> | StorePlugin<S>[]): void {
        const plugins = Array.isArray(plugin) ? plugin : [plugin];
        plugins.forEach((plugin) => plugin?.onInit?.(this));
        this.plugins.push(...plugins);
    }

    /** 插件初始化 */
    private initializePlugins(): void {
        this.plugins.forEach((plugin) => plugin.onInit?.(this));
    }

    /**
     * 订阅状态变化。
     * @returns 取消订阅函数
     */
    public subscribe(subscriber: (state: S) => void): () => void {
        this.subscribers.add(subscriber);
        return () => this.subscribers.delete(subscriber);
    }

    /**
     * 监听单个属性变化（可深度监听，支持 immediate）。
     *
     * @param path - 属性路径，如 "user.info.name"
     * @param callback - 变化回调
     * @param options.immediate - 是否立即触发一次
     * @param options.deep - 是否深度监听
     * @returns 取消监听函数
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

        deep && this.applyDeepProxy(path, initialValue);
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
     * 通知属性监听器。
     */
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

    /**
     * 深度代理对象，用于 deep watch。
     */
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

        Object.keys(obj).forEach((key) => {
            if (typeof obj[key] === 'object' && obj[key] !== null) {
                obj[key] = new Proxy(obj[key], handler);
            }
        });

        this.state = new Proxy(this.state, handler);
    }

    /**
     * 获取嵌套属性的工具函数。
     * @param obj - 任意对象
     * @param path - 如 "a.b.c"
     */
    private getNestedValue(obj: any, path: string): any {
        return path.split('.').reduce((o, p) => o && o[p], obj);
    }

    /**
     * 保存当前状态快照。
     * 可用于实现撤销/回滚功能。
     */
    public saveSnapshot(): void {
        this.snapshots.push(deepClone(this.state));
    }

    /**
     * 恢复最近一次保存的快照。
     * 若没有快照，会打印 warning。
     */
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
