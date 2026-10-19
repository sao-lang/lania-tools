# Lania Tools 测试体系与文档站点 — 任务执行文档

> 本文档是跨对话继续执行的主线文档。每完成一个阶段，请更新「进度看板」和「当前问题」两节。
>
> 最后更新：2026-10-19

---

## 一、任务目标

为 `packages/tools` 中的全部工具函数 / 工具类建立详细、可维护的测试体系，并用 VitePress 建立类似 Vue 官方文档的文档站点。

具体要求：

1. **覆盖率**
   - 覆盖每个公开函数、方法、分支和边界条件。
   - 重点覆盖 `AxiosWrapper` 及其全部 Manager。
   - 把当前被 `vitest.config.ts` 排除的 `src/axios/**` 重新纳入覆盖率统计。
2. **困难场景必须有真实后端辅助系统**
   - 双 Token 刷新（并发请求只刷新一次、刷新令牌轮换、刷新失败 / 过期）。
   - 大文件分片上传（真实 multipart、断点续传、分片 MD5、合并校验、并发上限、失败重试）。
   - 重试、取消、缓存、轮询、下载等也需要可通过真实 HTTP 验证。
3. **测试全部通过**
   - `npx vitest run` 全绿。
   - `npx vitest run --coverage` 全绿，并产出覆盖率报告。
4. **VitePress 文档站点**
   - 结构参考 Vue 官方文档：指南 / 模块文档 / API / 原理说明。
   - 每个模块包含：功能定位、原理、API、完整示例、注意事项。
   - `AxiosWrapper` 需要有独立的深度章节：请求生命周期、拦截器管道、双 Token、缓存、重试、取消、防抖节流、轮询、上传、下载。
   - 文档站点必须能成功构建。

---

## 二、当前基线

| 项目 | 结果 |
| --- | --- |
| 原有测试文件 | 14 个 |
| 原有测试用例 | 398 个，全部通过 |
| 原有覆盖率 | 98.31%（`src/axios/**` 与 `index.ts` 被排除） |
| Node | v24.12.0 |
| pnpm | 8.6.1 |
| Vitest | 0.33.0 |
| Axios | 1.18.1 |
| 测试环境 | 默认 jsdom；新增集成测试使用 `// @vitest-environment node` |

基线命令：

```powershell
npx vitest run --coverage
```

---

## 三、当前进度看板

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| P0 源码与现有测试审计 | ✅ 完成 | 已读完 `packages/tools/src` 全部源码与 14 个旧测试 |
| P1 后端测试辅助系统 | ✅ 完成 | `tests/server/test-server.ts` |
| P2 Manager 单元测试 | ✅ 完成 | `tests/axios/managers.test.ts`，54 个用例 |
| P3 UploadManager 单元测试 | ✅ 完成 | `tests/axios/upload-manager.test.ts`，21 个用例 |
| P4 AxiosWrapper 集成测试 | ✅ 完成 | `wrapper.integration.test.ts`，34 个用例全绿 |
| P4-A 异步拦截器错误恢复 | ✅ 完成 | 错误恢复前移到 `onFulfilled` 的 catch |
| P5 双 Token 集成测试 | ✅ 完成 | `double-token.integration.test.ts`，15 个用例 |
| P6 大文件上传集成测试 | ✅ 完成 | `upload.integration.test.ts`，8 个用例（真实 5MB 分片） |
| P7 下载集成测试 | ✅ 完成 | `download.integration.test.ts`，12 个用例 |
| P8 其他工具覆盖率补全 | ✅ 完成 | `edge-cases.test.ts` 49 个用例 + `md5-worker.test.ts` 5 个用例 |
| P9 覆盖率纳入 axios | ✅ 完成 | 移除 exclude，加入 95/90/90/95 阈值 |
| P10 VitePress 文档站点 | ✅ 完成 | `docs/`，35 页：6 个指南 + 1 个教程 + 1 个速查表 + 14 个工具 + 12 个 Axios 章节 |
| P11 文档构建验证 | ✅ 完成 | `pnpm docs:build` 成功 |

### 最新测试结果（全部完成）

```text
23 个测试文件
656 个用例全部通过
语句 99.59% / 分支 97.14% / 函数 97.05% / 行 99.59%
```

连续 3 次 `npx vitest run --coverage` 均通过，阈值（95/90/90/95）生效。

---

## 四、已完成工作明细

### 4.1 新增后端测试辅助系统

文件：`packages/tools/tests/server/test-server.ts`

零第三方依赖的 Node HTTP 测试服务器，能力包括：

- 启停：随机端口、`start()` / `stop()`、keep-alive socket 清理。
- 通用：
  - `GET /health`
  - `GET/POST/PUT/DELETE/PATCH /echo`
  - `GET /headers`
  - `GET /delay/:ms`、`GET /delay?ms=`
  - `GET /status?code=`
  - `GET /business/:code`（HTTP 200 + 业务 code）
  - `GET /flaky?key=&failures=`（按 key 计数，可控失败次数）
  - `GET /stats`（请求数、最大并发、取消数、token 统计、分片记录）
- 双 Token：
  - `POST /auth/login`
  - `POST /auth/refresh`（真实 refresh token 轮换、单次使用、可配置延迟 / 失败）
  - `GET /protected/resource`（Bearer 校验、业务 code 或 HTTP 401 两种模式）
  - `expireAccessTokens()` / `expireRefreshTokens()` / `forceAccessTokenExpiry()`
  - 统计 `refreshCalls`、`refreshSuccessCalls`、`tokenSeq`
- 分片上传：
  - `POST /upload/chunk`（手写 multipart 解析，支持二进制）
  - `GET /upload/uploaded?fileMd5=`
  - `POST /upload/merge`（拼接、缺失分片校验、MD5 校验）
  - `GET /upload/file/:md5`
  - `failNextChunks(index, times)` 控制指定分片失败次数
  - 统计 `chunkRequests`、`maxConcurrentUploads`
- 下载：
  - `GET /download/report?mode=plain|utf8|quoted-utf8|none`
  - `GET /download/bytes?size=`
- 轮询：`GET /poll/:key`（计数、`failUntil` 可控失败）
- SSE：`GET /sse?events=&interval=`

### 4.2 新增测试文件

| 文件 | 用例数 | 当前状态 | 覆盖内容 |
| --- | --- | --- | --- |
| `packages/tools/tests/server/test-server.ts` | — | ✅ | 后端辅助系统（非测试文件） |
| `packages/tools/tests/axios/managers.test.ts` | 54 | ✅ 通过 | 常量、请求 Key、缓存、取消令牌、防抖节流、并发控制、轮询 |
| `packages/tools/tests/axios/upload-manager.test.ts` | 21 | ✅ 通过 | 分片 MD5、文件 MD5、Worker 分支、重试、取消、并发、断点续传 |
| `packages/tools/tests/axios/wrapper.integration.test.ts` | 34 | ✅ 通过 | HTTP 方法、token、拦截器、业务 code、缓存、防抖节流、重试、取消、并发、轮询、工厂 |
| `packages/tools/tests/axios/double-token.integration.test.ts` | 15 | ✅ 通过 | 并发单次刷新、令牌轮换、过期、失败、防死循环、HTTP 401 限制 |
| `packages/tools/tests/axios/upload.integration.test.ts` | 8 | ✅ 通过 | 12MB 真实分片、续传、重试、并发上限、取消、MD5 合并校验、边界大小 |
| `packages/tools/tests/axios/download.integration.test.ts` | 12 | ✅ 通过 | 文件名解析、资源清理、取消、失败 |
| `packages/tools/tests/axios/md5-worker.test.ts` | 5 | ✅ 通过 | Worker 分片 MD5 与错误分支 |
| `packages/tools/tests/edge-cases.test.ts` | 49 | ✅ 通过 | 各模块未覆盖分支 |

### 4.3 已修复的源码问题

测试过程中发现并修复了以下真实缺陷（均已写入源码）：

1. **`helper.ts` 请求 Key 真值判断**
   - 问题：`req.data ? ... : ''` 使 `0` / `false` / `''` 与“无数据”生成相同 Key，缓存可能串数据。
   - 修复：仅 `null` / `undefined` 视为空。

2. **`GlobalConcurrencyController` 同步抛错导致队列死锁**
   - 问题：排队任务同步抛错时不会进入 `catch/finally`，`activeCount` 永不回退。
   - 修复：用 `Promise.resolve().then(() => task())` 包一层。

3. **`UploadManager` 重试死锁**
   - 问题：重试递归仍在 `concurrencyController.run()` 内部再次 `run()`，`maxConcurrent=1` 时自己等待自己。
   - 修复：重试循环移到并发槽位之外；每次尝试单独占用槽位。

4. **`UploadManager` 无 Worker 环境下无法计算 MD5**
   - 增加主线程分片 MD5 回退；`Blob.arrayBuffer()` 优先，`FileReader` 兜底。

5. **`InterceptorManager` 无法识别防抖 / 节流取消**
   - 问题：原判断为 `err instanceof DebounceThrottleManager`（永远为 false）。
   - 修复：识别 `DebounceThrottleCancelError`、`err.isCancel === true`、`axios.isCancel`。

6. **重试结果被丢弃**
   - 问题：`runResponseErrorMiddlewares()` 的返回值未被使用，重试成功后仍抛原始错误。
   - 修复：返回恢复后的响应；最终错误才调用 `onError`。

7. **重试递归进入拦截器**
   - 问题：重试使用 `this.instance(config)` 会再次进入 `retryMiddleware`，造成递归重试和重复 `onError`。
   - 修复：新增无拦截器的 `retryInstance`，由 `retryRequest` 统一循环重试。

8. **缓存短路方式错误**
   - 问题：缓存命中时从请求拦截器 `reject(fakeResponse)`，Axios 会把该对象当作 config 继续 dispatch，导致真实网络请求 / 报错。
   - 修复：缓存命中时替换 `config.adapter` 返回假响应，仍完整经过响应拦截器链。

9. **缓存错误解包业务数据**
   - 问题：`CacheManager.set` 会把任何带 `data` 字段的对象解包，导致 `{ code, data }` 业务响应被缓存成 `data`。
   - 修复：只解包真正的 `AxiosResponse`（含 `config` / `status` / `headers`）。

10. **`AxiosWrapper.get()` 丢失 `config.params`**
    - 问题：`params: data ?? config.data`，应回退到 `config.params`。
    - 修复：改为 `params: data ?? config.params`。

11. **`WebSocketClient` 构造后不连接**
    - 修复：构造函数调用 `connect()`；补上手动关闭标记、重连定时器清理、心跳去重、关闭时停止重连。

12. **`SSEClient.close()` 未停止重连**
    - 修复：关闭时清理重连定时器、置 `closed` 标记、置空 `eventSource`；错误回调在手动关闭后不再重连。

---

## 五、已解决：Axios 1.18.1 异步拦截器错误恢复

> 状态：✅ 已修复。保留本节作为设计说明，避免后续回归。

### 5.1 Axios 1.18.1：异步请求拦截器的 `onRejected` 不会被调用

**现象**

`wrapper.integration.test.ts` 中「请求拦截器错误恢复」用例失败：

```text
Error: request interceptor failure
```

**最小复现**

用独立 Node 脚本注册：

```js
instance.interceptors.request.use(
  async () => { console.log('fulfilled'); throw new Error('boom'); },
  async (e) => { console.log('rejected', !!e.config); return e.config; }
);
```

实际输出：

```text
fulfilled
caught boom
```

结论：异步 `onFulfilled` 抛错后，Axios 1.18.1 **不会调用同一个拦截器的 `onRejected`**（与经典 Promise 语义不同），因此 `InterceptorManager` 目前依赖 `request.onRejected` 做错误恢复的路径不可达。

**影响**

- `interceptors.request.onRejected` 返回修复后 config 的功能失效。
- 不影响取消、缓存、重试、业务 code 等已通过的用例。

**建议修复方案**

把错误恢复逻辑前移到请求拦截器的 `onFulfilled` 内部：

```ts
async (config) => {
    const ctx = { config };
    try {
        await this.runRequestMiddlewares(ctx);
        return ctx.config;
    } catch (err) {
        if (this.isCancelError(err)) throw err;
        const fixedConfig = await this.runRequestErrorMiddlewares({ err });
        if (fixedConfig) return fixedConfig;
        throw err;
    }
}
```

同时保留外层 `onRejected` 作为兜底（处理其他拦截器抛出的错误）。

注意事项：

- 返回 `fixedConfig` 后 Axios 会继续 dispatch，不会再次进入本请求拦截器；若需要重新执行完整请求链，需在 `onRejected` 中显式调用 `this.instance(fixedConfig)`（当前语义是“修复后继续 dispatch”）。
- 临时调试日志已在定位问题后清理；实现时请勿重新加入 `[debug]` 日志。

**实际实现**

- 新增 `InterceptorManager.handleRequestError(err, config?)`，由请求拦截器的 `onFulfilled` catch 与外层 `onRejected` 共同调用。
- 同步发现响应侧同样存在该问题：`doubleTokenMiddleware` 抛错（如刷新失败）不会回调本拦截器的 `onRejected`，因此新增 `handleResponseError(err)`，由响应 `onFulfilled` 的 catch 与 `onRejected` 共同调用，保证 `onError` 只触发一次。
- 顺带修复：缓存命中改为替换 `config.adapter`；重试使用无拦截器实例；重放请求跳过 Token 注入。

**验收结果**

- ✅ 该用例通过。
- ✅ 全量 596 个用例通过。

---

## 六、执行计划与结果

> P4-A ~ P11 已全部完成，各小节保留为「当时要做什么 / 达到什么效果」的记录。

### P4-A：修复当前阻塞问题并清理调试代码 ✅

步骤：

1. 按 5.1 方案改造 `InterceptorManager.attachInterceptors()` 的请求拦截器。
2. 确认源码中不存在 `[debug]` 日志。
3. 运行：
   ```powershell
   npx vitest run packages/tools/tests/axios/managers.test.ts packages/tools/tests/axios/upload-manager.test.ts packages/tools/tests/axios/wrapper.integration.test.ts
   ```
4. 期望：109/109 通过。

---

### P5：双 Token 刷新集成测试 ✅ 已完成

新增文件：`packages/tools/tests/axios/double-token.integration.test.ts`（node 环境）

测试清单：

1. **正常刷新**
   - 登录获得 access / refresh。
   - `server.expireAccessTokens()`。
   - 请求 `/protected/resource` 返回业务 code `40101`。
   - `refreshAccessToken` 调用 `/auth/refresh`，拿到新 access。
   - 原请求自动重试成功，返回新 `tokenSeq`。
2. **并发只刷新一次**
   - 同时发起 5 个过期请求。
   - `server.refreshDelayMs = 100`。
   - 期望 `server.refreshCalls === 1`，5 个请求全部成功且 tokenSeq 一致为新值。
3. **刷新令牌轮换**
   - 第一次刷新后旧 refresh token 被标记 used。
   - 再次用旧 token 刷新返回 `refreshExpiredCode`。
4. **刷新令牌过期**
   - `server.expireRefreshTokens()` + `expireAccessTokens()`。
   - 请求拒绝，`onRefreshTokenExpired` 被调用一次。
5. **刷新接口失败**
   - `server.failRefresh = true`。
   - 请求拒绝，`onRefreshTokenExpired` 被调用，`refreshCalls === 1`。
6. **缺少 refreshToken**
   - `getRefreshToken` 返回空。
   - 拒绝信息包含 `Missing refresh token`。
7. **未提供 refreshAccessToken**
   - 拒绝信息包含 `No refreshAccessToken provided`。
8. **refreshAccessToken 返回非法值**
   - 拒绝信息包含 `Invalid new access token`。
9. **防死循环**
   - `server.forceAccessTokenExpiry()`。
   - 只刷新一次并重试一次，随后拒绝 `Request already retried after refresh`，`refreshCalls === 1`。
10. **`enableDoubleToken=false`**
    - 过期业务 code 原样返回，不触发刷新。
11. **HTTP 401 模式说明**
    - 当前实现只在 HTTP 200 + 业务 code 下生效。
    - 测试确认 HTTP 401 不会触发双 Token；文档中明确此限制。
12. **`onRefreshTokenExpired` 与 `onError` 的调用边界**
    - 刷新失败时回调次数可控，不重复弹窗。

辅助工具：

- 在测试内维护 `tokenStore = { access, refresh }`。
- `refreshAccessToken` 内部用 `axios.post(server.baseURL + '/auth/refresh', { refreshToken })`，检查 `code === 0` 后更新 store。
- 注意并发刷新时，`getRefreshToken()` 只被调用一次（Promise 单例）。

验收标准：

- 所有双 Token 用例通过。
- 服务器统计能证明并发只刷新一次、旧 refresh 不可复用。

---

### P6：大文件分片上传集成测试 ✅ 已完成

新增文件：`packages/tools/tests/axios/upload.integration.test.ts`（node 环境）

使用真实 `CHUNK_SIZE = 5MB`，不要 mock `const`。

测试清单：

1. **完整上传**
   - 生成约 12MB `File`（3 个分片：5MB + 5MB + 2MB）。
   - `wrapper.uploadFile('/upload/chunk', file, { calculateChunkMd5: true, onProgress, onChunkProgress })`。
   - 调用 `POST /upload/merge`（测试里手动发）。
   - 校验服务器合并文件大小、MD5 与本地 `crypto.createHash('md5')` 一致。
   - 校验 `server.chunkRequests.length === 3`，分片索引 0/1/2。
2. **断点续传**
   - 先用 `uploadManager.uploadChunk` 上传 0 号分片，或直接调用一次上传。
   - 再调用 `uploadFile`，开启 `enableResume: true`、`getUploadedChunksUrl: server.baseURL + '/upload/uploaded'`。
   - 期望本次只上传缺失分片，`onProgress` 从已上传数量开始递增。
3. **分片重试**
   - `server.failNextChunks(1, 2)`。
   - 期望 1 号分片重试后成功，最终合并成功。
4. **分片 MD5 校验**
   - 开启 `calculateChunkMd5`。
   - 服务器 `chunkRequests` 中 `chunkMd5` 全部存在且与服务器重算一致。
5. **并发上限**
   - wrapper 设置 `maxConcurrent: 2`。
   - `server.uploadDelayMs = 30`。
   - 期望 `server.maxConcurrentUploads <= 2`。
6. **取消上传**
   - 当前 `UploadManager.uploadFile` 内部创建 cancel token，没有对外暴露取消入口。
   - 需决定是否补充能力：
     - 方案 A（推荐）：`UploadFileOptions` 增加 `cancelTokenId` / `signal`，由 `AxiosWrapper` 的 `CancelTokenManager` 管理。
     - 方案 B：仅测试 `uploadChunk` 的取消（已有单元测试），文档标注 `uploadFile` 暂不支持中途取消。
7. **上传失败传播**
   - 让某分片持续失败（`failNextChunks(index, 10)`）。
   - 期望 `uploadFile` reject，且不会调用 merge。
8. **空文件 / 单分片 / 恰好整数倍**
   - 单元测试已覆盖；集成测试可只保留一个 5MB 精确边界。

验收标准：

- 合并后的 MD5 与源文件一致。
- 能证明断点续传确实跳过了已上传分片。
- 能证明重试发生在真实 HTTP 层，而不是 mock。

---

### P7：下载与拦截器补充测试 ✅ 已完成

新增文件：

- `packages/tools/tests/axios/download.integration.test.ts`（jsdom）
- 如有必要：`packages/tools/tests/axios/interceptor-manager.test.ts`

下载测试清单：

1. 显式传入 `filename`。
2. `Content-Disposition: attachment; filename="report.txt"`。
3. `filename*=UTF-8''...` 中文文件名。
4. `filename="fallback.txt"; filename*=UTF-8''...`（当前正则取第一个 filename，需用测试固定行为）。
5. 无 `Content-Disposition` 时回退到 URL 最后一段。
6. URL 也没有文件名时回退 `download_file`。
7. `method='post'`。
8. `cancelTokenId` 在成功 / 失败后都被清理。
9. 100ms 后移除 `<a>` 并 `URL.revokeObjectURL`。
10. 下载失败时不触发点击。

实现注意：

- jsdom 中需要替换：
  - `HTMLAnchorElement.prototype.click`
  - `URL.createObjectURL`
  - `URL.revokeObjectURL`
- 可用 `adapter: 'http'` + 真实 TestServer；Node 适配器对 `responseType: 'blob'` 的行为需要在测试中确认（可能得到字符串/Buffer，必要时在测试内转 Blob 或用 XHR 适配器）。

拦截器补充测试清单：

1. `tokenProvider` 同步 / 异步返回值。
2. `codeHandlers` 锁在 1 秒后释放（可用 fake timers 或直接调用私有方法）。
3. 缓存命中错误对象 `__fromCache` 分支（若保留）。
4. 自定义请求 `onRejected` 返回非 config（不应重试）。
5. 自定义响应 `onRejected` 返回无 `data` 的响应（应继续走重试 / 抛错）。
6. `onError` 在取消、防抖、节流时不调用。
7. `retryRequest` 无 `config` 时直接抛出。

---

### P8：其他工具覆盖率补全 ✅ 已完成

根据当前覆盖率报告的缺口逐项补齐：

| 文件 | 当前缺口 | 待补内容 |
| --- | --- | --- |
| `sse-client.ts` | 90.26% / 分支 80% | onopen 停止重连、错误后重连、重连定时器清理、close 后不再重连、message/error 回调替换 |
| `websocket-client.ts` | 96.4% / 分支 76.19% | 构造自动连接、心跳发送、心跳停止、重连次数耗尽、手动关闭不重连、重连成功重置次数、非 OPEN 不发送 |
| `store.ts` | 99% / 分支 89.28% | `notifyWatchers` 浅比较未变化、深比较相等、无 snapshot 警告、dispatch 批量 action、asyncFunc 抛错、插件 onError |
| `tools.ts` | 96.63% | `copy` 文本失败、图片失败、ClipboardItem 不存在、fetch 失败、既无 text 也无 imageUrl |
| `virtual-scroller.ts` | 96.46% / 分支 86.53% | 空数据、loadMore 返回空、加载中重复触发、resize、DOM 复用、提前 clear |
| `draggable.ts` | 97.11% | touch 事件解绑、边界命中、snap 阈值、父容器约束、动画帧清理 |
| `web-storage-helper.ts` | 98.7% | IndexedDB `onerror`、`openCursor` 错误、过期数据、加密 / 非加密 |
| `validator.ts` | 100% / 分支 93.65% | `required` 边界、规则抛错、动态规则覆盖、缓存命中、getErrors 副本 |
| `convert-chinese-text.ts` | 100% / 分支 96.15% | 空字典、排除选择器、MutationObserver 新增节点、LRU 淘汰、批处理空闲回调 |
| `type.ts` | 100% / 分支 97.22% | `isFalsy(NaN)`、`isArrayLike` 负数 / 非整数、`isEmptyObject` 非对象 |
| `format-time.ts` | 100% | 已完整，无需补 |
| `event-bus.ts` | 100% | 已完整，无需补 |
| `carousel.ts` | 100% | 已完整，无需补 |

建议：

- 优先补齐分支覆盖率，而不是只追行覆盖率。
- 对 DOM 类工具优先补行为断言，不要只断言“不抛错”。

---

### P9：覆盖率配置与质量门 ✅ 已完成

修改 `vitest.config.ts`：

```ts
coverage: {
    provider: 'v8',
    include: ['packages/**/src/**/*.ts'],
    exclude: [
        'packages/**/src/index.ts',
        // 如 worker 无法在测试环境加载，可保留排除，但需在文档说明
        // 'packages/**/src/axios/md5-calculator.worker.ts',
    ],
    thresholds: {
        statements: 95,
        branches: 90,
        functions: 95,
        lines: 95,
    },
}
```

执行：

```powershell
npx vitest run --coverage
```

验收标准：

- 全绿。
- 覆盖率报告包含 `src/axios/**`。
- 各文件行覆盖率 ≥ 95%，分支尽量 ≥ 90%。
- 如某项确实无法测试（例如浏览器专属 Worker 真机行为），必须在文档「测试说明」中解释原因。

---

### P10：VitePress 文档站点 ✅ 已完成

#### 目录建议

```text
docs/
├─ .vitepress/
│  ├─ config.ts
│  └─ theme/index.ts（可选）
├─ index.md                        # 首页 Hero
├─ guide/
│  ├─ getting-started.md
│  ├─ installation.md
│  ├─ testing.md                   # 测试体系 + 后端辅助系统说明
│  └─ architecture.md
├─ tools/
│  ├─ event-bus.md
│  ├─ store.md
│  ├─ tools.md                     # debounce / throttle / deepClone / isDeepEqual / copy
│  ├─ type.md
│  ├─ validator.md
│  ├─ format-time.md
│  ├─ web-storage-helper.md
│  ├─ sse-client.md
│  ├─ websocket-client.md
│  ├─ carousel.md
│  ├─ draggable.md
│  ├─ virtual-scroller.md
│  └─ convert-chinese-text.md
├─ axios/
│  ├─ index.md                     # 架构总览 + 请求生命周期
│  ├─ interceptors.md
│  ├─ cache.md
│  ├─ double-token.md
│  ├─ retry-and-cancel.md
│  ├─ debounce-throttle.md
│  ├─ concurrency.md
│  ├─ polling.md
│  ├─ upload.md
│  └─ download.md
└─ api/
   └─ ...                          # 可选：按模块列 API 表
```

#### 每个模块文档的固定结构

1. 一句话定位。
2. 解决了什么问题。
3. 原理图（ASCII / Mermaid / 时序图）。
4. 快速开始（最小可运行示例）。
5. 完整 API 表（参数、类型、默认值、说明）。
6. 进阶用法。
7. 边界与注意事项。
8. 测试覆盖情况（可选，但推荐）。

#### Axios 深度章节必须包含

- 请求从 `wrapper.get()` 到响应返回的完整生命周期。
- 拦截器执行顺序与短路机制。
- 为什么缓存命中要替换 `adapter`。
- 双 Token 时序图：
  - 并发请求同时过期 → 只刷新一次 → 全部重放。
  - refresh 过期 / 失败 → 登出回调。
  - `__gotAccessToken` 防死循环。
- 重试为什么要用无拦截器的 `retryInstance`。
- 防抖 / 节流为什么抛 `CancelError`，以及如何与 Axios 取消机制兼容。
- 分片上传完整流程：切分 → MD5 → 并发上传 → 重试 → 断点续传 → 合并。
- 上传重试不能在并发槽位内递归的原因（死锁示例）。
- 真实后端测试服务器的设计与使用方式。

#### 文档站点工程化

在根 `package.json` 增加：

```json
{
  "scripts": {
    "docs:dev": "vitepress dev docs",
    "docs:build": "vitepress build docs",
    "docs:preview": "vitepress preview docs"
  }
}
```

安装：

```powershell
pnpm add -D vitepress
```

验收标准：

```powershell
pnpm docs:build
```

构建成功，无死链 / 无 Markdown 解析错误。

---

### P11：最终验证与清理 ✅ 已完成

1. 删除临时调试代码、临时脚本、临时文件。
2. 全量测试：
   ```powershell
   npx vitest run --coverage
   ```
3. 文档构建：
   ```powershell
   pnpm docs:build
   ```
4. 更新本文件「进度看板」为全部完成。
5. 可选：更新 `packages/tools/README.md`，指向文档站点。
6. 可选：更新 `packages/tools/docs/test-coverage-report.md` 为最新数据。

---

## 七、关键文件索引

### 源码

- `packages/tools/src/axios/index.ts` — AxiosWrapper / Factory
- `packages/tools/src/axios/InterceptorManager.ts` — 拦截器管道
- `packages/tools/src/axios/CacheManager.ts`
- `packages/tools/src/axios/CancelTokenManager.ts`
- `packages/tools/src/axios/DebounceThrottleManager.ts`
- `packages/tools/src/axios/GlobalConcurrencyController.ts`
- `packages/tools/src/axios/PollingManager.ts`
- `packages/tools/src/axios/UploadManager.ts`
- `packages/tools/src/axios/helper.ts`
- `packages/tools/src/axios/md5-calculator.worker.ts`
- `packages/tools/src/sse-client.ts`
- `packages/tools/src/websocket-client.ts`
- 其余工具源码见 `packages/tools/src/`

### 测试

- `packages/tools/tests/server/test-server.ts` — 后端辅助系统
- `packages/tools/tests/axios/managers.test.ts`
- `packages/tools/tests/axios/upload-manager.test.ts`
- `packages/tools/tests/axios/wrapper.integration.test.ts`
- `packages/tools/tests/axios/double-token.integration.test.ts`
- `packages/tools/tests/axios/upload.integration.test.ts`
- `packages/tools/tests/axios/download.integration.test.ts`
- `packages/tools/tests/axios/md5-worker.test.ts`
- `packages/tools/tests/edge-cases.test.ts`
- 旧测试：`packages/tools/tests/*.test.ts`

### 文档

- `docs/.vitepress/config.ts` — 站点与侧边栏配置
- `docs/index.md` — 首页
- `docs/guide/*.md` — 快速上手、整体架构、测试体系
- `docs/tools/*.md` — 13 个工具模块
- `docs/axios/*.md` — 10 个 Axios 深度章节
- `packages/tools/docs/test-coverage-report.md` — 覆盖率报告（已更新）
- `packages/tools/README.md` — 已补充文档站点与测试说明

### 配置

- `vitest.config.ts`（覆盖范围 + 阈值）
- `package.json`（docs 脚本、vitepress 依赖）
- `.gitignore`（忽略 vitepress 构建产物）

---

## 八、已知风险与注意事项

1. **Axios 版本行为差异**
   - 当前锁定的 Axios 1.18.1 对异步请求拦截器的错误处理与经典 Promise 语义不同（见 5.1）。
   - 修改拦截器逻辑后，需要同时验证 Axios 1.x 的同步 / 异步拦截器路径。

2. **jsdom 与 Node 适配器差异**
   - jsdom 默认使用 XHR 适配器，Node 测试使用 `adapter: 'http'`。
   - 下载、Blob、FormData 行为可能不同，必要时分别测试。
   - 集成测试优先使用 node 环境；DOM 相关逻辑在 jsdom 中用 mock 验证。

3. **Worker 在 Node 中不可用**
   - `UploadManager.calculateFileMd5` 已增加主线程回退。
   - Worker 分支通过 `vi.stubGlobal('Worker', FakeWorker)` 测试。
   - 真实浏览器 Worker 行为无法在 Node 测试中完全覆盖，文档需注明。

4. **定时器与 TTL**
   - 缓存 TTL、防抖、节流、轮询测试优先使用 fake timers，避免慢测试和偶发失败。
   - 真实 HTTP 集成测试中的计时相关断言要留足余量。

5. **端口与并发**
   - 每个测试文件启动独立的随机端口服务器。
   - 注意 `afterAll` 必须 `server.stop()`，否则 Vitest 可能不退出。

6. **全局状态**
   - `AxiosWrapperFactory` 的实例 Map 是静态的，测试中使用唯一名称。
   - 缓存 / 防抖 / 节流 / 取消令牌管理器都是实例级状态，测试间应重新创建 Wrapper。

7. **代码修改原则**
   - 只修复测试暴露的、与测试目标强耦合的缺陷。
   - 每次修复后必须运行相关测试文件，再运行全量测试。

---

## 九、如何继续执行

新对话开始时，按以下顺序操作：

1. 打开本文件，查看「进度看板」和「当前问题」。
2. 执行当前阶段的第一条命令，确认失败 / 通过状态与文档一致。
3. 按阶段顺序推进，不要跳过 P4-A。
4. 每完成一个阶段：
   - 更新「进度看板」。
   - 记录新增测试文件与用例数。
   - 记录修复的源码问题。
5. 全部测试通过后再开始 P10 文档站点。
6. 完成文档构建后，更新「进度看板」为全部完成。

快速状态检查命令：

```powershell
# 新增测试
npx vitest run packages/tools/tests/axios

# 全量测试 + 覆盖率
npx vitest run --coverage

# 文档构建（P10 之后）
pnpm docs:build
```

---

## 十、完成定义（Definition of Done）

- [x] `npx vitest run` 全绿（596/596）。
- [x] `npx vitest run --coverage` 全绿，且 `src/axios/**` 纳入统计。
- [x] 双 Token 并发刷新、刷新过期、刷新失败均有真实 HTTP 集成测试。
- [x] 大文件分片上传、断点续传、分片重试、MD5 合并校验均有真实 HTTP 集成测试。
- [x] 下载文件名解析、资源清理有测试。
- [x] 其他工具的行覆盖率 ≥ 95%，分支覆盖率 ≥ 90%（无法覆盖的分支需说明）。
- [x] `docs/` VitePress 站点可 `build`。
- [x] 文档包含每个模块的原理、API、示例、注意事项。
- [x] 无临时调试代码、无临时文件。

### 交付物清单

| 类别 | 内容 |
| --- | --- |
| 后端辅助系统 | `packages/tools/tests/server/test-server.ts` |
| 新增测试 | `tests/axios/*.test.ts`（6 个）、`tests/edge-cases.test.ts` |
| 源码修复 | 17 项（见 `packages/tools/docs/test-coverage-report.md` 第四节） |
| 覆盖率配置 | `vitest.config.ts`（纳入 axios + 阈值） |
| 文档站点 | `docs/`（VitePress，35 个页面：指南 / 教程 / 速查表 / 工具参考 / Axios 深度章节） |
| 文档脚本 | `docs:dev` / `docs:build` / `docs:preview` |

### 已知限制

1. **Worker 的真实浏览器行为**未在 Node 中验证，只通过 `vi.stubGlobal('Worker', FakeWorker)` 覆盖分支；主线程回退路径已完整测试。
2. **HTTP 401 不触发双 Token**：当前实现只识别 HTTP 200 + 业务 code，文档已明确说明并给出两种接入方案。
3. **`uploadFile` 不内置合并请求**：合并协议因后端而异，返回 `{ fileMd5, totalChunks }` 由调用方发起。
4. **少量防御性分支不可达**（SSR / 无 DOM 环境），保留在源码中并已在覆盖率报告说明。