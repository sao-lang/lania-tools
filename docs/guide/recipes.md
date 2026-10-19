# 常见场景 Recipes

每个 Recipe 都是可以直接落地的组合方案，包含完整代码与关键点说明。

## 1. 登录 + 双 Token 自动续期

**目标**：登录后所有请求自动带 Token；Access 过期时自动刷新并重放；Refresh 也失效时跳登录。

```ts
import axios from 'axios';
import { AxiosWrapper } from '@lania-tools/tools/axios-wrapper';
import { LocalStorageHelper } from '@lania-tools/tools/web-storage-helper';

const session = {
    get access() {
        return LocalStorageHelper.get<string>('access') ?? '';
    },
    get refresh() {
        return LocalStorageHelper.get<string>('refresh') ?? '';
    },
    save(pair: { access: string; refresh: string }) {
        LocalStorageHelper.set('access', pair.access, { expiresInSeconds: 60 * 60 });
        LocalStorageHelper.set('refresh', pair.refresh, { expiresInSeconds: 7 * 24 * 3600 });
    },
    clear() {
        LocalStorageHelper.delete('access');
        LocalStorageHelper.delete('refresh');
    },
};

export const http = new AxiosWrapper(
    { baseURL: '/api', timeout: 15_000 },
    {
        enableDoubleToken: true,
        tokenProvider: () => session.access,
        getRefreshToken: () => session.refresh,
        refreshAccessToken: async (refreshToken) => {
            // 注意：刷新请求使用裸 axios，避免递归进入包装器
            const { data } = await axios.post('/api/auth/refresh', { refreshToken });
            if (data.code !== 0) throw new Error('refresh failed');
            session.save({ access: data.data.accessToken, refresh: data.data.refreshToken });
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

export async function login(username: string, password: string) {
    const { data } = await axios.post('/api/auth/login', { username, password });
    session.save({ access: data.data.accessToken, refresh: data.data.refreshToken });
}
```

**关键点**

- 刷新接口必须用裸 `axios`，否则刷新请求自身过期会再次触发刷新。
- 并发请求过期只会刷新一次（Promise 单例）。
- 重放请求会跳过 `tokenProvider`，即使闭包里的 Token 还没更新也不会失败。

## 2. 搜索框：防抖 + 竞态取消 + 缓存

**目标**：输入时防抖；快速输入时旧请求被取消；相同关键词命中缓存。

```ts
import { AxiosWrapper } from '@lania-tools/tools/axios-wrapper';
import { debounce } from '@lania-tools/tools/tools';

const http = new AxiosWrapper(
    { baseURL: '/api' },
    { enableCache: true, cacheTTL: 10_000 },
);

export const search = debounce((keyword: string) => {
    // 每次输入用同一个 cancelTokenId，后一次会取消前一次
    return http
        .get<SearchResult[]>('/search', { q: keyword }, { cancelTokenId: 'search' })
        .catch((error) => {
            if (error?.type === 'debounce' || error?.name === 'CanceledError') return;
            throw error;
        });
}, 300);
```

**关键点**

- 防抖在请求层（`enableDebounce`）与工具层（`debounce`）都能实现：前者适合统一配置，后者适合精确控制。
- `cancelTokenId` 复用保证同一逻辑请求只保留最后一次。
- 缓存 Key 由 `method + url + params + data` 稳定序列化生成，参数顺序不影响命中。

## 3. 分页列表 + 并发控制

```ts
const http = new AxiosWrapper(
    { baseURL: '/api' },
    { maxConcurrent: 4 },
);

async function loadPage(page: number, size = 20) {
    const { data } = await http.get<Page<User>>('/users', { page, size });
    return data;
}
```

**关键点**

- 全局限流会把「请求 + 上传 + 轮询」一起约束，避免首屏被上传挤占。
- 需要独立配额时用 `AxiosWrapperFactory.create('upload', ...)` 创建另一个实例。

## 4. 大文件上传（续传 + 进度 + 取消 + 合并）

```ts
import { AxiosWrapper } from '@lania-tools/tools/axios-wrapper';

const http = new AxiosWrapper({ baseURL: '/api' }, { maxConcurrent: 3 });

export async function upload(file: File, onPercent: (percent: number) => void) {
    const { fileMd5, totalChunks } = await http.uploadFile('/upload/chunk', file, {
        enableResume: true,
        getUploadedChunksUrl: '/upload/uploaded',
        calculateChunkMd5: true,
        cancelTokenId: `upload-${file.name}`,
        onProgress: (finished, total) => onPercent(Math.round((finished / total) * 100)),
    });

    // 所有分片完成后通知服务端合并（协议由后端定义）
    const merged = await http.post('/upload/merge', { fileMd5, totalChunks });
    if (merged.data.code !== 0) throw new Error('merge failed');
    return merged.data.data;
}

// 取消
export const cancelUpload = (fileName: string) =>
    http.cancelRequest(`upload-${fileName}`);
```

**服务端需要提供**

```http
POST /upload/chunk          multipart: file, chunkIndex, totalChunks, fileMd5, chunkMd5
GET  /upload/uploaded?fileMd5=xxx   → { uploaded: [0, 2] }
POST /upload/merge          { fileMd5, totalChunks }
```

**关键点**

- `fileMd5` 是续传主键，必须跨刷新稳定。
- 分片失败会自动重试 3 次（间隔 1s），重试不会占用额外并发槽位。
- 进度回调可能对同一分片触发多次，用 `chunkIndex` 而不是调用次数。

## 5. 导出下载

```ts
const http = new AxiosWrapper({ baseURL: '/api' });

await http.downloadFile('/export/orders', 'post', '订单导出.xlsx', {
    data: { from: '2026-01-01', to: '2026-12-31' },
    cancelTokenId: 'export',
});
```

**关键点**

- 文件名优先取参数，其次 `Content-Disposition` 的 `filename*`，再次 `filename`，最后 URL 末段。
- 100ms 后自动移除 `<a>` 并释放 Blob URL。
- 大文件建议后端返回直链，避免整文件驻留内存。

## 6. 实时通知：SSE / WebSocket + 事件总线

```ts
import { EventBus } from '@lania-tools/tools/event-bus';
import { SSEClient } from '@lania-tools/tools/sse-client';
import { WebSocketClient } from '@lania-tools/tools/websocket-client';

export const bus = new EventBus();
bus.registerNamespace('realtime');

const sse = new SSEClient({ url: '/api/events', reconnectInterval: 3000 });
sse.on('message', (raw) => {
    const message = JSON.parse(raw);
    void bus.emit(message.type, message.payload, { namespace: 'realtime' });
});

const ws = new WebSocketClient({
    url: 'wss://example.com/ws',
    heartbeatInterval: 30_000,
    maxReconnectAttempts: 10,
});
ws.on('message', (raw) => {
    const message = JSON.parse(raw);
    void bus.emit(message.type, message.payload, { namespace: 'realtime' });
});

// 业务侧只订阅事件，不关心传输方式
bus.on('order:paid', (order) => refreshOrder(order.id), { namespace: 'realtime' });
```

**关键点**

- 用事件总线把「传输层」与「业务层」解耦，之后从 SSE 换到 WebSocket 不需要改业务代码。
- SSE 浏览器端不支持自定义 Header，认证通常走 Cookie 或 URL 参数。
- WebSocket 的 `send` 在非 `OPEN` 状态会静默忽略，需要业务自行缓存待发消息。

## 7. 全局状态 + 持久化

```ts
import { Store } from '@lania-tools/tools/store';
import { LocalStorageHelper } from '@lania-tools/tools/web-storage-helper';

type State = { user: { name: string } | null; theme: 'light' | 'dark' };

const persistPlugin = {
    onInit(store: Store<State, any>) {
        const saved = LocalStorageHelper.get<State>('app-state');
        if (saved) store.dispatch({ type: 'hydrate', payload: saved } as any);
    },
    onStateChange(store: Store<State, any>) {
        LocalStorageHelper.set('app-state', store.getState());
    },
};

export const store = new Store({
    initialState: { user: null, theme: 'light' } as State,
    reducers: {
        hydrate: (_state, payload: State) => payload,
        setUser: (state, user: State['user']) => ({ ...state, user }),
        setTheme: (state, theme: State['theme']) => ({ ...state, theme }),
    },
    derivedState: {
        isLoggedIn: (state) => state.user !== null,
    },
    plugins: [persistPlugin],
});
```

**关键点**

- `onInit` 中 `dispatch` 会触发一次 `onStateChange`，如果不需要可加守卫避免循环写。
- `reducers` 必须返回新对象，否则不会通知订阅者。
- 派生状态按 `state` 引用缓存，派生函数必须是纯函数。

## 8. 表单校验（异步 + 跨字段）

```ts
import { Validator, Rules } from '@lania-tools/tools/validator';

type RegisterForm = {
    username: string;
    password: string;
    confirm: string;
};

export const registerValidator = new Validator<RegisterForm>({
    username: [
        Rules.required('请输入用户名'),
        Rules.minLength(3),
        async (value) => {
            const exists = await api.checkUsername(value);
            return { status: !exists, message: '用户名已被占用' };
        },
    ],
    password: [Rules.required(), Rules.minLength(8)],
    confirm: [Rules.required(), Rules.matchField('password', '两次密码不一致')],
});

const { isValid, errors } = await registerValidator.validate(form);
```

**关键点**

- 每个字段在第一条失败规则处停止，`errors[field]` 只保留最关键的提示。
- 校验结果按 `JSON.stringify(data)` 缓存，重复校验同一份数据不会重复发请求。
- 规则抛错视为失败并打印 `console.error`，不会中断整个表单。

## 9. 长列表虚拟滚动

```ts
import { VirtualScroller } from '@lania-tools/tools/virtual-scroller';

const scroller = new VirtualScroller({
    containerSelector: '#list',
    estimatedItemHeight: 56,
    bufferSize: 5,
    loadMoreCallback: async (count) => {
        const { data } = await http.get<Item[]>('/feed', { limit: count });
        return data;
    },
    renderItemContent: (item) => {
        const row = document.createElement('div');
        row.className = 'row';
        row.textContent = item.title;
        return row;
    },
});

// 卸载
scroller.clear();
```

**关键点**

- 容器必须有明确高度，否则 `clientHeight` 为 0，不会渲染任何内容。
- `estimatedItemHeight` 越接近真实平均高度，滚动条跳动越小。
- 数据必须有稳定 `id`，DOM 复用依赖它。

## 10. 拖拽 + 网格吸附

```ts
import { Draggable } from '@lania-tools/tools/draggable';

const draggable = new Draggable(document.getElementById('panel')!, {
    boundary: { minX: 0, maxX: 800, minY: 0, maxY: 600 },
    enableSnap: true,
    snapToGrid: { x: 20, y: 20 },
    snapThreshold: 8,
    enableTouch: true,
    enableAnimation: true,
    onDragEnd: ({ x, y }) => savePosition({ x, y }),
});

draggable.bindEvents();
// draggable.destroy();
```

**关键点**

- `boundary` 限制的是 `translate` 位移值，不是页面坐标。
- `constrainToParent` 会根据父容器尺寸自动推导边界（父容器需要有定位）。
- 拖拽期间会禁用文本选中，结束后恢复。

## 11. 轮播（slide / marquee）

```ts
import { Carousel } from '@lania-tools/tools/carousel';

const carousel = new Carousel({
    mode: 'slide',
    containerSelector: '.banner',
    itemSelector: '.banner__item',
    paginationSelector: '.banner__dots',
    autoplayInterval: 4000,
    pauseOnHover: true,
    speed: 400,
});

// 手动控制
carousel.nextSlide();
carousel.goToSlide(2);
carousel.stopAutoplay();
```

**关键点**

- slide 模式会克隆首尾项实现无缝循环，`originalItemCount` 始终是真实数量。
- 容器隐藏时宽度为 0，需要在显示后触发 `window.resize` 或重新创建实例。
- marquee 模式的 `speed` 单位是 `px/s`。

## 12. 多后端实例

```ts
import { AxiosWrapperFactory } from '@lania-tools/tools/axios-wrapper';

export const userApi = AxiosWrapperFactory.create(
    'user',
    { baseURL: 'https://api.example.com/user' },
    { maxConcurrent: 3, enableCache: true, cacheTTL: 60_000 },
);

export const fileApi = AxiosWrapperFactory.create(
    'file',
    { baseURL: 'https://api.example.com/file' },
    { maxConcurrent: 2 },
);
```

**关键点**

- 同名再次调用返回同一实例；不同名称拥有独立的缓存、限流与取消令牌。
- 工厂的 Map 是进程级静态状态，测试中请使用唯一名称。

## 13. 页面文本批量替换

```ts
import { convertPageChinese } from '@lania-tools/tools/convert-chinese-text';

const stop = convertPageChinese(
    { 記憶: '记忆', 網路: '网络', 程式: '程序' },
    document.body,
    {
        batchSize: 100,
        observeMutations: true,
        excludeSelectors: ['script', 'style', 'pre', 'code', 'textarea', '[contenteditable]'],
    },
);

// 路由切换或卸载时
stop();
```

**关键点**

- 只处理文本节点，不处理属性（`placeholder`、`aria-label`）。
- 开启 `observeMutations` 后新增节点会被自动处理。
- 字典过大会生成超长正则，建议按页面拆分。

## 14. 组件卸载时的清理清单

| 资源 | 清理方式 |
| --- | --- |
| 轮播自动播放 / 跑马灯 | `carousel.destroy()` |
| 拖拽监听 | `draggable.destroy()` |
| 虚拟滚动 | `scroller.clear()`（并移除容器） |
| SSE | `sse.close()` |
| WebSocket | `ws.close()` |
| 轮询 | `http.stopPolling(key)` |
| 进行中的请求 | `http.cancelAllRequests()` |
| 事件总线订阅 | `bus.off(event, handler)` |
| 文本替换观察器 | `stop()` |
| 取消订阅 / 监听 | `unsubscribe()` 返回值 |

## 15. 框架集成：Vue 3 / React

组件库本身无框架依赖，只需注意「DOM 相关实例在挂载后创建、卸载前销毁」。

### Vue 3（组合式 API）

```vue
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { SSEClient } from '@lania-tools/tools/sse-client';
import { VirtualScroller } from '@lania-tools/tools/virtual-scroller';

const listRef = ref<HTMLElement | null>(null);
let sse: SSEClient | null = null;
let scroller: VirtualScroller | null = null;

onMounted(() => {
    sse = new SSEClient({ url: '/api/events' });
    sse.on('message', (raw) => console.log(raw));

    scroller = new VirtualScroller({
        containerSelector: listRef.value!,
        estimatedItemHeight: 56,
        bufferSize: 5,
        loadMoreCallback: async (count) => fetch(`/api/feed?limit=${count}`).then((r) => r.json()),
    });
});

onBeforeUnmount(() => {
    sse?.close();
    sse = null;
    scroller?.clear();
    scroller = null;
});
</script>

<template>
    <div ref="listRef" class="list"></div>
</template>
```

### React（Hooks）

```tsx
import { useEffect, useRef } from 'react';
import { WebSocketClient } from '@lania-tools/tools/websocket-client';

export function useRealtime(onMessage: (data: string) => void) {
    const clientRef = useRef<WebSocketClient | null>(null);

    useEffect(() => {
        const client = new WebSocketClient({ url: 'wss://example.com/ws' });
        client.on('message', onMessage);
        clientRef.current = client;

        return () => {
            client.close();
            clientRef.current = null;
        };
    }, [onMessage]);

    return {
        send: (message: string) => clientRef.current?.send(message),
    };
}
```

### 请求层在框架中的位置

请求层是**与框架无关的单例**，通常放在 `src/services/http.ts`：

```ts
// 只创建一次，所有组件共享缓存与限流
export const http = new AxiosWrapper(...);
```

不要在组件内 `new AxiosWrapper()`，否则每个实例都有独立缓存与并发配额。

### 卸载清单

| 资源 | Vue | React |
| --- | --- | --- |
| 轮播 / 拖拽 / 虚拟滚动 | `onBeforeUnmount` | `useEffect` cleanup |
| SSE / WebSocket | `onBeforeUnmount` | cleanup |
| 轮询 | `onBeforeUnmount` + `stopPolling` | cleanup |
| 进行中的请求 | `cancelAllRequests()` | cleanup |
