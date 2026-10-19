# 从零搭建一个完整模块

本教程从空目录开始，逐步搭建一个包含**登录鉴权、列表、搜索、轮询、上传、下载、实时通知、全局状态**的模块。每一步都说明「为什么这样配置」。

最终代码可以直接作为项目的 `src/services/` 参考。

## 目标

```text
src/
├── services/
│   ├── session.ts     会话与 Token
│   ├── http.ts        请求层
│   ├── user.ts        用户相关接口
│   ├── upload.ts      文件上传
│   ├── export.ts      文件导出
│   └── realtime.ts    实时通知
└── store/
    └── app.ts         全局状态
```

## Step 1：建立请求层

```ts
// src/services/http.ts
import axios from 'axios';
import { AxiosWrapper } from '@lania-tools/tools/axios-wrapper';

export const http = new AxiosWrapper(
    {
        baseURL: import.meta.env.VITE_API_BASE ?? '/api',
        timeout: 15_000,
        headers: { 'X-Client': 'web' },
    },
    {
        maxConcurrent: 5,
    },
);
```

此时已经拥有：

- 全局并发控制；
- 取消令牌管理；
- 请求 / 响应拦截器管道（未启用具体能力）。

**为什么先不开启所有能力**：缓存、防抖、重试都是「按需开启」的，盲目全开会掩盖接口语义问题。后面按场景逐个加。

## Step 2：登录与会话

Token 存在哪里取决于安全要求：

| 方案 | 优点 | 缺点 |
| --- | --- | --- |
| localStorage | 简单、跨标签页 | XSS 可读 |
| sessionStorage | 标签页隔离 | 关页面即失效 |
| Cookie（HttpOnly） | XSS 不可读 | 需要服务端配合，CSRF 防护 |

这里用 `LocalStorageHelper` 演示（带过期时间）：

```ts
// src/services/session.ts
import { LocalStorageHelper } from '@lania-tools/tools/web-storage-helper';

const ACCESS_KEY = 'access_token';
const REFRESH_KEY = 'refresh_token';

export interface TokenPair {
    accessToken: string;
    refreshToken: string;
}

export const session = {
    get access(): string {
        return LocalStorageHelper.get<string>(ACCESS_KEY) ?? '';
    },
    get refresh(): string {
        return LocalStorageHelper.get<string>(REFRESH_KEY) ?? '';
    },
    save(pair: TokenPair): void {
        LocalStorageHelper.set(ACCESS_KEY, pair.accessToken, { expiresInSeconds: 60 * 60 });
        LocalStorageHelper.set(REFRESH_KEY, pair.refreshToken, {
            expiresInSeconds: 7 * 24 * 3600,
        });
    },
    clear(): void {
        LocalStorageHelper.delete(ACCESS_KEY);
        LocalStorageHelper.delete(REFRESH_KEY);
    },
};

export async function login(username: string, password: string): Promise<TokenPair> {
    // 登录本身不应该带旧 Token，因此使用裸 axios
    const { data } = await axios.post('/api/auth/login', { username, password });
    if (data.code !== 0) throw new Error(data.message);

    const pair: TokenPair = {
        accessToken: data.data.accessToken,
        refreshToken: data.data.refreshToken,
    };
    session.save(pair);
    return pair;
}

export function logout(): void {
    session.clear();
    http.clearCache();
}
```

> `logout` 中调用 `http.clearCache()` 很重要：缓存可能包含上一个用户的数据。

## Step 3：启用 Token 与自动续期

把会话接入请求层：

```ts
// src/services/http.ts（继续补充）
export const http = new AxiosWrapper(
    { baseURL: '/api', timeout: 15_000 },
    {
        maxConcurrent: 5,

        tokenProvider: () => session.access,

        enableDoubleToken: true,
        getRefreshToken: () => session.refresh,
        refreshAccessToken: async (refreshToken) => {
            const { data } = await axios.post('/api/auth/refresh', { refreshToken });
            if (data.code !== 0) throw new Error('refresh failed');

            session.save({
                accessToken: data.data.accessToken,
                refreshToken: data.data.refreshToken,
            });
            return data.data.accessToken;
        },
        accessTokenExpiredCodes: [40101],
        refreshTokenExpiredCodes: [40102],
        onRefreshTokenExpired: () => {
            session.clear();
            location.assign('/login');
        },
    },
);
```

这里绕不开一个循环依赖：`session.ts` 需要 `http`，而 `http.ts` 需要 `session`。

解决方案：把 `http` 的创建放到 `session` 之后，或把 `logout` 的缓存清理移到调用方。示例中 `session.ts` 里对 `http` 的引用应改为由调用方处理：

```ts
// src/services/session.ts
export function logout(): void {
    session.clear();
}
```

```ts
// 调用方
import { http } from './http';
import { logout as clearSession } from './session';

export function signOut() {
    clearSession();
    http.clearCache();
    location.assign('/login');
}
```

**验证方式**：并发发起 5 个过期请求，服务端应只收到 1 次 `/auth/refresh`。原理见 [双 Token 刷新](/axios/double-token)。

## Step 4：列表页

```ts
// src/services/user.ts
import { http } from './http';

export interface User {
    id: number;
    name: string;
}

export interface Page<T> {
    items: T[];
    total: number;
}

export function listUsers(page: number, size = 20) {
    return http.get<Page<User>>('/users', { page, size });
}
```

给「用户列表」开启短缓存：

```ts
export const userHttp = new AxiosWrapper(
    { baseURL: '/api' },
    { enableCache: true, cacheTTL: 30_000, tokenProvider: () => session.access },
);
```

或者直接给全局 `http` 开启缓存，然后对实时性要求高的接口单独使用另一个实例。两种方式都可以，关键是**同一个实例共享缓存**。

## Step 5：搜索（防抖 + 竞态）

```ts
// src/services/search.ts
import { debounce } from '@lania-tools/tools/tools';
import { http } from './http';

export interface SearchResult {
    id: number;
    title: string;
}

let requestSeq = 0;

export const search = debounce(async (keyword: string): Promise<SearchResult[]> => {
    if (!keyword.trim()) return [];

    const current = ++requestSeq;
    try {
        const { data } = await http.get<SearchResult[]>(
            '/search',
            { q: keyword },
            { cancelTokenId: 'search' },
        );
        if (current !== requestSeq) return []; // 双保险
        return data;
    } catch (error: any) {
        if (error?.isCancel || error?.name === 'CanceledError') return [];
        throw error;
    }
}, 300);
```

为什么需要两层保护：

1. `cancelTokenId` 让后一次请求取消前一次；
2. `requestSeq` 防止极端情况下旧响应仍被渲染。

## Step 6：轮询任务状态

```ts
// src/services/job.ts
import { http } from './http';

export interface JobStatus {
    status: 'pending' | 'running' | 'done' | 'failed';
    progress: number;
}

export function watchJob(jobId: string, onUpdate: (status: JobStatus) => void) {
    const key = `job-${jobId}`;

    http.startPolling<JobStatus>({
        key,
        url: `/jobs/${jobId}`,
        interval: 2000,
        maxPollingTimes: 30,
        onSuccess: (res) => {
            const status = res.data.data;
            onUpdate(status);
            if (status.status === 'done' || status.status === 'failed') {
                http.stopPolling(key);
            }
        },
        onError: () => {
            // 单次失败不停止，最多 30 次兜底
        },
    });

    return () => http.stopPolling(key);
}
```

关键点：**必须有无条件兜底**（`maxPollingTimes`），否则接口一直成功但条件不满足时会永久轮询。

## Step 7：上传

```ts
// src/services/upload.ts
import { http } from './http';

export interface UploadResult {
    fileMd5: string;
    url: string;
}

export async function uploadFile(file: File, onProgress: (percent: number) => void) {
    const { fileMd5, totalChunks } = await http.uploadFile('/upload/chunk', file, {
        enableResume: true,
        getUploadedChunksUrl: '/upload/uploaded',
        calculateChunkMd5: true,
        cancelTokenId: `upload-${file.name}`,
        onProgress: (finished, total) => onProgress(Math.round((finished / total) * 100)),
    });

    const merged = await http.post<UploadResult>('/upload/merge', { fileMd5, totalChunks });
    if (merged.data.code !== 0) throw new Error('merge failed');

    return {
        fileMd5,
        url: merged.data.data.url,
    };
}

export function cancelUpload(fileName: string) {
    http.cancelRequest(`upload-${fileName}`);
}
```

注意：

- 断点续传要求服务端按 `fileMd5` 记录分片；
- 合并协议由后端定义，所以 `uploadFile` 不内置；
- 取消后分片重试会立即停止。

## Step 8：下载

```ts
// src/services/export.ts
import { http } from './http';

export function exportUsers(filter: { from: string; to: string }) {
    return http.downloadFile(
        '/export/users',
        'post',
        `用户导出_${filter.from}_${filter.to}.xlsx`,
        { data: filter, cancelTokenId: 'export-users' },
    );
}

export function cancelExport() {
    http.cancelRequest('export-users');
}
```

## Step 9：实时通知

用事件总线把「传输层」与「业务层」解耦：

```ts
// src/services/realtime.ts
import { EventBus } from '@lania-tools/tools/event-bus';
import { SSEClient } from '@lania-tools/tools/sse-client';

export const bus = new EventBus();
bus.registerNamespace('realtime');

export interface Notification {
    id: number;
    title: string;
    level: 'info' | 'warning';
}

let client: SSEClient | null = null;

export function connectRealtime(): void {
    if (client) return;

    client = new SSEClient({ url: '/api/events', reconnectInterval: 3000 });

    client.on('message', (raw) => {
        try {
            const event = JSON.parse(raw) as { type: string; payload: Notification };
            void bus.emit(event.type, event.payload, { namespace: 'realtime' });
        } catch (error) {
            console.error('invalid realtime payload', error);
        }
    });
}

export function disconnectRealtime(): void {
    client?.close();
    client = null;
}

// 业务侧只订阅事件
// bus.on('notification', (n) => toast(n.title), { namespace: 'realtime' });
```

换成 WebSocket 时，只改 `connectRealtime`，业务订阅不变。

## Step 10：全局状态

```ts
// src/store/app.ts
import { Store } from '@lania-tools/tools/store';
import { LocalStorageHelper } from '@lania-tools/tools/web-storage-helper';

export interface AppState {
    user: { id: number; name: string } | null;
    theme: 'light' | 'dark';
    notifications: number;
}

const persist: StorePlugin<AppState> = {
    onStateChange(store) {
        LocalStorageHelper.set('app-state', {
            user: store.getState('user'),
            theme: store.getState('theme'),
        });
    },
};

export const appStore = new Store({
    initialState: {
        user: null,
        theme: 'light',
        notifications: 0,
    } as AppState,
    reducers: {
        setUser: (state, user: AppState['user']) => ({ ...state, user }),
        setTheme: (state, theme: AppState['theme']) => ({ ...state, theme }),
        incNotifications: (state) => ({
            ...state,
            notifications: state.notifications + 1,
        }),
        reset: () => ({ user: null, theme: 'light', notifications: 0 }),
    },
    derivedState: {
        isLoggedIn: (state) => state.user !== null,
        notificationLabel: (state) =>
            state.notifications > 99 ? '99+' : String(state.notifications),
    },
    plugins: [persist],
});
```

与实时通知联动：

```ts
import { bus } from '../services/realtime';
import { appStore } from '../store/app';

bus.on('notification', () => appStore.actions.incNotifications(), {
    namespace: 'realtime',
});
```

## Step 11：统一错误处理

```ts
// src/services/http.ts（最终版）
import axios from 'axios';
import { AxiosWrapper } from '@lania-tools/tools/axios-wrapper';
import { createLogger } from '@lania-tools/tools/logger';
import { session } from './session';

const log = createLogger({ name: 'http', timestamp: true, historySize: 50 });

export const http = new AxiosWrapper(
    { baseURL: '/api', timeout: 15_000 },
    {
        // 并发
        maxConcurrent: 5,

        // 缓存（对读接口生效）
        enableCache: true,
        cacheTTL: 30_000,

        // 重试（仅网络失败）
        enableRetry: true,
        retryTimes: 2,
        retryDelay: 500,

        // 认证
        tokenProvider: () => session.access,
        enableDoubleToken: true,
        getRefreshToken: () => session.refresh,
        refreshAccessToken: async (refreshToken) => {
            const { data } = await axios.post('/api/auth/refresh', { refreshToken });
            if (data.code !== 0) throw new Error('refresh failed');
            session.save(data.data);
            return data.data.accessToken;
        },
        accessTokenExpiredCodes: [40101],
        refreshTokenExpiredCodes: [40102],
        onRefreshTokenExpired: () => {
            session.clear();
            location.assign('/login');
        },

        // 响应处理
        onError: (error) => {
            if (error?.response?.status === 403) {
                location.assign('/403');
                return;
            }
            log.error('request failed', {
                url: error?.config?.url,
                method: error?.config?.method,
                status: error?.response?.status,
                retryCount: error?.config?.__retryCount ?? 0,
            });
        },
        codeHandlers: {
            50001: (response) => {
                // 业务提示，不再向调用方抛错
                console.warn(response.data.message);
                return { ...response, data: null };
            },
        },
    },
);
```

## Step 12：清理

```ts
// 路由卸载 / 应用退出
import { http } from './services/http';
import { disconnectRealtime } from './services/realtime';

export function teardown() {
    http.cancelAllRequests();
    http.stopPolling('job-anything'); // 或按业务 key 逐个停止
    disconnectRealtime();
}
```

## 完整流程回顾

```text
login()
  └ session.save()
       └ http 每次请求自动带 Token
            ├─ Access 过期 → 刷新（并发只刷一次）→ 重放
            └─ Refresh 过期 → 清理会话 → 跳登录

listUsers(page)
  └ 命中缓存 → 直接返回（不发请求）

search(keyword)
  ├─ debounce 300ms
  ├─ cancelTokenId 取消旧请求
  └─ 序号校验防止旧响应覆盖

watchJob(id)
  ├─ 每 2s 轮询
  ├─ 完成 / 失败 → stopPolling
  └─ 最多 30 次兜底

uploadFile(file)
  ├─ 计算 fileMd5
  ├─ 查询已上传分片
  ├─ 并发上传（全局限流）
  ├─ 失败重试（槽位外）
  └─ 合并

exportUsers()
  └ 下载文件名：参数 → filename* → filename → URL

connectRealtime()
  ├─ SSE 自动重连
  └─ 事件总线分发 → Store 计数
```

## 检查清单

- [ ] 刷新接口使用裸 axios
- [ ] `onRefreshTokenExpired` 清理会话并跳转
- [ ] 搜索与竞态都有处理
- [ ] 轮询有次数上限
- [ ] 上传有合并步骤与失败处理
- [ ] 下载失败不触发点击
- [ ] 组件卸载时取消请求、停止轮询、关闭连接
- [ ] 登出时清理缓存
