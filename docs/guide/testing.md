# 测试与质量保障

这套库的测试目标不是让覆盖率数字好看，而是**证明困难场景真的可用**。

## 运行

```bash
# 全量测试
npx vitest run

# 覆盖率（含阈值校验）
npx vitest run --coverage

# 只跑请求层
npx vitest run packages/tools/tests/axios

# 单个文件
npx vitest run packages/tools/tests/axios/double-token.integration.test.ts

# 按名称过滤
npx vitest run -t "refreshes only once"
```

## 当前结果

| 指标 | 数值 |
| --- | --- |
| 测试文件 | 23 |
| 用例 | 656 |
| 语句覆盖率 | 99.59% |
| 分支覆盖率 | 97.14% |
| 函数覆盖率 | 97.05% |

覆盖率配置（`vitest.config.ts`）：

```ts
test: {
    environment: 'jsdom',
    globals: true,
    include: ['packages/**/tests/**/*.test.ts'],
    coverage: {
        provider: 'v8',
        include: ['packages/**/src/**/*.ts'],
        exclude: ['packages/**/src/index.ts'],
        thresholds: { statements: 95, branches: 90, functions: 90, lines: 95 },
    },
}
```

## 两层测试

| 层次 | 目的 | 典型位置 |
| --- | --- | --- |
| 单元测试 | 验证单个模块的行为、参数、边界 | `tests/*.test.ts` |
| 集成测试 | 验证跨模块行为与真实协议 | `tests/axios/*.integration.test.ts` |

单元测试用 mock 控制时间与外部依赖；集成测试启动真实 HTTP 服务端，用真实网络、真实 multipart、真实并发。

### 环境选择

```ts
// 真实 HTTP、二进制、Worker 回退 → Node 环境
// @vitest-environment node
```

```ts
// DOM 组件、下载、剪贴板 → jsdom
// @vitest-environment jsdom
```

默认是 jsdom（见配置），需要 Node 原生能力的文件在首行声明 `// @vitest-environment node`。

## 测试服务端

文件：`packages/tools/tests/server/test-server.ts`（零第三方依赖）。

### 为什么需要它

用 mock 验证请求层有三个盲区：

1. **Axios 的真实行为**：拦截器链、adapter 替换、`CancelToken`、`responseType: 'blob'`，mock 很容易把库的行为假设错。
2. **并发与时序**：双 Token 必须证明「并发 5 个请求只刷新 1 次」，只有服务端统计真实到达次数才能验证。
3. **二进制与 multipart**：分片上传的 FormData 编码、断点续传、MD5 校验，必须让服务端解析真实字节流。

### 启停

```ts
const server = new TestServer({ accessTtlMs: 60_000, authErrorMode: 'business' });
await server.start();      // 随机端口
server.baseURL;            // http://127.0.0.1:<port>
await server.stop();       // 关闭并销毁 keep-alive socket
server.reset();            // 清空计数与状态
```

### 路由

| 路由 | 说明 |
| --- | --- |
| `GET /health` | 健康检查 |
| `GET/POST/PUT/DELETE/PATCH /echo` | 回显 method / query / body / headers |
| `GET /headers` | 只回显 headers |
| `GET /delay/:ms`、`GET /delay?ms=` | 延迟响应 |
| `GET /status?code=` | 返回指定 HTTP 状态码 |
| `GET /business/:code` | HTTP 200 + 业务 code |
| `GET /flaky?key=&failures=` | 前 N 次失败，之后成功 |
| `GET /stats` | 请求数、最大并发、刷新次数、分片记录 |
| `POST /auth/login` | 发放 access / refresh |
| `POST /auth/refresh` | 刷新（单次使用、可延迟、可失败） |
| `GET /protected/resource` | Bearer 校验，返回过期业务 code |
| `POST /upload/chunk` | 手写 multipart 解析 |
| `GET /upload/uploaded?fileMd5=` | 已上传分片 |
| `POST /upload/merge` | 拼接 + 缺失校验 + MD5 |
| `GET /upload/file/:md5` | 下载合并结果 |
| `GET/POST /download/report` | 各种 `Content-Disposition` |
| `GET/POST /download/bytes?size=` | 指定长度二进制 |
| `GET /poll/:key` | 轮询计数与失败注入 |
| `GET /sse?events=&interval=` | SSE 推送 |

### 可编程控制

```ts
server.expireAccessTokens();       // 让所有 access 立即失效
server.expireRefreshTokens();      // 让所有 refresh 立即失效
server.forceAccessTokenExpiry();   // 受保护接口永远返回过期 code
server.failNextChunks(1, 2);       // 1 号分片失败 2 次
server.failRefresh = true;         // 刷新接口返回 500
server.refreshDelayMs = 80;        // 放大并发刷新竞态窗口
server.uploadDelayMs = 80;         // 放大上传并发窗口
```

### 统计字段

```ts
server.requestCount;          // 总请求数
server.maxActiveRequests;     // 观测到的最大并发
server.abortedRequests;       // 被中断的请求数
server.refreshCalls;          // 刷新接口被调用次数
server.refreshSuccessCalls;   // 刷新成功次数
server.tokenSeq;              // 已发放的 token 代数
server.chunkRequests;         // 每个分片的详细信息
server.maxConcurrentUploads;  // 上传分片最大并发
```

## 困难场景怎么测

### 双 Token

```ts
it('refreshes only once for concurrent expired requests', async () => {
    const pair = server.login();
    store = { access: pair.accessToken, refresh: pair.refreshToken };
    const { wrapper } = createTokenWrapper(server, store);

    server.expireAccessTokens();
    server.refreshDelayMs = 80;   // 放大竞态窗口

    const responses = await Promise.all(
        Array.from({ length: 5 }, () => wrapper.get('/protected/resource')),
    );

    expect(server.refreshCalls).toBe(1);
    expect(new Set(responses.map((r) => r.data.data.token)).size).toBe(1);
});
```

覆盖的边界：并发单次刷新、令牌轮换、两轮刷新、Refresh 过期、刷新接口失败、缺少 refresh、未配置刷新函数、非法返回值、并发失败只通知一次、防死循环、`tokenProvider` 返回旧值、`enableDoubleToken: false`、无关 code、HTTP 401 不触发。

### 大文件上传

使用真实 `CHUNK_SIZE = 5MB`，不 mock 常量：

```ts
it('uploads every chunk and merges into a byte-identical file', async () => {
    const size = 12 * MB;              // 5 + 5 + 2
    const expected = createBuffer(size);
    const file = makeFile(size);

    const result = await wrapper.uploadFile('/upload/chunk', file, {
        calculateChunkMd5: true,
    });

    const merged = await wrapper.post('/upload/merge', {
        fileMd5: result.fileMd5,
        totalChunks: result.totalChunks,
    });

    expect(merged.data.data.md5).toBe(md5Of(expected));
});
```

覆盖的边界：完整性、断点续传只传缺失分片、分片重试、并发上限、取消、永久失败不合并、整数倍大小、空文件。

### 下载

jsdom + 真实服务端，断言：

- 文件名优先级（参数 → `filename*` → `filename` → URL → `download_file`）；
- 100ms 后移除 `<a>` 并 `revokeObjectURL`；
- 失败不触发点击；
- 成功 / 失败都清理取消令牌。

## 写新测试的约定

1. **优先断言行为**，而不是实现细节。私有字段只在难以触发的分支上使用。
2. **时间相关用假定时器**：`vi.useFakeTimers()`；涉及真实 HTTP 时不要混用假定时器。
3. **每个集成测试文件独立起服务**：随机端口，`afterAll` 关闭。
4. **避免固定 sleep 断言**：改为轮询等待（`waitUntil`），否则并行执行时会 flaky。
5. **修改源码后**：先跑相关文件，再跑全量 `npx vitest run --coverage`。

### 示例：轮询等待

```ts
async function waitUntil(condition: () => boolean, timeout = 2000, interval = 10) {
    const startedAt = Date.now();
    while (!condition()) {
        if (Date.now() - startedAt > timeout) throw new Error('waitUntil timed out');
        await new Promise((resolve) => setTimeout(resolve, interval));
    }
}
```

## 已知环境差异

### 1. Axios 异步拦截器不会回调同一个 `onRejected`

```js
instance.interceptors.request.use(
  async () => { throw new Error('boom'); },
  async () => { /* 不会执行 */ },
);
```

因此本库把错误恢复放在 `onFulfilled` 的 `catch` 中，`onRejected` 仅作为其他拦截器抛错的兜底。详见 [拦截器管道](/axios/interceptors)。

### 2. Node 没有 Worker / FileReader

`UploadManager.calculateFileMd5` 会自动回退到主线程 + `Blob.arrayBuffer()`；Worker 分支通过 `vi.stubGlobal('Worker', FakeWorker)` 覆盖。

### 3. jsdom 与 Node 的 Blob / FormData 行为不同

集成测试优先用 Node 环境；DOM 相关（下载、剪贴板、组件）用 jsdom。

## 覆盖率报告

详细的分文件覆盖率与已修复缺陷清单见 `packages/tools/docs/test-coverage-report.md`。
