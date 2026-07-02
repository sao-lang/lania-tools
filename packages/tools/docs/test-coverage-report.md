# 单测覆盖率报告

## 一、测试运行结果

| 指标      | 数值     |
| ------- | ------ |
| 测试文件总数  | 14 个   |
| 通过测试    | 398 个  |
| 失败测试    | 0 个    |
| 未处理错误   | 0 个    |
| 总体代码覆盖率 | 98.31% |

***

## 二、文件测试状态汇总

| 序号 | 源文件                       | 测试文件                                  | 状态     | 覆盖率    |
| -- | ------------------------- | ------------------------------------- | ------ | ------ |
| 1  | `event-bus.ts`            | event-bus.test.ts                     | ✅ 完整   | 100%   |
| 2  | `type.ts`                 | type.test.ts                          | ✅ 完整   | 100%   |
| 3  | `validator.ts`            | validator.test.ts                     | ✅ 完整   | 100%   |
| 4  | `store.ts`                | store.test.ts                         | ✅ 基本完整 | 99%    |
| 5  | `tools.ts`                | tools.test.ts                         | ✅ 基本完整 | 96.63% |
| 6  | `virtual-scroller.ts`     | virtual-scroller.test.ts              | ✅ 基本完整 | 96.46% |
| 7  | `draggable.ts`            | draggable.test.ts                     | ✅ 基本完整 | 97.11% |
| 8  | `sse-client.ts`           | client.test.ts                        | ⚠️ 需补充 | 90.26% |
| 9  | `websocket-client.ts`     | client.test.ts                        | ⚠️ 需补充 | 96.4%  |
| 10 | `carousel.ts`             | carousel.test.ts                      | ✅ 完整   | 100%   |
| 11 | `convert-chinese-text.ts` | convert-chinese-text.test.ts          | ✅ 基本完整 | 96.15% |
| 12 | `format-time.ts`          | format-time.test.ts                   | ✅ 完整   | 100%   |
| 13 | `web-storage-helper.ts`   | web-storage-helper.test.ts            | ✅ 基本完整 | 98.7%  |
| 14 | `axios/`                  | axios.test.ts + axios-wrapper.test.ts | ❌ 大量缺失 | -      |

***

## 三、详细测试清单

### ✅ 完整测试 (3个)

#### 1. event-bus.ts

- **功能**：全局事件发布/订阅、命名空间支持、错误处理
- **测试覆盖**：14 个测试用例，100% 覆盖率
- **状态**：✅ 完整

#### 2. type.ts

- **功能**：`isBoolean`、`isNumber`、`isString`、`isArray`、`isObject`、`isEmptyObject`、`isArrayLike`、`isWindow`、`isHTMLElement`、`isPrimitive`、`isFalsy`
- **测试覆盖**：49 个测试用例，100% 覆盖率
- **状态**：✅ 完整

#### 3. validator.ts

- **功能**：规则注册、异步验证、错误处理、自定义规则
- **测试覆盖**：48 个测试用例，100% 覆盖率
- **状态**：✅ 完整

***

### ✅ 基本完整 (5个)

#### 4. store.ts

- **功能**：类 Redux 状态管理、reducer、action、middleware、plugin
- **测试覆盖**：24 个测试用例，99% 覆盖率
- **缺失**：第 228-230 行、第 336 行（边界情况）
- **建议**：补充边界测试

#### 5. tools.ts

- **功能**：`debounce`、`throttle`、`deepClone`、`isDeepEqual`、`copy`（文本/图片复制）
- **测试覆盖**：43 个测试用例，96.63% 覆盖率
- **缺失**：第 307-308 行、第 324-325 行（copy 函数边缘情况）
- **建议**：补充 copy 函数的异常处理测试

#### 6. virtual-scroller.ts

- **功能**：长列表虚拟滚动、动态高度、加载更多
- **测试覆盖**：7 个测试用例，96.46% 覆盖率
- **缺失**：第 327 行、第 333 行、第 343-351 行（部分边界情况）
- **建议**：补充边界测试

#### 7. draggable.ts

- **功能**：DOM 拖拽、边界限制、吸附网格、动画、触摸支持、父容器约束
- **测试覆盖**：33 个测试用例，97.11% 覆盖率
- **缺失**：第 161-168 行、第 171-173 行（touch 事件解绑的部分边界情况）
- **建议**：补充 touch 事件解绑的边界测试

#### 8. web-storage-helper.ts

- **功能**：LocalStorage、SessionStorage、Cookie、IndexedDB 封装，支持过期、加密
- **测试覆盖**：49 个测试用例，98.7% 覆盖率
- **修复**：已修复第 365 行 `request.result` 空值保护问题
- **缺失**：IndexedDBHelper 的 initDB onerror 分支、openCursor onerror 分支
- **建议**：补充 IndexedDB 错误处理测试

***

### ⚠️ 需补充测试 (5个)

#### 8. sse-client.ts

- **功能**：EventSource 封装、自动重连、消息/错误回调
- **测试覆盖**：1 个测试用例，90.26% 覆盖率
- **缺失**：重连机制、onopen 回调、关闭连接
- **需要补充**：
  - 自动重连测试
  - 手动关闭测试
  - onopen 回调测试
  - 重连定时器清理测试

#### 9. websocket-client.ts

- **功能**：WebSocket 封装、自动重连、心跳检测、事件回调
- **测试覆盖**：2 个测试用例，96.4% 覆盖率
- **缺失**：心跳机制、重连次数限制
- **需要补充**：
  - 心跳机制测试（startHeartbeat/stopHeartbeat）
  - 重连次数达到上限时触发 onClose
  - 连接关闭时停止心跳
  - 非 OPEN 状态不发送消息

#### 10. carousel.ts

- **功能**：图片轮播、循环播放、自动播放、指示器、事件回调
- **测试覆盖**：12 个测试用例，79.65% 覆盖率
- **缺失**：循环播放、自动播放、指示器点击
- **需要补充**：
  - 自动播放/暂停测试
  - 无限循环测试
  - 指示器点击切换测试
  - 事件回调测试（onChange、onBeforeChange）

#### 11. convert-chinese-text.ts

- **功能**：批量替换页面中文文本、MutationObserver 监听、LRU 缓存、Deque 队列
- **测试覆盖**：16 个测试用例，83.63% 覆盖率
- **缺失**：DOM 变化观察、缓存淘汰
- **需要补充**：
  - MutationObserver DOM 变化观察测试
  - Deque 类队列操作测试
  - 缓存超过 maxCacheSize 时的淘汰测试
  - 排除选择器功能测试

#### 12. format-time.ts

- **功能**：时间戳/Date 格式化、自定义格式字符串、12/24 小时制
- **测试覆盖**：5 个测试用例，76.72% 覆盖率
- **缺失**：字符串格式支持
- **需要补充**：
  - 各种格式字符串测试（`YYYY/MM/DD`、`HH:mm:SS`、`hh:mm`、`YYYY-MM-DD HH:mm`）
  - 12 小时制测试（`hh`、`h`）
  - 单数字格式测试（`M`、`D`、`H`、`m`、`S`）

***

### ❌ 有缺陷/大量缺失 (1个)

#### 13. axios/ - Axios 封装模块

**功能模块**：

| 文件                               | 功能                                    |
| -------------------------------- | ------------------------------------- |
| `index.ts`                       | AxiosWrapper 核心类（双Token刷新、重试、缓存、并发控制） |
| `InterceptorManager.ts`          | 拦截器管理器（12个中间件）                        |
| `CacheManager.ts`                | 缓存管理                                  |
| `DebounceThrottleManager.ts`     | 防抖节流管理                                |
| `GlobalConcurrencyController.ts` | 全局并发控制                                |
| `CancelTokenManager.ts`          | 取消令牌管理                                |
| `PollingManager.ts`              | 轮询管理                                  |
| `UploadManager.ts`               | 文件上传管理                                |

**测试覆盖状态**：

| 功能                              | 测试状态  |
| ------------------------------- | ----- |
| 构造函数/工厂模式                       | ✅ 已覆盖 |
| get/post/put/delete             | ✅ 已覆盖 |
| downloadFile                    | ✅ 已覆盖 |
| CacheManager（独立）                | ✅ 已覆盖 |
| CancelTokenManager（独立）          | ✅ 已覆盖 |
| DebounceThrottleManager（独立）     | ✅ 已覆盖 |
| GlobalConcurrencyController（独立） | ✅ 已覆盖 |
| PollingManager（独立）              | ✅ 已覆盖 |
| UploadManager（独立）               | ✅ 已覆盖 |
| **双 Token 刷新**                  | ❌ 缺失  |
| **请求重试**                        | ❌ 缺失  |
| **Token 注入集成**                  | ❌ 缺失  |
| **缓存集成**                        | ❌ 缺失  |
| **防抖节流集成**                      | ❌ 缺失  |
| **并发控制集成**                      | ❌ 缺失  |
| **文件上传集成**                      | ❌ 缺失  |
| **轮询集成**                        | ❌ 缺失  |
| **取消请求集成**                      | ❌ 缺失  |
| **所有中间件集成**                     | ❌ 缺失  |

***

## 四、按优先级排序的补充清单

### 🔴 P0 - 必须修复/补充

| 序号 | 文件                    | 内容              | 原因     |
| -- | --------------------- | --------------- | ------ |
| 1  | axios/index.ts        | 双 Token 刷新集成测试  | 核心业务功能 |
| 2  | axios/index.ts        | 请求重试集成测试        | 核心业务功能 |

### 🟡 P1 - 建议补充

| 序号 | 文件                  | 内容                                 |
| -- | ------------------- | ---------------------------------- |
| 5  | axios/index.ts      | Token 注入集成测试                       |
| 6  | axios/index.ts      | 缓存集成测试                             |
| 7  | axios/index.ts      | 防抖节流集成测试                           |
| 8  | axios/index.ts      | 文件上传/轮询/取消请求集成测试                   |
| 9  | format-time.ts      | 字符串格式测试（YYYY/MM/DD、HH:mm:SS、12小时制） |
| 10 | sse-client.ts       | 重连机制、关闭连接测试                        |
| 11 | websocket-client.ts | 心跳机制、重连次数限制测试                      |

### 🟢 P2 - 可选补充

| 序号 | 文件                                        | 内容                           |
| -- | ----------------------------------------- | ---------------------------- |
| 12 | carousel.ts                               | 自动播放、循环、指示器测试                |
| 13 | draggable.ts                              | touch 事件解绑边界测试               |
| 14 | convert-chinese-text.ts                   | 极端边缘情况测试（空字典键、textContent为空） |
| 15 | store.ts / tools.ts / virtual-scroller.ts | 边界情况补充                       |

***

## 五、总结

```
┌─────────────────────────────────────────────────────────────────────┐
│                      src 目录测试状态汇总                            │
├─────────────────────────────────────────────────────────────────────┤
│  ✅ 完整 (5/14)                                                      │
│     ├── event-bus.ts    (100%)                                      │
│     ├── type.ts         (100%)                                      │
│     ├── validator.ts    (100%)                                      │
│     ├── carousel.ts     (100%)                                      │
│     └── format-time.ts  (100%)                                      │
├─────────────────────────────────────────────────────────────────────┤
│  ✅ 基本完整 (6/14)                                                  │
│     ├── store.ts        (99%) - 建议补充边界测试                     │
│     ├── tools.ts        (96.63%) - 建议补充 copy 异常测试            │
│     ├── virtual-scroller.ts (96.46%) - 建议补充边界测试              │
│     ├── draggable.ts    (97.11%) - 建议补充 touch 解绑边界测试       │
│     ├── convert-chinese-text.ts (100%) - 分支覆盖 96.15%            │
│     └── web-storage-helper.ts (98.7%) - 已修复空值保护缺陷           │
├─────────────────────────────────────────────────────────────────────┤
│  ⚠️ 需补充 (2/14)                                                    │
│     ├── sse-client.ts   (90.26%) - 重连机制                         │
│     └── websocket-client.ts (96.4%) - 心跳、重连次数                 │
├─────────────────────────────────────────────────────────────────────┤
│  ❌ 有缺陷/大量缺失 (1/14)                                           │
│     └── axios/          - 9个集成测试缺失                           │
└─────────────────────────────────────────────────────────────────────┘
```

