# 虚拟滚动 VirtualScroller

## 定位

只渲染视口内的列表项，用「高度占位」维持滚动条，让十万条数据也能流畅滚动。

## 导入

```ts
import { VirtualScroller } from '@lania-tools/tools/virtual-scroller';
```

## 快速开始

```html
<div id="list" style="height: 400px">

</div>
```

```ts
import { VirtualScroller } from '@lania-tools/tools/virtual-scroller';

const scroller = new VirtualScroller({
    containerSelector: '#list',
    estimatedItemHeight: 56,
    bufferSize: 5,
    loadMoreCallback: async (count) => {
        const res = await fetch(`/api/items?limit=${count}`);
        return res.json();
    },
    renderItemContent: (item) => `<div class="row">${item.name}</div>`,
});
```

> 容器**必须**有高度（CSS 或行内样式），否则 `clientHeight` 为 0，不会渲染任何内容。

## 配置

```ts
interface VirtualScrollerOptions {
    containerSelector: string | HTMLElement;
    estimatedItemHeight: number;
    bufferSize: number;
    loadMoreCallback: (count: number) => Promise<any[]>;
    renderItemContent?: (data: any) => string | HTMLElement;
}
```

| 选项 | 类型 | 说明 |
| --- | --- | --- |
| `containerSelector` | `string \| HTMLElement` | 滚动容器 |
| `estimatedItemHeight` | `number` | 预估行高，用于初始占位与视图容量计算 |
| `bufferSize` | `number` | 视口上下额外渲染的项数 |
| `loadMoreCallback` | `(count) => Promise<any[]>` | 加载数据；`count` 固定为 20 |
| `renderItemContent` | `(data) => string \| HTMLElement` | 自定义渲染；字符串作为 HTML，元素会被 append |

构造函数可能抛错：

```text
VirtualScroller: Container element not found.
```

## 方法

| 方法 | 说明 |
| --- | --- |
| `loadMore(): Promise<void>` | 手动加载下一批（内部有并发保护） |
| `clear(): void` | 清空数据、DOM、复用池，并把 `scrollTop` 归零 |

## 内部状态

| 字段 | 含义 |
| --- | --- |
| `allItems` | 所有数据项（含计算出的 `height` 与 `offsetTop`） |
| `totalHeight` | 所有项高度之和 |
| `viewportHeight` | 容器可见高度 |
| `maxItemsPerView` | `ceil(viewportHeight / estimatedItemHeight) + 2 * bufferSize` |
| `startIndex` / `endIndex` | 当前渲染区间 |
| `domPool` | `id → HTMLElement` 复用池 |
| `isLoading` | 加载锁 |
| `itemsToLoadCount` | 固定 20 |

## 渲染原理

### 1. 视口区间计算

```text
totalHeight
┌──────────────────────────────┐
│  ░░░░░ buffer 区（已渲染）      │
│  █████ 可见区（已渲染）         │
│  ░░░░░ buffer 区（已渲染）      │
│  （其余项不渲染）               │
└──────────────────────────────┘
```

```ts
// 二分查找最后一个 offsetTop <= scrollTop 的项
const start = findStartIndex(scrollTop);
const newStart = Math.max(0, start - bufferSize);
const newEnd = Math.min(items.length - 1, newStart + maxItemsPerView);
```

只有 `startIndex` / `endIndex` 变化时才重新渲染。

### 2. 二分查找

```ts
private findStartIndex(scrollTop: number): number {
    let low = 0;
    let high = this.allItems.length - 1;
    let resultIndex = 0;

    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (this.allItems[mid].offsetTop <= scrollTop) {
            low = mid + 1;
            resultIndex = mid;
        } else {
            high = mid - 1;
        }
    }
    return resultIndex;
}
```

复杂度 `O(log n)`，滚动时每帧只做一次。

### 3. DOM 复用池

```text
滚动离开视口 → 从 DOM 移除，但保留在 domPool
滚动回到视口 → 从 domPool 取出，只更新 transform / height
```

复用 key 是数据项的 `id`：

```ts
const id = data.id !== undefined ? data.id : `item-${index}`;
```

因此**业务数据必须提供稳定 id**，否则复用会错乱。

### 4. 不定高测量

预估高度会与真实高度有偏差。每次渲染后：

```ts
requestAnimationFrame(() => this.measureItemHeights());
```

测量步骤：

1. 遍历当前渲染的元素，读取 `offsetHeight`；
2. 与记录的 `height` 比较，记录第一个变化的索引；
3. 从该索引开始重新累加 `offsetTop`；
4. 更新在 DOM 中的元素的 `translateY`；
5. 更新 `totalHeight` 与占位高度；
6. 重新校验可视范围。

这样即使项高度不一致，滚动条也能保持准确。

### 5. 触底加载

```ts
const distanceToBottom = totalHeight - (scrollTop + viewportHeight);
if (distanceToBottom < 200 && !isLoading) {
    this.loadMore();
}
```

`isLoading` 防止滚动事件密集触发时重复请求。

### 6. 加载失败

```ts
try {
    const newItems = await loadMoreCallback(20);
    if (newItems?.length) calculatePositions(newItems);
    else if (allItems.length === 0) console.log('No initial data to display.');
} catch (error) {
    console.error('Error loading data:', error);
} finally {
    isLoading = false;
}
```

失败只记录日志，`isLoading` 会复位，允许再次触发。

### 7. 响应式

```ts
window.addEventListener('resize', this.onResize.bind(this));
```

`clientHeight` 变化时重新计算 `maxItemsPerView` 并刷新可视范围。

## 元素结构

```html
<div id="list" style="overflow-y: scroll; position: relative">
    <div style="position: relative; width: 100%; height: <totalHeight>px">
        <div data-id="0" style="position: absolute; width: 100%; transform: translateY(0px); height: 56px">
            ...
        </div>
        <div data-id="1" style="position: absolute; width: 100%; transform: translateY(56px); height: 56px">
            ...
        </div>
    </div>
</div>
```

容器与列表元素的行内样式由组件设置，子项为绝对定位 + `translateY`。

## 完整示例：带自定义渲染的聊天记录

```ts
import { VirtualScroller } from '@lania-tools/tools/virtual-scroller';

let cursor = 0;

const scroller = new VirtualScroller({
    containerSelector: '#messages',
    estimatedItemHeight: 64,
    bufferSize: 8,
    loadMoreCallback: async (count) => {
        const page = await api.getMessages({ cursor, limit: count });
        cursor = page.nextCursor;
        return page.items;
    },
    renderItemContent: (message) => {
        const row = document.createElement('div');
        row.className = `message message--${message.role}`;
        row.textContent = message.content;
        return row;
    },
});
```

## 注意事项

| 问题 | 说明 |
| --- | --- |
| 容器高度 | 必须有明确高度，否则不渲染 |
| 预估高度误差 | 误差越大，滚动条跳动越明显；异步测量会逐步修正 |
| 数据 id | 必须稳定，否则 DOM 复用错乱 |
| 加载数量 | 固定 20 条，不可配置 |
| 高度变化 | 图片异步加载等导致的高度变化需要触发重新测量（滚动或 resize 会触发） |
| 横向滚动 | 不支持 |
| 销毁 | 组件没有 `destroy()`，且对 `window.resize` 的监听不会移除；单页应用反复创建实例时需要自行处理 |
| 无障碍 | 大部分内容不在 DOM 中，屏幕阅读器体验有限 |

## 调试

```ts
const scroller = new VirtualScroller({ ... });

// 开发环境可读取内部状态
console.log((scroller as any).startIndex, (scroller as any).endIndex);
console.log((scroller as any).allItems.length);
console.log((scroller as any).domPool.size);
```

`domPool.size` 应稳定在「可视项数 + buffer」附近，持续增长说明 id 不稳定。

## 测试覆盖

`packages/tools/tests/virtual-scroller.test.ts` 与 `edge-cases.test.ts`：

- 选择器 / HTMLElement / 无效容器抛错；
- 首次加载与空数据提示；
- 滚动重算可视范围；
- `clear()`；
- 加载失败恢复；
- `isLoading` 并发保护；
- resize 重算；
- DOM 复用与 `renderItemContent`（字符串 / 元素）。
