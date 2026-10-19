# 轮播 Carousel

## 定位

原生 DOM 轮播，支持两种模式：

| 模式 | 效果 | `speed` 含义 | 适用 |
| --- | --- | --- | --- |
| `slide` | 一次显示一张，切换时滑动 | 过渡时长（ms） | 图片轮播、卡片 |
| `marquee` | 内容连续滚动 | 滚动速度（px/s） | 公告、logo 墙 |

## 导入

```ts
import { Carousel } from '@lania-tools/tools/carousel';
```

## HTML 结构

```html
<!-- slide 模式 -->
<div class="banner">
    <div class="banner__item">1</div>
    <div class="banner__item">2</div>
    <div class="banner__item">3</div>
</div>
<div class="banner__dots"></div>

<!-- marquee 模式 -->
<div class="notice">
    <span class="notice__item">公告一</span>
    <span class="notice__item">公告二</span>
</div>
```

## 快速开始

```ts
const carousel = new Carousel({
    mode: 'slide',
    containerSelector: '.banner',
    itemSelector: '.banner__item',
    paginationSelector: '.banner__dots',
    speed: 300,
    autoplayInterval: 3000,
    pauseOnHover: true,
});
```

构造时立即初始化并启动自动播放。

## 配置

```ts
type SuperCarouselOptions = {
    mode: 'slide' | 'marquee';
    containerSelector: string;
    itemSelector: string;
    speed?: number;
    autoplayInterval?: number;
    pauseOnHover?: boolean;
    paginationSelector?: string;
};
```

| 选项 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `mode` | `'slide' \| 'marquee'` | 必填 | 模式 |
| `containerSelector` | `string` | 必填 | 容器选择器 |
| `itemSelector` | `string` | 必填 | 子项选择器 |
| `speed` | `number` | `300` | slide：过渡毫秒数；marquee：px/s |
| `autoplayInterval` | `number` | `3000` | 自动播放间隔 |
| `pauseOnHover` | `boolean` | `true` | 悬停暂停 |
| `paginationSelector` | `string` | 无 | 分页容器（仅 slide） |

### 构造时可能抛错 / 警告

| 情况 | 行为 |
| --- | --- |
| 容器选择器找不到 | **throw** `Carousel container not found for selector: ...` |
| 子项数量为 0 | **console.warn**，不运行 |
| `mode` 非法 | **throw** `Invalid mode specified: ...` |

## 实例方法

| 方法 | 说明 | 适用模式 |
| --- | --- | --- |
| `start()` | 启动自动播放 / 滚动 | 两者 |
| `stop()` | 停止自动播放 / 滚动 | 两者 |
| `nextSlide()` | 下一张 | slide |
| `prevSlide()` | 上一张 | slide |
| `goToSlide(index, useTransition?)` | 跳到指定原始索引 | slide |
| `startAutoplay()` / `stopAutoplay()` | 自动播放控制 | slide |
| `startMarquee()` / `stopMarquee()` | 跑马灯控制 | marquee |
| `destroy()` | 销毁实例并清理 DOM | 两者 |

> `nextSlide` / `prevSlide` / `goToSlide` 在 marquee 模式下直接返回，不报错。

## slide 模式原理

### 1. 首尾克隆实现无缝循环

```text
原始：[1, 2, 3]
克隆后：[3', 1, 2, 3, 1']
         ↑           ↑
       前置克隆     后置克隆
```

- `originalItemCount` = 3（真实数量）；
- `currentIndex` 始终是真实索引（0..2）；
- DOM 索引 = `currentIndex + 1`。

### 2. 过渡结束后的瞬移

```ts
goToSlide(index, useTransition = true) {
    const targetDomIndex = index + 1;
    const offset = -targetDomIndex * itemWidth;

    container.style.transition = useTransition ? `transform ${speed}ms ease-in-out` : 'none';
    container.style.transform = `translateX(${offset}px)`;

    if (useTransition) {
        handleTransitionEnd → {
            currentIndex = index;
            updatePagination();
            isAnimating = false;
            if (index === -1) jumpTo(originalItemCount - 1);      // 从后置克隆跳回真实第一张
            if (index === originalItemCount) jumpTo(0);           // 从前置克隆跳回真实最后一张
        }
    } else {
        currentIndex = index;
        updatePagination();
        isAnimating = false;
    }
}
```

`jumpTo` 会临时关闭 transition 再瞬间定位，用户看不到跳变。

### 3. 动画锁

```ts
if (this.isAnimating && useTransition) return;
```

过渡期间忽略新的切换，避免快速点击导致位置错乱。

### 4. 切换方向

```ts
nextSlide() {
    const newIndex = currentIndex + 1;
    if (newIndex > originalItemCount - 1) newIndex = originalItemCount; // 前往后置克隆
    goToSlide(newIndex);
}

prevSlide() {
    const newIndex = currentIndex - 1;
    if (newIndex < 0) newIndex = -1; // 前往前置克隆
    goToSlide(newIndex);
}
```

### 5. 宽度计算

```ts
itemWidth = container.parentElement.getBoundingClientRect().width;
```

因此 **slide 模式要求容器有一个有宽度的父元素**。容器本身 `display: none` 时宽度为 0。

### 6. 分页点

```ts
paginationContainer.innerHTML = '';
for (let i = 0; i < originalItemCount; i++) {
    const dot = document.createElement('span');
    dot.className = 'slide-dot';
    dot.dataset.index = String(i);
    dot.addEventListener('click', () => {
        stopAutoplay();
        goToSlide(i);
        startAutoplay();
    });
}
```

- 类的固定为 `slide-dot`；
- 当前项会附加 `active` 类；
- 点击会重置自动播放计时。

## marquee 模式原理

```ts
private marqueeAnimate(timestamp: number) {
    const elapsed = timestamp - this.lastTimestamp;
    const speedPerMs = this.options.speed / 1000;

    this.currentOffset += speedPerMs * elapsed;

    const originalContentWidth = this.itemWidth * this.originalItemCount;
    if (this.currentOffset >= originalContentWidth) {
        this.currentOffset = this.currentOffset % originalContentWidth;
    }

    this.container.style.transform = `translateX(-${this.currentOffset}px)`;
    this.lastTimestamp = timestamp;
    this.animationFrameId = requestAnimationFrame(this.marqueeAnimateBound);
}
```

要点：

- 所有原始项会被克隆一份追加到末尾（`A B C → A B C A B C`）；
- 位移超过「一份内容宽度」后取模归零，形成无缝循环；
- `lastTimestamp` 在启动时重置为 0，避免暂停很久后出现巨大跳跃；
- 使用 `requestAnimationFrame` 而不是 CSS 动画，便于动态启停。

### 必需样式

组件会自动设置：

```ts
container.style.overflow = 'hidden';
container.style.whiteSpace = 'nowrap';
container.style.display = 'block';
```

子项会被设为 `display: inline-block`。

## 响应式

```ts
window.addEventListener('resize', this.boundHandleResize);
```

resize 时：

1. 记录当前是否在运行；
2. `stop()`；
3. 重新计算宽度；
4. slide 模式无过渡跳到当前位置；
5. 如果之前在运行则 `start()`。

## 悬停暂停

```ts
container.addEventListener('mouseenter', this.boundStop);
container.addEventListener('mouseleave', this.boundStart);
```

回调使用预绑定引用，保证 `destroy()` 能正确移除。

## 销毁

```ts
carousel.destroy();
```

清理内容：

- 停止自动播放 / 跑马灯；
- 移除 `resize` 与悬停监听；
- 移除 `data-cloned="true"` 的克隆节点；
- 重置容器与子项的行内样式；
- 清空分页容器。

## 完整示例

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

document.querySelector('.banner__next')!
    .addEventListener('click', () => carousel.nextSlide());

document.querySelector('.banner__prev')!
    .addEventListener('click', () => carousel.prevSlide());

// 路由切换
onBeforeUnmount(() => carousel.destroy());
```

## 样式建议

```css
.banner {
    overflow: hidden;
}
.banner__item {
    /* 宽度由组件计算，不要写死 100% */
    box-sizing: border-box;
}
.slide-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin: 0 4px;
    border-radius: 50%;
    background: #ddd;
    cursor: pointer;
}
.slide-dot.active {
    background: #42b983;
}
```

## 注意事项

| 问题 | 说明 |
| --- | --- |
| 容器隐藏 | 宽度为 0，需在显示后重建或触发 resize |
| 最少项数 | 建议 ≥ 2 |
| 图片未加载 | 尺寸未知会影响布局，给容器固定宽高 |
| 与 CSS 冲突 | 组件会覆盖 `transform`、`transition`、`width` 等行内样式 |
| 多实例 | 每个实例独立，注意分别 `destroy()` |
| 无障碍 | 未处理 `aria-*`，需要业务补充 |
| 自动播放 | 浏览器省电模式可能暂停定时器 |

## 测试覆盖

`packages/tools/tests/carousel.test.ts`（40 个用例）：

- 两种模式的初始化；
- 自动播放启停；
- 分页点生成与 `active` 更新；
- `goToSlide` / `nextSlide` / `prevSlide` 与边界回绕；
- resize 重新计算；
- 悬停暂停；
- 销毁清理；
- 非法选择器 / 未知模式的错误行为。
