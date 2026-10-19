# 双 Token 刷新

双 Token = **Access Token（短期）+ Refresh Token（长期）**。Access 过期时用 Refresh 换一对新 Token，并自动重放失败的请求。

这是请求层里最容易写错的功能：并发、轮换、死循环、通知去重，缺一不可。

## 快速开始

```ts
const session = {
    access: localStorage.getItem('access') ?? '',
    refresh: localStorage.getItem('refresh') ?? '',
};

const http = new AxiosWrapper(
    { baseURL: '/api' },
    {
        enableDoubleToken: true,

        tokenProvider: () => session.access,
        getRefreshToken: () => session.refresh,

        refreshAccessToken: async (refreshToken) => {
            // 用裸 axios，避免刷新请求自身进入包装逻辑
            const { data } = await axios.post('/api/auth/refresh', { refreshToken });
            if (data.code !== 0) throw new Error(`refresh failed: ${data.code}`);
            session.access = data.data.accessToken;
            session.refresh = data.data.refreshToken;
            return session.access;
        },

        accessTokenExpiredCodes: [40101],
        refreshTokenExpiredCodes: [40102],

        onRefreshTokenExpired: () => {
            session.access = '';
            session.refresh = '';
            location.assign('/login');
        },
    },
);
```

## 触发条件

```text
响应到达
  │ data.code ∈ accessTokenExpiredCodes  → 尝试刷新
  │ data.code ∈ refreshTokenExpiredCodes → 直接登出
  │ 其他                                  → 原样返回
```

::: warning 只识别 HTTP 200 + 业务 code
如果后端用 HTTP 401 表示过期，axios 会在进入响应拦截器前就 reject，刷新逻辑不会触发。两种处理方式：

```ts
// A. 后端统一 HTTP 200 + 业务 code（推荐）
// B. 在自定义响应错误拦截器中转换
interceptors: {
    response: {
        onRejected: (error) => {
            if (error.response?.status === 401) {
                return { ...error.response, data: { code: 40101 } };
            }
            return Promise.reject(error);
        },
    },
}
```

集成测试 `surfaces HTTP 401 without triggering a refresh` 固定了这一行为。
:::

## 核心：Promise 单例

并发场景：

```text
请求 A ─┐
请求 B ─┼─ 同时发现 access 过期
请求 C ─┘
```

如果各自刷新，会发 3 次刷新请求。Refresh Token 轮换（一次性使用）时，后两次必然失败 —— 表现为「随机掉线」。

```ts
if (!this.refreshTokenPromise) {
    this.refreshTokenPromise = (async () => {
        const refreshToken = await getRefreshToken?.();
        if (!refreshToken) throw new Error('Missing refresh token.');

        const token = await refreshAccessToken(refreshToken);
        if (!token || typeof token !== 'string') throw new Error('Invalid new access token.');

        return token;
    })()
        .catch((error) => {
            onRefreshTokenExpired?.();   // 一次刷新周期只通知一次
            throw error;
        })
        .finally(() => {
            this.refreshTokenPromise = null;
        });
}

const newToken = await this.refreshTokenPromise;
```

时序：

```text
A 到达 → 无单例 → 创建 refreshTokenPromise
B 到达 → 有单例 → 直接 await
C 到达 → 有单例 → 直接 await
刷新完成 → 三个请求拿到同一个 token → 各自重放
finally → 清空单例，下一轮可再次刷新
```

## 重放请求

```ts
const authValue = `Bearer ${newToken}`;
const headers = originalConfig.headers;

if (headers && typeof headers.set === 'function') {
    headers.set('Authorization', authValue);      // Axios 1.x
} else {
    originalConfig.headers = { ...headers, Authorization: authValue };
}

return await this.instance(originalConfig);
```

### 为什么重放要跳过 tokenProvider

重放会再次进入请求拦截器，`tokenMiddleware` 会重新调用 `tokenProvider()`。如果闭包里的 Token 还没更新（非常常见），新 Token 会被旧 Token 覆盖，重放必然再次过期。

因此：

```ts
// tokenMiddleware
if ((ctx.config as any).__gotAccessToken) return;
```

集成测试 `keeps using the refreshed token even if tokenProvider still returns the stale one` 专门验证了这一点。

## 防死循环

如果服务端永远返回 access 过期：

```text
请求 → 过期 → 刷新 → 重放 → 过期 → 刷新 → …
```

原请求会被标记：

```ts
if (originalConfig.__gotAccessToken) {
    return Promise.reject(new Error('Request already retried after refresh'));
}
originalConfig.__gotAccessToken = true;
```

一个请求最多刷新 + 重放一次。

## 失败分类

| 情况 | 结果 | 通知 `onRefreshTokenExpired` |
| --- | --- | --- |
| `getRefreshToken` 返回空 | `Error('Missing refresh token.')` | 是 |
| 未配置 `refreshAccessToken` | `Error('No refreshAccessToken provided')` | 否（配置错误） |
| 刷新返回非字符串 | `Error('Invalid new access token.')` | 是 |
| 刷新接口报错 | 原始错误 | 是（每周期一次） |
| 响应 code ∈ `refreshTokenExpiredCodes` | `Error('Refresh token expired')` | 是 |
| 重放后仍过期 | `Error('Request already retried after refresh')` | 否 |

## 刷新令牌轮换

推荐后端每次刷新都更换 Refresh Token：

```ts
refreshAccessToken: async (refreshToken) => {
    const { data } = await axios.post('/auth/refresh', { refreshToken });
    session.access = data.accessToken;
    session.refresh = data.refreshToken; // 轮换
    return data.accessToken;
},
```

测试服务端实现了「一次性使用」：用过的 Refresh Token 再次使用会返回过期 code。

如果并发刷新没有被合并，这个测试会立刻失败 —— 测试中特意把刷新接口延迟 80ms 放大竞态窗口。

## 完整时序图

```text
5 个请求并发
   │
   ├─ 全部收到 { code: 40101 }
   │
   ├─ A: refreshTokenPromise == null → 创建单例（调用 /auth/refresh）
   ├─ B/C/D/E: await 同一个 promise
   │
   ├─ 刷新成功 → 得到 newToken
   │    ├─ 每个请求把自己的 config 写入 Authorization
   │    ├─ __gotAccessToken = true
   │    └─ this.instance(config) 重放
   │
   ├─ 重放时 tokenMiddleware 跳过（__gotAccessToken）
   ├─ 服务端校验新 Token → 200
   └─ 5 个请求全部成功，/auth/refresh 只被调用 1 次
```

## 与业务 code 处理的顺序

```text
flagMiddleware → doubleTokenMiddleware
```

- 若把 `40101` 同时写进 `codeHandlers`，处理器会先执行（可能弹窗），然后才刷新。建议不要这样配置。
- `responseHandler` 优先级更高：一旦配置并解包，`data.code` 可能不存在，双 Token 判定会失效。

## 服务端最小契约

```http
POST /auth/login
← { username, password }
→ { code: 0, data: { accessToken, refreshToken } }

POST /auth/refresh
← { refreshToken }
→ { code: 0, data: { accessToken, refreshToken } }
→ { code: 40102 }        // refresh 过期

GET /protected
Authorization: Bearer <access>
→ { code: 0, data: ... }
→ { code: 40101 }        // access 过期
```

## 注意事项

| 问题 | 说明 |
| --- | --- |
| 刷新接口 | 必须用裸 axios 或独立实例，否则递归 |
| 刷新失败 | 应清理本地会话，否则用户会卡在「每个请求都失败」 |
| 缓存 | 缓存命中的请求不会触发刷新；鉴权接口谨慎开缓存 |
| 并发通知 | `onRefreshTokenExpired` 每周期一次，但 `refreshTokenExpiredCodes` 分支按响应计 |
| 重放副作用 | 重放会重新经过缓存 / 防抖 / 节流中间件 |
| 时钟偏差 | Token 过期由服务端判定，客户端不做预判 |

## 测试覆盖

`packages/tools/tests/axios/double-token.integration.test.ts`（15 个用例）：

- 正常刷新并重放；
- 5 个并发请求只刷新 1 次；
- Refresh Token 轮换后旧 token 不可用；
- 连续两轮刷新；
- Refresh 过期、刷新接口失败；
- 缺少 refresh、未配置刷新函数、非法返回值；
- 并发刷新失败只通知一次；
- 防死循环；
- `tokenProvider` 返回旧值仍成功；
- `enableDoubleToken: false` 不刷新；
- 无关业务 code 不触发；
- HTTP 401 不触发。
