# 轮询

`PollingManager` 用于「等待某个异步任务完成」：支付结果、构建状态、数据导入进度。

相比手写 `setInterval`，它解决了：

1. 轮询请求也受全局并发限制；
2. 精确控制总次数，不会忘记停止；
3. 支持按 key 重启与停止；
4. 单个任务的回调异常不会影响其他任务。

## 快速开始

```ts
const http = new AxiosWrapper({ baseURL: '/api' });

http.startPolling<{ status: string }>({
    key: 'order-123',
    url: '/orders/123/status',
    interval: 2000,
    maxPollingTimes: 10,
    onSuccess: (res) => {
        if (res.data.data.status === 'paid') {
            http.stopPolling('order-123');
        }
    },
    onError: (error) => console.warn('poll failed', error),
});
```

## 配置

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `key` | `string` | 必填 | 唯一标识 |
| `url` | `string` | 必填 | 请求地址 |
| `method` | `'get' \| 'post' \| 'put' \| 'delete'` | `'get'` | 请求方法 |
| `config` | `AxiosRequestConfig` | 无 | 透传给 axios |
| `interval` | `number` | `5000` | 间隔（毫秒） |
| `maxPollingTimes` | `number` | `3` | 总次数（含首次） |
| `onSuccess` | `(res) => void` | 无 | 每次成功 |
| `onError` | `(err) => void` | 无 | 每次失败 |

## 执行模型

```text
poll(config)
  ├─ 无 key → console.error 并返回
  ├─ 同 key 已存在 → stopPolling(key)
  ├─ 创建 state { isStopped, attempts, timeoutId, config }
  └─ executePoll(state) 立即执行第一次

executePoll(state)
  ├─ isStopped 或 attempts >= max → 删除任务，结束
  └─ concurrencyController.run(requestTask)
       ├─ 再次检查 isStopped（排队期间可能被停止）
       ├─ instance[method](url, config)
       │    ├─ 成功 → onSuccess
       │    └─ 失败 → onError
       └─ finally
            ├─ attempts++（成功失败都计数）
            └─ attempts < max → setTimeout(interval) 调度下一次
```

### 为什么 attempts 在 finally 累加

无论成功失败都要计数，否则失败时会「永远重试」。

### 为什么停止后还要检查

`stopPolling` 可能发生在请求排队期间。任务真正执行时要再确认一次状态。

## 停止与重启

```ts
http.stopPolling('order-123');
```

停止时：

1. `isStopped = true`；
2. `clearTimeout`；
3. 从 Map 删除任务。

同 key 再次 `startPolling` 会先停旧任务，不会出现两个任务同时轮询。

## 与并发控制

轮询请求与其他请求共享同一个控制器。并发已满时轮询会排队，`interval` 的语义是「上一次结束到下一次开始的延迟」，不是固定节拍。

## 常见用法

### 条件满足后停止

```ts
http.startPolling({
    key: 'job',
    url: '/jobs/42',
    interval: 1000,
    maxPollingTimes: 60,
    onSuccess: (res) => {
        if (res.data.data.done) http.stopPolling('job');
    },
});
```

### 渐进式退避

`PollingManager` 不支持动态间隔。可以手动重启：

```ts
let attempt = 0;

function tick() {
    attempt += 1;
    http.startPolling({
        key: 'job',
        url: '/jobs/42',
        interval: Math.min(1000 * 2 ** attempt, 30_000),
        maxPollingTimes: 1,
        onSuccess: (res) => {
            if (res.data.data.done) http.stopPolling('job');
            else tick();
        },
        onError: tick,
    });
}

tick();
```

每次重启都会取消旧任务，不会叠加。

### 组件卸载清理

```ts
onBeforeUnmount(() => http.stopPolling('order-123'));
```

## 注意事项

| 场景 | 说明 |
| --- | --- |
| `maxPollingTimes: 0` | 不发出任何请求 |
| 未提供 `key` | 打印错误并直接返回 |
| 永远成功但条件不满足 | 必须依赖 `maxPollingTimes` 兜底 |
| 页面隐藏 | 浏览器会节流定时器，间隔不精确 |
| 重复启动同 key | 旧任务停止，但已发出的请求无法撤回 |
| 返回值 | `startPolling` 不返回 Promise |

## 测试覆盖

`packages/tools/tests/axios/managers.test.ts`：

- 立即执行 + 间隔执行 + 达到次数停止；
- 默认 5s / 3 次；
- 失败也计数；
- `onSuccess` 抛错按失败处理；
- 停止、未知 key、重启；
- post / put / delete；
- 请求进行中被停止后不再调度；
- `maxPollingTimes: 0`。

端到端：`wrapper.integration.test.ts > AxiosWrapper polling` 通过真实服务端统计请求次数。
