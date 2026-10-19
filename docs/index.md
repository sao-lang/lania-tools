---
layout: home

hero:
  name: '@lania-tools/tools'
  text: 前端工具库完整手册
  tagline: 从请求层到 DOM 组件，每个特性都有原理、API、示例与测试
  image:
    src: /logo.svg
    alt: Lania Tools
  actions:
    - theme: brand
      text: 开始学习
      link: /guide/getting-started
    - theme: alt
      text: 完整 API 参考
      link: /axios/api

features:
  - title: 请求层
    details: AxiosWrapper 把并发、缓存、防抖节流、重试、取消、双 Token、轮询、分片上传、下载组织成一条可解释的拦截器管道。
  - title: 通用工具
    details: 事件总线、状态管理、表单校验、类型判断、时间格式化、结构化日志、函数与对象工具，零依赖、可树摇。
  - title: 浏览器能力
    details: localStorage / sessionStorage / cookie / IndexedDB 统一封装，SSE 与 WebSocket 自动重连与心跳。
  - title: UI 能力
    details: 轮播、拖拽、虚拟滚动，全部基于原生 DOM，无框架绑定。
  - title: 完整可学
    details: 每个模块都有完整 API 表、参数语义、返回值、错误行为、时序图和可运行示例。
  - title: 可验证
    details: 656 个测试用例，语句覆盖率 99.59%，关键场景通过真实 HTTP 服务端验证。
---

## 这个库解决什么问题

前端项目里最常见的三类重复劳动：

1. **请求层的横切关注点**：缓存、并发、重试、Token 刷新、上传下载 —— 每个项目重写一遍，且容易写错。
2. **浏览器 API 的兼容层**：存储、SSE、WebSocket、剪贴板，异常分支很多。
3. **交互组件的细节**：拖拽边界、虚拟滚动测量、轮播无缝循环，正确实现比看起来难。

`@lania-tools/tools` 把它们拆成互不耦合的模块，可以只引入需要的部分。

## 文档如何使用

| 目标 | 从这里开始 |
| --- | --- |
| 第一次安装使用 | [快速上手](/guide/getting-started) |
| 跟着做一遍完整项目 | [从零搭建一个完整模块](/guide/tutorial) |
| 理解整体设计 | [整体架构](/guide/architecture) |
| 查 API / 参数 / 类型 | [速查表](/guide/cheatsheet)、[AxiosWrapper API](/axios/api) |
| 学请求层原理 | [架构与请求生命周期](/axios/) → [拦截器管道](/axios/interceptors) |
| 直接抄业务方案 | [常见场景 Recipes](/guide/recipes) |
| 排查问题 | [常见问题 FAQ](/guide/faq)、[错误处理与排错](/axios/errors) |
| 了解测试方式 | [测试与质量保障](/guide/testing) |

## 快速示例

```ts
import { AxiosWrapper } from '@lania-tools/tools/axios-wrapper';
import { EventBus } from '@lania-tools/tools/event-bus';
import { debounce } from '@lania-tools/tools/tools';

const http = new AxiosWrapper(
    { baseURL: '/api' },
    {
        maxConcurrent: 5,
        enableCache: true,
        cacheTTL: 30_000,
        enableRetry: true,
        tokenProvider: () => localStorage.getItem('access_token') ?? '',
    },
);

const bus = new EventBus();
bus.on('search', debounce((keyword: string) => http.get('/search', { q: keyword }), 300));
```
