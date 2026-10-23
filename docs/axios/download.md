# 文件下载

`downloadFile` 负责：请求二进制内容 → 解析文件名 → 触发浏览器下载 → 清理资源。

## 快速开始

```ts
const http = new AxiosWrapper({ baseURL: '/api' });

// 使用服务端提供的文件名
await http.downloadFile('/export/report');

// 指定文件名
await http.downloadFile('/export/report', 'get', '月报.xlsx');

// POST 下载
await http.downloadFile('/export/report', 'post', 'report.pdf', {
    data: { month: '2026-10' },
});

// 可取消
const task = http.downloadFile('/export/large', 'get', 'large.zip', {
    cancelTokenId: 'download-1',
});
http.cancelRequest('download-1');
```

## 签名

```ts
downloadFile(
    url: string,
    method?: 'get' | 'post',        // 默认 'get'
    filename?: string,
    config?: AxiosRequestConfig & { cancelTokenId?: string },
): Promise<AxiosResponse<Blob>>
```

| 参数 | 说明 |
| --- | --- |
| `url` | 下载地址 |
| `method` | `'get'` 或 `'post'` |
| `filename` | 显式文件名，优先级最高 |
| `config` | 透传 axios 配置，额外支持 `cancelTokenId` |

请求会强制 `responseType: 'blob'`。

## 执行流程

```text
downloadFile
  ├─ 1. 有 cancelTokenId → 创建并登记取消令牌
  ├─ 2. instance(url, { method, responseType: 'blob', ...config })
  ├─ 3. 解析文件名
  │     ├─ 参数 filename
  │     ├─ Content-Disposition: filename*=UTF-8''...
  │     ├─ Content-Disposition: filename="..."
  │     ├─ URL 末段（去掉 query / hash）
  │     └─ 'download_file'
  ├─ 4. URL.createObjectURL(blob)
  ├─ 5. 创建隐藏 <a download> 并 click()
  ├─ 6. 100ms 后移除 <a> 并 revokeObjectURL
  └─ 7. finally 清理取消令牌
```

## 文件名解析

按 RFC 6266 的顺序优先 `filename*`：

| 响应头 | 解析结果 |
| --- | --- |
| `attachment; filename="report.txt"` | `report.txt` |
| `attachment; filename*=UTF-8''%E6%B5%8B%E8%AF%95.txt` | `测试.txt` |
| `attachment; filename="fallback.txt"; filename*=UTF-8''%E6%B5%8B%E8%AF%95.txt` | `测试.txt` |
| `attachment`（无 filename） | URL 末段 |
| 无法解码的 `filename*` | 原始字符串 |

### 为什么优先 `filename*`

`filename` 只能放 ASCII，中文必须用 `filename*` + 百分号编码。很多服务端同时发送两者，其中 `filename` 只是降级值。若优先取 `filename`，中文名会变成乱码或 `fallback.txt`。

### URL 回退

```ts
finalFilename =
    finalFilename ||
    url.split('#')[0].split('?')[0].split('/').pop() ||
    'download_file';
```

先剥离 query / hash，否则 `/export/report?month=10` 会得到 `report?month=10`。

## 资源清理

```ts
setTimeout(() => {
    a.parentNode?.removeChild(a);
    URL.revokeObjectURL(blobUrl);
}, 100);
```

两个细节：

1. **延迟 100ms**：部分浏览器在 `click()` 后立即移除节点会取消下载；
2. **检查 `parentNode`**：组件可能在 100ms 内卸载并清空 DOM，直接 `removeChild` 会抛 `NotFoundError`。

## 取消

```ts
const task = http.downloadFile('/large.zip', 'get', 'large.zip', { cancelTokenId: 'zip' });
http.cancelRequest('zip');
```

取消后不会触发下载，令牌会被清理。

## 完整示例：带加载与错误处理的导出

```ts
import { AxiosWrapper } from '@lania-tool/tools/axios-wrapper';

const http = new AxiosWrapper({ baseURL: '/api' }, { timeout: 120_000 });

export async function exportOrders(params: { from: string; to: string }) {
    setLoading(true);
    try {
        await http.downloadFile('/export/orders', 'post', `订单_${params.from}_${params.to}.xlsx`, {
            data: params,
            cancelTokenId: 'export-orders',
        });
        toast.success('导出成功');
    } catch (error) {
        if (String(error).toLowerCase().includes('cancel')) return;
        toast.error('导出失败');
        throw error;
    } finally {
        setLoading(false);
    }
}

export function cancelExport() {
    http.cancelRequest('export-orders');
}
```

## 常见问题

### 拿到的是 JSON 错误信息

后端失败时返回 JSON，但 `responseType` 是 `blob`，于是 blob 里是错误 JSON。

兜底解析：

```ts
try {
    await http.downloadFile('/export');
} catch (error) {
    const blob = (error as any).response?.data as Blob | undefined;
    if (blob?.type?.includes('json')) {
        console.error(JSON.parse(await blob.text()));
    }
}
```

更推荐后端用 HTTP 状态码表示失败。

### 大文件内存占用

`responseType: 'blob'` 会把整个文件读进内存。超大文件建议后端返回带签名的直链，让浏览器直接下载，而不是经过 XHR。

### 下载没有触发

- 浏览器可能拦截「非用户手势」触发的下载；
- `URL.createObjectURL` 在 SSR 环境不可用；
- `document.body` 尚未挂载；
- 跨域时未暴露 `Content-Disposition`（需要 `Access-Control-Expose-Headers`）。

## 注意事项

| 问题 | 说明 |
| --- | --- |
| 成功路径 | 仍返回 `AxiosResponse<Blob>`，可用于进一步处理 |
| 失败路径 | 不创建 `<a>`、不调用 `createObjectURL` |
| 取消令牌 | 成功 / 失败 / 取消都会清理 |
| 文件名 | 显式参数优先，其次响应头 |
| 中文文件名 | 服务端应发送 `filename*` |
| 内存 | 整个文件驻留内存 |

## 测试覆盖

`packages/tools/tests/axios/download.integration.test.ts`（12 个用例，jsdom + 真实服务端）：

- 显式文件名；
- ASCII `filename`；
- `filename*` 优先；
- 同时存在时优先 `filename*`；
- 无响应头时回退 URL；
- URL 无有效段时回退 `download_file`；
- POST 下载；
- 100ms 后移除 `<a>` 并 `revokeObjectURL`；
- 成功 / 失败后清理取消令牌；
- 失败不触发下载；
- 取消。
