# Lania-Tools

企业级前端工具库 Monorepo，封装了日常开发中高频使用的工具函数和类库，覆盖 HTTP 请求、状态管理、事件总线、存储、拖拽、轮播、虚拟滚动、验证、SSE/WebSocket 等场景。

## 核心理念

**开箱即用**：每个模块独立导出，按需引入，零配置即可使用。

**渐进增强**：简单场景用函数，复杂场景用类，同样的模块提供不同层次的 API。

**类型安全**：完整的 TypeScript 类型支持，IDE 智能提示拉满。

**Tree Shaking 友好**：每个模块独立入口，打包工具可精确剔除未使用代码。

## 包概览

| 包名 | 说明 | 模块数 |
|------|------|--------|
| [@lania-tools/tools](./packages/tools/README.md) | 核心工具库，14 个模块 | 14 |
| [@lania-tools/json](./packages/json/README.md) | 简繁体中文转换字典数据 | 2 |

## 快速上手

### 安装

```bash
# 安装核心工具库
npm install @lania-tools/tools

# 安装 JSON 数据包（可选，用于简繁体转换）
npm install @lania-tools/json
```

### 按需引入

```typescript
// 从主入口引入
import { debounce, throttle, deepClone, formatTime } from '@lania-tools/tools';

// 从独立入口引入（更小的打包体积）
import { debounce, throttle } from '@lania-tools/tools/tools';
import { formatTime } from '@lania-tools/tools/format-time';
import { EventBus } from '@lania-tools/tools/event-bus';
import { Store } from '@lania-tools/tools/store';
import { AxiosWrapper } from '@lania-tools/tools/axios-wrapper';
import { Draggable } from '@lania-tools/tools/draggable';
import { WebSocketClient } from '@lania-tools/tools/websocket-client';
import { SSEClient } from '@lania-tools/tools/sse-client';
```

## 模块全景

```
lania-tools
├── packages/
│   ├── tools/                          # 核心工具库 @lania-tools/tools
│   │   └── src/
│   │       ├── index.ts                # 主入口
│   │       ├── type.ts                 # 类型判断（type, isFunction, isArray...）
│   │       ├── tools.ts                # 通用工具（debounce, throttle, deepClone, isDeepEqual）
│   │       ├── validator.ts            # 验证引擎（Validator + Rules 预设）
│   │       ├── format-time.ts          # 时间格式化（formatTime）
│   │       ├── web-storage-helper.ts   # 存储增强（LocalStorageHelper, SessionStorageHelper）
│   │       ├── event-bus.ts            # 事件总线（命名空间, 优先级, 一次性, 异步）
│   │       ├── store.ts                # 状态管理（Reducers, 派生状态, 插件, watch）
│   │       ├── sse-client.ts           # SSE 客户端（自动重连）
│   │       ├── websocket-client.ts     # WebSocket 客户端（自动重连, 心跳）
│   │       ├── draggable.ts            # 拖拽（边界限制, 吸附, 触摸）
│   │       ├── convert-chinese-text.ts # 中文文本转换（LRU 缓存, DOM 批量处理）
│   │       ├── carousel.ts             # 轮播（Slide 模式 + Marquee 跑马灯）
│   │       ├── virtual-scroller.ts     # 虚拟滚动（DOM 重用池, 二分查找）
│   │       └── axios/                  # Axios 封装
│   │           ├── index.ts            # AxiosWrapper 核心类
│   │           ├── CacheManager.ts     # 请求缓存管理
│   │           ├── CancelTokenManager.ts   # 请求取消管理
│   │           ├── DebounceThrottleManager.ts # 防抖节流管理
│   │           ├── GlobalConcurrencyController.ts # 全局并发控制
│   │           ├── InterceptorManager.ts  # 拦截器管理
│   │           ├── PollingManager.ts   # 轮询管理
│   │           ├── UploadManager.ts    # 上传管理
│   │           ├── helper.ts           # 辅助函数
│   │           └── const.ts            # 常量定义
│   │
│   └── json/                           # JSON 数据包 @lania-tools/json
│       ├── simpledToTraditional.json   # 简体 → 繁体映射
│       └── traditionalToSimpled.json   # 繁体 → 简体映射
│
├── scripts/                            # 构建脚本
│   ├── gulpfile.cjs                    # Gulp 构建配置
│   └── rollup.tools.config.js          # Rollup 打包配置
│
├── package.json                        # Monorepo 根配置
├── pnpm-workspace.yaml                 # pnpm workspace 配置
└── tsconfig.json                       # TypeScript 根配置
```

## 模块速查

| 模块 | 导出 | 一句话说明 |
|------|------|-----------|
| type | `type, isFunction, isBoolean, isNumber, isString, isArray, isObject, isEmptyObject, isArrayLike, isWindow, isHTMLElement, isPrimitive, isFalsy` | 比 typeof 更准确的类型判断 |
| tools | `debounce, throttle, deepClone, isDeepEqual` | 防抖/节流/深拷贝/深比较 |
| validator | `Validator, Rules` | 支持异步/跨字段/缓存的数据验证 |
| format-time | `formatTime` | 支持时间戳和自定义格式的时间格式化 |
| web-storage-helper | `LocalStorageHelper, SessionStorageHelper` | 带加密和 TTL 过期的存储封装 |
| event-bus | `EventBus` | 命名空间/优先级/一次性/异步事件总线 |
| store | `Store` | Reducers + 派生状态 + 插件 + watch 的状态管理 |
| sse-client | `SSEClient` | 自动重连的 SSE 客户端 |
| websocket-client | `WebSocketClient` | 自动重连 + 心跳的 WebSocket 客户端 |
| draggable | `Draggable` | 高性能 transform 拖拽（边界/吸附/触摸） |
| convert-chinese-text | `createChineseConverter, convertPageChinese` | LRU 缓存 + 批量 DOM 处理的文本替换 |
| carousel | `Carousel` | Slide 模式 + Marquee 跑马灯双模式轮播 |
| virtual-scroller | `VirtualScroller` | 不定高 + DOM 重用池 + 二分查找的虚拟滚动 |
| axios-wrapper | `AxiosWrapper` | 缓存/防抖/重试/双Token/轮询/并发控制的 Axios 封装 |

## 技术栈

- **语言**：TypeScript
- **包管理**：pnpm (Workspace)
- **构建**：Gulp + Rollup
- **版本管理**：Changesets
- **代码规范**：ESLint + Prettier + Commitlint + Husky
- **HTTP 底层**：Axios（AxiosWrapper 依赖）

## 项目结构

```
lania-tools/
├── packages/
│   ├── tools/          # 核心工具包
│   └── json/           # 数据字典包
├── scripts/            # 构建脚本
├── .changeset/         # Changesets 配置
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
├── .eslintrc.cjs
├── .prettierrc.cjs
└── commitlint.config.cjs
```

## 开发命令

```bash
# 安装依赖
pnpm install

# 构建
pnpm build

# 代码检查
pnpm eslint

# 发布
pnpm release

# 提交（规范化）
pnpm commit
```

## 与 pro-components 的关系

`lania-tools` 是底层工具库，`pro-components` 是上层组件库：

- `pro-components/ProFormN/utils/reactive.ts` 的响应式系统是一个独立的内部实现，不依赖 lania-tools
- `pro-components/ProTableN` 的 Axios 请求层可以直接使用 `AxiosWrapper` 替代
- `pro-components` 中的通用工具函数（防抖、深拷贝等）可迁移到 `lania-tools` 统一维护