# 缓存

缓存解决两个问题：**避免重复请求**，以及**让相同请求的 Key 稳定**。

## 快速开始

```ts
const http = new AxiosWrapper(
    { baseURL: '/api' },
    {
        enableCache: true,
        cacheTTL: 30_000,
    },
);

await http.get('/dictionaries'); // 真实请求
await http.get('/dictionaries'); // 命中缓存
http.clearCache();               // 手动失效
```

## 请求 Key

```ts
generateRequestKey({ method, url, params, data });
// "get:/dictionaries::"
```

规则：

1. `method` 统一小写，缺省 `get`；
2. `url` 原样，缺省空字符串；
3. `params` / `data` 只有一个时序列化；`null` / `undefined` 视为空；
4. 对象按 **key 排序后**递归序列化。

```ts
key({ params: { b: 2, a: 1 } }) === key({ params: { a: 1, b: 2 } }); // true
```

### 为什么不能用 `JSON.stringify`

```ts
JSON.stringify({ a: 1, b: 2 }); // '{"a":1,"b":2}'
JSON.stringify({ b: 2, a: 1 }); // '{"b":2,"a":1}'
```

同样语义会得到不同 Key，缓存直接失效。`stableStringify` 递归排序解决这个问题。

### `0` / `false` / `''` 的处理

```ts
// ❌ 真值判断：{ data: 0 } 与无 body 生成同一个 Key
const data = req.data ? stableStringify(req.data) : '';

// ✅ 只有 null / undefined 视为空
const data = req.data === undefined || req.data === null ? '' : stableStringify(req.data);
```

数组顺序**不排序**（顺序有语义）：

```ts
key({ params: { ids: [1, 2] } }) !== key({ params: { ids: [2, 1] } });
```

## 命中时发生了什么

```text
cacheRequestMiddleware
  └ cacheManager.get(config) !== null
      └ ctx.config.adapter = async () => ({
            __fromCache: true,
            data: cached,
            status: 200,
            statusText: 'Cache Hit',
            headers: {},
            config,
            request: {},
        })
```

要点：

- **替换 adapter**，请求不离开进程；
- 仍然经过完整 Response 链：`responseHandler`、`codeHandlers`、用户 `response.onFulfilled` 都会执行；
- `__fromCache` 让 `cacheResponseMiddleware` 跳过写回。

### 为什么不能 `reject(fakeResponse)`

Axios 的请求拦截器只能返回 config。`Promise.reject(fakeResponse)` 会被当作 config 继续 dispatch，结果是一次真实网络请求或难以排查的异常。

测试 `serves the same request from cache without hitting the network` 验证了真实请求数只增加 1。

## 写入规则

```ts
if (enableCache && !response.__fromCache) {
    cacheManager.set(response.config, response.data, cacheTTL);
}
```

`CacheManager.set` 只缓存**业务数据**：

| 传入 | 缓存内容 |
| --- | --- |
| 完整 `AxiosResponse`（含 `config` / `status` / `headers`） | `response.data` |
| 其他对象 | 原样 |

### 为什么不能无脑解包 `.data`

业务响应经常是：

```json
{ "code": 0, "data": { "list": [] } }
```

无脑解包会让缓存里只剩 `{ list: [] }`，再次取出时 `code` 丢失，`codeHandlers` 与双 Token 判定全部失效。

测试：`does not unwrap a business payload that happens to have a data field`。

## TTL

| 配置 | 行为 |
| --- | --- |
| 不传 `cacheTTL` | 永不过期，直到 `clearCache()` |
| `cacheTTL = 0` | 视为不过期 |
| `cacheTTL > 0` | 到期后第一次读取时惰性删除 |

惰性删除意味着没有后台定时器与清理任务，只在 `get` 时判断 `expireAt`。

## 手工管理

```ts
http.clearCache();
```

只影响当前实例。

## 与鉴权的关系

缓存命中不会发网络请求，也就不会触发 Token 刷新。如果某接口的响应依赖当前用户，**不要开启缓存**，或在登录 / 登出时 `clearCache()`。

```ts
async function logout() {
    await api.post('/auth/logout');
    http.clearCache();
    session.clear();
}
```

## 与其他中间件的顺序

```text
token → cache → debounce → throttle → custom
```

缓存在防抖之前：命中缓存时不会消耗防抖窗口，也不会触发防抖取消。

## 使用建议

| 场景 | 建议 |
| --- | --- |
| 字典 / 配置 | 长 TTL 或不过期 |
| 列表页 | 短 TTL（10~60s）+ 手动失效 |
| 详情页 | 中等 TTL（30~300s） |
| 用户私有数据 | 谨慎开启；登出时清理 |
| 实时数据 | 不开启 |
| 写操作 | 语义上不建议缓存 |

## 完整示例：字典缓存

```ts
import { AxiosWrapper } from '@lania-tool/tools/axios-wrapper';

export const http = new AxiosWrapper(
    { baseURL: '/api' },
    { enableCache: true, cacheTTL: 5 * 60_000 },
);

export async function getDictionaries() {
    const { data } = await http.get<Record<string, string[]>>('/dictionaries');
    return data;
}

// 后台更新字典后主动失效
export function invalidateDictionaries() {
    http.clearCache();
}
```

## 测试覆盖

- Key 稳定性与边界：`managers.test.ts > generateRequestKey`
- 缓存读写 / 过期 / 覆盖 / 清除：`managers.test.ts > CacheManager`
- 端到端命中、TTL、`clearCache`：`wrapper.integration.test.ts > AxiosWrapper caching against a real server`
