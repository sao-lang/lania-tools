# 快速上手

`@lania-tool/tools` 是一个**零框架依赖**的前端工具库，包含三层能力：

- **请求层**：`AxiosWrapper` 把并发、缓存、防抖节流、重试、取消、双 Token、轮询、分片上传、下载组织成一条可预测的管道。
- **通用层**：事件总线、状态管理、表单校验、类型判断、时间格式化、函数与对象工具。
- **浏览器层**：四套存储封装、SSE、WebSocket、中文批量替换，以及轮播 / 拖拽 / 虚拟滚动三个 DOM 组件。

## 安装

```bash
pnpm add @lania-tool/tools
# npm i @lania-tool/tools
# yarn add @lania-tool/tools
```

`axios-wrapper` 额外依赖 `axios` 与 `spark-md5`（已作为包依赖自动安装）。

## 模块清单

每个模块都有独立的子路径入口，按需引入不会把其他模块打进包里。

| 子路径 | 主要导出 | 运行环境 |
| --- | --- | --- |
| `@lania-tool/tools` | 全量导出 | 视具体模块 |
| `@lania-tool/tools/axios-wrapper` | `AxiosWrapper`、`AxiosWrapperFactory`、`DebounceThrottleCancelError` | 浏览器 / Node |
| `@lania-tool/tools/event-bus` | `EventBus` | 任意 |
| `@lania-tool/tools/store` | `Store` | 任意 |
| `@lania-tool/tools/tools` | `debounce`、`throttle`、`deepClone`、`isDeepEqual`、`copy` | 任意（`copy` 需 DOM） |
| `@lania-tool/tools/type` | `type` 与 12 个判断函数 | 任意 |
| `@lania-tool/tools/validator` | `Validator`、`Rules` | 任意 |
| `@lania-tool/tools/format-time` | `formatTime` | 任意 |
| `@lania-tool/tools/logger` | `createLogger`、`getLogger`、`Logger`、`safeStringify`、`formatLogRecord` | 任意 |
| `@lania-tool/tools/web-storage-helper` | `LocalStorageHelper`、`SessionStorageHelper`、`CookieHelper`、`IndexedDBHelper` | 浏览器 |
| `@lania-tool/tools/sse-client` | `SSEClient` | 浏览器 |
| `@lania-tool/tools/websocket-client` | `WebSocketClient` | 浏览器 |
| `@lania-tool/tools/convert-chinese-text` | `convertPageChinese`、`createChineseConverter` | 浏览器 |
| `@lania-tool/tools/carousel` | `Carousel` | 浏览器 |
| `@lania-tool/tools/draggable` | `Draggable` | 浏览器 |
| `@lania-tool/tools/virtual-scroller` | `VirtualScroller` | 浏览器 |

## 五分钟总览

### 1. 请求层

```ts
import { AxiosWrapper } from '@lania-tool/tools/axios-wrapper';

const http = new AxiosWrapper(
    { baseURL: 'https://api.example.com', timeout: 10_000 },
    {
        maxConcurrent: 5,      // 全局最多 5 个并发
        enableCache: true,     // GET 结果缓存
        cacheTTL: 30_000,
        enableRetry: true,     // 失败自动重试
        retryTimes: 2,
        tokenProvider: () => localStorage.getItem('access_token') ?? '',
        onError: (error) => console.error('[http]', error),
    },
);

const { data } = await http.get('/users', { page: 1 });
```

### 2. 事件总线

```ts
import { EventBus } from '@lania-tool/tools/event-bus';

const bus = new EventBus();
bus.on('user:login', (user) => console.log('欢迎', user.name));
await bus.emit('user:login', { name: 'Ada' });
```

### 3. 状态管理

```ts
import { Store } from '@lania-tool/tools/store';

const store = new Store({
    initialState: { count: 0 },
    reducers: { increment: (state) => ({ ...state, count: state.count + 1 }) },
    derivedState: { double: (state) => state.count * 2 },
});

store.subscribe((state) => console.log(state.count));
await store.actions.increment();
```

### 4. 函数工具

```ts
import { debounce, deepClone } from '@lania-tool/tools/tools';

const search = debounce((q: string) => fetch(`/search?q=${q}`), 300);
const copy = deepClone({ nested: { list: [1, 2, 3] } });
```

### 5. 表单校验

```ts
import { Validator, Rules } from '@lania-tool/tools/validator';

const validator = new Validator({
    email: [Rules.required(), Rules.email()],
    age: Rules.range(18, 120),
});

const { isValid, errors } = await validator.validate({ email: 'a@b.com', age: 20 });
```

### 6. 存储

```ts
import { LocalStorageHelper } from '@lania-tool/tools/web-storage-helper';

LocalStorageHelper.set('token', 'abc', { expiresInSeconds: 3600 });
LocalStorageHelper.get<string>('token');
```

### 7. 实时通信

```ts
import { SSEClient } from '@lania-tool/tools/sse-client';
import { WebSocketClient } from '@lania-tool/tools/websocket-client';

const sse = new SSEClient({ url: '/events' });
sse.on('message', (data) => console.log(data));

const ws = new WebSocketClient({ url: 'wss://example.com/ws' });
ws.on('message', (data) => console.log(data));
```

### 8. DOM 组件

```ts
import { Carousel } from '@lania-tool/tools/carousel';
import { Draggable } from '@lania-tool/tools/draggable';
import { VirtualScroller } from '@lania-tool/tools/virtual-scroller';
```

### 9. 日志

```ts
import { createLogger } from '@lania-tool/tools/logger';

const log = createLogger({ name: 'api', timestamp: true });
log.info('user loaded', { id: 42 });
log.error('request failed', new Error('timeout'));
```

## 引入方式与打包

### 推荐：子路径

```ts
import { EventBus } from '@lania-tool/tools/event-bus';
```

只加载该模块及其依赖，体积最小，适合生产环境。

### 全量

```ts
import { EventBus, Store, AxiosWrapper } from '@lania-tool/tools';
```

`src/index.ts` 导出了**全部模块**（包括事件总线、WebSocket、轮播、虚拟滚动）。打包器可 tree-shake，但入口会引入所有模块的类型与副作用（例如 `axios-wrapper` 依赖 `axios`），因此库代码更推荐子路径。

### CommonJS

```js
const { EventBus } = require('@lania-tool/tools/event-bus');
```

包的 `exports` 同时提供 `import` / `require` / `types` 三个条件。

### 目录结构

```text
@lania-tool/tools
├── dist/esm/*.esm.js      ES Module
├── dist/cjs/*.cjs.cjs     CommonJS
└── dist/types/*.d.ts      类型声明
```

## 运行环境

| 能力 | 最低要求 |
| --- | --- |
| 核心工具、Store、Validator、EventBus | ES2018+ 运行时 |
| `axios-wrapper` | `axios >= 1.7`，`CancelToken` / `AbortController` |
| 存储、SSE、WebSocket、UI 组件 | 浏览器 DOM |
| 分片上传 MD5 | 优先 Web Worker；不可用时自动回退主线程 |
| `IndexedDBHelper` | 支持 IndexedDB 的浏览器 |

### SSR 注意事项

- `LocalStorageHelper` / `SessionStorageHelper` / `CookieHelper` 直接访问 `window` / `document`，只在客户端调用。
- `SSEClient` / `WebSocketClient` / `Carousel` / `Draggable` / `VirtualScroller` 在构造时就会访问 DOM，需要放在 `onMounted` / `useEffect` 中。
- `AxiosWrapper` 可在服务端使用，但下载与分片上传依赖浏览器 API。

## 学习路线

1. [整体架构](/guide/architecture)：模块如何组织、状态归属、扩展点。
2. [AxiosWrapper 架构](/axios/) → [完整 API 参考](/axios/api)：请求层是这套库最复杂的部分。
3. 按需阅读工具模块：每个页面都包含完整 API、原理与示例。
4. [常见场景 Recipes](/guide/recipes)：把多个模块组合成真实业务方案。
5. [测试与质量保障](/guide/testing)：了解这些行为是如何被验证的。
