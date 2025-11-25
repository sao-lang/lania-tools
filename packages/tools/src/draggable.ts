/**
 * 拖拽边界限制
 * 注意：这里的 minX/maxX/minY/maxY 限制的是元素的 translate() 位移值。
 */
export interface DragBoundary {
    /** 水平方向最小值 */
    minX?: number;
    /** 水平方向最大值 */
    maxX?: number;
    /** 垂直方向最小值 */
    minY?: number;
    /** 垂直方向最大值 */
    maxY?: number;
}

/**
 * 自定义拖拽事件类型
 */
export interface CustomDragEvent {
    /** 事件类型 */
    type: 'dragstart' | 'drag' | 'dragend' | 'boundary';
    /** 元素当前 X 位移 (transform translate X) */
    x: number; 
    /** 元素当前 Y 位移 (transform translate Y) */
    y: number;
}

/**
 * Draggable 配置项
 */
export interface DraggableOptions {
    /** 拖拽边界 */
    boundary?: DragBoundary;
    /** 拖拽开始回调 */
    onDragStart?: (event: CustomDragEvent) => void;
    /** 拖拽中回调 */
    onDrag?: (event: CustomDragEvent) => void;
    /** 拖拽结束回调 */
    onDragEnd?: (event: CustomDragEvent) => void;
    /** 拖拽到边界回调 */
    onBoundaryHit?: (event: CustomDragEvent) => void;
    /** 初始位移 (transform translate X/Y) */
    initialPosition?: { x: number; y: number };
    /** 是否启用触摸事件 */
    enableTouch?: boolean;
    /** 是否启用动画过渡 */
    enableAnimation?: boolean;
    /** 是否启用吸附到网格 */
    snapToGrid?: { x: number; y: number };
    /** 吸附阈值 */
    snapThreshold?: number;
    /** 是否启用吸附 */
    enableSnap?: boolean;
    /** 是否限制在父容器边界内 (优先级低于 boundary 传入的值) */
    constrainToParent?: boolean; 
}

/**
 * 可拖拽元素封装类
 * - 使用 transform 实现高性能拖拽
 * - 支持边界限制、吸附到网格、触摸事件和回调
 */
export class Draggable {
    private element: HTMLElement;
    private isDragging: boolean = false;

    // 当前位移值，用于 transform: translate(currentX, currentY)
    private currentX: number = 0; 
    private currentY: number = 0;

    // 拖拽开始时的状态
    private startClientX: number = 0;
    private startClientY: number = 0;
    private startTranslateX: number = 0;
    private startTranslateY: number = 0;
    
    // 缓存尺寸（性能优化）
    private elementWidth: number = 0;
    private elementHeight: number = 0;
    private parentWidth: number = 0;
    private parentHeight: number = 0;

    // 配置项
    private boundary: DragBoundary;
    private onDragStart?: (event: CustomDragEvent) => void;
    private onDrag?: (event: CustomDragEvent) => void;
    private onDragEnd?: (event: CustomDragEvent) => void;
    private onBoundaryHit?: (event: CustomDragEvent) => void;
    private enableTouch: boolean;
    private enableAnimation: boolean;
    private snapToGrid: { x: number; y: number } | null = null;
    private snapThreshold: number;
    private enableSnap: boolean;
    private constrainToParent: boolean;

    private requestId: number | null = null;
    // 边界状态，用于控制 onBoundaryHit 触发频率
    private isBoundaryHit: boolean = false; 

    /**
     * 构造函数
     * @param element 可拖拽的 DOM 元素
     * @param options 配置项
     */
    constructor(element: HTMLElement, options: DraggableOptions = {}) {
        this.element = element;
        this.boundary = options.boundary || {};
        this.onDragStart = options.onDragStart;
        this.onDrag = options.onDrag;
        this.onDragEnd = options.onDragEnd;
        this.onBoundaryHit = options.onBoundaryHit;
        this.enableTouch = options.enableTouch ?? false;
        this.enableAnimation = options.enableAnimation ?? false;
        this.snapToGrid = options.snapToGrid ?? null;
        this.snapThreshold = options.snapThreshold ?? 10;
        this.enableSnap = options.enableSnap ?? false;
        this.constrainToParent = options.constrainToParent ?? false;

        // 设置初始 transform (使用 setPosition)
        if (options.initialPosition) {
            this.setPosition(options.initialPosition.x, options.initialPosition.y);
        } else {
            // 确保初始状态为 translate(0, 0)
            this.setPosition(0, 0); 
        }

        // 确保 position 样式为 absolute/relative 以便计算父容器边界
        if (window.getComputedStyle(this.element).position === 'static') {
            this.element.style.position = 'relative'; 
        }

        if (this.enableAnimation) {
            this.element.style.transition = 'transform 0.15s ease';
        }
    }

    /**
     * 绑定拖拽事件
     */
    public bindEvents(): void {
        this.element.addEventListener('mousedown', this.onMouseDown);
        document.addEventListener('mousemove', this.onMouseMove);
        document.addEventListener('mouseup', this.onMouseUp);

        if (this.enableTouch) {
            this.element.addEventListener('touchstart', this.onTouchStart, { passive: false });
            document.addEventListener('touchmove', this.onTouchMove, { passive: false });
            document.addEventListener('touchend', this.onTouchEnd);
        }
    }

    /**
     * 解绑拖拽事件 (修正 touch 事件解绑参数)
     */
    public unbindEvents(): void {
        this.element.removeEventListener('mousedown', this.onMouseDown);
        document.removeEventListener('mousemove', this.onMouseMove);
        document.removeEventListener('mouseup', this.onMouseUp);

        if (this.enableTouch) {
            // 确保移除时 passive 参数一致
            this.element.removeEventListener('touchstart', this.onTouchStart, { passive: false } as any);
            document.removeEventListener('touchmove', this.onTouchMove, { passive: false } as any);
            this.element.removeEventListener('touchend', this.onTouchEnd); // touchend 默认 passive: true

            // 由于 onTouchEnd 是绑定在 document 上，但为了代码可读性，这里修正一下
            document.removeEventListener('touchend', this.onTouchEnd);
        }

        if (this.requestId !== null) {
            cancelAnimationFrame(this.requestId);
            this.requestId = null;
        }
    }

    /** 禁用文本选中 */
    private disableTextSelection(): void {
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing'; // 保持光标一致
    }

    /** 恢复文本选中 */
    private enableTextSelection(): void {
        document.body.style.userSelect = '';
        this.element.style.cursor = 'grab';
    }

    /** 鼠标按下事件处理 */
    private onMouseDown = (e: MouseEvent) => {
        // 确保只响应左键
        if (e.button !== 0) return; 
        this.startDrag(e.clientX, e.clientY);
        this.onDragStart?.({ type: 'dragstart', x: this.currentX, y: this.currentY });
    };

    /** 鼠标移动事件处理 */
    private onMouseMove = (e: MouseEvent) => {
        this.dragMove(e.clientX, e.clientY);
    };

    /** 鼠标抬起事件处理 */
    private onMouseUp = () => {
        this.endDrag();
    };

    /** 触摸开始事件处理 */
    private onTouchStart = (e: TouchEvent) => {
        e.preventDefault();
        const touch = e.touches[0];
        this.startDrag(touch.clientX, touch.clientY);
        this.onDragStart?.({ type: 'dragstart', x: this.currentX, y: this.currentY });
    };

    /** 触摸移动事件处理 */
    private onTouchMove = (e: TouchEvent) => {
        if (!this.isDragging) return;
        e.preventDefault();
        const touch = e.touches[0];
        this.dragMove(touch.clientX, touch.clientY);
    };

    /** 触摸结束事件处理 */
    private onTouchEnd = () => {
        if (!this.isDragging) return;
        this.endDrag();
    };

    /** 开始拖拽 */
    private startDrag(clientX: number, clientY: number) {
        this.disableTextSelection();
        
        // 缓存起始位置和尺寸 (性能优化)
        this.startClientX = clientX;
        this.startClientY = clientY;
        this.startTranslateX = this.currentX;
        this.startTranslateY = this.currentY;
        
        const rect = this.element.getBoundingClientRect();
        this.elementWidth = rect.width;
        this.elementHeight = rect.height;
        
        if (this.constrainToParent && this.element.parentElement) {
            const parentRect = this.element.parentElement.getBoundingClientRect();
            this.parentWidth = parentRect.width;
            this.parentHeight = parentRect.height;
        }

        this.isDragging = true;
        this.isBoundaryHit = false; // 重置边界状态
        this.element.style.cursor = 'grabbing';
    }

    /** 拖拽移动 */
    private dragMove(clientX: number, clientY: number) {
        if (!this.isDragging) return;

        if (this.requestId !== null) cancelAnimationFrame(this.requestId);

        this.requestId = requestAnimationFrame(() => {
            // 1. 计算位移 Delta
            const deltaX = clientX - this.startClientX;
            const deltaY = clientY - this.startClientY;

            // 2. 计算新位置 (基于起始位移 + Delta)
            let moveX = this.startTranslateX + deltaX;
            let moveY = this.startTranslateY + deltaY;
            
            // 3. 应用边界
            const prevX = moveX;
            const prevY = moveY;
            moveX = this.applyBoundary(moveX, 'X');
            moveY = this.applyBoundary(moveY, 'Y');

            // 4. 应用吸附
            if (this.enableSnap && this.snapToGrid) {
                moveX = this.applySnap(moveX, this.snapToGrid.x);
                moveY = this.applySnap(moveY, this.snapToGrid.y);
            }
            
            // 5. 设置新位置
            this.setPosition(moveX, moveY);
            
            // 6. 边界回调 (修正为仅在第一次触碰时触发)
            if (prevX !== moveX || prevY !== moveY) {
                // 发生边界修正
                if (!this.isBoundaryHit) {
                    this.onBoundaryHit?.({ type: 'boundary', x: moveX, y: moveY });
                    this.isBoundaryHit = true;
                }
            } else {
                // 没有边界修正，可以重置状态
                this.isBoundaryHit = false; 
            }

            // 7. 拖拽中回调 (修正参数为位移值)
            this.onDrag?.({ type: 'drag', x: moveX, y: moveY });
        });
    }

    /** 结束拖拽 */
    private endDrag() {
        if (!this.isDragging) return;
        
        // 传递最终位置 (currentX/Y)
        this.onDragEnd?.({ type: 'dragend', x: this.currentX, y: this.currentY });
        
        this.isDragging = false;
        this.isBoundaryHit = false;
        this.enableTextSelection();
        
        if (this.requestId !== null) {
            cancelAnimationFrame(this.requestId);
            this.requestId = null;
        }
    }

    /** 设置元素位置 (使用 transform) */
    public setPosition(x: number, y: number): void {
        // 更新内部状态
        this.currentX = x;
        this.currentY = y;
        
        // 应用 transform
        this.element.style.transform = `translate(${x}px, ${y}px)`;
    }

    /** 应用边界限制 */
    private applyBoundary(value: number, axis: 'X' | 'Y'): number {
        
        // 优先使用用户传入的边界
        let min = axis === 'X' ? (this.boundary.minX ?? -Infinity) : (this.boundary.minY ?? -Infinity);
        let max = axis === 'X' ? (this.boundary.maxX ?? Infinity) : (this.boundary.maxY ?? Infinity);

        // 如果启用了限制在父容器
        if (this.constrainToParent) {
            const size = axis === 'X' ? this.elementWidth : this.elementHeight;
            const parentSize = axis === 'X' ? this.parentWidth : this.parentHeight;
            
            // 默认 min 边界 (0)
            const parentMin = 0; 
            // 默认 max 边界 (父容器尺寸 - 元素尺寸)
            const parentMax = parentSize - size; 
            
            // 如果用户没有设置 minX/minY，则使用父容器的 0 边界
            if (this.boundary[`min${axis}`] === undefined) {
                 min = Math.max(min, parentMin);
            }
            // 如果用户没有设置 maxX/maxY，则使用父容器的 Max 边界
            if (this.boundary[`max${axis}`] === undefined) {
                 max = Math.min(max, parentMax);
            }
        }
        
        // 最终限制
        return Math.min(Math.max(value, min), max);
    }

    /** 应用吸附到网格 */
    private applySnap(value: number, grid: number): number {
        // 使用 snapThreshold 逻辑 (可选，这里简化为纯吸附)
        const snappedValue = Math.round(value / grid) * grid;
        return snappedValue;
    }

    /** 销毁实例，解绑事件 */
    public destroy(): void {
        this.unbindEvents();
        // 清理 transform 动画
        this.element.style.transition = '';
        this.element.style.cursor = '';
    }
}

export default Draggable;
