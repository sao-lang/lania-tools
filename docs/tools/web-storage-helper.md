# 本地存储

## 定位

四套**同构 API** 的存储封装，共享同一套方法名与选项，切换介质时几乎不需要改业务代码。

```ts
import {
    LocalStorageHelper,
    SessionStorageHelper,
    CookieHelper,
    IndexedDBHelper,
} from '@lania-tools/tools/web-storage-helper';
```

## 介质对比

| 类 | 介质 | 容量 | 生命周期 | 同步 / 异步 |
| --- | --- | --- | --- | --- |
| `LocalStorageHelper` | `localStorage` | ~5MB | 永久 | 同步 |
| `SessionStorageHelper` | `sessionStorage` | ~5MB | 标签页关闭 | 同步 |
| `CookieHelper` | `document.cookie` | ~4KB | 可设置 | 同步 |
| `IndexedDBHelper` | IndexedDB | 大（按配额） | 永久 | 异步 |

## 统一 API

| 方法 | 签名 | 说明 |
| --- | --- | --- |
| `set` | `(key, value, options?) => void \| Promise<void>` | 写入 |
| `get` | `<T>(key) => T \| null \| Promise<T \| null>` | 读取，不存在或过期返回 `null` |
| `delete` | `(key) => void \| Promise<void>` | 删除 |
| `clear` | `() => void \| Promise<void>` | 清空 |
| `keys` | `() => string[] \| Promise<string[]>` | 所有 key |
| `size` | `() => number \| Promise<number>` | 条目大小 |
| `setMultiple` | `(items, options?) => void \| Promise<void>` | 批量写入 |
| `getMultiple` | `<T>(keys) => Record<string, T \| null>` | 批量读取 |

> 只有 `IndexedDBHelper` 的方法返回 Promise。

### 选项

```ts
interface StorageOptions {
    /** 过期时间（秒），不传表示永不过期 */
    expiresInSeconds?: number;
    /** 是否以十六进制编码存储 */
    encryptData?: boolean;
}
```

## 内部数据格式

四种介质都存储同一个结构：

```ts
interface StoredData<T> {
    value: T;
    expiresAt: number | null; // null = 永不过期
}
```

- localStorage / sessionStorage / IndexedDB：序列化为 JSON 字符串；
- Cookie：序列化后再 `encodeURIComponent`。

### 过期语义

```text
get(key)
  ├─ 不存在 → null
  ├─ 无法解析 → console.error → null
  ├─ expiresAt === null → 返回 value
  ├─ Date.now() < expiresAt → 返回 value
  └─ 已过期 → delete(key) → null
```

过期是**惰性删除**：读取时才判断与清理，没有后台定时器。

### 为什么不能区分「不存在」和「存了 null」

两者的 `get` 都返回 `null`。需要区分时使用 `keys().includes(key)` 判断存在性。

## LocalStorageHelper

```ts
LocalStorageHelper.set('token', 'abc');
LocalStorageHelper.set('profile', { name: 'Ada' }, { expiresInSeconds: 3600 });
LocalStorageHelper.get<{ name: string }>('profile'); // { name: 'Ada' }

LocalStorageHelper.setMultiple({ a: 1, b: 2 });
LocalStorageHelper.getMultiple<number>(['a', 'b']); // { a: 1, b: 2 }

LocalStorageHelper.keys(); // 所有 key
LocalStorageHelper.size(); // 所有条目字符串长度之和
```

`size()` 返回的是**字符数**，不是字节数，也不包含 key 的长度。

## SessionStorageHelper

API 与 `LocalStorageHelper` 完全一致，只是底层使用 `sessionStorage`。

```ts
SessionStorageHelper.set('draft', { title: '未保存' });
```

适合：表单草稿、一次性流程状态、标签页隔离的数据。

## CookieHelper

```ts
CookieHelper.set('theme', 'dark', { expiresInSeconds: 60 * 60 * 24 * 7 });
CookieHelper.get<string>('theme'); // 'dark'
CookieHelper.delete('theme');
```

### 行为细节

| 行为 | 说明 |
| --- | --- |
| 默认过期 | 未传 `expiresInSeconds` 时为 **10 年** |
| 路径 | 固定 `path=/` |
| 编码 | 值经过 `encodeURIComponent` |
| 读取 | 浏览器负责过期；本类的 `get` 不再二次判断 `expiresAt` |
| 删除 | 写入 `Max-Age=-99999999; path=/` |
| `keys` | 解析当前域下所有 Cookie 名 |
| `size` | 各 Cookie 字符串长度之和 |

### 限制

- 没有 `domain`、`secure`、`SameSite`、`HttpOnly` 选项；
- 容量约 4KB；
- `document.cookie` 无法读取 `HttpOnly` Cookie；
- 每次请求都会携带，注意体积。

需要这些能力时请直接操作 `document.cookie` 或由服务端 `Set-Cookie`。

## IndexedDBHelper

```ts
await IndexedDBHelper.set('user', { id: 1, name: 'Ada' });
await IndexedDBHelper.get<{ id: number; name: string }>('user');
await IndexedDBHelper.delete('user');
await IndexedDBHelper.clear();
await IndexedDBHelper.keys();
await IndexedDBHelper.size();
await IndexedDBHelper.setMultiple({ a: 1, b: 2 });
await IndexedDBHelper.getMultiple<number>(['a', 'b']);
```

### 数据库结构

| 项 | 值 |
| --- | --- |
| database | `myDatabase` |
| object store | `myStore` |
| keyPath | `id` |
| version | `1` |

### 执行流程

```text
set(id, value)
  ├─ 序列化 { value, expiresAt }
  ├─ initDB()
  │    ├─ indexedDB.open('myDatabase', 1)
  │    ├─ onupgradeneeded → createObjectStore('myStore', { keyPath: 'id' })
  │    ├─ onsuccess → resolve(db)
  │    └─ onerror → reject(error)
  ├─ transaction('myStore', 'readwrite')
  ├─ store.put({ id, value })
  └─ transaction.oncomplete → resolve
```

### 错误行为

- 打开数据库失败：reject `open failed`；
- 事务失败：reject `transaction.error`；
- 读取时 `db.transaction` 抛错：捕获后 reject。

### 过期数据

`get` 发现 `expiresAt` 已过时，会调用 `delete(id)` 然后返回 `null`。因此**读取过期数据会产生一次写操作**。

### 限制

- `dbName` / `storeName` 是私有静态常量，不可配置；
- 只支持单 store；
- 所有方法都依赖 IndexedDB 存在（SSR / 隐私模式下不可用）。

## 加密选项

```ts
LocalStorageHelper.set('secret', { a: 1 }, { encryptData: true });
```

实现是把字符串按 UTF-8 转成十六进制：

```ts
const bytes = new TextEncoder().encode(json);
const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
```

读取时先判断是否为合法十六进制，是则解码，否则按明文处理。

::: warning
这不是加密，只是编码。能防止肉眼直读，**不能防篡改，也不能保护敏感数据**。敏感信息应放在 HttpOnly Cookie 或服务端会话中。
:::

## 完整示例：带过期的用户偏好

```ts
import { LocalStorageHelper } from '@lania-tools/tools/web-storage-helper';

interface Preferences {
    theme: 'light' | 'dark';
    language: string;
}

const KEY = 'user-preferences';

export function loadPreferences(): Preferences | null {
    return LocalStorageHelper.get<Preferences>(KEY);
}

export function savePreferences(preferences: Preferences): void {
    LocalStorageHelper.set(KEY, preferences, { expiresInSeconds: 30 * 24 * 3600 });
}

export function clearPreferences(): void {
    LocalStorageHelper.delete(KEY);
}
```

## 注意事项

| 问题 | 说明 |
| --- | --- |
| SSR | `window.localStorage` / `document.cookie` 不存在 |
| 隐私模式 | 写入可能抛 `QuotaExceededError`（`get` 有 try/catch，`set` 没有） |
| 同源策略 | 所有介质都受同源限制 |
| 并发 | localStorage 多标签页同时写会互相覆盖，可监听 `storage` 事件 |
| 加密 | 只是十六进制编码 |
| 大小 | `size()` 是字符数近似值 |
| 版本升级 | `IndexedDBHelper` 固定 version=1，扩展 schema 需要自行处理 `onupgradeneeded` |

## 测试覆盖

`packages/tools/tests/web-storage-helper.test.ts`（49 个用例）与 `edge-cases.test.ts`：

- 四套存储的增删改查、批量操作；
- 过期与惰性删除；
- 加密写入 / 读取；
- `keys` / `size` / `clear`；
- Cookie 的编码与过期；
- IndexedDB 的建库（`onupgradeneeded`）、读取、过期删除、打开失败、游标。
