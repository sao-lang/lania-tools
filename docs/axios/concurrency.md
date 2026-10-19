# 并发控制

`GlobalConcurrencyController` 保证同一时刻最多有 N 个任务在执行，超出的排队等待。

## 要解决的问题

浏览器对同域名的并发连接数有上限。一次发出 50 个请求时：

- 大量请求卡在「等待连接」，超时与进度都不可预测；
- 首屏关键请求被无关请求阻塞；
- 服务端限流更容易把客户端判定为异常。

把并发压到合理值可以让时序可控。

## 快速开始

```ts
const http = new AxiosWrapper(
    { baseURL: '/api' },
    { maxConcurrent: 3 },
);
```

## 工作原理

```text
maxConcurrent = 2
activeCount   = 0
queue         = []

run(A) → activeCount=1 → 执行 A
run(B) → activeCount=2 → 执行 B
run(C) → 无空闲槽 → 入队 { task, resolve, reject }
run(D) → 入队

A 完成 → activeCount=1 → scheduleNext() → 出队 C
B 完成 → activeCount=0 → scheduleNext() → 出队 D
```

```ts
async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.activeCount < this.maxConcurrent) {
        this.activeCount++;
        try {
            return await task();
        } finally {
            this.activeCount--;
            this.scheduleNext();
        }
    }

    return new Promise<T>((resolve, reject) => {
        this.queue.push({ task, resolve, reject });
        this.scheduleNext();
    });
}
```

## 三个必须处理的边界

### 1. 任务同步抛错

```ts
queuedTask.task().then(...) // 同步异常直接冒泡，catch/finally 不执行
```

这会让 `activeCount` 永远不回退，队列死锁。因此排队任务统一包一层：

```ts
Promise.resolve()
    .then(() => queuedTask.task())
    .then(resolve)
    .catch(reject)
    .finally(() => {
        this.activeCount--;
        this.scheduleNext();
    });
```

测试：`keeps the queue alive when a queued task throws synchronously`。

### 2. 重试不能占着槽位等自己

```ts
// ❌ maxConcurrent = 1 时自锁
controller.run(async () => {
    try {
        await upload();
    } catch {
        return controller.run(() => upload());
    }
});
```

正确做法是把重试循环放在槽位之外：

```ts
for (let attempt = 0; attempt <= retryTimes; attempt++) {
    try {
        await controller.run(() => uploadOnce());
        return;
    } catch (error) {
        if (attempt < retryTimes) await delay(retryDelay);
    }
}
```

测试：`releases the concurrency slot while waiting to retry`。

### 3. 队列任务启动时再次检查状态

轮询任务在排队期间可能已被 `stopPolling`，因此任务体内部要再检查一次：

```ts
const requestTask = async () => {
    if (state.isStopped) return;
    ...
};
```

## 共享范围

```text
AxiosWrapper.request  ─┐
UploadManager 分片     ─┼─→ 同一个 GlobalConcurrencyController
PollingManager 轮询    ─┘
```

好处：上传不会把带宽占满导致其他请求全部超时。

代价：上传大文件时，普通请求可能排队。需要隔离时用多个实例：

```ts
export const api = AxiosWrapperFactory.create('api', { baseURL: '/api' }, { maxConcurrent: 5 });
export const upload = AxiosWrapperFactory.create('upload', { baseURL: '/api' }, { maxConcurrent: 2 });
```

## 默认值

| 传入 | 实际 |
| --- | --- |
| 未传 | `MAX_CONCURRENT_REQUESTS = 5` |
| `0` | 5 |
| 负数 | 5 |
| 非数字 | 5 |
| 正数 | 该值 |

## 观测真实并发

测试服务端的 `/stats` 会记录实际最大并发：

```ts
const stats = await axios.get(`${server.baseURL}/stats`);
expect(stats.data.maxActiveRequests).toBeLessThanOrEqual(2);
```

集成测试 `limits HTTP requests to maxConcurrent` 与 `respects the global concurrency limit while uploading` 用它验证 HTTP 与上传分片都不突破上限。

## 注意事项

| 问题 | 说明 |
| --- | --- |
| 没有超时 | 任务永久挂起会占住槽位，应配合 axios `timeout` |
| 取消 | 排队中的请求轮到时会被取消令牌立即拒绝并释放槽位 |
| 实例隔离 | 不同 Wrapper 实例有独立控制器 |
| 公平性 | 严格 FIFO |
| 长任务 | 一个慢请求会阻塞后续任务，可拆分或提高上限 |

## 测试覆盖

`packages/tools/tests/axios/managers.test.ts`：

- 默认值与非法值回退；
- 并发不超过上限（6 个任务、上限 2）；
- 错误传播后队列继续；
- 同步抛错不阻塞队列；
- `activeCount` 正确回退；
- 大量排队任务（50 个）。
