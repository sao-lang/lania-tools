# 日志 Logger

## 定位

一个**零依赖、结构化、可插拔**的日志工具。解决的问题：

| 问题 | 本模块的做法 |
| --- | --- |
| `console.log` 无法整体关闭 | 级别过滤 + `silent` |
| 日志散落各处、无法统一格式 | 命名空间 + 上下文 + 统一 handler |
| 生产环境需要上报而不是打印 | `handler` 替换为上报函数 |
| 日志参数可能是循环引用 / Error | `safeStringify` 永不抛错 |
| 需要排查"刚才发生了什么" | 可选的历史环形缓冲 |
| 模块多、日志无法区分来源 | `child()` 生成 `api:user:profile` 形式的命名空间 |
| 线上突然要开 debug | `setGlobalLevel('debug')` 一键切换 |

```ts
import { createLogger } from '@lania-tool/tools/logger';
```

## 最小示例

```ts
import { createLogger } from '@lania-tool/tools/logger';

const log = createLogger({ name: 'api' });

log.debug('不会输出：默认级别是 info');
log.info('用户登录', { userId: 42 });
log.warn('响应较慢', { ms: 1200 });
log.error('请求失败', new Error('timeout'));
```

控制台输出：

```text
[api] [INFO] 用户登录 { userId: 42 }
[api] [WARN] 响应较慢 { ms: 1200 }
[api] [ERROR] 请求失败 Error: timeout
    at ...
```

## 日志级别

```ts
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
```

阈值（数值越大越严重）：

| 级别 | 数值 | 含义 |
| --- | --- | --- |
| `debug` | 10 | 开发调试细节 |
| `info` | 20 | 正常业务流程（默认） |
| `warn` | 30 | 可恢复的异常 |
| `error` | 40 | 失败，需要关注 |
| `silent` | 100 | 关闭全部输出 |

过滤规则：

```ts
LOG_LEVEL_ORDER[要输出的级别] >= LOG_LEVEL_ORDER[当前级别]
```

因此 `level: 'warn'` 时，`warn` 与 `error` 输出，`info` / `debug` 被过滤。

## 创建 Logger

### `createLogger(options?)`

创建一个**独立**实例（独立的级别、输出器与历史缓冲）。

```ts
const log = createLogger({
    name: 'api',
    level: 'debug',
    context: { app: 'web', version: '1.2.0' },
    timestamp: true,
    handler: (record) => {
        // 自定义输出
    },
});
```

| 选项 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `name` | `string` | `''` | 命名空间 |
| `level` | `LogLevel` | 全局级别（初始 `info`） | 最低输出级别 |
| `context` | `Record<string, unknown>` | `{}` | 固定上下文，合并进每条日志 |
| `timestamp` | `boolean` | `false` | 是否输出时间 |
| `timeFormatter` | `(date: Date) => string` | `HH:mm:ss.SSS` | 时间格式 |
| `handler` | `(record) => void` | 输出到 console | 日志输出器 |
| `historySize` | `number` | `0` | 历史缓冲上限，`0` 表示不记录 |

级别不合法会抛错：

```ts
createLogger({ level: 'verbose' as any }); // Error: Invalid log level: verbose
```

### `getLogger(name = 'app')`

按名称获取**共享**实例，同名多次调用返回同一个对象。

```ts
import { getLogger } from '@lania-tool/tools/logger';

const a = getLogger('api');
const b = getLogger('api');
a === b; // true
```

适合在多个模块中引用同一个 logger，而不必层层传递。

### `createLogger` 与 `getLogger` 的区别

| | `createLogger` | `getLogger` |
| --- | --- | --- |
| 同名实例 | 每次都是新对象 | 复用同一个 |
| 适用 | 需要独立配置 | 全局共享单例 |

## 实例方法

### 输出

| 方法 | 签名 | 说明 |
| --- | --- | --- |
| `debug` | `(message: string, ...args: unknown[]) => void` | debug 级别 |
| `info` | 同上 | info 级别 |
| `warn` | 同上 | warn 级别 |
| `error` | 同上 | error 级别 |
| `log` | `(level: ActiveLogLevel, message, ...args) => void` | 动态级别 |

```ts
const level = shouldAlert ? 'error' : 'warn';
log.log(level, '库存不足', { sku: 'A-1' });
```

参数会被**原样**记录到 `record.args`，默认输出时交给 `console`，因此 `Error` 能保留堆栈。

### 级别控制

```ts
log.getLevel();                  // 'info'
log.setLevel('debug');           // 对当前实例及其所有 child 生效
log.isLevelEnabled('debug');     // true
```

`setLevel` 修改的是**共享的 core**，因此：

```ts
const child = log.child('user');
child.setLevel('debug');
log.debug('现在也会输出');       // true
```

> 需要一个完全独立的级别，请使用 `createLogger()` 新建实例。

### 命名空间与上下文

```ts
const api = createLogger({ name: 'api', context: { app: 'web' } });
const user = api.child('user', { module: 'profile' });

user.info('loaded');
// name    → 'api:user'
// context → { app: 'web', module: 'profile' }
```

- 名称用 `:` 拼接；
- 上下文浅合并，同名键以子级为准；
- 父级无名称时，child 直接使用自己的名称；
- `child('')` 保持父级名称。

```ts
const scoped = log.withContext({ requestId: 'r-1' }); // 名称不变，只加上下文
```

### `assert(condition, message, ...args)`

条件为假时以 `error` 输出，为真时完全静默（与 `console.assert` 一致）。

```ts
log.assert(user.id, '用户缺少 id', { user });
```

### `time(label?)`

返回结束函数，结束时以 `debug` 输出耗时并返回毫秒数：

```ts
const end = log.time('fetch users');
const users = await fetchUsers();
const duration = end(); // debug: fetch users: 42ms
```

即使 debug 被过滤，结束函数仍会返回耗时。

### 历史缓冲

```ts
const log = createLogger({ historySize: 100 });

log.info('step 1');
log.info('step 2');

log.getHistory();    // LogRecord[]（副本）
log.clearHistory();
```

只有**实际输出**的记录才会进入历史（被级别过滤的不记录）。缓冲是环形队列，超出上限时丢弃最早的记录。

### 替换输出器

```ts
log.setHandler((record) => {
    sendToServer(record);
});
```

对当前实例及其所有 child 生效。

## 数据结构

### `LogRecord`

```ts
interface LogRecord {
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    args: unknown[];
    context: Record<string, unknown>;
    name: string;
    timestamp: number; // 毫秒时间戳
    time: string;      // 格式化后的时间；未开启 timestamp 时为空串
}
```

### `LogHandler`

```ts
type LogHandler = (record: LogRecord) => void;
```

handler 抛错不会中断业务流程：本模块会捕获并用 `console.error` 报告一次：

```text
[logger] log handler threw an error: Error: ...
```

## 默认输出格式

```text
[时间] [命名空间] [级别] 消息 {上下文} 参数1 参数2
```

未开启时间 / 未设置名称 / 无上下文时，对应片段自动省略：

```ts
createLogger().info('hello');                       // [INFO] hello
createLogger({ name: 'api' }).info('hello');        // [api] [INFO] hello
```

默认 handler 会把级别映射到同名 console 方法（`debug` / `info` / `warn` / `error`）。若某方法不存在，回退到 `console.log`；若 `console` 整体不存在（某些极端运行时），静默跳过。

## 独立格式化工具

### `safeStringify(value): string`

把任意值转为可读字符串，**永不抛错**。

| 输入 | 输出 |
| --- | --- |
| `'a'` | `a` |
| `undefined` | `undefined` |
| `10n` | `10n` |
| `Symbol('x')` | `Symbol(x)` |
| `() => {}` | `[Function anonymous]` |
| `new Error('boom')` | 堆栈字符串 |
| 循环引用 | 循环处为 `"[Circular]"` |
| `Map` / `Set` / `RegExp` | 转为可序列化形式 |
| `JSON.stringify` 抛错 | `String(value)` |

```ts
import { safeStringify } from '@lania-tool/tools/logger';

const payload: any = { id: 1 };
payload.self = payload;
safeStringify(payload); // '{"id":1,"self":"[Circular]"}'
```

### `formatLogRecord(record): string`

把一条记录格式化成单行字符串，适合写入文件或随请求上报：

```ts
import { formatLogRecord } from '@lania-tool/tools/logger';

formatLogRecord({
    level: 'warn',
    message: 'slow request',
    args: [{ ms: 1200 }],
    context: { path: '/users' },
    name: 'api',
    timestamp: 0,
    time: '08:05:03.007',
});
// '08:05:03.007 [api] [WARN] slow request {"path":"/users"} {"ms":1200}'
```

## 全局控制

```ts
import { getGlobalLevel, setGlobalLevel } from '@lania-tool/tools/logger';

setGlobalLevel('debug'); // 影响所有已创建实例与后续实例
getGlobalLevel();        // 'debug'
```

典型用法：从 URL 参数或本地存储读取调试开关。

```ts
if (new URLSearchParams(location.search).has('debug')) {
    setGlobalLevel('debug');
}
```

### `clearLoggers()`

清空按名称缓存的实例、已注册的 core 与全局级别（恢复为 `info`）。

主要用于测试与热更新。已创建的实例仍可继续使用，但不再响应全局级别。

## 与 AxiosWrapper 集成

### 全局错误日志

```ts
import { AxiosWrapper } from '@lania-tool/tools/axios-wrapper';
import { createLogger } from '@lania-tool/tools/logger';

const log = createLogger({ name: 'http', timestamp: true, historySize: 50 });

export const http = new AxiosWrapper(
    { baseURL: '/api' },
    {
        onError: (error) => {
            log.error('request failed', {
                url: error?.config?.url,
                method: error?.config?.method,
                status: error?.response?.status,
                retryCount: error?.config?.__retryCount ?? 0,
            });
        },
    },
);
```

`onError` 只在**最终失败**时触发，不会记录取消、防抖、节流，也不会记录重试成功的情况。

### 请求耗时

```ts
const httpLog = createLogger({ name: 'http', level: 'debug' });

const http = new AxiosWrapper(
    { baseURL: '/api' },
    {
        interceptors: {
            request: {
                onFulfilled(config) {
                    (config as any).__startedAt = Date.now();
                    return config;
                },
            },
            response: {
                onFulfilled(response) {
                    httpLog.info(`${response.config.method?.toUpperCase()} ${response.config.url}`, {
                        ms: Date.now() - ((response.config as any).__startedAt ?? Date.now()),
                        status: response.status,
                    });
                    return response;
                },
            },
        },
    },
);
```

### 刷新 Token 诊断

```ts
refreshAccessToken: async (refreshToken) => {
    log.info('refreshing access token');
    try {
        const { data } = await axios.post('/api/auth/refresh', { refreshToken });
        log.info('refresh ok', { tokenSeq: data.data.tokenSeq });
        return data.data.accessToken;
    } catch (error) {
        log.error('refresh failed', error);
        throw error;
    }
},
```

## 与 Store / EventBus 集成

```ts
import { Store } from '@lania-tool/tools/store';
import { createLogger } from '@lania-tool/tools/logger';

const log = createLogger({ name: 'store' });

const store = new Store({
    initialState: { count: 0 },
    reducers: {
        increment: (state) => ({ ...state, count: state.count + 1 }),
    },
    plugins: [
        {
            onStateChange(_store, newState, oldState) {
                log.debug('state changed', { from: oldState, to: newState });
            },
            onError(_store, error) {
                log.error('reducer failed', error);
            },
        },
    ],
});
```

EventBus 没有通配符监听，需要记录事件时在自己的发事件入口包一层：

```ts
import { EventBus } from '@lania-tool/tools/event-bus';
import { createLogger } from '@lania-tool/tools/logger';

const bus = new EventBus();
const log = createLogger({ name: 'bus' });

export function emit(event: string, data?: unknown) {
    log.debug('emit', { event, data });
    return bus.emit(event, data);
}
```

## 自定义输出器

### 上报到服务端

```ts
const remote = createLogger({
    name: 'remote',
    level: 'warn',
    handler: (record) => {
        const body = JSON.stringify({
            level: record.level,
            name: record.name,
            message: record.message,
            context: record.context,
            time: record.time,
        });

        // 失败也不能影响业务；使用 keepalive 提高页面关闭前的送达率
        void fetch('/api/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            keepalive: true,
        }).catch(() => {});
    },
});
```

### 同时输出到控制台与内存

```ts
import { defaultLogHandler } from '@lania-tool/tools/logger';

const buffer: string[] = [];

const log = createLogger({
    name: 'app',
    handler: (record) => {
        defaultLogHandler(record);
        buffer.push(formatLogRecord(record));
        if (buffer.length > 200) buffer.shift();
    },
});
```

### 按级别分流

```ts
const log = createLogger({
    handler: (record) => {
        if (record.level === 'error') {
            reportToSentry(record);
        }
        defaultLogHandler(record);
    },
});
```

## 性能建议

1. **避免昂贵的参数构造**：

```ts
if (log.isLevelEnabled('debug')) {
    log.debug('snapshot', buildExpensiveSnapshot());
}
```

2. **生产环境把级别设为 `warn`**：减少 I/O。
3. **历史缓冲会持有对象引用**：只在需要排查问题时开启，并控制 `historySize`。
4. **handler 要轻量**：网络上报建议批量 / 异步，避免阻塞主流程。
5. **不要在日志中输出敏感信息**：`Authorization`、密码、完整用户对象。

## 注意事项

| 场景 | 说明 |
| --- | --- |
| 级别共享 | `setLevel` 影响当前实例与所有 child；独立级别请新建实例 |
| `silent` | 只用于过滤，`silent` 本身不是可输出级别 |
| 上下文 | 浅合并，不做深拷贝 |
| 历史 | 只记录实际输出的日志，且持有引用 |
| handler 抛错 | 被捕获并报告一次，不会中断业务 |
| SSR | 无 `console` 时静默跳过，不会抛错 |
| 日志格式 | 默认 handler 使用 console 的多参数形式；需要字符串时用 `formatLogRecord` |
| 全局级别 | `clearLoggers()` 后，已创建实例不再受全局控制 |

## 测试覆盖

`packages/tools/tests/logger.test.ts`（56 个用例）：

- 级别阈值与过滤、`silent`、非法级别；
- `setLevel` 对 child 的影响、`isLevelEnabled`；
- 命名空间拼接、上下文合并与拷贝；
- 时间戳默认值、默认格式、自定义格式；
- 历史缓冲上限、过滤、清空、副本语义、负数归一化；
- 自定义 handler、替换 handler、handler 抛错与递归保护；
- 默认 handler 的级别映射、前缀、上下文、`Error` 原样传递、缺失方法回退、无 `console`；
- `formatLogRecord`；
- `time()` / `assert()` / 动态 `log()`；
- `getLogger` 单例、`createLogger` 独立实例、全局级别、`clearLoggers`；
- `safeStringify` 的全部类型与循环引用、序列化失败兜底。
