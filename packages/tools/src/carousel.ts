type CarouselMode = 'slide' | 'marquee';

type SuperCarouselOptions = {
    /** 轮播模式：'slide' (分段) 或 'marquee' (连续跑马灯) */
    mode: CarouselMode;
    /** 容器的选择器 (CSS Selector) - 包含所有轮播项的父元素 */
    containerSelector: string;
    /** 每个项目/slide 的选择器 (CSS Selector) */
    itemSelector: string;

    // --- 通用配置 ---
    /** 动画速度/持续时间。在 slide 模式下是过渡时间(ms)，在 marquee 模式下是每帧移动的像素值 */
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

    // 默认配置
    private static defaultOptions = {
        speed: 300, // slide 默认 300ms 过渡，marquee 默认每帧 5px 移动
        autoplayInterval: 3000,
        pauseOnHover: true,
    };

    constructor(options: SuperCarouselOptions) {
        // 1. 合并配置
        this.options = { ...Carousel.defaultOptions, ...options } as any;

        // 2. 获取 DOM 元素
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

        // 3. 根据模式初始化
        if (this.options.mode === 'slide') {
            this.initSlideMode();
        } else if (this.options.mode === 'marquee') {
            this.initMarqueeMode();
        } else {
            throw new Error(
                `Invalid mode specified: ${this.options.mode}. Must be 'slide' or 'marquee'.`,
            );
        }

        // 4. 设置通用事件监听
        this.setupEventListeners();

        // 5. 启动自动播放/滚动
        if (this.options.mode === 'slide') {
            this.startAutoplay();
        } else if (this.options.mode === 'marquee') {
            this.startMarquee();
        }
    }

    // --- 模式初始化函数 ---

    private initSlideMode(): void {
        // 1. 获取分页容器
        if (this.options.paginationSelector) {
            this.paginationContainer = document.querySelector(this.options.paginationSelector);
        }

        // 2. 克隆头尾项目实现无限循环
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
        this.container.style.display = 'block'; // 覆盖 Slide 模式的 flex

        // 2. 克隆足够多的项目实现“无限”循环
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
        if (wrapper) {
            // 在 Slide 模式下，itemWidth 是视口宽度
            this.itemWidth = wrapper.getBoundingClientRect().width;
        } else if (this.originalItemCount > 0) {
            // 在 Marquee 模式下，itemWidth 是单个项目的实际宽度
            this.itemWidth = this.items[0].getBoundingClientRect().width;
        }
    }

    /** 销毁实例，清理事件监听器和 DOM 结构 */
    public destroy(): void {
        this.stop();
        window.removeEventListener('resize', this.handleResize.bind(this));

        if (this.options.pauseOnHover) {
            this.container.removeEventListener('mouseenter', this.stop.bind(this));
            this.container.removeEventListener('mouseleave', this.start.bind(this));
        }

        // 移除克隆节点
        this.items.forEach((item) => {
            if (item.getAttribute('data-cloned') === 'true') {
                try {
                    this.container.removeChild(item);
                } catch (e) {
                    /* Already removed or not found */
                }
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
            this.container.addEventListener('mouseenter', this.stop.bind(this));
            this.container.addEventListener('mouseleave', this.start.bind(this));
        }
        // 响应式处理
        window.addEventListener('resize', this.handleResize.bind(this));
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
        } else if (this.options.mode === 'marquee') {
            // Marquee 模式只需要确保 itemWidth 正确即可，不需要重定位
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

    private marqueeAnimate = (timestamp: number): void => {
        if (!this.lastTimestamp) {
            this.lastTimestamp = timestamp;
        }

        const elapsed = timestamp - this.lastTimestamp;
        // Marquee 模式下 options.speed 是每帧移动的像素值
        const speedPerMs = this.options.speed / 16;

        // 1. 计算新的偏移量
        this.currentOffset += speedPerMs * elapsed;

        // 2. 处理“无限”循环
        // 循环点：当滚动偏移量超过原始项目集合的总宽度时，重置到 0
        const originalContentWidth = this.itemWidth * this.originalItemCount;

        if (this.currentOffset >= originalContentWidth) {
            // 重置到起点 (克隆内容开始的位置)
            this.currentOffset = this.currentOffset % originalContentWidth;
        }

        // 3. 应用 CSS 变换
        this.container.style.transform = `translateX(-${this.currentOffset}px)`;

        this.lastTimestamp = timestamp;
        this.animationFrameId = requestAnimationFrame(this.marqueeAnimate);
    };

    public startMarquee(): void {
        if (this.animationFrameId === null) {
            this.animationFrameId = requestAnimationFrame(this.marqueeAnimate);
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

        // 目标 DOM 索引：原始索引 + 1 (因为前面有一个克隆项)
        const targetDomIndex = index + 1;
        // 偏移量
        const offset = -targetDomIndex * this.itemWidth;

        // 设置过渡
        this.container.style.transition = useTransition
            ? `transform ${this.options.speed}ms ease-in-out`
            : 'none';

        this.container.style.transform = `translateX(${offset}px)`;

        // 在过渡结束后执行逻辑
        setTimeout(
            () => {
                // 只有在完成动画后才更新 currentIndex，防止点击过快
                this.currentIndex = index;
                this.updatePagination();
                this.isAnimating = false;

                // 处理无限循环：如果到达了克隆项，立即无过渡地跳到对应原始项
                if (index === -1) {
                    // 移到了最前面 (最末尾的克隆项)
                    this.jumpTo(this.originalItemCount - 1);
                } else if (index === this.originalItemCount) {
                    // 移到了最后面 (最开头的克隆项)
                    this.jumpTo(0);
                }
            },
            useTransition ? this.options.speed : 0,
        );
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
        if (this.options.mode !== 'slide') return;
        let newIndex = this.currentIndex + 1;
        // 目标是下一个原始项目，或者如果是最后一个，目标是第一个克隆项 (DOM 索引 N+1)
        if (newIndex > this.originalItemCount - 1) {
            newIndex = this.originalItemCount;
        }
        this.goToSlide(newIndex);
    }

    /** 导航到上一张 (Slide 模式专用) */
    public prevSlide(): void {
        if (this.options.mode !== 'slide') return;
        let newIndex = this.currentIndex - 1;
        // 目标是前一个原始项目，或者如果是第一个，目标是最后一个克隆项 (DOM 索引 0)
        if (newIndex < 0) {
            newIndex = -1;
        }
        this.goToSlide(newIndex);
    }

    public startAutoplay(): void {
        if (this.options.mode !== 'slide') return;
        this.stopAutoplay();
        this.autoPlayTimer = window.setInterval(() => {
            this.nextSlide();
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
