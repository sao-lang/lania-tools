type CarouselMode = 'slide' | 'marquee';

type SuperCarouselOptions = {
    /** 轮播模式：'slide' (分段) 或 'marquee' (连续跑马灯) */
    mode: CarouselMode;
    /** 容器的选择器 (CSS Selector) - 包含所有轮播项的父元素 */
    containerSelector: string;
    /** 每个项目/slide 的选择器 (CSS Selector) */
    itemSelector: string;

    // --- 通用配置 ---
    /** 动画速度/持续时间。在 slide 模式下是 CSS 过渡时间(ms)。
     * 在 marquee 模式下是滚动速度 (px/s, 像素/秒) */
    speed?: number;
    /** 自动播放间隔 (毫秒) */
    autoplayInterval?: number;
    /** 鼠标悬停时是否暂停自动播放 */
    pauseOnHover?: boolean;

    // --- Slide 模式专属配置 ---
    /** 分页点容器的选择器 (CSS Selector)，仅在 mode='slide' 时有效 */
    paginationSelector?: string;
};

export class Carousel {
    private container: HTMLElement;
    private items: NodeListOf<HTMLElement>;
    private originalItemCount: number;

    private options: SuperCarouselOptions &
        Required<Pick<SuperCarouselOptions, 'speed' | 'autoplayInterval' | 'pauseOnHover'>>;

    // --- 状态与内部变量 ---
    private isAnimating: boolean = false; // 用于 Slide 模式
    private currentIndex: number = 0; // 当前显示的原始项目索引 (0 到 N-1) - 仅 Slide 模式
    private itemWidth: number = 0;

    private autoPlayTimer: number | null = null;
    private paginationContainer: HTMLElement | null = null;
    private paginationDots: HTMLElement[] = [];

    // Marquee 模式变量
    private animationFrameId: number | null = null;
    private lastTimestamp: number = 0;
    private currentOffset: number = 0; // 当前滚动偏移量 (像素)

    // --- 预绑定方法引用，用于事件监听器的性能优化 ---
    private boundHandleResize: () => void;
    private boundStart: () => void;
    private boundStop: () => void;
    private marqueeAnimateBound: (timestamp: number) => void;

    // 默认配置
    private static defaultOptions = {
        speed: 300, // slide 默认 300ms 过渡，marquee 默认 300px/s 速度
        autoplayInterval: 3000,
        pauseOnHover: true,
    };

    constructor(options: SuperCarouselOptions) {
        // 1. 合并配置
        this.options = { ...Carousel.defaultOptions, ...options } as any;

        // 2. 预绑定方法
        this.boundHandleResize = this.handleResize.bind(this);
        this.boundStart = this.start.bind(this);
        this.boundStop = this.stop.bind(this);
        this.marqueeAnimateBound = this.marqueeAnimate.bind(this);

        // 3. 获取 DOM 元素
        const container = document.querySelector(this.options.containerSelector);
        if (!container) {
            throw new Error(
                `Carousel container not found for selector: ${this.options.containerSelector}`,
            );
        }
        this.container = container as HTMLElement;
        this.items = this.container.querySelectorAll<HTMLElement>(this.options.itemSelector);
        this.originalItemCount = this.items.length;

        if (this.originalItemCount === 0) {
            console.warn(
                `No items found for selector: ${this.options.itemSelector}. Carousel will not run.`,
            );
            return;
        }

        // 4. 根据模式初始化
        if (this.options.mode === 'slide') {
            this.initSlideMode();
        } else if (this.options.mode === 'marquee') {
            this.initMarqueeMode();
        } else {
            throw new Error(
                `Invalid mode specified: ${this.options.mode}. Must be 'slide' or 'marquee'.`,
            );
        }

        // 5. 设置通用事件监听
        this.setupEventListeners();

        // 6. 启动自动播放/滚动
        this.start();
    }

    // --- 模式初始化函数 ---

    private initSlideMode(): void {
        // 1. 获取分页容器
        if (this.options.paginationSelector) {
            this.paginationContainer = document.querySelector(this.options.paginationSelector);
        }

        // 2. 克隆头尾项目实现无限循环 (A B C -> C A B C A)
        const lastItem = this.items[this.originalItemCount - 1].cloneNode(true) as HTMLElement;
        const firstItem = this.items[0].cloneNode(true) as HTMLElement;
        lastItem.setAttribute('data-cloned', 'true');
        firstItem.setAttribute('data-cloned', 'true');
        this.container.prepend(lastItem);
        this.container.appendChild(firstItem);

        // 重新获取包含克隆体的所有项目
        this.items = this.container.querySelectorAll<HTMLElement>(this.options.itemSelector);

        // 3. 设置 CSS 属性 (Flexbox 布局)
        this.container.style.display = 'flex';
        this.container.style.width = this.items.length * 100 + '%';
        this.container.style.transition = `transform ${this.options.speed}ms ease-in-out`;

        this.items.forEach((item) => {
            item.style.flexShrink = '0';
            item.style.width = 100 / this.items.length + '%';
        });

        // 4. 初始定位
        this.calculateItemWidth();
        this.goToSlide(0, false);

        // 5. 创建分页点
        if (this.paginationContainer) {
            this.createPagination();
        }
    }

    private initMarqueeMode(): void {
        // 1. 必须设置容器样式以确保项目水平排列和溢出隐藏
        this.container.style.overflow = 'hidden';
        this.container.style.whiteSpace = 'nowrap';
        this.container.style.display = 'block';

        // 2. 克隆足够多的项目实现“无限”循环 (A B C -> A B C A B C)
        // 克隆所有原始项目
        for (let i = 0; i < this.originalItemCount; i++) {
            const originalItem = this.items[i];
            const clone = originalItem.cloneNode(true) as HTMLElement;
            clone.setAttribute('data-cloned', 'true');
            this.container.appendChild(clone);
        }

        // 重新获取包含克隆体的所有项目
        this.items = this.container.querySelectorAll<HTMLElement>(this.options.itemSelector);

        // 3. 设置项目样式，使其水平排列
        this.items.forEach((item) => {
            item.style.display = 'inline-block';
            item.style.boxSizing = 'border-box';
        });

        // 4. 计算项目宽度 (用于滚动距离)
        this.calculateItemWidth();
        // 设置初始状态
        this.container.style.transform = `translateX(-${this.currentOffset}px)`;
        this.container.style.transition = 'none';
    }

    // --- 通用/辅助函数 ---

    /** 统一的宽度计算逻辑 */
    private calculateItemWidth(): void {
        const wrapper = this.container.parentElement;
        if (this.options.mode === 'slide' && wrapper) {
            // 在 Slide 模式下，itemWidth 是视口宽度
            this.itemWidth = wrapper.getBoundingClientRect().width;
        } else if (this.options.mode === 'marquee' && this.originalItemCount > 0) {
            // 在 Marquee 模式下，itemWidth 是单个项目的实际宽度
            this.itemWidth = this.items[0].getBoundingClientRect().width;
        }
    }

    /** 销毁实例，清理事件监听器和 DOM 结构 */
    public destroy(): void {
        this.stop();

        // 移除预绑定事件监听
        window.removeEventListener('resize', this.boundHandleResize);
        if (this.options.pauseOnHover) {
            this.container.removeEventListener('mouseenter', this.boundStop);
            this.container.removeEventListener('mouseleave', this.boundStart);
        }

        // 移除克隆节点
        this.items.forEach((item) => {
            if (item.getAttribute('data-cloned') === 'true') {
                item.remove();
            }
        });

        // 清理行内样式
        this.container.style.overflow = '';
        this.container.style.whiteSpace = '';
        this.container.style.display = '';
        this.container.style.transform = '';
        this.container.style.transition = '';
        this.container.style.width = '';
        this.items.forEach((item) => {
            item.style.flexShrink = '';
            item.style.width = '';
            item.style.display = '';
            item.style.boxSizing = '';
        });

        // 清理分页点
        if (this.paginationContainer) {
            this.paginationContainer.innerHTML = '';
        }
    }

    // --- 事件和控制 ---

    private setupEventListeners(): void {
        // 鼠标悬停暂停/启动
        if (this.options.pauseOnHover) {
            this.container.addEventListener('mouseenter', this.boundStop);
            this.container.addEventListener('mouseleave', this.boundStart);
        }
        // 响应式处理
        window.addEventListener('resize', this.boundHandleResize);
    }

    private handleResize(): void {
        // 暂停当前的自动播放/滚动
        const wasRunning = this.autoPlayTimer !== null || this.animationFrameId !== null;
        this.stop();

        // 重新计算宽度
        this.calculateItemWidth();

        // 根据模式重置位置
        if (this.options.mode === 'slide') {
            // Slide 模式需要无过渡地跳到当前位置以修正偏移
            this.jumpTo(this.currentIndex);
        }

        // 如果之前在运行，则重新启动
        if (wasRunning) {
            this.start();
        }
    }

    /** 统一的启动方法 */
    public start(): void {
        if (this.options.mode === 'slide') {
            this.startAutoplay();
        } else if (this.options.mode === 'marquee') {
            this.startMarquee();
        }
    }

    /** 统一的停止方法 */
    public stop(): void {
        if (this.options.mode === 'slide') {
            this.stopAutoplay();
        } else if (this.options.mode === 'marquee') {
            this.stopMarquee();
        }
    }

    // --- Marquee 模式方法 ---

    private marqueeAnimate(timestamp: number): void {
        if (!this.lastTimestamp) {
            this.lastTimestamp = timestamp;
        }

        const elapsed = timestamp - this.lastTimestamp;
        // options.speed 视为 px/s (像素/秒)
        const speedPerMs = this.options.speed / 1000;

        // 1. 计算新的偏移量
        this.currentOffset += speedPerMs * elapsed;

        // 2. 处理“无限”循环
        const originalContentWidth = this.itemWidth * this.originalItemCount;

        if (this.currentOffset >= originalContentWidth) {
            // 重置到起点 (克隆内容开始的位置)
            this.currentOffset = this.currentOffset % originalContentWidth;
        }

        // 3. 应用 CSS 变换
        this.container.style.transform = `translateX(-${this.currentOffset}px)`;

        this.lastTimestamp = timestamp;
        this.animationFrameId = requestAnimationFrame(this.marqueeAnimateBound);
    }

    public startMarquee(): void {
        if (this.animationFrameId === null) {
            // 重置 lastTimestamp 以避免在长时间暂停后发生巨大跳跃
            this.lastTimestamp = 0;
            this.animationFrameId = requestAnimationFrame(this.marqueeAnimateBound);
        }
    }

    public stopMarquee(): void {
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    // --- Slide 模式方法 ---

    /** 创建分页点 */
    private createPagination(): void {
        if (!this.paginationContainer) return;

        this.paginationContainer.innerHTML = '';
        this.paginationDots = [];

        for (let i = 0; i < this.originalItemCount; i++) {
            const dot = document.createElement('span');
            dot.className = 'slide-dot';
            dot.setAttribute('data-index', i.toString());
            dot.addEventListener('click', () => {
                this.stopAutoplay();
                this.goToSlide(i);
                this.startAutoplay();
            });
            this.paginationContainer.appendChild(dot);
            this.paginationDots.push(dot);
        }
        this.updatePagination();
    }

    /** 更新分页点状态 */
    private updatePagination(): void {
        this.paginationDots.forEach((dot, index) => {
            dot.classList.toggle('active', index === this.currentIndex);
        });
    }

    /** 移动到指定索引的 Slide */
    public goToSlide(index: number, useTransition: boolean = true): void {
        if (this.options.mode !== 'slide') return;
        if (this.isAnimating && useTransition) return;
        this.isAnimating = true;

        // 目标 DOM 索引：原始索引 + 1 (因为前面有一个克隆项)。
        const targetDomIndex = index + 1;
        // 偏移量
        const offset = -targetDomIndex * this.itemWidth;

        // 设置过渡
        this.container.style.transition = useTransition
            ? `transform ${this.options.speed}ms ease-in-out`
            : 'none';

        this.container.style.transform = `translateX(${offset}px)`;

        // 使用 transitionend 事件监听来取代 setTimeout，实现更健壮的无缝循环
        if (useTransition) {
            const handleTransitionEnd = () => {
                this.container.removeEventListener('transitionend', handleTransitionEnd);

                this.currentIndex = index;
                this.updatePagination();
                this.isAnimating = false;

                // 处理无限循环
                if (index === -1) {
                    // 移到了最前面 (最末尾的克隆项)，跳到最后一个原始项
                    this.jumpTo(this.originalItemCount - 1);
                } else if (index === this.originalItemCount) {
                    // 移到了最后面 (最开头的克隆项)，跳到第一个原始项
                    this.jumpTo(0);
                }
            };

            // 注意：因为 transitionend 可能会被多次触发，这里使用 once: true 或手动移除。
            // 采用手动移除，因为它在组件销毁时更易控制。
            this.container.addEventListener('transitionend', handleTransitionEnd);
        } else {
            // 无过渡模式 (初始化/jumpTo)
            this.currentIndex = index;
            this.updatePagination();
            this.isAnimating = false;
        }
    }

    /** 无过渡跳转（用于处理无限循环的边界和响应式）*/
    private jumpTo(index: number): void {
        this.currentIndex = index;
        const targetDomIndex = index + 1;
        const offset = -targetDomIndex * this.itemWidth;

        // 立即无过渡跳转
        this.container.style.transition = 'none';
        this.container.style.transform = `translateX(${offset}px)`;

        // 重新启用过渡，准备下一次滑动
        requestAnimationFrame(() => {
            this.container.style.transition = `transform ${this.options.speed}ms ease-in-out`;
        });

        this.updatePagination();
        this.isAnimating = false;
    }

    /** 导航到下一张 (Slide 模式专用) */
    public nextSlide(): void {
        if (this.options.mode !== 'slide' || this.isAnimating) return;

        let newIndex = this.currentIndex + 1;
        // 如果是最后一个原始项目，目标是第一个克隆项 (索引 N)
        if (newIndex > this.originalItemCount - 1) {
            newIndex = this.originalItemCount;
        }
        this.goToSlide(newIndex);
    }

    /** 导航到上一张 (Slide 模式专用) */
    public prevSlide(): void {
        if (this.options.mode !== 'slide' || this.isAnimating) return;

        let newIndex = this.currentIndex - 1;
        // 如果是第一个原始项目，目标是最后一个克隆项 (索引 -1)
        if (newIndex < 0) {
            newIndex = -1;
        }
        this.goToSlide(newIndex);
    }

    public startAutoplay(): void {
        if (this.options.mode !== 'slide' || this.autoPlayTimer !== null) return;

        this.autoPlayTimer = window.setInterval(() => {
            if (!this.isAnimating) {
                this.nextSlide();
            }
        }, this.options.autoplayInterval);
    }

    public stopAutoplay(): void {
        if (this.autoPlayTimer !== null) {
            clearInterval(this.autoPlayTimer);
            this.autoPlayTimer = null;
        }
    }
}

export default Carousel;
