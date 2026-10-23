# 中文批量转换

## 定位

按字典批量替换页面文本，常用于：

- 繁体 → 简体；
- 术语统一（`程式` → `程序`）；
- 文案替换 / 品牌名替换；
- 简易多语言替换。

提供两个 API：

| API | 用途 |
| --- | --- |
| `createChineseConverter` | 纯函数转换器，可独立使用 |
| `convertPageChinese` | 扫描并批量替换 DOM 文本节点 |

## 导入

```ts
import {
    createChineseConverter,
    convertPageChinese,
} from '@lania-tool/tools/convert-chinese-text';
```

## createChineseConverter

```ts
function createChineseConverter(maxCacheSize?: number): (
    text: string,
    dictionary: Record<string, string>,
    useCache?: boolean,
) => string;
```

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `maxCacheSize` | `500` | LRU 缓存上限 |
| `text` | — | 待替换文本 |
| `dictionary` | — | 字典 |
| `useCache` | `true` | 是否使用缓存 |

### 示例

```ts
const convert = createChineseConverter(200);

convert('記憶與網路', { 記憶: '记忆', 網路: '网络' });
// '记忆与网络'

convert('', { 記憶: '记忆' });          // ''（空文本直接返回）
convert('abc', {});                    // 'abc'（空字典直接返回）
```

### 配套字典

现成的简繁字典可直接安装 [`@lania-tool/json`](https://www.npmjs.com/package/@lania-tool/json) 使用：

```bash
pnpm add @lania-tool/json
```

```ts
import simpledToTraditional from '@lania-tool/json/simpledToTraditional.json';
import traditionalToSimpled from '@lania-tool/json/traditionalToSimpled.json';

convert('中國臺灣', traditionalToSimpled);  // '中国台湾'
convert('中国台湾', simpledToTraditional);  // '中國臺灣'
```

详见 json 包 README。

### 内部机制

```ts
const cache = new Map<string, string>();
let dict: Record<string, string> = {};

return (text, dictionary, useCache = true) => {
    if (!text || !dictionary || !Object.keys(dictionary).length) return text;

    // 字典变化 → 重建正则 + 清空缓存
    if (dict !== dictionary) {
        dict = dictionary;
        const keys = Object.keys(dict).map(escapeRegExp);
        pattern = keys.length ? new RegExp(keys.join('|'), 'g') : /($^)/;
        cache.clear();
    }

    // 命中缓存 → 移到队尾（LRU）
    if (useCache && cache.has(text)) {
        const result = cache.get(text)!;
        cache.delete(text);
        cache.set(text, result);
        return result;
    }

    const result = text.replace(pattern, (match) => dict[match] || match);

    if (useCache) {
        cache.set(text, result);
        if (cache.size > maxCacheSize) {
            const firstKey = cache.keys().next().value;
            if (firstKey) cache.delete(firstKey);
        }
    }

    return result;
};
```

要点：

1. **字典引用变化**才重建正则与清空缓存（同一对象内的修改不会触发）；
2. 字典 key 会转义正则元字符（`a.b` 中的 `.` 不会匹配任意字符）；
3. `Map` 的插入顺序用于实现 LRU：命中时删除再插入；
4. 超限时删除队首（最久未使用）。

## convertPageChinese

```ts
function convertPageChinese(
    dictionary: Record<string, string>,
    targetElement?: HTMLElement,   // 默认 document.body
    options?: ConvertOptions,
): () => void;
```

### ConvertOptions

| 选项 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `observeMutations` | `boolean` | `false` | 监听 DOM 变化，处理新增节点 |
| `batchSize` | `number` | `100` | 每批处理的文本节点数 |
| `excludeSelectors` | `string[]` | `[]` | 排除的选择器 |
| `useCache` | `boolean` | `true` | 是否缓存替换结果 |
| `maxCacheSize` | `number` | `500` | LRU 缓存上限 |

返回值为**停止观察**函数；即使未开启 `observeMutations` 也返回可安全调用的函数。

### 最小示例

```ts
const stop = convertPageChinese(
    { 記憶: '记忆', 網路: '网络', 程式: '程序' },
    document.body,
    {
        batchSize: 100,
        observeMutations: true,
        excludeSelectors: ['script', 'style', 'pre', 'code', 'textarea', '[contenteditable]'],
    },
);

// 路由切换 / 卸载
stop();
```

## 完整处理流程

```text
convertPageChinese(dictionary, target, options)
  │
  ├─ 字典为空 → 返回空函数
  ├─ 创建转换器 createChineseConverter(maxCacheSize)
  │
  ├─ 收集文本节点
  │    └─ TreeWalker(SHOW_TEXT)
  │         ├─ 跳过括号内空白节点
  │         └─ 排除命中 excludeSelectors 的父元素
  │
  ├─ 队列初始化
  │
  ├─ processBatch()（同步执行第一批）
  │    ├─ 取出 batchSize 个节点
  │    ├─ 跳过已被移除的节点（parentElement 为空）
  │    ├─ 替换文本
  │    └─ 队列非空 → requestIdleCallback(processBatch)
  │
  └─ observeMutations
       ├─ 收集新增元素节点（去重 + 排除）
       └─ idle 回调中统一收集其文本节点并处理
```

### 为什么用 TreeWalker

只遍历文本节点，避免对每个元素读取 `innerText`（会触发重排）。空白节点会被跳过，减少无意义替换与缓存条目。

### 为什么用 requestIdleCallback

大批量文本替换如果同步完成，会阻塞主线程造成掉帧。分批放入空闲回调可以保持交互流畅：

```ts
const idleCallback =
    window.requestIdleCallback ||
    ((fn) => setTimeout(fn, 16));
```

不支持 `requestIdleCallback` 的浏览器退化为 16ms 定时器。

### 为什么排除要检查 parentNode

`TreeWalker` 的 `acceptNode` 收到的是文本节点，排除规则需要作用在它的父元素上：

```ts
acceptNode: (node) =>
    shouldExclude(node.parentNode) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
```

`shouldExclude` 使用 `closest(selector)`，因此子节点也会被排除。

## 监听动态内容

```ts
convertPageChinese(dict, document.body, { observeMutations: true });
```

MutationObserver 只收集**新增的元素节点**，并在一次空闲回调中批量收集其文本节点，避免每次 DOM 变动都同步遍历整棵子树。

```ts
const pendingElements = new Set<Node>();

const handleMutations = (mutations) => {
    for (const m of mutations) {
        for (const n of Array.from(m.addedNodes)) {
            if (n.nodeType === Node.ELEMENT_NODE && !shouldExclude(n)) {
                pendingElements.add(n);
            }
        }
    }
    if (pendingElements.size > 0 && !scheduled) {
        scheduled = true;
        idleCallback(() => {
            scheduled = false;
            pendingElements.forEach((el) => getTextNodes(el).forEach((n) => queue.push(n)));
            pendingElements.clear();
            processBatch();
        });
    }
};
```

## 性能建议

| 场景 | 建议 |
| --- | --- |
| 长文档 | 增大 `batchSize` 更快，但单批阻塞更久 |
| 频繁 DOM 更新 | 开启 `observeMutations` |
| 字典很大 | 控制在数百条内，或按页面拆分字典 |
| 重复文本多 | 保持 `useCache: true` |
| 只替换一次 | 保持 `observeMutations: false`，处理完即可 |

## 限制

1. **只处理文本节点**：不修改 `title`、`placeholder`、`aria-label`、`value` 等属性。
2. **不处理 Shadow DOM**：需要对每个 shadow root 单独调用。
3. **替换结果不会二次参与替换**：避免链式误替换。
4. **`stop()` 只停止观察**：已排队的批次仍可能执行。
5. **字典按引用比较**：修改同一字典对象的属性不会重建正则，请传入新对象。
6. **正则 `g` 标志**：长度大或条目多的字典会生成很长的正则，注意性能。

## 完整示例：繁体转简体

```ts
import { convertPageChinese } from '@lania-tool/tools/convert-chinese-text';

const traditionalToSimplified = {
    記憶: '记忆',
    網路: '网络',
    程式: '程序',
    資訊: '信息',
    軟體: '软件',
};

export function localizePage(root: HTMLElement = document.body) {
    return convertPageChinese(traditionalToSimplified, root, {
        batchSize: 200,
        observeMutations: true,
        excludeSelectors: ['script', 'style', 'pre', 'code', 'textarea', 'input'],
    });
}
```

## 测试覆盖

`packages/tools/tests/convert-chinese-text.test.ts`（36 个用例）：

- 基础替换与多条目；
- 正则特殊字符转义；
- 空文本 / 空字典；
- 排除选择器；
- `batchSize` 分批；
- LRU 缓存命中与淘汰；
- `useCache: false`；
- MutationObserver 处理新增节点。
