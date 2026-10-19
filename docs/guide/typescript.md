# TypeScript 类型指南

库本身用 TypeScript 编写，所有公开 API 都带类型。本页列出**全部导出类型**及典型用法，便于在业务代码中复用。

## 通用

### `VarTypes`

`type()` 的返回类型：

```ts
type VarTypes =
    | 'number' | 'string' | 'boolean' | 'function' | 'object' | 'array'
    | 'date' | 'error' | 'set' | 'map' | 'weakmap' | 'weakset'
    | 'regexp' | 'symbol' | 'bigint' | 'arraybuffer'
    | 'null' | 'undefined';
```

### `TimeFormatter`

```ts
import type { TimeFormatter } from '@lania-tools/tools/format-time';

const iso: TimeFormatter = (time) => time.toISOString();
```

## 校验器

```ts
import type {
    ValidationResult,
    ValidationRuleResult,
    ValidationRuleFn,
    ValidationRules,
} from '@lania-tools/tools/validator';

type UserForm = { name: string; age: number };

const rules: ValidationRules<UserForm> = {
    name: (value, allValues) => ({ status: value.length > 0 }),
    age: async (value) => ({ status: value >= 18, message: '未成年' }),
};

const validator = new Validator<UserForm>(rules);

const result: ValidationResult = await validator.validate({ name: 'Ada', age: 20 });
```

| 类型 | 定义 |
| --- | --- |
| `ValidationResult` | `{ isValid: boolean; errors: Record<string, string> }` |
| `ValidationRuleResult` | `{ status: boolean; message?: string }` |
| `ValidationRuleFn<T>` | `(value: T, allValues?: Record<string, T>) => ValidationRuleResult \| Promise<ValidationRuleResult>` |
| `ValidationRules<T>` | `Record<string, ValidationRuleFn<T> \| ValidationRuleFn<T>[]>` |

> `Validator<T>` 的泛型参数是**字段值类型**。如果表单字段类型不同，使用默认 `any` 或按字段建立联合类型。

## 状态管理

```ts
import type {
    AsyncAction,
    StorePlugin,
    ActionsFromReducers,
    DerivedState,
    ReducersMap,
    PathType,
    FromPathType,
} from '@lania-tools/tools/store';
```

### 基本用法

```ts
type State = { count: number; user: { name: string } };

const store = new Store({
    initialState: { count: 0, user: { name: '' } } as State,
    reducers: {
        increment: (state: State) => ({ ...state, count: state.count + 1 }),
        rename: (state: State, name: string) => ({ ...state, user: { name } }),
    },
    derivedState: {
        double: (state: State) => state.count * 2,
    },
});

await store.actions.rename('Ada');   // payload 自动推导为 string
const name = store.getState('user.name');  // string
```

### 路径类型

```ts
type State = { user: { name: string; tags: string[] } };

type Name = PathType<State, 'user.name'>;       // string
type Whole = FromPathType<'', State, State>;    // State
```

`getState` / `getDerivedState` 使用这两个类型做路径推导。

### 插件类型

```ts
const logger: StorePlugin<State> = {
    onInit(store) {},
    onStateChange(store, newState, oldState) {},
    onError(store, error) {},
};
```

### `AsyncAction`

```ts
const action: AsyncAction = {
    type: 'rename',
    asyncFunc: async (state) => await fetchName(state.user),
};
await store.dispatch(action);
```

| 类型 | 说明 |
| --- | --- |
| `DerivedState<S, D>` | `{ [K in keyof D]: (state: S) => D[K] }` |
| `ReducersMap<S>` | `Record<string, (state: S, payload?: any) => S>` |
| `ActionsFromReducers<S, R>` | 由 reducers 自动推导的 action 函数集合 |

## 事件总线

```ts
import type { EventContext, EventHandler, AsyncEventHandler } from '@lania-tools/tools/event-bus';

const handler: EventHandler<{ id: number }> = (data) => console.log(data?.id);
const asyncHandler: AsyncEventHandler<{ id: number }> = async (data, ctx: EventContext) => {};
```

| 类型 | 定义 |
| --- | --- |
| `EventContext` | `{ [key: string]: any }` |
| `EventHandler<T>` | `(eventData?: T, context?: EventContext) => void` |
| `AsyncEventHandler<T>` | `(eventData?: T, context?: EventContext) => Promise<void>` |

## 存储

```ts
import type { StorageOptions } from '@lania-tools/tools/web-storage-helper';

const options: StorageOptions = { expiresInSeconds: 600, encryptData: true };
LocalStorageHelper.set('key', { a: 1 }, options);
```

## 日志

```ts
import type { LogHandler, LogLevel, LogRecord, LoggerOptions } from '@lania-tools/tools/logger';

const level: LogLevel = 'info';

const options: LoggerOptions = {
    name: 'api',
    level,
    timestamp: true,
    historySize: 50,
};

const handler: LogHandler = (record: LogRecord) => {
    console.log(record.level, record.message, record.context);
};
```

| 类型 | 定义 |
| --- | --- |
| `LogLevel` | `'debug' \| 'info' \| 'warn' \| 'error' \| 'silent'` |
| `ActiveLogLevel` | `Exclude<LogLevel, 'silent'>` |
| `LogRecord` | `{ level; message; args; context; name; timestamp; time }` |
| `LogHandler` | `(record: LogRecord) => void` |
| `LoggerOptions` | `{ name?; level?; context?; timestamp?; timeFormatter?; handler?; historySize? }` |

## 客户端选项

```ts
import type { SSEOptions } from '@lania-tools/tools/sse-client';
import type { WebSocketOptions } from '@lania-tools/tools/websocket-client';
import type { SuperCarouselOptions } from '@lania-tools/tools/carousel';
import type { VirtualScrollerOptions } from '@lania-tools/tools/virtual-scroller';
import type { ConvertOptions } from '@lania-tools/tools/convert-chinese-text';
```

```ts
const sseOptions: SSEOptions = { url: '/events', reconnectInterval: 3000 };
const wsOptions: WebSocketOptions = { url: 'wss://x', heartbeatInterval: 30_000 };
const carouselOptions: SuperCarouselOptions = {
    mode: 'slide',
    containerSelector: '.carousel',
    itemSelector: '.slide',
};
const scrollerOptions: VirtualScrollerOptions = {
    containerSelector: '#list',
    estimatedItemHeight: 50,
    bufferSize: 5,
    loadMoreCallback: async (count) => [],
};
const convertOptions: ConvertOptions = { batchSize: 100, observeMutations: true };
```

## 拖拽

```ts
import type {
    DraggableOptions,
    DragBoundary,
    CustomDragEvent,
} from '@lania-tools/tools/draggable';

const boundary: DragBoundary = { minX: 0, maxX: 400 };
const options: DraggableOptions = {
    boundary,
    enableTouch: true,
    onDrag: (event: CustomDragEvent) => console.log(event.x, event.y),
};
```

| 类型 | 定义 |
| --- | --- |
| `DragBoundary` | `{ minX?; maxX?; minY?; maxY? }`（限制的是 translate 位移） |
| `CustomDragEvent` | `{ type: 'dragstart' \| 'drag' \| 'dragend' \| 'boundary'; x: number; y: number }` |

## AxiosWrapper

```ts
import type {
    WrapperOptions,
    UploadFileOptions,
    PollingConfig,
} from '@lania-tools/tools/axios-wrapper';
```

> `WrapperOptions` 由 `axios-wrapper` 入口导出；`UploadFileOptions` 与 `PollingConfig` 同样从该入口导出，可直接用于包装业务函数。

### 请求泛型

```ts
interface User {
    id: number;
    name: string;
}

const response = await http.get<User[]>('/users');
// response.data: User[]

const created = await http.post<User>('/users', { name: 'Ada' });
// created.data: User
```

`get` / `post` / `put` / `delete` / `request` 的泛型参数默认是 `any`，也可以显式指定。

### 包装业务 API

```ts
const api = {
    listUsers: (page: number) => http.get<User[]>('/users', { page }),
    updateUser: (id: number, patch: Partial<User>) => http.put<User>(`/users/${id}`, patch),
    removeUser: (id: number) => http.delete<void>(`/users/${id}`),
};
```

### 上传与轮询

```ts
const options: UploadFileOptions = {
    enableResume: true,
    getUploadedChunksUrl: '/upload/uploaded',
    calculateChunkMd5: true,
    cancelTokenId: 'upload-1',
};

const polling: PollingConfig<{ status: string }> = {
    key: 'job-1',
    url: '/jobs/1',
    interval: 2000,
    maxPollingTimes: 30,
    onSuccess: (res) => {
        if (res.data.data.status === 'done') http.stopPolling('job-1');
    },
};
```

## 类型导出总表

| 模块 | 导出的类型 |
| --- | --- |
| `format-time` | `TimeFormatter` |
| `logger` | `LogLevel`、`ActiveLogLevel`、`LogRecord`、`LogHandler`、`LoggerOptions` |
| `type` | `VarTypes` |
| `validator` | `ValidationResult`、`ValidationRuleResult`、`ValidationRuleFn`、`ValidationRules` |
| `store` | `AsyncAction`、`StorePlugin`、`PathType`、`FromPathType`、`DerivedState`、`ReducersMap`、`ActionsFromReducers` |
| `event-bus` | `EventContext`、`EventHandler`、`AsyncEventHandler` |
| `web-storage-helper` | `StorageOptions` |
| `sse-client` | `SSEOptions` |
| `websocket-client` | `WebSocketOptions` |
| `carousel` | `SuperCarouselOptions` |
| `draggable` | `DraggableOptions`、`DragBoundary`、`CustomDragEvent` |
| `virtual-scroller` | `VirtualScrollerOptions` |
| `convert-chinese-text` | `ConvertOptions` |
| `axios-wrapper` | `WrapperOptions`、`UploadFileOptions`、`PollingConfig` |

## 注意事项

1. **`strict` 模式**：库内部开启严格模式，类型声明可直接在 `strict: true` 的项目中使用。
2. **泛型默认值**：请求方法默认 `<T = any>`，未指定时 `response.data` 为 `any`，建议显式传入业务类型。
3. **`Store` 的 reducer 类型**：`actions` 的 payload 类型由 reducer 第二个参数推导；若 reducer 不声明参数类型，payload 会退化为 `any`。
4. **`ValidatedRuleFn<T>` 的 `allValues`**：类型是 `Record<string, T>`，字段类型不一致时请使用默认 `any`。
