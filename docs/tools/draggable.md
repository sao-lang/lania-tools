# 拖拽 Draggable

## 定位

基于 `transform: translate` 的拖拽封装，支持边界限制、网格吸附、触摸与动画。

## 导入

```ts
import { Draggable } from '@lania-tools/tools/draggable';
```

## 快速开始

```html
<div id="box" style="width: 100px; height: 100px; background: #42b983"></div>
```

```ts
const draggable = new Draggable(document.getElementById('box')!, {
    boundary: { minX: 0, maxX: 500, minY: 0, maxY: 300 },
    enableTouch: true,
    enableAnimation: true,
    onDragStart: ({ x, y }) => console.log('start', x, y),
    onDrag: ({ x, y }) => console.log('drag', x, y),
    onDragEnd: ({ x, y }) => console.log('end', x, y),
});

draggable.bindEvents();
```

**必须手动调用 `bindEvents()`**，构造不会自动绑定。

## 配置

```ts
interface DraggableOptions {
    boundary?: DragBoundary;
    initialPosition?: { x: number; y: number };
    enableTouch?: boolean;
    enableAnimation?: boolean;
    enableSnap?: boolean;
    snapToGrid?: { x: number; y: number };
    snapThreshold?: number;
    constrainToParent?: boolean;
    onDragStart?: (event: CustomDragEvent) => void;
    onDrag?: (event: CustomDragEvent) => void;
    onDragEnd?: (event: CustomDragEvent) => void;
    onBoundaryHit?: (event: CustomDragEvent) => void;
}
```

| 选项 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `boundary` | `{ minX?, maxX?, minY?, maxY? }` | 无 | 限制 **translate 位移** |
| `initialPosition` | `{ x, y }` | `{ 0, 0 }` | 初始位移 |
| `enableTouch` | `boolean` | `false` | 启用触摸事件 |
| `enableAnimation` | `boolean` | `false` | 是否加过渡动画 |
| `enableSnap` | `boolean` | `false` | 是否启用网格吸附 |
| `snapToGrid` | `{ x, y }` | `null` | 网格尺寸 |
| `snapThreshold` | `number` | `10` | 吸附阈值（像素） |
| `constrainToParent` | `boolean` | `false` | 限制在父容器内 |
| `onDragStart` | 函数 | 无 | 开始拖拽 |
| `onDrag` | 函数 | 无 | 拖拽中（每帧） |
| `onDragEnd` | 函数 | 无 | 结束 |
| `onBoundaryHit` | 函数 | 无 | 刚碰到边界时触发一次 |

### 事件对象

```ts
interface CustomDragEvent {
    type: 'dragstart' | 'drag' | 'dragend' | 'boundary';
    x: number; // 当前 translateX
    y: number; // 当前 translateY
}
```

## 方法

| 方法 | 说明 |
| --- | --- |
| `bindEvents()` | 绑定鼠标 / 触摸事件 |
| `unbindEvents()` | 解绑事件并取消待执行的动画帧 |
| `setPosition(x, y)` | 直接设置位移（会同步内部状态与 `transform`） |
| `destroy()` | 解绑事件并清理行内样式 |

```ts
draggable.setPosition(100, 50); // 同时更新 currentX/currentY
draggable.destroy();
```

## 拖拽流程

```text
mousedown / touchstart
  ├─ 禁用文本选中
  ├─ 缓存起点 clientX/clientY 与当前 translate
  ├─ 缓存元素尺寸（必要时缓存父容器尺寸）
  ├─ isDragging = true
  └─ onDragStart（仅鼠标路径在 startDrag 之后触发）

mousemove / touchmove
  ├─ 取消上一帧未执行的 rAF
  ├─ rAF：
  │    ├─ delta = client - start
  │    ├─ 目标 = startTranslate + delta
  │    ├─ 应用边界
  │    ├─ 应用吸附
  │    ├─ setPosition（写 transform）
  │    ├─ 刚碰到边界 → onBoundaryHit 一次
  │    └─ onDrag
  └─

mouseup / touchend
  ├─ onDragEnd
  ├─ isDragging = false
  ├─ isBoundaryHit = false
  ├─ 恢复文本选中
  └─ 取消待执行的 rAF
```

## 关键实现

### 1. 为什么用 `transform`

| | `left/top` | `transform: translate` |
| --- | --- | --- |
| 触发重排 | 是 | 否 |
| 合成层 | 反复重建 | 一次提升后复用 |
| 动画性能 | 差 | 好 |

### 2. `requestAnimationFrame` 合并

```ts
if (this.requestId !== null) cancelAnimationFrame(this.requestId);
this.requestId = requestAnimationFrame(() => {
    /* 计算并写入 transform */
});
```

`mousemove` 在高刷新率设备上可达 1000Hz，直接写样式会造成大量无效计算。rAF 保证每帧最多一次。

### 3. 边界计算

```ts
private applyBoundary(value, axis) {
    let min = axis === 'X' ? (boundary.minX ?? -Infinity) : (boundary.minY ?? -Infinity);
    let max = axis === 'X' ? (boundary.maxX ?? Infinity) : (boundary.maxY ?? Infinity);

    if (constrainToParent) {
        const size = axis === 'X' ? elementWidth : elementHeight;
        const parentSize = axis === 'X' ? parentWidth : parentHeight;

        if (boundary[`min${axis}`] === undefined) min = Math.max(min, 0);
        if (boundary[`max${axis}`] === undefined) max = Math.min(max, parentSize - size);
    }

    return Math.min(Math.max(value, min), max);
}
```

- `boundary` 优先；
- `constrainToParent` 只补充**未设置**的边界；
- 约束范围是 `[0, 父宽 - 元素宽]`。

### 4. 边界回调只触发一次

```ts
if (prevX !== moveX || prevY !== moveY) {
    if (!this.isBoundaryHit) {
        this.onBoundaryHit?.({ type: 'boundary', x: moveX, y: moveY });
        this.isBoundaryHit = true;
    }
} else {
    this.isBoundaryHit = false;
}
```

离开边界后状态会重置，下次再碰到会再次触发。

### 5. 网格吸附

```ts
const snapped = Math.round(value / grid) * grid;
const distance = Math.abs(value - snapped);
return distance <= snapThreshold ? snapped : value;
```

只有距离网格线小于 `snapThreshold` 时才吸附。

### 6. 触摸事件

```ts
element.addEventListener('touchstart', onTouchStart, { passive: false });
```

必须 `passive: false` 才能 `preventDefault()` 阻止页面滚动。解绑时参数必须一致：

```ts
element.removeEventListener('touchstart', onTouchStart, { passive: false } as any);
```

`touchend` 绑定在 `document` 上，因为手指可能移出元素后才抬起。

## 完整示例：可保存位置的面板

```ts
import { Draggable } from '@lania-tools/tools/draggable';

const element = document.getElementById('panel')!;
const saved = JSON.parse(localStorage.getItem('panel-position') || 'null');

const draggable = new Draggable(element, {
    initialPosition: saved ?? { x: 0, y: 0 },
    boundary: { minX: 0, minY: 0 },
    constrainToParent: true,
    enableTouch: true,
    enableAnimation: false,
    enableSnap: true,
    snapToGrid: { x: 20, y: 20 },
    snapThreshold: 6,
    onDragEnd: ({ x, y }) => {
        localStorage.setItem('panel-position', JSON.stringify({ x, y }));
    },
    onBoundaryHit: () => {
        element.classList.add('at-edge');
        setTimeout(() => element.classList.remove('at-edge'), 300);
    },
});

draggable.bindEvents();

// 卸载
// draggable.destroy();
```

## 注意事项

| 问题 | 说明 |
| --- | --- |
| 忘记 `bindEvents` | 拖拽不会生效 |
| `position` | 构造时若为 `static` 会改为 `relative` |
| `transform` 冲突 | 组件直接覆盖 `transform`，不要与 `scale` 等混用 |
| 滚动容器 | 不处理滚动偏移，父容器滚动后边界需重新计算 |
| 多实例 | 每个实例都监听 `document`，注意及时 `destroy()` |
| 文本选中 | 拖拽期间全局禁用，结束后恢复 |
| 无障碍 | 不支持键盘拖拽 |
| 触摸滚动 | `touchmove` 会 `preventDefault`，元素上无法同时纵向滚动 |

## 测试覆盖

`packages/tools/tests/draggable.test.ts`（33 个用例）与 `edge-cases.test.ts`：

- 鼠标 / 触摸拖拽全流程；
- 边界限制与 `onBoundaryHit` 只触发一次；
- `setPosition`；
- 网格吸附与阈值；
- 父容器约束；
- 动画帧合并；
- 事件解绑（含 `passive` 参数一致性）；
- `destroy()` 清理动画帧与样式。
