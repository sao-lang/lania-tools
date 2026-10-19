# 重试与取消

## 重试

```ts
const http = new AxiosWrapper(
    { baseURL: '/api' },
    {
        enableRetry: true,
        retryTimes: 3,     // 首次之外再重试 3 次
        retryDelay: 500,   // 每次间隔 500ms
    },
);
```

### 触发条件

只有**网络层失败**（axios reject）才重试：

- 网络错误；
- 超时；
- HTTP 4xx / 5xx。

业务 code 错误（HTTP 200 + `code !== 0`）默认**不重试**，除非你在拦截器中主动抛出。

取消、防抖、节流不会重试。

### 执行流程

```text
请求失败
  │ __retryCount = 0
  ├ 0 < 3 → +1 → 等 500ms → 重新入队
  ├ 仍失败 → +1 → 等 500ms → 重新入队
  ├ 仍失败 → +1 → 等 500ms → 重新入队
  └ 仍失败 → 超过预算 → reject 最后一次错误 → onError 一次
```

### 实现

```ts
private async retryRequest(err: any) {
    const config = err?.config;
    if (!config) throw err;  // 无 config 无法重放

    const maxRetries = this.options.retryTimes ?? DEFAULT_MAX_RETRIES;
    const retryDelay = this.options.retryDelay ?? DEFAULT_RETRY_DELAY;
    config.__retryCount = config.__retryCount || 0;

    let lastError = err;
    while (config.__retryCount < maxRetries) {
        config.__retryCount += 1;
        await new Promise((r) => setTimeout(r, retryDelay));
        try {
            return await this.concurrencyController.run(() => this.retryInstance(config));
        } catch (retryError) {
            lastError = retryError;
            if (isCancel(retryError)) throw retryError;
        }
    }
    throw lastError;
}
```

四个关键点：

1. **无拦截器实例**：`retryInstance` 不再挂拦截器，避免递归重试与重复 `onError`；
2. **循环而非递归**：次数线性可控；
3. **重试也进队列**：不会绕过全局限流；
4. **取消立即终止**：不浪费重试预算。

### 曾经的缺陷：重试结果被丢弃

```ts
// ❌
await this.runResponseErrorMiddlewares(ctx);
this.onError?.(ctx.err);
return Promise.reject(ctx.err);
```

即使重试成功，调用方仍收到原错误，`onError` 也会触发。正确写法：

```ts
const recovered = await this.runResponseErrorMiddlewares(ctx);
if (recovered) return recovered;
```

测试 `retries failed requests until they succeed` 同时断言「最终成功」与「onError 未调用」。

### 什么时候不要重试

| 场景 | 原因 |
| --- | --- |
| POST 创建订单 | 可能重复创建 |
| 带副作用的 PUT | 取决于幂等性 |
| 已确认的参数错误（400） | 重试无意义 |
| 认证过期 | 应交给双 Token 机制 |

当前配置是**实例级**的。需要单请求控制时，为该请求使用独立实例，或关闭 `enableRetry` 后自行封装。

## 取消

### 按 ID 取消

```ts
const request = http.get('/slow', undefined, { cancelTokenId: 'slow-1' });

http.cancelRequest('slow-1');

await request.catch((error) => {
    // CanceledError
});
```

### 取消全部

```ts
http.cancelAllRequests();
```

只影响通过 `cancelTokenId` 注册的请求；未传 id 的请求不受影响。

### 生命周期

```text
request() → CancelToken.source()
          → cancelTokenManager.set(id, source)
     │
     ├─ 网络请求
     │
     └─ finally → cancelTokenManager.delete(id)
```

成功、失败、取消都会清理，不会泄漏。

### 取消不触发 onError

```ts
onError: (error) => {
    if (axios.isCancel(error)) return; // 不需要
    report(error);
};
```

取消错误在 `handleResponseError` 的第一步就 reject 并返回。

### 取消的判定

```ts
error instanceof DebounceThrottleCancelError ||
error?.isCancel === true ||
axios.isCancel(error)
```

### 上传与下载的取消

```ts
// 下载
const download = http.downloadFile('/large.zip', 'get', 'large.zip', {
    cancelTokenId: 'zip',
});
http.cancelRequest('zip');

// 上传
const upload = http.uploadFile('/upload/chunk', file, { cancelTokenId: 'upload-1' });
http.cancelRequest('upload-1');
```

上传取消后：

- 进行中的分片请求被中断；
- 等待重试的分片不再继续；
- 抛出 `Upload canceled by user signal.`；
- 令牌被清理。

## 竞态处理模式

搜索框的典型问题：先发的请求后返回，覆盖了最新结果。两种方案：

### 方案 A：同一个 `cancelTokenId`

```ts
let requestId = 0;

async function search(keyword: string) {
    const current = ++requestId;
    try {
        const { data } = await http.get('/search', { q: keyword }, { cancelTokenId: 'search' });
        if (current !== requestId) return; // 双保险
        render(data);
    } catch (error) {
        if (axios.isCancel(error)) return;
        throw error;
    }
}
```

后一次请求会通过 `CancelTokenManager` 取消前一次。

### 方案 B：利用防抖

```ts
const search = debounce((keyword: string) => {
    http.get('/search', { q: keyword }, { cancelTokenId: 'search' }).then(({ data }) => render(data));
}, 300);
```

## 组件卸载时的清理

```ts
onBeforeUnmount(() => {
    http.cancelAllRequests();
    http.stopPolling('job');
});
```

## 注意事项

| 问题 | 说明 |
| --- | --- |
| 副作用重复 | 只对幂等请求重试 |
| 重试与拦截器 | 重试不重跑请求拦截器（使用 `retryInstance`） |
| 重试与 Token | Token 过期应交给双 Token，而不是重试 |
| `retryTimes` 语义 | 额外次数：`3` = 最多 4 次尝试 |
| 取消返回 | 总是 reject |
| 无 config 的错误 | 直接抛出，不重试 |
| 退避 | 当前是固定间隔 |

## 测试覆盖

| 行为 | 测试 |
| --- | --- |
| 重试后成功 | `retries failed requests until they succeed` |
| 重试耗尽只触发一次 `onError` | `rejects after the retry budget is exhausted` |
| `retryTimes: 0` 不重试 | `retryTimes=0 means no retry` |
| 关闭重试 | `does not retry when enableRetry is false` |
| 按 ID 取消 | `cancels a request by its cancelTokenId` |
| 取消全部 | `cancels every in-flight request` |
| 未传 id 不会被取消 | `does not cancel requests without a cancelTokenId` |
| 取消不触发 `onError` | `does not call onError for debounce/throttle cancellations` |
| 上传取消 | `cancels an in-flight upload through cancelTokenId` |
