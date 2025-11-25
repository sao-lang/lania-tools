// VirtualScroller.ts

interface Item {
    // 每个数据项必须有一个唯一的 ID
    id: string | number;
    // 存储该项的真实高度 (初始为预估高度)
    height: number;
    // 存储该项在整个列表中的起始偏移量 (累加的高度)
    offsetTop: number;
    // 存储其他业务数据
    data: any;
}

interface Options {
    // 容器元素或其选择器
    containerSelector: string | HTMLElement;
    // 列表项的预估高度
    estimatedItemHeight: number;
    // 可视区域内**额外**渲染的元素数量 (提升用户体验)
    bufferSize: number;
    // 滚到底部时加载更多数据的回调函数
    loadMoreCallback: (count: number) => Promise<any[]>;
}

export class VirtualScroller {
    private options: Options;
    private container!: HTMLElement;
    private listElement!: HTMLElement; // 用于承载列表项的内部元素

    private allItems: Item[] = []; // 包含所有数据的数组 (带高度和偏移量信息)
    private totalHeight = 0; // 整个列表的总高度
    private viewportHeight = 0; // 容器的可见高度
    private startIndex = 0; // 当前可视区域的起始索引
    private endIndex = 0; // 当前可视区域的结束索引
    private maxItemsPerView = 0; // 可视区域最大渲染数量 (可视+缓存)

    // 待加载数据数量，用于传递给 loadMoreCallback
    private itemsToLoadCount = 20;
    private isLoading = false; // 是否正在加载数据

    constructor(options: Options) {
        this.options = options;
        this.setupElements(options.containerSelector);
        this.setupInitialState();
    }

    /**
     * 1. 元素初始化和设置
     */
    private setupElements(containerSelector: string | HTMLElement) {
        // 确保容器存在
        const container =
            typeof containerSelector === 'string'
                ? document.querySelector(containerSelector)
                : containerSelector;

        if (!container) {
            throw new Error('VirtualScroller: Container element not found.');
        }
        this.container = container as HTMLElement;
        this.container.style.overflowY = 'scroll'; // 容器启用原生滚动条
        this.container.style.position = 'relative'; // 为绝对定位的列表项准备

        // 列表容器 (承载所有列表项的元素)
        this.listElement = document.createElement('div');
        this.listElement.style.position = 'relative';
        this.listElement.style.width = '100%';
        this.container.appendChild(this.listElement);

        // 滚动事件监听
        this.container.addEventListener('scroll', this.handleScroll.bind(this));

        // 窗口尺寸变化监听 (处理不定高时容器高度变化)
        window.addEventListener('resize', this.onResize.bind(this));
    }

    /**
     * 2. 状态初始化
     */
    private setupInitialState() {
        this.viewportHeight = this.container.clientHeight;
        // 可视区域元素数量 = 向上取整(可视高度 / 预估高度) + 2 * 缓存区
        this.maxItemsPerView =
            Math.ceil(this.viewportHeight / this.options.estimatedItemHeight) +
            2 * this.options.bufferSize;

        // 首次加载数据
        this.loadMore();
    }

    /**
     * 3. 数据处理 (不定高核心)
     * 采用预估高度和累加偏移量
     */
    private calculatePositions(newItems: any[]): void {
        const estimatedHeight = this.options.estimatedItemHeight;
        const initialIndex = this.allItems.length;

        // 遍历新数据，计算 offsetTop 和初始化 height
        newItems.forEach((data, index) => {
            const itemIndex = initialIndex + index;
            const prevItem = this.allItems[itemIndex - 1];

            this.allItems.push({
                id: data.id || `item-${itemIndex}`,
                height: estimatedHeight, // 初始使用预估高度
                offsetTop: prevItem ? prevItem.offsetTop + prevItem.height : 0,
                data: data,
            });
        });

        // 计算总高度
        const lastItem = this.allItems[this.allItems.length - 1];
        this.totalHeight = lastItem ? lastItem.offsetTop + lastItem.height : 0;

        // 更新列表容器的高度，形成滚动条 (此处使用 listElement 模拟内容高度)
        this.listElement.style.height = `${this.totalHeight}px`;

        // 初始渲染
        this.updateVisibleRange();
    }

    /**
     * 4. 滚动事件处理
     */
    private handleScroll(): void {
        // 获取当前滚动位置
        const scrollTop = this.container.scrollTop;

        // 核心: 更新可视区域范围
        this.updateVisibleRange(scrollTop);

        // 触发加载更多
        this.checkLoadMore(scrollTop);
    }

    /**
     * 5. 查找起始索引 (性能优化: 二分查找)
     * 查找第一个 `offsetTop` 大于或等于 `scrollTop` 的元素。
     */
    private findStartIndex(scrollTop: number): number {
        let low = 0;
        let high = this.allItems.length - 1;
        let result = 0;

        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            if (this.allItems[mid].offsetTop <= scrollTop) {
                low = mid + 1;
                result = mid; // 暂存一个可能的起始索引
            } else {
                high = mid - 1;
            }
        }

        // 考虑到用户可能滚动到上一个元素的顶部，我们返回 result，然后应用 bufferSize
        return result;
    }

    /**
     * 6. 更新可视区域范围 (核心渲染逻辑)
     */
    private updateVisibleRange(scrollTop: number = this.container.scrollTop): void {
        if (this.allItems.length === 0) return;

        // 1. 计算起始索引 (二分查找性能更优)
        let newStartIndex = this.findStartIndex(scrollTop);

        // 2. 应用 bufferSize
        newStartIndex = Math.max(0, newStartIndex - this.options.bufferSize);

        // 3. 计算结束索引
        let newEndIndex = newStartIndex + this.maxItemsPerView;
        newEndIndex = Math.min(this.allItems.length - 1, newEndIndex);

        // 只有范围发生变化时才更新
        if (newStartIndex !== this.startIndex || newEndIndex !== this.endIndex) {
            this.startIndex = newStartIndex;
            this.endIndex = newEndIndex;
            this.renderList();
        }
    }

    /**
     * 7. 渲染当前可视区域的列表项
     */
    private renderList(): void {
        const fragment = document.createDocumentFragment();
        const visibleItems = this.allItems.slice(this.startIndex, this.endIndex + 1);

        // 清空现有元素
        this.listElement.innerHTML = '';

        visibleItems.forEach((item) => {
            // 创建列表项元素 (在实际项目中，这里通常是组件或模板)
            const itemEl = document.createElement('div');
            itemEl.setAttribute('data-id', String(item.id));
            itemEl.style.position = 'absolute';
            itemEl.style.width = '100%';
            // 关键: 定位和初始高度
            itemEl.style.transform = `translateY(${item.offsetTop}px)`;
            itemEl.style.height = `${item.height}px`; // 保持初始高度，等待测量

            // 示例内容 (请根据实际业务修改)
            itemEl.innerHTML = `Item ${item.id} - Content: ${JSON.stringify(item.data)} <br> (Offset: ${item.offsetTop})`;

            fragment.appendChild(itemEl);
        });

        this.listElement.appendChild(fragment);

        // 异步测量真实高度 (实现不定高)
        requestAnimationFrame(() => this.measureItemHeights());
    }

    /**
     * 8. 测量真实高度并修正偏移量 (不定高关键)
     */
    private measureItemHeights(): void {
        let hasHeightChanged = false;
        const renderedElements = Array.from(this.listElement.children) as HTMLElement[];

        renderedElements.forEach((el) => {
            const itemId = el.getAttribute('data-id');
            const item = this.allItems.find((i) => String(i.id) === itemId);

            if (item) {
                // 获取元素的实际渲染高度
                const actualHeight = el.offsetHeight;

                // 如果实际高度与当前存储的高度不同，则需要修正
                if (actualHeight !== item.height) {
                    item.height = actualHeight;
                    hasHeightChanged = true;
                }
            }
        });

        // 如果有元素高度发生变化，则需要重新计算后续元素的偏移量
        if (hasHeightChanged) {
            let currentOffset = 0;
            this.allItems.forEach((item) => {
                // 修正当前元素的偏移量
                if (item.offsetTop !== currentOffset) {
                    item.offsetTop = currentOffset;
                    // 重新定位DOM元素
                    const el = this.listElement.querySelector(
                        `[data-id="${item.id}"]`,
                    ) as HTMLElement;
                    if (el) {
                        el.style.transform = `translateY(${item.offsetTop}px)`;
                    }
                }
                // 累加高度
                currentOffset += item.height;
            });

            // 重新计算总高度
            this.totalHeight = currentOffset;
            this.listElement.style.height = `${this.totalHeight}px`;

            // 由于高度和偏移量变化，需要重新校验当前可视范围 (防止跳动)
            this.updateVisibleRange();
        }
    }

    /**
     * 9. 滚动到底部加载更多
     */
    private checkLoadMore(scrollTop: number): void {
        // 滚动条离底部的距离
        const distanceToBottom = this.totalHeight - (scrollTop + this.viewportHeight);

        // 距离底部小于 200px 并且当前没有加载，则触发加载
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
        console.log('Loading more data...');

        try {
            const newItems = await this.options.loadMoreCallback(this.itemsToLoadCount);

            if (newItems && newItems.length > 0) {
                // 1. 处理新数据，计算预估偏移量
                this.calculatePositions(newItems);
            } else if (this.allItems.length === 0) {
                // 第一次加载就没数据
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
            this.updateVisibleRange(); // 重新计算范围
        }
    }

    /**
     * 12. 清空列表数据 (可选)
     */
    public clear(): void {
        this.allItems = [];
        this.totalHeight = 0;
        this.listElement.innerHTML = '';
        this.listElement.style.height = '0px';
        this.container.scrollTop = 0;
        this.startIndex = 0;
        this.endIndex = 0;
    }
}

export default VirtualScroller;
