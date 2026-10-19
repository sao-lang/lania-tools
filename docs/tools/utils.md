# 函数与对象工具

## 定位

五个高频基础工具，零依赖、可直接在任何运行时使用。

| 函数 | 作用 | 是否需要 DOM |
| --- | --- | --- |
| `debounce` | 停止触发 `wait` 毫秒后执行 | 否 |
| `throttle` | 在 `wait` 毫秒内最多执行一次 | 否 |
| `deepClone` | 支持循环引用与特殊对象的深拷贝 | 否 |
| `isDeepEqual` | 支持循环引用的深度比较 | 否 |
| `copy` | 复制文本 / 图片到剪贴板 | 是 |

```ts
import { debounce, throttle, deepClone, isDeepEqual, copy } from '@lania-tools/tools/tools';
```

---

## debounce

### 签名

```ts
function debounce<T extends (...args: any[]) => any>(
    fn: T,
    wait?: number,
    immediate?: boolean,
): ((...args: Parameters<T>) => ReturnType<T>) & { cancel: () => void };
```

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `fn` | `Function` | 必填 | 目标函数 |
| `wait` | `number` | `1000` | 静默时间（毫秒） |
| `immediate` | `boolean` | `false` | 是否首次立即执行 |

返回值：包装后的函数；同类型参数与返回值，并附带 `cancel()`。

### 行为

#### 普通模式（`immediate = false`）

```text
t=0    调用 A → 清除无定时器 → 设 300ms 定时器
t=100  调用 B → 清除 A 的定时器 → 设新定时器
t=250  调用 C → 清除 B 的定时器 → 设新定时器
t=550  执行 C
```

```ts
const search = debounce((keyword: string) => {
    console.log('search', keyword);
}, 300);

search('a');
search('ab');
search('abc');
// 300ms 后只输出一次：search abc
```

#### 立即模式（`immediate = true`）

```text
t=0    调用 A → 立即执行 → 进入 300ms 冷却
t=100  调用 B → 冷却中，忽略
t=400  调用 C → 冷却结束，立即执行
```

```ts
const submit = debounce(() => api.submit(), 1000, true);
submit(); // 立即调用
submit(); // 1s 内忽略
```

#### 返回值

返回的是**上一次执行**的结果，因为本次调用可能只是排队：

```ts
const fn = debounce((x: number) => x * 2, 10);
fn(2);  // undefined（尚未执行）
// 10ms 后执行
```

#### cancel

```ts
const fn = debounce(() => console.log('run'), 300);
fn();
fn.cancel(); // 取消，不会执行
```

### 典型用法

```ts
// 输入框
input.addEventListener('input', debounce((e) => {
    fetchSuggestions((e.target as HTMLInputElement).value);
}, 250));

// 窗口尺寸
window.addEventListener('resize', debounce(() => relayout(), 200));

// 自动保存
const autoSave = debounce(() => saveDocument(), 2000);
editor.on('change', autoSave);
```

### 注意

- `wait` 传 `0` 时会回退为 `1000`（`wait || 1000`）。
- `cancel()` 只清除定时器，不会重置已返回的结果。

---

## throttle

### 签名

```ts
function throttle<T extends (...args: any[]) => any>(
    func: T,
    wait?: number,
    options?: { leading?: boolean; trailing?: boolean },
): ((...args: Parameters<T>) => ReturnType<T>) & { cancel: () => void };
```

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `func` | `Function` | 必填 | 目标函数 |
| `wait` | `number` | `1000` | 最小间隔（毫秒） |
| `options.leading` | `boolean` | `true` | 首次是否立即执行 |
| `options.trailing` | `boolean` | `true` | 窗口结束时是否补一次 |

### 行为

```text
leading: true, trailing: true（默认）
调用 → 立即执行 → 冷却期内再调用 → 安排一次尾调用
```

```ts
const onScroll = throttle(() => {
    console.log(window.scrollY);
}, 200);
window.addEventListener('scroll', onScroll);
```

#### 关闭首调用

```ts
const fn = throttle(handler, 500, { leading: false });
fn(); // 不立即执行，500ms 后执行
```

#### 关闭尾调用

```ts
const fn = throttle(handler, 500, { trailing: false });
fn(); // 立即执行
fn(); // 冷却期内忽略，且不会补执行
```

#### cancel

```ts
const fn = throttle(handler, 500);
fn();
fn.cancel(); // 清除待执行的尾调用，并重置计时
```

### 时间回拨处理

```ts
if (remaining <= 0 || remaining > wait) { ... }
```

`remaining > wait` 说明系统时间被往回调整，此时直接执行并重置基准。

### 与 debounce 对比

```text
连续触发 10 次，间隔 50ms，窗口 200ms

debounce：▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁█   只执行最后一次
throttle：█▁▁▁▁█▁▁▁▁█▁▁▁▁█▁▁▁▁█   每 200ms 执行一次
```

---

## deepClone

### 签名

```ts
function deepClone<T>(obj: T, cache?: WeakMap<object, any>): T;
```

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `obj` | `T` | 待克隆值 |
| `cache` | `WeakMap` | 内部用于处理循环引用，通常不传 |

### 支持的类型

| 类型 | 处理方式 |
| --- | --- |
| 原始值 / `null` | 直接返回 |
| `Date` | `new Date(time)` |
| `RegExp` | `new RegExp(source, flags)` |
| `Map` | 键和值都递归克隆 |
| `Set` | 元素递归克隆 |
| `Array` | 逐项递归 |
| 普通对象 | 仅复制自身可枚举字符串键 |
| 循环引用 | `WeakMap` 缓存，保持引用结构 |

### 示例

```ts
const source = {
    date: new Date('2026-01-01'),
    regexp: /ab+c/gi,
    map: new Map([['a', { deep: 1 }]]),
    set: new Set([1, 2]),
    nested: { list: [1, 2, 3] },
};
source.self = source;

const clone = deepClone(source);

clone.self === clone;            // true
clone.nested !== source.nested;  // true
clone.map !== source.map;        // true
clone.date.getTime() === source.date.getTime(); // true
```

### 不支持

- class 实例的方法与原型链（会被当作普通对象，丢失原型）；
- `Symbol` 键；
- 不可枚举属性；
- `ArrayBuffer` / `Blob` / 函数（函数按引用复制）；
- `WeakMap` / `WeakSet`（会被当作空普通对象）。

需要处理这些类型时请使用 `structuredClone` 或专门的库。

---

## isDeepEqual

### 签名

```ts
function isDeepEqual<T>(
    a: T,
    b: T,
    cacheA?: WeakMap<object, any>,
    cacheB?: WeakMap<object, any>,
): boolean;
```

### 比较规则

1. `a === b` → `true`；
2. 两者都是 `NaN` → `true`；
3. 任一方不是对象 → `false`；
4. 构造函数不同 → `false`（`Date` ≠ `Array`）；
5. 循环引用：已缓存的配对视为相等；
6. `Date` 比较时间戳；
7. `RegExp` 比较 `source` 与 `flags`；
8. `Map` 比较 size，再按 **键的引用** 取值并深度比较值（对象键需要是同一个引用）；
9. `Set` 比较 size，再为每个元素寻找深层相等项（**无序**）；
10. 普通对象 / 数组：key 数量相同且每个 key 深度相等。

### 示例

```ts
isDeepEqual({ a: [1, 2] }, { a: [1, 2] });            // true
isDeepEqual({ a: 1 }, { a: 1, b: 2 });                // false
isDeepEqual(NaN, NaN);                                // true
isDeepEqual(new Date(0), new Date(0));                // true
isDeepEqual(/a/gi, /a/gi);                            // true
isDeepEqual(new Set([1, 2]), new Set([2, 1]));        // true
isDeepEqual(new Map([['a', 1]]), new Map([['a', 1]])); // true
```

循环引用：

```ts
const a: any = { value: 1 };
a.self = a;
const b: any = { value: 1 };
b.self = b;
isDeepEqual(a, b); // true
```

### 为什么不用 JSON.stringify

```ts
JSON.stringify(new Map([['a', 1]]));  // '{}'
JSON.stringify({ a: undefined });     // '{}'
JSON.stringify({ a: 1, b: 2 }) === JSON.stringify({ b: 2, a: 1 }); // false
```

顺序敏感、丢失类型、无法处理循环引用。

---

## copy

### 签名

```ts
function copy(options: { text?: string; imageUrl?: string }): Promise<void>;
```

### 行为矩阵

| 条件 | 行为 |
| --- | --- |
| `text` + `navigator.clipboard` | `clipboard.writeText` |
| `text`，无 clipboard | 创建隐藏 `textarea` + `document.execCommand('copy')` |
| `imageUrl` + clipboard + `ClipboardItem` | `fetch` → `Blob` → `clipboard.write` |
| `imageUrl`，无 `ClipboardItem` | `console.warn`，不抛错 |
| 既无 `text` 也无 `imageUrl` | **抛出** `Either text or imageUrl must be provided` |

### 示例

```ts
import { copy } from '@lania-tools/tools/tools';

await copy({ text: '邀请码：ABC123' });
await copy({ imageUrl: 'https://example.com/chart.png' });
```

### 错误处理

文本 / 图片复制失败只打印 `console.error`，Promise 仍然 resolve：

```ts
await copy({ text: 'x' }); // 即使剪贴板权限被拒绝也不会 reject
```

这样调用方不需要为「权限被拒」写额外分支；需要感知失败时请自行检查 `navigator.permissions` 或改用原生 API。

### 注意

- 图片固定按 `image/png` 写入；JPEG 在部分浏览器会失败。
- `ClipboardItem` 在非安全上下文（HTTP）不可用。
- 浏览器要求复制操作处于用户手势中，异步延迟后调用可能被拒绝。

---

## 测试覆盖

| 模块 | 测试 |
| --- | --- |
| `debounce` | `tests/tools.test.ts`：普通 / 立即 / `cancel` |
| `throttle` | `tests/edge-cases.test.ts`：尾部执行与定时器清理 |
| `deepClone` | `tests/tools.test.ts`：Date / RegExp / Map / Set / 循环引用 |
| `isDeepEqual` | `tests/tools.test.ts`：全部类型与 NaN |
| `copy` | `tests/edge-cases.test.ts`：剪贴板失败、`execCommand` 失败、图片失败、无 `ClipboardItem`、无参数 |
