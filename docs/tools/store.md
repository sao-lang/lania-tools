# 状态管理 Store

## 定位

一个类 Redux 的轻量状态容器：**reducer + action + 派生状态 + 订阅 + 插件 + 快照**。无框架依赖，可在任意 JS 运行时使用。

适合：中小型应用的全局状态、需要严格不可变更新与可预测通知的场景。
不适合：超大规模、需要时间旅行调试 → 用 Redux DevTools 生态。

## 导入

```ts
import { Store } from '@lania-tool/tools/store';
```

## 最小示例

```ts
import { Store } from '@lania-tool/tools/store';

const store = new Store({
    initialState: { count: 0 },
    reducers: {
        increment: (state) => ({ ...state, count: state.count + 1 }),
        add: (state, amount: number) => ({ ...state, count: state.count + amount }),
    },
    derivedState: {
        double: (state) => state.count * 2,
    },
});

store.subscribe((state) => console.log('count =', state.count));

await store.actions.increment();
await store.actions.add(5);

store.getState('count');        // 6
store.getDerivedState('double'); // 12
```

## 构造函数

```ts
new Store<S, D, R>({
    initialState: S,
    reducers: R,
    derivedState?: DerivedState<S, D>,
    plugins?: StorePlugin<S>[],
})
```

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `initialState` | `S` | 初始状态 |
| `reducers` | `Record<string, (state: S, payload?: any) => S>` | 纯函数，必须返回新对象或同一引用 |
| `derivedState` | `Record<string, (state: S) => any>` | 派生值，按 state 引用缓存 |
| `plugins` | `StorePlugin<S>[]` | 插件，`onInit` 在构造时立即调用 |

### 泛型

```ts
type State = { count: number; user: { name: string } };

const store = new Store<
    State,
    { double: number; nameLength: number },
    { increment: (state: State) => State }
>({ ... });
```

通常不需要手写泛型，交给推导即可。

## 状态更新流程

```text
dispatch(action | action[])
  │
  ├─ 归一化为数组
  ├─ oldState = this.state
  ├─ 对每个 action：
  │    ├─ action.asyncFunc?(newState) → action.payload
  │    ├─ reducer = reducers[action.type]
  │    │    └─ 不存在 → console.warn，跳过
  │    └─ newState = reducer(newState, payload)
  │
  ├─ newState === oldState → 直接返回（不通知）
  ├─ state = newState
  ├─ notifyWatchers(state)
  ├─ subscribers.forEach(s => s(state))
  ├─ plugins.onStateChange(store, state, oldState)
  └─ 清空派生状态缓存
```

异常路径：

```text
reducer / asyncFunc 抛错
  └─ plugins.onError(store, error) → 继续抛出
```

## API

### `actions`

由 `reducers` 的 key 自动生成：

```ts
await store.actions.increment();
await store.actions.add(5);
// 等价于
await store.dispatch({ type: 'increment', payload: undefined });
await store.dispatch({ type: 'add', payload: 5 });
```

### `dispatch(action | action[]): Promise<void>`

```ts
await store.dispatch({ type: 'increment' });

await store.dispatch([
    { type: 'increment' },
    { type: 'add', payload: 2 },
]);
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | `keyof R` | reducer 名 |
| `payload` | `any` | 传给 reducer 的第二个参数 |
| `asyncFunc` | `(state) => Promise<any>` | 可选，返回值作为 payload |

**批量 dispatch 只通知一次**，订阅者拿到的是累积后的最终状态。

```ts
store.subscribe((state) => console.log(state.count));
await store.dispatch([
    { type: 'increment' },
    { type: 'increment' },
]);
// 只打印一次：2
```

### `asyncFunc`

```ts
await store.dispatch({
    type: 'setUser',
    asyncFunc: async (state) => {
        return api.getUser(state.userId);
    },
});
```

`asyncFunc` 接收**当前累积状态**，返回值覆盖 `payload`。批量时后续 action 能看到前面 action 的结果。

### `getState(path?): S | 字段值`

```ts
store.getState();              // 整个 state
store.getState('count');       // 6
store.getState('user.name');   // 'Ada'
```

路径不存在时返回 `undefined`。

### `getDerivedState(path?): D | 派生值`

```ts
store.getDerivedState('double'); // 12
store.getDerivedState();         // { double: 12 }
```

缓存规则：`state` 引用不变时直接返回上次计算结果。`dispatch` 成功后缓存失效。

### `subscribe(fn): () => void`

```ts
const unsubscribe = store.subscribe((state) => {
    render(state);
});

unsubscribe();
```

- 每次有效状态变更后调用；
- 返回的函数用于取消订阅；
- 订阅者抛错会中断后续订阅者（未做隔离，需业务自行 try/catch）。

### `watchProperty(path, callback, options?): () => void`

只在指定路径变化时触发。

```ts
store.watchProperty('count', (newValue, oldValue) => {
    console.log(`${oldValue} → ${newValue}`);
});

store.watchProperty('user', callback, { deep: true, immediate: true });
```

| 选项 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `immediate` | `boolean` | `false` | 注册时立即调用一次（新旧值相同） |
| `deep` | `boolean` | `false` | 用深比较判断嵌套对象变化 |

- 浅比较：`newValue !== oldValue`；
- 深比较：`isDeepEqual(newValue, oldValue)`，变化后保存 `deepClone` 副本；
- 同一个路径可以注册多个 watcher，取消其中一个不影响其他。

### `addPlugin(plugin | plugin[]): void`

```ts
store.addPlugin({
    onInit(store) {},
    onStateChange(store, newState, oldState) {},
    onError(store, error) {},
});
```

`onInit` 在注册时立即调用。

### `saveSnapshot(): void`

保存当前状态的深拷贝。

### `restoreSnapshot(): void`

恢复到最近一次快照（后进先出）。

```ts
store.saveSnapshot();
await store.actions.increment();
store.restoreSnapshot(); // 回到保存时
```

- 恢复后会通知 watcher 与订阅者；
- 没有快照时 `console.warn('No snapshots available to restore.')`。

## 插件接口

```ts
type StorePlugin<S> = {
    onInit?: (store: Store<S, any, any>) => void;
    onStateChange?: (store: Store<S, any, any>, newState: S, oldState: S) => void;
    onError?: (store: Store<S, any, any>, error: Error) => void;
};
```

### 示例：持久化插件

```ts
import { Store } from '@lania-tool/tools/store';
import { LocalStorageHelper } from '@lania-tool/tools/web-storage-helper';

type State = { theme: 'light' | 'dark'; count: number };

const persist: StorePlugin<State> = {
    onStateChange(store) {
        LocalStorageHelper.set('app-state', store.getState());
    },
    onError(_store, error) {
        console.error('[store]', error);
    },
};

const store = new Store({
    initialState: { theme: 'light', count: 0 } as State,
    reducers: {
        setTheme: (state, theme: State['theme']) => ({ ...state, theme }),
        increment: (state) => ({ ...state, count: state.count + 1 }),
    },
    plugins: [persist],
});
```

### 示例：日志插件

```ts
const logger: StorePlugin = {
    onStateChange(_store, newState, oldState) {
        console.group('state change');
        console.log('from', oldState);
        console.log('to', newState);
        console.groupEnd();
    },
};
```

## 完整示例：购物车

```ts
import { Store } from '@lania-tool/tools/store';

type CartItem = { id: string; name: string; price: number; quantity: number };
type State = { items: CartItem[]; coupon: string | null };

const store = new Store({
    initialState: { items: [], coupon: null } as State,
    reducers: {
        addItem: (state, item: CartItem) => ({
            ...state,
            items: [...state.items, item],
        }),
        removeItem: (state, id: string) => ({
            ...state,
            items: state.items.filter((item) => item.id !== id),
        }),
        updateQuantity: (state, payload: { id: string; quantity: number }) => ({
            ...state,
            items: state.items.map((item) =>
                item.id === payload.id ? { ...item, quantity: payload.quantity } : item,
            ),
        }),
        applyCoupon: (state, coupon: string | null) => ({ ...state, coupon }),
    },
    derivedState: {
        total: (state) =>
            state.items.reduce((sum, item) => sum + item.price * item.quantity, 0),
        count: (state) => state.items.reduce((sum, item) => sum + item.quantity, 0),
    },
});

store.watchProperty('items', (items) => console.log('items changed', items.length), {
    deep: true,
});

await store.actions.addItem({ id: 'a', name: '键盘', price: 399, quantity: 1 });
await store.actions.updateQuantity({ id: 'a', quantity: 2 });

store.getDerivedState('total'); // 798
```

## 注意事项

| 场景 | 说明 |
| --- | --- |
| 不可变更新 | 原地修改返回同一引用不会通知 |
| 批量 dispatch | 只通知一次，使用累积后的最终状态 |
| 派生状态 | 必须是纯函数，结果以 state 引用为缓存 key |
| 深监听 | 每次变化都会深拷贝，大对象慎用 |
| 订阅者异常 | 会中断后续订阅者，建议内部捕获 |
| 快照 | 深拷贝，内存随快照数量线性增长 |
| 缺少 reducer | 警告并跳过该 action，不中断批量 |
| SSR | 无全局状态，按请求创建即可 |

## 测试覆盖

`packages/tools/tests/store.test.ts`（24 个用例）与 `edge-cases.test.ts`：

- 基础 reducer、`actions`、批量 dispatch；
- `asyncFunc` 与批量累积；
- `getState` / `getDerivedState`（含缓存命中与缺失 key）；
- 订阅与取消订阅；
- `watchProperty` 浅比较 / 深比较 / `immediate`；
- 插件 `onInit` / `onStateChange` / `onError`；
- 快照保存与恢复；
- 缺少 reducer 的警告；
- 多 watcher 的独立取消。
