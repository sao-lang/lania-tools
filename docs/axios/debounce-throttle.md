# 防抖与节流

两者都用于「相同请求短时间内被重复触发」的场景：

| 机制 | 语义 | 典型场景 |
| --- | --- | --- |
| 防抖 | 一段时间内只保留**最后一次** | 搜索输入、表单校验 |
| 节流 | 一段时间内只**放行一次**（首次） | 滚动加载、按钮连点 |

## 快速开始

```ts
const http = new AxiosWrapper(
    { baseURL: '/api' },
    { enableDebounce: true, debounceInterval: 300 },
);

const p1 = http.get('/search', { q: 'vue' });
const p2 = http.get('/search', { q: 'vue' });
const p3 = http.get('/search', { q: 'vue' });

await p1; // reject（被 p2 取消）
await p2; // reject（被 p3 取消）
await p3; // resolve（真正发出）
```

```ts
const throttled = new AxiosWrapper(
    { baseURL: '/api' },
    { enableThrottle: true, throttleInterval: 1000 },
);

await throttled.get('/feed'); // 放行
await throttled.get('/feed'); // reject（冷却期内）
```

## 取消错误

```ts
export class DebounceThrottleCancelError extends Error {
    isCancel = true;
    type: 'debounce' | 'throttle';
    name = 'CancelError';
}
```

`isCancel = true` 让它与 axios 的取消错误共用判定，因此：

- 不进入重试；
- 不触发 `onError`；
- 可用 `error.type` 区分是防抖还是节流。

```ts
import { DebounceThrottleCancelError } from '@lania-tool/tools/axios-wrapper';

try {
    await http.get('/search', { q });
} catch (error) {
    if (error instanceof DebounceThrottleCancelError) return;
    throw error;
}
```

## 防抖实现

```ts
debounceRequest(req, delay = 300) {
    const key = generateRequestKey(req);
    return new Promise((resolve, reject) => {
        if (this.debounceMap.has(key)) {
            const pending = this.debounceMap.get(key)!;
            clearTimeout(pending.timer);
            pending.reject(new DebounceThrottleCancelError('...', 'debounce'));
        }

        const timer = setTimeout(() => {
            this.debounceMap.delete(key);
            resolve(req);
        }, delay);

        this.debounceMap.set(key, { resolve, reject, timer });
    });
}
```

时序：

```text
t=0    请求 A → 设 300ms 定时器
t=50   请求 B → A reject，B 重设定时器
t=100  请求 C → B reject，C 重设定时器
t=400  C 定时器触发 → 放行 → 只发出一次请求
```

## 节流实现

```ts
throttleRequest(req, interval = 1000) {
    const key = generateRequestKey(req);
    const now = Date.now();
    return new Promise((resolve, reject) => {
        const record = this.throttleMap.get(key);
        if (record && now - record.lastTime < interval) {
            reject(new DebounceThrottleCancelError('...', 'throttle'));
            return;
        }
        this.throttleMap.set(key, { lastTime: now });
        resolve(req);
    });
}
```

- **首次放行**，窗口内后续请求直接拒绝；
- 不会补发最后一次（与工具层 `throttle` 的 `trailing` 不同）。

## 手工清理

```ts
// 组件卸载 / 实例销毁
manager.clear();
```

`clear()` 会 reject 所有等待中的防抖请求，并清空节流记录。

> 封装的 `AxiosWrapper` 没有暴露 `clear()`。如果需要，请在应用层确保不再触发相同请求，或使用独立实例。

## 三种实现怎么选

| 需求 | 方案 |
| --- | --- |
| 所有请求统一防抖 | `options.enableDebounce` |
| 只对搜索防抖，且需要拿到结果 | 工具层 `debounce` + 自己的取消逻辑 |
| 按钮点击限频 | `options.enableThrottle` |
| 滚动加载节流 | 工具层 `throttle`（需要控制 leading/trailing） |

### 工具层防抖示例

```ts
import { debounce } from '@lania-tool/tools/tools';

const search = debounce(async (keyword: string) => {
    const { data } = await http.get('/search', { q: keyword }, { cancelTokenId: 'search' });
    render(data);
}, 300);
```

这种方式可以拿到最终结果，也能与 `cancelTokenId` 组合解决竞态。

## 与重试、缓存的关系

```text
token → cache → debounce → throttle → custom
```

- **缓存优先**：命中缓存时不会触发防抖，也不会消耗窗口；
- **防抖先于节流**：被防抖取消的请求不会进入节流判定；
- **取消不重试**：被防抖 / 节流拒绝的请求不会进入重试。

## 注意事项

1. **Key 由 method + url + params + data 决定**，参数不同互不影响；
2. **被取消的请求会 reject**，业务侧必须 `catch`，否则产生未处理 rejection；
3. **节流不补发最后一次**；需要补发请用工具层 `throttle(..., { trailing: true })`；
4. **两者可同时开启**，先防抖再节流；
5. **防抖是全局按 Key 生效**，不同组件对同一接口的请求会互相取消。

## 测试覆盖

`packages/tools/tests/axios/managers.test.ts`：

- 相同 Key 互相取消、不同 Key 互不影响；
- 默认间隔（300ms / 1000ms）；
- `cancelDebounce` / `cancelThrottle` / `clear`；
- 边界（499ms 拒绝、500ms 放行）；
- 节流首次放行与窗口结束放行。

端到端：`wrapper.integration.test.ts > AxiosWrapper debounce, throttle and retry`。
