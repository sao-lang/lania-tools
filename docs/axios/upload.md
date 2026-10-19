# 大文件分片上传

`UploadManager` 把文件切成固定大小的分片并发上传，支持断点续传、分片校验与失败重试。

## 为什么分片

| 问题 | 单次上传 | 分片上传 |
| --- | --- | --- |
| 网络中断 | 整个文件重传 | 只重传失败分片 |
| 网关超时 | 大文件容易触发 | 每片独立完成 |
| 进度 | 只能整体 | 可精确到分片 |
| 并发 | 单连接 | 多分片并行 |
| 校验 | 只能整体 | 可分片校验 |

默认分片大小 `CHUNK_SIZE = 5 * 1024 * 1024`（5MB）。

## 快速开始

```ts
const http = new AxiosWrapper({ baseURL: '/api' }, { maxConcurrent: 3 });

const { fileMd5, totalChunks } = await http.uploadFile('/upload/chunk', file, {
    calculateChunkMd5: true,
    onChunkProgress: (chunkIndex, totalChunks, loaded, total) => {
        console.log(`分片 ${chunkIndex + 1}/${totalChunks}: ${loaded}/${total}`);
    },
    onProgress: (finished, total) => {
        console.log(`总进度 ${finished}/${total}`);
    },
});

await http.post('/upload/merge', { fileMd5, totalChunks });
```

## 配置

```ts
interface UploadFileOptions {
    maxConcurrent?: number;
    enableResume?: boolean;
    calculateChunkMd5?: boolean;
    getUploadedChunksUrl?: string;
    onChunkProgress?: (chunkIndex, totalChunks, loaded, total) => void;
    onProgress?: (finished, total) => void;
    cancelToken?: CancelTokenSource;
    cancelTokenId?: string;
}
```

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `maxConcurrent` | — | **保留字段**，实际使用全局并发控制器 |
| `enableResume` | `false` | 是否查询已上传分片 |
| `calculateChunkMd5` | `false` | 是否计算每个分片的 MD5 |
| `getUploadedChunksUrl` | 无 | 已上传分片查询地址 |
| `onChunkProgress` | 无 | 分片进度 |
| `onProgress` | 无 | 已完成分片数 |
| `cancelTokenId` | 无 | 取消标识 |
| `cancelToken` | 自动创建 | 由 Wrapper 注入 |

## 返回值

```ts
{ fileMd5: string; totalChunks: number }
```

**合并请求不内置**。不同后端的合并协议差异很大（是否需要文件名、分片总数、是否异步），因此由调用方发起。

## 完整流程

```text
uploadFile(url, file, options)
  │
  ├─ 1. 计算文件 MD5
  │     ├─ 有 Worker → new Worker(md5-calculator.worker)
  │     └─ 无 Worker → 主线程按 chunkSize 分片读取（Blob.arrayBuffer）
  │
  ├─ 2. 断点续传（可选）
  │     └─ GET `${getUploadedChunksUrl}?fileMd5=${fileMd5}`
  │          → { uploaded: number[] }
  │
  ├─ 3. 生成待上传索引
  │     └─ 过滤掉 uploaded 中的索引
  │
  ├─ 4. 并发上传每个分片
  │     ├─ file.slice(start, end)
  │     ├─ 可选 calculateChunkMd5
  │     ├─ FormData(file, chunkIndex, totalChunks, fileMd5?, chunkMd5?)
  │     ├─ 每次尝试 concurrencyController.run(post)
  │     └─ 失败重试（最多 3 次，间隔 1s）
  │
  └─ 5. 返回 { fileMd5, totalChunks }
```

## 请求协议

每个分片：

```http
POST /upload/chunk
Content-Type: multipart/form-data

file=<binary>
chunkIndex=0
totalChunks=3
fileMd5=<整体 md5>
chunkMd5=<分片 md5，可选>
```

断点续传查询：

```http
GET /upload/uploaded?fileMd5=xxx
→ { "uploaded": [0, 2] }
```

> `UploadManager` 期望响应体**直接**是 `{ uploaded: [...] }`。如果后端统一返回 `{ code, data }`，需要用 `responseHandler` 解包：

```ts
const http = new AxiosWrapper(
    { baseURL: '/api' },
    {
        responseHandler: (response) => ({
            ...response,
            data: response.data?.data ?? response.data,
        }),
    },
);
```

## 实现要点

### 1. 重试必须在并发槽位之外

```ts
// ❌ maxConcurrent = 1 时自锁
controller.run(async () => {
    try { await post(); }
    catch { return controller.run(() => post()); }
});
```

```ts
// ✅ 每次尝试单独占槽
for (let attempt = 0; attempt <= retryTimes; attempt++) {
    try {
        await controller.run(() => post());
        return;
    } catch (error) {
        if (attempt < retryTimes) await delay(retryDelay);
    }
}
```

测试 `releases the concurrency slot while waiting to retry (no deadlock with limit 1)`。

### 2. 取消不重试

```ts
if (axios.isCancel(error)) {
    throw new Error('Upload canceled by user signal.');
}
```

否则用户取消后仍会继续重试。

### 3. 无 Worker 环境要能工作

```ts
if (typeof Worker === 'undefined') {
    return this.calculateFileMd5InMainThread(file, chunkSize);
}
```

分片读取优先 `Blob.arrayBuffer()`，不可用时回退 `FileReader`。

### 4. 进度回调可能多次触发

`onChunkProgress` 来自 axios 的 `onUploadProgress`，同一分片可能触发多次。用第一个参数 `chunkIndex` 判断分片，不要用调用次数。

```ts
onChunkProgress: (chunkIndex, totalChunks, loaded, total) => {
    percents[chunkIndex] = total ? loaded / total : 0;
    onPercent(
        Object.values(percents).reduce((sum, value) => sum + value, 0) / totalChunks,
    );
},
```

## 断点续传完整示例

```ts
export async function uploadWithResume(file: File) {
    const { fileMd5, totalChunks } = await http.uploadFile('/upload/chunk', file, {
        enableResume: true,
        getUploadedChunksUrl: '/upload/uploaded',
        calculateChunkMd5: true,
        onProgress: (finished, total) => showProgress(finished / total),
    });

    const merged = await http.post('/upload/merge', { fileMd5, totalChunks });
    if (merged.data.code !== 0) throw new Error('merge failed');
    return merged.data.data;
}
```

## 取消完整示例

```ts
const task = http.uploadFile('/upload/chunk', file, {
    cancelTokenId: 'upload-1',
    onProgress: (finished, total) => showProgress(finished / total),
});

document.getElementById('cancel')!.addEventListener('click', () => {
    http.cancelRequest('upload-1');
});

try {
    await task;
} catch (error) {
    if (String(error).includes('canceled')) toast('已取消上传');
}
```

## 性能建议

| 场景 | 建议 |
| --- | --- |
| 内网高速 | `maxConcurrent` 4~6 |
| 弱网移动端 | 2~3 |
| GB 级文件 | 增大 `CHUNK_SIZE` 到 10MB+ |
| 秒传 | 先上传 `fileMd5`，服务端命中则直接返回 |
| MD5 性能 | 只在服务端需要校验时开 `calculateChunkMd5` |

## 注意事项

1. **合并必须由调用方触发**，并处理「分片齐全但合并失败」的重试。
2. **`fileMd5` 是续传主键**，服务端必须稳定保存。
3. **上传请求不经过缓存与防抖中间件**（直接 `instance.post`），但仍受并发控制。
4. **空文件**：`totalChunks = 0`，不会发出任何分片请求。
5. **恰好整数倍**：分片数 = `size / CHUNK_SIZE`，最后一片不需要额外空片。

## 测试覆盖

单元测试 `upload-manager.test.ts`（21 个用例）：

- 分片 MD5、文件 MD5、Worker 与主线程回退；
- multipart 字段、取消令牌、进度回调；
- 重试成功 / 耗尽 / 取消不重试；
- 并发上限、重试与槽位；
- 断点续传、空文件、整数倍、错误传播。

集成测试 `upload.integration.test.ts`（8 个用例，真实 5MB 分片）：

- 12MB 上传 + 合并 + 下载逐字节比对 + MD5 一致；
- 续传只传缺失分片；
- 分片失败重试；
- 并发上限 ≤ 2；
- 取消；
- 永久失败不合并；
- 整数倍分片；
- 空文件。
