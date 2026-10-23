# 事件总线 EventBus

## 定位

用于**跨组件、跨模块**通信的发布 / 订阅容器。适用于：

- 任意两个模块之间传递事件，避免层层透传 props；
- 需要按优先级顺序执行多个监听器；
- 需要命名空间隔离不同业务域；
- 需要统计某事件被触发多少次。

不适合：需要强类型、可回溯的状态 → 用 [Store](/tools/store)。

## 导入

```ts
import { EventBus } from '@lania-tool/tools/event-bus';
```

## 最小示例

```ts
import { EventBus } from '@lania-tool/tools/event-bus';

const bus = new EventBus();

const handler = (user: { name: string }) => console.log('欢迎', user.name);
bus.on('user:login', handler);

await bus.emit('user:login', { name: 'Ada' });

bus.off('user:login', handler);
```

## 完整 API

### `new EventBus()`

无参数。每个实例完全独立。

### `on(event, handler, options?): void`

注册处理器。

```ts
bus.on('save', handler);
bus.on('save', handler, { namespace: 'editor', priority: 10, once: true });
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `event` | `string` | 必填 | 事件名 |
| `handler` | `EventHandler \| AsyncEventHandler` | 必填 | 同步或异步函数 |
| `options.namespace` | `string` | `'global'` | 命名空间；非 global 必须已注册 |
| `options.priority` | `number` | `0` | 越大越先执行 |
| `options.once` | `boolean` | `false` | 执行一次后自动移除 |

- 同一个 handler 可以重复注册，会按注册次数执行。
- 注册后按 `priority` **降序**重排。
- 未注册的命名空间会 **throw**：`Namespace xxx is not registered`。

### `emit(event, eventData?, options?): Promise<void>`

触发事件。

```ts
await bus.emit('save', { id: 1 }, { namespace: 'editor' });
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `event` | `string` | 必填 | 事件名 |
| `eventData` | `any` | `undefined` | 传给处理器的数据 |
| `options.namespace` | `string` | `'global'` | 命名空间 |

行为：

1. 校验命名空间（未注册则 reject）。
2. 若存在处理器，触发计数 +1。
3. 按优先级顺序依次执行；异步函数会被 `await`。
4. 单个处理器抛错会被捕获并 `console.error`，**不影响**后续处理器。
5. `once` 处理器执行后从列表中移除。

### `emitBatch(events): Promise<void>`

串行触发多个事件。

```ts
await bus.emitBatch([
    { event: 'a', data: 1 },
    { event: 'b', data: 2, options: { namespace: 'editor' } },
]);
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `event` | `string` | 事件名 |
| `data` | `any` | 数据 |
| `options` | `{ namespace?: string }` | 命名空间 |

### `off(event, handler, options?): void`

移除处理器。必须传入**同一个函数引用**。

```ts
bus.off('save', handler);
bus.off('save', handler, { namespace: 'editor' });
```

移除不存在的处理器不会报错。

### `getEventCount(namespace, event): number`

返回事件被触发的次数。

```ts
await bus.emit('save');
bus.getEventCount('global', 'save'); // 1
```

注意：只有**存在处理器**时计数才会增加；处理器被 `off` 或 `once` 移除后，计数保留。

### `registerNamespace(namespace): void`

注册命名空间。重复注册无副作用。

```ts
bus.registerNamespace('editor');
```

### `clear(): void`

清空所有处理器与计数器。命名空间注册信息保留。

## 参数与类型

```ts
interface EventContext {
    [key: string]: any;
}

type EventHandler<T = any> = (eventData?: T, context?: EventContext) => void;

type AsyncEventHandler<T = any> = (eventData?: T, context?: EventContext) => Promise<void>;
```

> 当前实现传入的 `context` 是空对象 `{}`，保留给未来的扩展。业务数据请通过 `eventData` 传递。

## 特性详解

### 1. 优先级

```ts
const order: string[] = [];
bus.on('test', () => order.push('low'), { priority: 0 });
bus.on('test', () => order.push('high'), { priority: 10 });
bus.on('test', () => order.push('mid'), { priority: 5 });
await bus.emit('test');
// order === ['high', 'mid', 'low']
```

相同优先级按注册顺序执行（`Array.prototype.sort` 在现代引擎中稳定）。

### 2. 一次性事件

```ts
bus.on('saved', () => toast('已保存'), { once: true });
await bus.emit('saved');
await bus.emit('saved'); // 不再触发
```

`once` 的移除发生在该处理器执行之后，同一事件的其他处理器不受影响。

### 3. 异步处理器

```ts
bus.on('sync', async (payload) => {
    await api.save(payload);
});
await bus.emit('sync', payload); // 等待完成
```

因为 `emit` 会 await，所以可以表达「所有监听者都处理完」的语义。处理器之间是**串行**的。

### 4. 命名空间

```ts
bus.registerNamespace('editor');
bus.on('save', handler, { namespace: 'editor' });
await bus.emit('save', undefined, { namespace: 'editor' });
```

不同命名空间下同名事件互不影响：

```ts
bus.on('save', () => console.log('editor'), { namespace: 'editor' });
bus.on('save', () => console.log('global'));
await bus.emit('save'); // 只触发 global
```

### 5. 错误隔离

```ts
bus.on('test', () => {
    throw new Error('boom');
});
bus.on('test', () => console.log('still runs'));
await bus.emit('test'); // 第二个处理器仍然执行
```

### 6. 触发计数

```ts
bus.on('notify', handler);
await bus.emit('notify');
await bus.emit('notify');
bus.getEventCount('global', 'notify'); // 2
```

## 完整示例：编辑器保存流程

```ts
import { EventBus } from '@lania-tool/tools/event-bus';

const bus = new EventBus();
bus.registerNamespace('editor');

// 1. 高优先级：日志与埋点
bus.on('document:save', (doc) => track('save', doc.id), {
    namespace: 'editor',
    priority: 100,
});

// 2. 普通：持久化
bus.on(
    'document:save',
    async (doc) => {
        await api.save(doc);
    },
    { namespace: 'editor', priority: 10 },
);

// 3. 一次性：保存成功提示
bus.on('document:save', () => toast.success('已保存'), {
    namespace: 'editor',
    once: true,
});

// 4. 失败处理（独立事件）
bus.on('document:error', (error) => toast.error(String(error)), {
    namespace: 'editor',
});

try {
    await bus.emit('document:save', document, { namespace: 'editor' });
} catch (error) {
    // emit 只会在命名空间非法时 reject；处理器错误已被隔离
}
```

## 注意事项

| 场景 | 说明 |
| --- | --- |
| 内存泄漏 | 长生命周期实例上的订阅需要 `off` |
| 重复注册 | 同一个函数注册两次会执行两次 |
| `once` + 多个同名处理器 | 只移除当前执行的那个 |
| 递归 emit | 同一事件在处理器中再次 emit，会继续递归，无内置防护 |
| 异步顺序 | 处理器串行执行，慢处理器会阻塞后续处理器 |
| 计数 | 只在有处理器时递增 |

## 测试覆盖

`packages/tools/tests/event-bus.test.ts`（14 个用例）：

- 注册 / 触发、多处理器；
- 优先级顺序；
- `once`；
- 异步处理器；
- `off`；
- 命名空间注册与未注册报错；
- 触发计数；
- 批量触发；
- `clear`；
- 处理器异常隔离；
- 无数据触发。
