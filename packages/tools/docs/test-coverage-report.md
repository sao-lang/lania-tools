# 单测覆盖率报告

> 最近一次更新：2026-10-19。`src/axios/**` 已纳入覆盖率统计。

## 一、测试运行结果

| 指标 | 数值 |
| --- | --- |
| 测试文件总数 | 23 个 |
| 通过测试 | 656 个 |
| 失败测试 | 0 个 |
| 未处理错误 | 0 个 |
| 语句覆盖率 | 99.59% |
| 分支覆盖率 | 97.14% |
| 函数覆盖率 | 97.05% |

运行方式：

```bash
npx vitest run --coverage
```

质量门（`vitest.config.ts`）：语句 ≥ 95%、分支 ≥ 90%、函数 ≥ 90%、行 ≥ 95%。

## 二、测试分层

| 层次 | 文件 | 说明 |
| --- | --- | --- |
| 后端辅助系统 | `tests/server/test-server.ts` | 真实 HTTP 服务端：双 Token、分片上传、重试、取消、轮询、下载、SSE |
| Manager 单元测试 | `tests/axios/managers.test.ts` | 常量、请求 Key、缓存、取消令牌、防抖节流、并发、轮询 |
| 上传单元测试 | `tests/axios/upload-manager.test.ts` | 分片 MD5、文件 MD5、Worker / 主线程回退、重试、并发、断点续传 |
| 请求层集成 | `tests/axios/wrapper.integration.test.ts` | HTTP 方法、Token、拦截器、业务 code、缓存、防抖节流、重试、取消、并发、轮询、工厂 |
| 双 Token 集成 | `tests/axios/double-token.integration.test.ts` | 并发单次刷新、轮换、过期、失败、防死循环 |
| 上传集成 | `tests/axios/upload.integration.test.ts` | 12MB 真实分片、续传、重试、并发上限、取消、MD5 合并校验 |
| 下载集成 | `tests/axios/download.integration.test.ts` | 文件名解析、资源清理、取消、失败 |
| Worker | `tests/axios/md5-worker.test.ts` | Web Worker 分片 MD5 与错误分支 |
| 日志单元测试 | `tests/logger.test.ts` | 级别、命名空间、上下文、历史、handler、格式化、全局控制 |
| 边界补全 | `tests/edge-cases.test.ts` | 各模块未覆盖分支 |

## 三、各文件覆盖率

| 源文件 | 语句 | 分支 | 函数 | 状态 |
| --- | --- | --- | --- | --- |
| `carousel.ts` | 100% | 100% | 100% | ✅ |
| `convert-chinese-text.ts` | 100% | 96.15% | 100% | ✅ |
| `draggable.ts` | 100% | 100% | 100% | ✅ |
| `event-bus.ts` | 100% | 100% | 100% | ✅ |
| ormat-time.ts | 100% | 100% | 100% | ✅ |
| `logger.ts` | 100% | 100% | 100% | ✅ |
| `sse-client.ts` | 100% | 100% | 90.9% | ✅ |
| `store.ts` | 100% | 98.38% | 100% | ✅ |
| `tools.ts` | 100% | 96.96% | 100% | ✅ |
| `type.ts` | 100% | 100% | 100% | ✅ |
| `validator.ts` | 100% | 100% | 100% | ✅ |
| `virtual-scroller.ts` | 100% | 94.91% | 100% | ✅ |
| `web-storage-helper.ts` | 99.56% | 92.62% | 88.46% | ✅ |
| `websocket-client.ts` | 100% | 97.14% | 87.5% | ✅ |
| `axios/CacheManager.ts` | 100% | 100% | 100% | ✅ |
| `axios/CancelTokenManager.ts` | 100% | 100% | 100% | ✅ |
| `axios/DebounceThrottleManager.ts` | 100% | 100% | 100% | ✅ |
| `axios/GlobalConcurrencyController.ts` | 100% | 100% | 100% | ✅ |
| `axios/InterceptorManager.ts` | 97.96% | 97.11% | 100% | ✅ |
| `axios/PollingManager.ts` | 100% | 95.45% | 100% | ✅ |
| `axios/UploadManager.ts` | 100% | 100% | 100% | ✅ |
| `axios/const.ts` | 100% | 100% | 100% | ✅ |
| `axios/helper.ts` | 100% | 100% | 100% | ✅ |
| `axios/index.ts` | 97.83% | 87.36% | 100% | ✅ |
| `axios/md5-calculator.worker.ts` | 93.54% | 100% | 75% | ✅ |

未覆盖的少量分支主要是浏览器 / SSR 环境下不可达的防御性代码（例如非 Worker 环境的兜底、未被触发的 `onerror` 回调），已在源码中标注用途。

***

## 四、测试过程中发现并修复的源码缺陷

| # | 文件 | 问题 | 修复 |
| --- | --- | --- | --- |
| 1 | `axios/helper.ts` | `params`/`data` 用真值判断，`0`/`false`/`''` 与空值生成相同 Key | 仅 `null`/`undefined` 视为空 |
| 2 | `axios/GlobalConcurrencyController.ts` | 排队任务同步抛错时 `activeCount` 不回退，队列死锁 | `Promise.resolve().then()` 包裹任务 |
| 3 | `axios/UploadManager.ts` | 重试在并发槽位内递归，`maxConcurrent=1` 时自锁 | 重试循环移到槽位之外 |
| 4 | `axios/UploadManager.ts` | 无 `Worker` 环境无法计算文件 MD5 | 增加主线程分片计算回退 |
| 5 | `axios/UploadManager.ts` | `FileReader` 不可用时无法读取分片 | 优先 `Blob.arrayBuffer()` |
| 6 | `axios/InterceptorManager.ts` | `isCancelError` 判断写错，防抖/节流取消被当成网络错误 | 正确识别取消来源 |
| 7 | `axios/InterceptorManager.ts` | 重试成功后的响应被丢弃，仍抛原错误 | 返回恢复后的响应 |
| 8 | `axios/InterceptorManager.ts` | 缓存命中通过 reject 假响应实现，导致真实请求或异常 | 替换 `adapter` 短路 |
| 9 | `axios/CacheManager.ts` | 会把业务响应的 `data` 字段误当响应体解包 | 仅解包真正的 `AxiosResponse` |
| 10 | `axios/index.ts` | 重试递归进入拦截器，重复 `onError` | 新增无拦截器 `retryInstance` |
| 11 | `axios/index.ts` | `get()` 的第二参数回退到 `config.data` 而非 `config.params` | 修正回退目标 |
| 12 | `axios/index.ts` | 下载文件名优先取 `filename`，中文名丢失；URL 回退带 query | 按 RFC 6266 优先 `filename*`，剥离 query |
| 13 | `axios/index.ts` | 100ms 后无条件 `removeChild`，页面已卸载时抛错 | 检查 `parentNode` |
| 14 | `axios/index.ts` | 并发刷新失败会为每个等待者各通知一次登出 | 通知移入刷新单例内部 |
| 15 | `axios/InterceptorManager.ts` | 重放请求被 `tokenProvider` 的旧值覆盖 | 重放请求跳过 Token 注入 |
| 16 | `websocket-client.ts` | 构造后不连接、手动关闭后仍重连、重连定时器不清理 | 构造函数连接并补全生命周期 |
| 17 | `sse-client.ts` | 手动关闭后仍自动重连 | 关闭时清理定时器并置标记 |
| 18 | `web-storage-helper.ts` | `CookieHelper.delete` 未带 `path=/`，删不掉已写入的 Cookie | 删除时补上 `path=/` |
| 19 | `web-storage-helper.ts` | `IndexedDBHelper.keys()` 调用两次 `openCursor()`，`onerror` 监听的是另一个请求 | 复用同一个 request |
| 20 | `src/index.ts` | 全量入口漏导出 `event-bus` / `websocket-client` / `carousel` / `virtual-scroller` | 补齐全部模块导出，并导出各模块选项类型 |
