# @lania-tools/tools

企业级前端工具函数库，14 个独立模块，覆盖 Web 开发中最高频的使用场景。

## 架构设计

```
@lania-tools/tools
├── 基础工具层
│   ├── type.ts              - 类型判断（比 typeof 更准）
│   ├── tools.ts             - 通用工具（防抖/节流/深拷贝/深比较）
│   └── format-time.ts       - 时间格式化
│
├── 数据管理层
│   ├── store.ts             - 全局状态管理（Reducers + 派生状态 + 插件）
│   ├── web-storage-helper.ts - 存储增强（LocalStorage/SessionStorage + 加密 + TTL）
│   └── validator.ts         - 数据验证引擎（异步验证 + 缓存）
│
├── 通信层
│   ├── axios/               - Axios 增强封装（缓存/防抖/重试/双Token/轮询/并发）
│   ├── event-bus.ts         - 事件总线（命名空间/优先级/一次性）
│   ├── sse-client.ts        - SSE 客户端
│   └── websocket-client.ts  - WebSocket 客户端
│
├── DOM 交互层
│   ├── draggable.ts         - 拖拽（transform/边界/吸附/触摸）
│   ├── carousel.ts          - 轮播（Slide + Marquee 双模式）
│   ├── virtual-scroller.ts  - 虚拟滚动（DOM 重用池/二分查找）
│   └── convert-chinese-text.ts - 中文文本转换（LRU 缓存/DOM 批量处理）
│
└── 独立入口导出
    ├── index.ts                   - 全量导出
    ├── axios-wrapper              - 仅 Axios 封装
    ├── draggable                  - 仅拖拽
    ├── event-bus                  - 仅事件总线
    ├── convert-chinese-text       - 仅文本转换
    ├── sse-client                 - 仅 SSE
    ├── store                      - 仅状态管理
    ├── format-time                - 仅时间格式化
    ├── validator                  - 仅验证器
    ├── websocket-client           - 仅 WebSocket
    └── web-storage-helper         - 仅存储
```

## 模块详解

### 1. type.ts — 类型判断

比 `typeof` 更准确的类型判断工具集，基于 `Object.prototype.toString.call()` 实现。

**导出函数：**

| 函数 | 说明 | 示例 |
|------|------|------|
| `type(obj)` | 获取变量的精确类型字符串 | `type([])` → `"array"` |
| `isFunction(obj)` | 是否为函数 | `isFunction(()=>{})` → `true` |
| `isBoolean(obj)` | 是否为布尔值 | `isBoolean(false)` → `true` |
| `isNumber(obj)` | 是否为数字 | `isNumber(123)` → `true` |
| `isString(obj)` | 是否为字符串 | `isString('')` → `true` |
| `isArray(obj)` | 是否为数组 | `isArray([])` → `true` |
| `isObject(obj)` | 是否为普通对象 | `isObject({})` → `true` |
| `isEmptyObject(obj)` | 是否为空对象 | `isEmptyObject({})` → `true` |
| `isArrayLike(obj)` | 是否为类数组 | `isArrayLike('abc')` → `true` |
| `isWindow(obj)` | 是否为 window 对象 | `isWindow(window)` → `true` |
| `isHTMLElement(obj)` | 是否为 HTMLElement | `isHTMLElement(div)` → `true` |
| `isPrimitive(obj)` | 是否为原始类型 | `isPrimitive(1)` → `true` |
| `isFalsy(obj)` | 是否为假值 | `isFalsy(0)` → `true` |

**内部实现：** 维护一个 `class2type` 映射表，将 `Object.prototype.toString` 的返回值（如 `[object Date]`）映射为小写类型字符串（如 `"date"`），使用 `const` 元组 + `forEach` 初始化，保证类型安全。

**使用示例：**

```typescript
import { type, isObject, isArray } from '@lania-tools/tools';

type(new Map())   // "map"  (typeof 只会返回 "object")
type(null)        // "null"  (typeof 只会返回 "object")
type(undefined)   // "undefined"
type(new Date())  // "date"
```

---

### 2. tools.ts — 通用工具

**导出函数：**

#### debounce — 防抖

```typescript
import { debounce } from '@lania-tools/tools';

const search = debounce(
  (keyword: string) => {
    console.log('搜索:', keyword);
  },
  300,     // 等待时间 ms
  false    // immediate: 是否立即执行
);

// 支持取消
search.cancel();
```

**实现要点：** 每次调用清除上一次的 `setTimeout`，重新计时。`immediate=true` 时首次立即执行，后续在等待时间内不再执行。

#### throttle — 节流

```typescript
import { throttle } from '@lania-tools/tools';

const scroll = throttle(
  (e: Event) => {
    console.log('滚动位置:', window.scrollY);
  },
  100,                    // 间隔时间 ms
  { leading: true, trailing: true }  // leading 和 trailing 互斥
);

// 支持取消
scroll.cancel();
```

**实现要点：** 基于时间戳的节流实现，`leading` 控制是否开始时执行，`trailing` 控制是否结束时执行。

#### deepClone — 深拷贝

```typescript
import { deepClone } from '@lania-tools/tools';

const obj = { a: 1, b: { c: 2 }, d: new Date(), e: new Map() };
const cloned = deepClone(obj);

// 支持循环引用
const circular: any = { a: 1 };
circular.self = circular;
deepClone(circular); // 不会死循环
```

**支持的类型：** `Date`, `RegExp`, `Map`, `Set`, 数组, 普通对象，以及循环引用（通过 `WeakMap` 缓存）。

#### isDeepEqual — 深比较

```typescript
import { isDeepEqual } from '@lania-tools/tools';

isDeepEqual({ a: 1, b: [2, 3] }, { a: 1, b: [2, 3] }); // true
isDeepEqual(NaN, NaN); // true (Object.is 语义)
```

**支持的类型：** 同 `deepClone`，同样支持循环引用检测。

---

### 3. validator.ts — 验证引擎

**导出：**

| 导出 | 类型 | 说明 |
|------|------|------|
| `Validator` | Class | 通用验证器，支持异步/跨字段/缓存 |
| `Rules` | Object | 内置验证规则预设 |

**Rules 内置规则：**

| 规则 | 参数 | 说明 |
|------|------|------|
| `Rules.required(message?)` | 提示信息 | 必填校验 |
| `Rules.minLength(min, message?)` | 最小长度 | 字符串最小长度 |
| `Rules.maxLength(max, message?)` | 最大长度 | 字符串最大长度 |
| `Rules.pattern(regex, message?)` | 正则 | 正则匹配 |
| `Rules.email(message?)` | 提示信息 | 邮箱格式 |
| `Rules.phone(message?)` | 提示信息 | 手机号格式 |
| `Rules.range(min, max, message?)` | 最小/最大值 | 数字范围 |
| `Rules.integer(message?)` | 提示信息 | 整数 |
| `Rules.matchField(otherField, message?)` | 其他字段名 | 跨字段值匹配 |
| `Rules.max(max, message?)` | 最大值 | 数字最大值 |
| `Rules.min(min, message?)` | 最小值 | 数字最小值 |
| `Rules.custom(fn, message?)` | 自定义函数 | 自定义验证 |
| `Rules.url(message?)` | 提示信息 | URL 格式 |
| `Rules.date(message?)` | 提示信息 | 日期格式 |

**使用示例：**

```typescript
import { Validator, Rules } from '@lania-tools/tools';

const validator = new Validator({
  username: [Rules.required('用户名不能为空'), Rules.minLength(3, '至少3个字符')],
  email: Rules.email('请输入正确的邮箱'),
  password: [
    Rules.required('密码不能为空'),
    Rules.minLength(6, '密码至少6位'),
  ],
  confirmPassword: Rules.matchField('password', '两次密码不一致'),
});

const result = await validator.validate({
  username: 'ab',
  email: 'invalid',
  password: '123',
  confirmPassword: '456',
});

// result: { isValid: false, errors: { username: '至少3个字符', email: '请输入正确的邮箱', ... } }
```

**验证器特性：**

- **异步验证**：支持 `async (value) => ({ status, message })` 的异步规则函数
- **动态规则**：通过 `setDynamicRules()` 运行时替换验证规则
- **结果缓存**：相同数据不重复验证，通过 `generateCacheKey` 生成缓存键
- **跨字段验证**：规则函数接收 `allValues` 参数，可访问其他字段值

---

### 4. format-time.ts — 时间格式化

```typescript
import { formatTime } from '@lania-tools/tools';

// 默认格式：YYYY-MM-DD HH:mm:SS
formatTime(new Date());           // "2025-06-25 14:30:00"
formatTime(1719304200000);        // 时间戳也支持

// 自定义格式字符串
formatTime(new Date(), 'YYYY/MM/DD');        // "2025/06/25"
formatTime(new Date(), 'HH:mm:SS');          // "14:30:00"
formatTime(new Date(), 'YYYY-MM-DD HH:mm');  // "2025-06-25 14:30"

// 自定义格式化函数
formatTime(new Date(), (date) => {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
});
```

**支持的格式组件：** `YYYY`, `MM`, `M`, `DD`, `D`, `HH`, `H`, `hh`, `h`, `mm`, `m`, `SS`, `S`

---

### 5. web-storage-helper.ts — 存储增强

对 `localStorage` 和 `sessionStorage` 的增强封装，支持 **数据加密** 和 **TTL 过期**。

**导出：**

- `LocalStorageHelper` — localStorage 封装
- `SessionStorageHelper` — sessionStorage 封装

**API（两者相同）：**

| 方法 | 说明 |
|------|------|
| `set(key, value, options?)` | 设置值，支持 `expiresInSeconds` 和 `encryptData` |
| `get<T>(key)` | 获取值，自动过期判断和类型推断 |
| `delete(key)` | 删除单个键 |
| `clear()` | 清空所有数据 |
| `keys()` | 获取所有 key |
| `size()` | 获取存储总大小（字符数） |
| `setMultiple(items, options?)` | 批量设置 |
| `getMultiple<T>(keys)` | 批量获取 |

**使用示例：**

```typescript
import { LocalStorageHelper } from '@lania-tools/tools';

// 基础用法
LocalStorageHelper.set('token', 'abc123');

// 过期时间：30 秒后自动清除
LocalStorageHelper.set('code', '123456', { expiresInSeconds: 30 });

// 加密存储
LocalStorageHelper.set('password', 'secret', { encryptData: true });

// 读取
const token = LocalStorageHelper.get<string>('token'); // 'abc123'

// 批量操作
LocalStorageHelper.setMultiple({ a: 1, b: 2 }, { expiresInSeconds: 60 });
```

**加密原理：** 使用 `TextEncoder` 将字符串转为 UTF-8 字节数组，再将每个字节转为十六进制字符串。读取时反向操作。这不是高强度加密，但可以防止明文存储敏感信息。

**TTL 原理：** 存储时将 `expiresAt`（到期时间戳）和 `value` 包装为 `StoredData` 对象一起序列化。读取时检查 `Date.now() < expiresAt`，过期则自动删除并返回 `null`。

---

### 6. event-bus.ts — 事件总线

**特性：**

| 特性 | 说明 |
|------|------|
| 命名空间 | 隔离不同模块的事件，避免命名冲突 |
| 优先级 | 数值越大优先级越高，按优先级排序执行 |
| 一次性事件 | `once: true` 的事件执行后自动移除 |
| 异步支持 | 同时支持同步和异步处理函数 |
| 触发统计 | 统计每个事件被触发的次数 |
| 批量触发 | `emitBatch` 批量触发多个事件 |

**使用示例：**

```typescript
import { EventBus } from '@lania-tools/tools';

const bus = new EventBus();

// 基础订阅
bus.on('user:login', (data) => {
  console.log('用户登录:', data);
});

// 带命名空间
bus.on('user:logout', handler, { namespace: 'auth' });

// 优先级：数值越大越先执行
bus.on('data:update', handler1, { priority: 10 });
bus.on('data:update', handler2, { priority: 1 });  // handler1 先执行

// 一次性事件
bus.on('app:ready', handler, { once: true });

// 触发事件
bus.emit('user:login', { userId: 1, name: '张三' });

// 异步事件
bus.on('data:fetch', async (params) => {
  const data = await fetchData(params);
  console.log(data);
});

// 触发次数
bus.getEventCount('global', 'user:login'); // 1

// 批量触发
bus.emitBatch([
  { event: 'a', data: 1 },
  { event: 'b', data: 2 },
]);

// 取消订阅
bus.off('user:login', handler);
```

---

### 7. store.ts — 状态管理

一个轻量级的全局状态管理方案，融合了 Redux 的 reducer 模式和 Vue 的 computed 概念。

**核心概念：**

```
Store
├── State        — 状态对象（只读）
├── Reducers     — 状态变更函数映射（Redux 风格）
├── DerivedState — 派生状态（Vue computed 风格）
├── Plugins      — 插件系统（生命周期钩子）
├── Watch        — 属性监听（路径精确监控）
├── Subscribe    — 全局订阅（每次变更触发）
└── Snapshot     — 状态快照（可回溯历史）
```

**使用示例：**

```typescript
import { Store } from '@lania-tools/tools';

// 定义 Reducer
const counterStore = new Store({
  initialState: { count: 0, name: 'counter' },
  reducers: {
    increment: (state, payload: number = 1) => ({
      ...state,
      count: state.count + payload,
    }),
    decrement: (state) => ({
      ...state,
      count: state.count - 1,
    }),
    reset: (state) => ({
      ...state,
      count: 0,
    }),
  },
  derivedState: {
    double: (state) => state.count * 2,
    isZero: (state) => state.count === 0,
  },
  plugins: [
    {
      onStateChange: (store, newState, oldState) => {
        console.log(`count: ${oldState.count} → ${newState.count}`);
      },
    },
  ],
});

// 通过 dispatch 触发变更
await counterStore.dispatch({ type: 'increment', payload: 5 });
await counterStore.dispatch({ type: 'increment' }); // payload=1 默认值

// 通过 actions 触发变更（语法糖，自动推导 payload 类型）
await counterStore.actions.increment(10);

// 获取派生状态
const computed = counterStore.getDerivedState();
console.log(computed.double); // 10
console.log(computed.isZero); // false

// 属性监听
counterStore.watch('count', (newVal, oldVal) => {
  console.log(`count changed: ${oldVal} → ${newVal}`);
});

// 全局订阅
const unsubscribe = counterStore.subscribe((state) => {
  console.log('state:', state);
});
```

**Store 特性：**

| 特性 | 说明 |
|------|------|
| Reducers | Redux 风格的纯函数状态变更，支持异步 Action（asyncFunc） |
| Actions | 从 Reducers 自动推导的 action 方法，类型安全 |
| DerivedState | 类似 Vue computed，根据 state 自动计算派生值 |
| Plugins | 插件系统，支持 onInit/onStateChange/onError 生命周期 |
| Watch | 支持路径精确监听（如 `'user.name'`），支持 immediate/deep |
| Subscribe | 全局订阅，每次 dispatch 后触发 |
| Snapshot | 自动保存状态快照，支持回溯 |
| 批量 dispatch | 传入数组批量执行多个 action，只触发一次通知 |

---

### 8. sse-client.ts — SSE 客户端

```typescript
import { SSEClient } from '@lania-tools/tools';

const sse = new SSEClient({
  url: '/api/events',
  reconnectInterval: 5000,  // 断线重连间隔 ms
});

// 监听消息
sse.on('message', (data) => {
  console.log('收到推送:', JSON.parse(data));
});

// 监听错误
sse.on('error', (error) => {
  console.error('SSE 错误:', error);
});

// 主动关闭
sse.close();
```

**特性：** 连接断开后自动重连，连接成功后自动停止重连定时器。

---

### 9. websocket-client.ts — WebSocket 客户端

```typescript
import { WebSocketClient } from '@lania-tools/tools';

const ws = new WebSocketClient({
  url: 'wss://example.com/ws',
  reconnectInterval: 5000,      // 重连间隔 ms
  heartbeatInterval: 30000,     // 心跳间隔 ms
  maxReconnectAttempts: 10,     // 最大重连次数
});

// 监听事件
ws.on('open', (event) => console.log('连接成功'));
ws.on('message', (data) => console.log('收到消息:', data));
ws.on('close', (event) => console.log('连接关闭'));
ws.on('error', (event) => console.error('连接错误'));

// 发送消息
ws.send('hello');

// 主动关闭（不重连）
ws.close();
```

**特性：** 自动重连（有次数上限）、心跳检测（定时发送 `ping`）、事件回调模式。

---

### 10. draggable.ts — 拖拽

基于 `transform: translate()` 的高性能拖拽实现。

**配置选项：**

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `boundary` | `{ minX, maxX, minY, maxY }` | - | 拖拽边界限制 |
| `initialPosition` | `{ x, y }` | `{ 0, 0 }` | 初始位移 |
| `enableTouch` | `boolean` | `false` | 是否启用触摸事件 |
| `enableAnimation` | `boolean` | `false` | 是否启用动画过渡 |
| `snapToGrid` | `{ x, y }` | - | 吸附到网格 |
| `snapThreshold` | `number` | `10` | 吸附阈值 |
| `enableSnap` | `boolean` | `false` | 是否启用吸附 |
| `constrainToParent` | `boolean` | `false` | 是否限制在父容器内 |
| `onDragStart` | `(event) => void` | - | 拖拽开始回调 |
| `onDrag` | `(event) => void` | - | 拖拽中回调 |
| `onDragEnd` | `(event) => void` | - | 拖拽结束回调 |
| `onBoundaryHit` | `(event) => void` | - | 触碰边界回调 |

**使用示例：**

```typescript
import { Draggable } from '@lania-tools/tools';

const draggable = new Draggable(document.getElementById('box')!, {
  boundary: { minX: 0, maxX: 500, minY: 0, maxY: 300 },
  enableTouch: true,
  constrainToParent: true,
  onDrag: (e) => console.log(`当前位置: (${e.x}, ${e.y})`),
  onBoundaryHit: (e) => console.log('碰到边界了'),
});

// 绑定事件
draggable.bindEvents();

// 解绑事件
draggable.unbindEvents();
```

**实现要点：** 使用 `transform` 而非 `top/left` 实现位移（避免触发 Layout），使用 `requestAnimationFrame` 优化拖拽帧率，边界检测在 `dragMove` 中进行。

---

### 11. convert-chinese-text.ts — 中文文本转换

专为简繁体转换等批量文本替换场景设计，支持 LRU 缓存和 DOM 批量处理。

**导出：**

| 导出 | 说明 |
|------|------|
| `createChineseConverter(maxCacheSize?)` | 创建转换器工厂函数 |
| `convertPageChinese(dict, targetElement?, options?)` | 批量处理页面 DOM 文本 |

**使用示例：**

```typescript
import { createChineseConverter, convertPageChinese } from '@lania-tools/tools';
import simpledToTraditional from '@lania-tools/json/simpledToTraditional.json';

// 方式一：纯文本转换
const converter = createChineseConverter(500);
const result = converter('中国台湾', simpledToTraditional);
// "中國臺灣"

// 方式二：批量处理页面文本
const stopObservation = convertPageChinese(
  simpledToTraditional,
  document.body,
  {
    observeMutations: true,      // 监听 DOM 变化，自动处理新增节点
    batchSize: 100,              // 每批处理的文本节点数
    excludeSelectors: ['.no-convert', 'code', 'pre'], // 排除的选择器
    useCache: true,              // 使用 LRU 缓存
    maxCacheSize: 500,           // 最大缓存条目
  }
);

// 停止观察
stopObservation();
```

**架构设计：**

```
convertPageChinese
├── 字典解析 → 构建 RegExp（key 转义 + 正则分组）
├── TreeWalker → 遍历文本节点（排除指定选择器）
├── 批量处理队列（Deque）
│   ├── requestIdleCallback 分批处理
│   └── 避免阻塞主线程
├── MutationObserver
│   ├── 监听新增 DOM 节点
│   └── 去重 + 延迟处理
└── LRU 缓存（Map）
    ├── key 命中 → 移到末尾（最新使用）
    └── 超出 maxCacheSize → 删除头部（最久未使用）
```

---

### 12. carousel.ts — 轮播

支持 Slide（分段切换）和 Marquee（连续跑马灯）两种模式。

**配置选项：**

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `mode` | `'slide' \| 'marquee'` | - | 轮播模式（必填） |
| `containerSelector` | `string` | - | 容器 CSS 选择器（必填） |
| `itemSelector` | `string` | - | 项目 CSS 选择器（必填） |
| `speed` | `number` | `300` | Slide 模式：过渡时间(ms)；Marquee 模式：滚动速度(px/s) |
| `autoplayInterval` | `number` | `3000` | 自动播放间隔(ms) |
| `pauseOnHover` | `boolean` | `true` | 鼠标悬停时暂停 |
| `paginationSelector` | `string` | - | 分页点容器选择器（仅 Slide 模式） |

**使用示例：**

```typescript
import { Carousel } from '@lania-tools/tools';

// Slide 模式（分段轮播）
const carousel = new Carousel({
  mode: 'slide',
  containerSelector: '.carousel-track',
  itemSelector: '.carousel-item',
  speed: 400,
  autoplayInterval: 3000,
  paginationSelector: '.carousel-dots',
  pauseOnHover: true,
});

// Marquee 模式（跑马灯）
const marquee = new Carousel({
  mode: 'marquee',
  containerSelector: '.marquee-track',
  itemSelector: '.marquee-item',
  speed: 100,  // 100px/s 滚动速度
  pauseOnHover: true,
});

// 销毁
carousel.destroy();
```

**Slide 模式实现要点：** 克隆首尾元素实现无限循环（A B C → C A B C A），通过 CSS `transform: translateX()` + `transition` 实现平滑切换，过渡结束后无缝跳转到实际位置。

**Marquee 模式实现要点：** 克隆所有原始项目实现无限循环（A B C → A B C A B C），通过 `requestAnimationFrame` 持续更新 `transform: translateX()`，根据时间戳计算滚动距离实现匀速滚动。

---

### 13. virtual-scroller.ts — 虚拟滚动

支持不定高项目的虚拟滚动，核心优化：DOM 重用池 + 二分查找 + requestAnimationFrame。

**配置选项：**

| 选项 | 类型 | 说明 |
|------|------|------|
| `containerSelector` | `string \| HTMLElement` | 滚动容器 |
| `estimatedItemHeight` | `number` | 预估项目高度 |
| `bufferSize` | `number` | 缓冲区大小（可视区外预渲染数量） |
| `loadMoreCallback` | `(count) => Promise<any[]>` | 加载更多数据的回调 |
| `renderItemContent` | `(data) => string \| HTMLElement` | 自定义渲染内容 |

**使用示例：**

```typescript
import { VirtualScroller } from '@lania-tools/tools';

const scroller = new VirtualScroller({
  containerSelector: '.scroll-container',
  estimatedItemHeight: 80,
  bufferSize: 5,
  loadMoreCallback: async (count) => {
    const items = await fetchItems(count);
    return items;
  },
  renderItemContent: (data) => {
    return `<div class="item">
      <h3>${data.title}</h3>
      <p>${data.description}</p>
    </div>`;
  },
});
```

**架构设计：**

```
VirtualScroller
├── 数据层
│   ├── allItems: Item[]          — 所有数据项（含位置信息）
│   └── totalHeight: number       — 总高度
│
├── 可视区计算
│   ├── findStartIndex(scrollTop) — 二分查找起始索引
│   ├── startIndex / endIndex     — 可视区范围
│   └── maxItemsPerView           — 每屏最大项目数
│
├── DOM 渲染
│   ├── domPool: Map<id, HTMLElement> — DOM 元素重用池
│   ├── renderList()              — 渲染可视区
│   │   ├── 进入可视区 → 从池中取/创建元素
│   │   └── 离开可视区 → 从 DOM 移除（保留在池中）
│   └── updateItemElement()       — 更新元素位置和内容
│
└── 滚动加载
    ├── checkLoadMore(scrollTop)  — 接近底部时加载更多
    └── loadMore()                — 调用 loadMoreCallback
```

**DOM 重用池机制：** 不销毁离开可视区的 DOM 元素，而是保留在 `domPool` 中。当元素重新进入可视区时，直接从池中取出复用，避免重复创建 DOM。

---

### 14. axios/ — Axios 增强封装

`AxiosWrapper` 是本项目的核心模块，对 Axios 进行了全方位增强。

**特性一览：**

| 特性 | 管理器 | 说明 |
|------|--------|------|
| 请求缓存 | `CacheManager` | 相同请求返回缓存结果，支持 TTL |
| 防抖/节流 | `DebounceThrottleManager` | 防止重复请求 |
| 请求重试 | 内置 | 失败自动重试，可配置次数和延迟 |
| 双 Token 刷新 | 内置 | Access Token 过期自动刷新，Refresh Token 过期强制登出 |
| 并发控制 | `GlobalConcurrencyController` | 限制同时进行的请求数 |
| 请求取消 | `CancelTokenManager` | 通过 cancelTokenId 取消特定请求 |
| 轮询 | `PollingManager` | 定时轮询接口 |
| 上传 | `UploadManager` | 文件上传进度管理 |
| 代码处理器 | 内置 | 根据业务 code 执行不同逻辑 |
| 自定义拦截器 | `InterceptorManager` | 请求/响应拦截器 |

**配置选项：**

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `maxConcurrent` | `number` | `Infinity` | 最大并发请求数 |
| `enableCache` | `boolean` | - | 启用请求缓存 |
| `cacheTTL` | `number` | - | 缓存过期时间 ms |
| `enableDebounce` | `boolean` | - | 启用防抖 |
| `debounceInterval` | `number` | - | 防抖间隔 ms |
| `enableThrottle` | `boolean` | - | 启用节流 |
| `throttleInterval` | `number` | - | 节流间隔 ms |
| `enableRetry` | `boolean` | - | 启用重试 |
| `retryTimes` | `number` | `3` | 重试次数 |
| `retryDelay` | `number` | `1000` | 重试延迟 ms |
| `tokenProvider` | `() => string` | - | Access Token 获取函数 |
| `enableDoubleToken` | `boolean` | - | 启用双 Token |
| `getRefreshToken` | `() => string` | - | Refresh Token 获取函数 |
| `refreshAccessToken` | `(token) => string` | - | 刷新 Token 函数 |
| `accessTokenExpiredCodes` | `(number\|string)[]` | - | Access Token 过期业务码 |
| `refreshTokenExpiredCodes` | `(number\|string)[]` | - | Refresh Token 过期业务码 |
| `onRefreshTokenExpired` | `() => void` | - | Refresh Token 过期回调 |
| `onError` | `(err) => void` | - | 全局错误处理 |
| `responseHandler` | `(res) => any` | - | 响应数据转换 |
| `codeHandlers` | `Record<number, fn>` | - | 业务码处理器 |
| `interceptors` | `{ request, response }` | - | 自定义拦截器 |

**使用示例：**

```typescript
import { AxiosWrapper } from '@lania-tools/tools/axios-wrapper';

const http = new AxiosWrapper(
  {
    baseURL: '/api',
    timeout: 10000,
  },
  {
    // 缓存
    enableCache: true,
    cacheTTL: 60000,

    // 防抖（相同请求 300ms 内只发一次）
    enableDebounce: true,
    debounceInterval: 300,

    // 重试
    enableRetry: true,
    retryTimes: 3,
    retryDelay: 1000,

    // 双 Token
    tokenProvider: () => localStorage.getItem('accessToken') || '',
    enableDoubleToken: true,
    getRefreshToken: () => localStorage.getItem('refreshToken') || '',
    refreshAccessToken: async (refreshToken) => {
      const res = await axios.post('/auth/refresh', { refreshToken });
      return res.data.accessToken;
    },
    accessTokenExpiredCodes: [401],
    refreshTokenExpiredCodes: [402],
    onRefreshTokenExpired: () => {
      window.location.href = '/login';
    },

    // 响应处理
    responseHandler: (res) => res.data,
    codeHandlers: {
      403: (res) => console.error('无权限'),
    },
  }
);

// 发送请求
const data = await http.get('/users', { params: { page: 1 } });
const result = await http.post('/users', { name: '张三' });

// 取消请求
const source = http.getCancelToken('user-list');
http.get('/users', { cancelTokenId: 'user-list' });
http.cancelRequest('user-list'); // 取消

// 轮询
const polling = http.createPolling('/tasks/status', {
  interval: 3000,
  onData: (data) => console.log('任务状态:', data),
  stopWhen: (data) => data.status === 'completed',
});
polling.start();
polling.stop();

// 文件上传
const uploader = http.createUploader('/upload', {
  onProgress: (percent) => console.log(`进度: ${percent}%`),
  onSuccess: (data) => console.log('上传成功:', data),
});
uploader.upload(file);
```

**双 Token 刷新的核心设计：**

```
请求 → 响应 401（Access Token 过期）
    ↓
InterceptorManager.doubleTokenMiddleware
    ↓
检查 refreshTokenPromise（单例模式）
    ├── 已有刷新任务 → 等待同一个 Promise
    └── 无刷新任务 → 创建新的刷新 Promise
          ↓
    refreshAccessToken(refreshToken)
          ↓
    ├── 成功 → 更新 token → 重试原请求
    └── 失败（Refresh Token 过期）→ onRefreshTokenExpired()
```

**关键设计：** 使用 Promise 单例模式防止并发刷新 Token。当多个请求同时返回 401 时，只有第一个请求触发刷新，其余请求等待同一个刷新 Promise 完成后再重试。

## 独立入口导出

除了主入口 `@lania-tools/tools`，每个模块都有独立入口，减小打包体积：

```typescript
// 只引入需要的模块
import { debounce, throttle } from '@lania-tools/tools/tools';
import { formatTime } from '@lania-tools/tools/format-time';
import { EventBus } from '@lania-tools/tools/event-bus';
import { Store } from '@lania-tools/tools/store';
import { AxiosWrapper } from '@lania-tools/tools/axios-wrapper';
import { Draggable } from '@lania-tools/tools/draggable';
import { WebSocketClient } from '@lania-tools/tools/websocket-client';
import { SSEClient } from '@lania-tools/tools/sse-client';
import { Validator, Rules } from '@lania-tools/tools/validator';
import { LocalStorageHelper } from '@lania-tools/tools/web-storage-helper';
import { createChineseConverter } from '@lania-tools/tools/convert-chinese-text';
```