// VirtualScroller.ts - 优化版 (包含 DOM 元素重用)

interface Item {
    id: string | number;
    height: number;
    offsetTop: number;
    data: any;
}

interface Options {
    containerSelector: string | HTMLElement;
    estimatedItemHeight: number;
    bufferSize: number;
    loadMoreCallback: (count: number) => Promise<any[]>;
    // 增加一个可选的渲染回调，用于自定义列表项的渲染内容
    renderItemContent?: (data: any) => string | HTMLElement;
}

export class VirtualScroller {
    private options: Options;
    private container!: HTMLElement;
    private listElement!: HTMLElement;
    private domPool: Map<string | number, HTMLElement> = new Map(); // DOM 元素重用池

    private allItems: Item[] = [];
    private totalHeight = 0;
    private viewportHeight = 0;
    private startIndex = 0;
    private endIndex = 0;
    private maxItemsPerView = 0;

    private itemsToLoadCount = 20;
    private isLoading = false;

    constructor(options: Options) {
        this.options = options;
        this.setupElements(options.containerSelector);
        this.setupInitialState();
    }

    /**
     * 1. 元素初始化和设置
     */
    private setupElements(containerSelector: string | HTMLElement) {
        const container =
            typeof containerSelector === 'string'
                ? document.querySelector(containerSelector)
                : containerSelector;

        if (!container) {
            throw new Error('VirtualScroller: Container element not found.');
        }
        this.container = container as HTMLElement;
        this.container.style.overflowY = 'scroll';
        this.container.style.position = 'relative';

        this.listElement = document.createElement('div');
        this.listElement.style.position = 'relative';
        this.listElement.style.width = '100%';
        this.container.appendChild(this.listElement);

        this.container.addEventListener('scroll', this.handleScroll.bind(this));
        window.addEventListener('resize', this.onResize.bind(this));
    }

    /**
     * 2. 状态初始化
     */
    private setupInitialState() {
        this.viewportHeight = this.container.clientHeight;
        this.maxItemsPerView =
            Math.ceil(this.viewportHeight / this.options.estimatedItemHeight) +
            2 * this.options.bufferSize;

        this.loadMore();
    }

    /**
     * 3. 数据处理 (不定高核心)
     */
    private calculatePositions(newItems: any[]): void {
        const estimatedHeight = this.options.estimatedItemHeight;
        const initialIndex = this.allItems.length;

        newItems.forEach((data, index) => {
            const itemIndex = initialIndex + index;
            const prevItem = this.allItems[itemIndex - 1];

            // 使用 data.id 作为唯一 ID，如果业务数据没有提供，则使用生成的
            const id = data.id !== undefined ? data.id : `item-${itemIndex}`;

            this.allItems.push({
                id: id,
                height: estimatedHeight,
                offsetTop: prevItem ? prevItem.offsetTop + prevItem.height : 0,
                data: data,
            });
        });

        const lastItem = this.allItems[this.allItems.length - 1];
        this.totalHeight = lastItem ? lastItem.offsetTop + lastItem.height : 0;

        this.listElement.style.height = `${this.totalHeight}px`;

        this.updateVisibleRange();
    }

    /**
     * 4. 滚动事件处理
     */
    private handleScroll(): void {
        const scrollTop = this.container.scrollTop;
        this.updateVisibleRange(scrollTop);
        this.checkLoadMore(scrollTop);
    }

    /**
     * 5. 查找起始索引 (二分查找)
     * 查找最后一个 offsetTop 小于或等于 scrollTop 的元素。
     */
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

        // 返回找到的索引，updateVisibleRange 会应用 bufferSize
        return resultIndex;
    }

    /**
     * 6. 更新可视区域范围
     */
    private updateVisibleRange(scrollTop: number = this.container.scrollTop): void {
        if (this.allItems.length === 0) return;

        // 1. 计算起始索引 (二分查找)
        let newStartIndex = this.findStartIndex(scrollTop);

        // 2. 应用 bufferSize (向上滚动时预渲染 buffer)
        newStartIndex = Math.max(0, newStartIndex - this.options.bufferSize);

        // 3. 计算结束索引
        let newEndIndex = newStartIndex + this.maxItemsPerView;
        newEndIndex = Math.min(this.allItems.length - 1, newEndIndex);

        if (newStartIndex !== this.startIndex || newEndIndex !== this.endIndex) {
            this.startIndex = newStartIndex;
            this.endIndex = newEndIndex;
            this.renderList();
        }
    }

    /**
     * 7. 渲染当前可视区域的列表项 (使用 DOM 重用)
     */
    private renderList(): void {
        const visibleItems = this.allItems.slice(this.startIndex, this.endIndex + 1);
        const fragment = document.createDocumentFragment();
        const currentRenderedIds = new Set<string | number>();

        // 1. 渲染/重用新进入可视区的元素
        visibleItems.forEach((item) => {
            currentRenderedIds.add(item.id);

            let itemEl: HTMLElement;
            if (this.domPool.has(item.id)) {
                // 重用已存在的元素 (只是位置变了)
                itemEl = this.domPool.get(item.id)!;
            } else {
                // 创建新元素
                itemEl = this.createItemElement(item);
                this.domPool.set(item.id, itemEl);
            }

            // 更新元素的位置和内容
            this.updateItemElement(itemEl, item);
            fragment.appendChild(itemEl);
        });

        // 2. DOM 回收：移除离开可视区的旧元素
        const children = Array.from(this.listElement.children) as HTMLElement[];
        children.forEach((el) => {
            const itemId = el.getAttribute('data-id');
            // 如果这个元素ID不在当前可视区范围内，则移除
            if (itemId && !currentRenderedIds.has(itemId)) {
                this.listElement.removeChild(el);
                // 注意：这里我们保留在 domPool 中，以便在回到可视区时立即重用
            }
        });

        // 3. 批量插入新元素
        this.listElement.appendChild(fragment);

        // 4. 异步测量真实高度
        requestAnimationFrame(() => this.measureItemHeights());
    }

    /**
     * 辅助方法：创建列表项元素
     */
    private createItemElement(item: Item): HTMLElement {
        const itemEl = document.createElement('div');
        itemEl.setAttribute('data-id', String(item.id));
        itemEl.style.position = 'absolute';
        itemEl.style.width = '100%';
        // 其他样式可以在这里设置

        // 首次设置内容
        const content = this.options.renderItemContent
            ? this.options.renderItemContent(item.data)
            : `Item ${item.id} - Content: ${JSON.stringify(item.data)}`;

        if (typeof content === 'string') {
            itemEl.innerHTML = content;
        } else {
            itemEl.appendChild(content);
        }

        return itemEl;
    }

    /**
     * 辅助方法：更新列表项元素
     */
    private updateItemElement(el: HTMLElement, item: Item): void {
        // 关键: 定位和高度占位
        el.style.transform = `translateY(${item.offsetTop}px)`;
        el.style.height = `${item.height}px`;

        // 如果需要，可以在这里更新内容，但为了性能，通常只在创建时设置内容。
        // 如果数据更新频繁，需要在这里调用内容更新逻辑。
    }

    /**
     * 8. 测量真实高度并修正偏移量 (不定高关键)
     */
    private measureItemHeights(): void {
        let hasHeightChanged = false;
        let firstChangedIndex = -1;
        const renderedElements = Array.from(this.listElement.children) as HTMLElement[];

        // 1. 测量和标记高度变化
        renderedElements.forEach((el) => {
            const itemId = el.getAttribute('data-id');
            const itemIndex = this.allItems.findIndex((i) => String(i.id) === itemId);
            const item = this.allItems[itemIndex];

            if (item) {
                const actualHeight = el.offsetHeight;

                if (actualHeight !== item.height) {
                    item.height = actualHeight;
                    hasHeightChanged = true;
                    if (firstChangedIndex === -1 || itemIndex < firstChangedIndex) {
                        firstChangedIndex = itemIndex; // 记录第一个变化元素的索引
                    }
                }
            }
        });

        // 2. 修正偏移量和总高度
        if (hasHeightChanged) {
            // 从第一个变化元素的索引开始修正
            const startIndex = Math.max(0, firstChangedIndex);
            let currentOffset =
                startIndex > 0
                    ? this.allItems[startIndex - 1].offsetTop + this.allItems[startIndex - 1].height
                    : 0;

            for (let i = startIndex; i < this.allItems.length; i++) {
                const item = this.allItems[i];

                // 只修正偏移量不等于当前累加值，或该元素在当前渲染列表中的元素
                if (item.offsetTop !== currentOffset) {
                    item.offsetTop = currentOffset;

                    // 如果该元素在当前渲染列表中，则更新 DOM
                    const el = this.domPool.get(item.id);
                    if (el && this.listElement.contains(el)) {
                        el.style.transform = `translateY(${item.offsetTop}px)`;
                    }
                }
                currentOffset += item.height;
            }

            // 重新计算总高度
            this.totalHeight = currentOffset;
            this.listElement.style.height = `${this.totalHeight}px`;

            // 重新校验当前可视范围
            this.updateVisibleRange();
        }
    }

    /**
     * 9. 滚动到底部加载更多
     */
    private checkLoadMore(scrollTop: number): void {
        const distanceToBottom = this.totalHeight - (scrollTop + this.viewportHeight);

        if (distanceToBottom < 200 && !this.isLoading) {
            this.loadMore();
        }
    }

    /**
     * 10. 暴露的公共方法：加载数据
     */
    public async loadMore(): Promise<void> {
        if (this.isLoading) return;

        this.isLoading = true;

        try {
            const newItems = await this.options.loadMoreCallback(this.itemsToLoadCount);

            if (newItems && newItems.length > 0) {
                this.calculatePositions(newItems);
            } else if (this.allItems.length === 0) {
                console.log('No initial data to display.');
            }
        } catch (error) {
            console.error('Error loading data:', error);
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * 11. 处理窗口尺寸变化
     */
    private onResize(): void {
        const newViewportHeight = this.container.clientHeight;
        if (newViewportHeight !== this.viewportHeight) {
            this.viewportHeight = newViewportHeight;
            this.maxItemsPerView =
                Math.ceil(this.viewportHeight / this.options.estimatedItemHeight) +
                2 * this.options.bufferSize;
            this.updateVisibleRange();
        }
    }

    /**
     * 12. 清空列表数据
     */
    public clear(): void {
        this.allItems = [];
        this.totalHeight = 0;
        this.listElement.innerHTML = ''; // 清空 DOM
        this.domPool.clear(); // 清空重用池
        this.listElement.style.height = '0px';
        this.container.scrollTop = 0;
        this.startIndex = 0;
        this.endIndex = 0;
    }
}

export default VirtualScroller;
