/**
 * 拖拽边界限制
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
    /** 当前 x 坐标 */
    x: number;
    /** 当前 y 坐标 */
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
    /** 初始位置 */
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
}

/**
 * 可拖拽元素封装类
 * - 支持鼠标和触摸事件
 * - 支持边界限制
 * - 支持吸附到网格
 * - 支持拖拽动画
 * - 支持回调事件
 */
export class Draggable {
    private element: HTMLElement;
    private offsetX: number = 0;
    private offsetY: number = 0;
    private isDragging: boolean = false;
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
    private requestId: number | null = null;

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

        // 确保初始 left/top
        const style = window.getComputedStyle(this.element);
        if (!style.left || style.left === 'auto') this.element.style.left = '0px';
        if (!style.top || style.top === 'auto') this.element.style.top = '0px';
        if (options.initialPosition) {
            this.setPosition(options.initialPosition.x, options.initialPosition.y);
        }

        if (this.enableAnimation) {
            this.element.style.transition = 'left 0.15s ease, top 0.15s ease';
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
     * 解绑拖拽事件
     */
    public unbindEvents(): void {
        this.element.removeEventListener('mousedown', this.onMouseDown);
        document.removeEventListener('mousemove', this.onMouseMove);
        document.removeEventListener('mouseup', this.onMouseUp);

        if (this.enableTouch) {
            this.element.removeEventListener('touchstart', this.onTouchStart);
            document.removeEventListener('touchmove', this.onTouchMove);
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
    }

    /** 恢复文本选中 */
    private enableTextSelection(): void {
        document.body.style.userSelect = '';
    }

    /** 鼠标按下事件处理 */
    private onMouseDown = (e: MouseEvent) => {
        this.startDrag(e.clientX, e.clientY);
        this.onDragStart?.({ type: 'dragstart', x: e.clientX, y: e.clientY });
    };

    /** 鼠标移动事件处理 */
    private onMouseMove = (e: MouseEvent) => {
        this.dragMove(e.clientX, e.clientY);
    };

    /** 鼠标抬起事件处理 */
    private onMouseUp = (e: MouseEvent) => {
        this.endDrag(e.clientX, e.clientY);
    };

    /** 触摸开始事件处理 */
    private onTouchStart = (e: TouchEvent) => {
        e.preventDefault();
        const touch = e.touches[0];
        this.startDrag(touch.clientX, touch.clientY);
        this.onDragStart?.({ type: 'dragstart', x: touch.clientX, y: touch.clientY });
    };

    /** 触摸移动事件处理 */
    private onTouchMove = (e: TouchEvent) => {
        if (!this.isDragging) return;
        e.preventDefault();
        const touch = e.touches[0];
        this.dragMove(touch.clientX, touch.clientY);
    };

    /** 触摸结束事件处理 */
    private onTouchEnd = (e: TouchEvent) => {
        if (!this.isDragging) return;
        const touch = e.changedTouches[0];
        this.endDrag(touch.clientX, touch.clientY);
    };

    /** 开始拖拽 */
    private startDrag(clientX: number, clientY: number) {
        this.disableTextSelection();
        const rect = this.element.getBoundingClientRect();
        this.offsetX = clientX - rect.left;
        this.offsetY = clientY - rect.top;
        this.isDragging = true;
        this.element.style.cursor = 'grabbing';
    }

    /** 拖拽移动 */
    private dragMove(clientX: number, clientY: number) {
        if (!this.isDragging) return;

        if (this.requestId !== null) cancelAnimationFrame(this.requestId);

        this.requestId = requestAnimationFrame(() => {
            let moveX = clientX - this.offsetX;
            let moveY = clientY - this.offsetY;

            // 应用边界
            moveX = this.applyBoundary(moveX, 'X');
            moveY = this.applyBoundary(moveY, 'Y');

            // 应用吸附
            if (this.enableSnap && this.snapToGrid) {
                moveX = this.applySnap(moveX, this.snapToGrid.x);
                moveY = this.applySnap(moveY, this.snapToGrid.y);
            }

            const prevX = parseFloat(this.element.style.left) || 0;
            const prevY = parseFloat(this.element.style.top) || 0;

            this.setPosition(moveX, moveY);

            // 边界回调
            const threshold = 1;
            if (
                (moveX !== prevX || moveY !== prevY) &&
                ((this.boundary.minX !== undefined &&
                    Math.abs(moveX - this.boundary.minX) < threshold) ||
                    (this.boundary.maxX !== undefined &&
                        Math.abs(moveX - this.boundary.maxX) < threshold) ||
                    (this.boundary.minY !== undefined &&
                        Math.abs(moveY - this.boundary.minY) < threshold) ||
                    (this.boundary.maxY !== undefined &&
                        Math.abs(moveY - this.boundary.maxY) < threshold))
            ) {
                this.onBoundaryHit?.({ type: 'boundary', x: moveX, y: moveY });
            }

            this.onDrag?.({ type: 'drag', x: clientX, y: clientY });
        });
    }

    /** 结束拖拽 */
    private endDrag(clientX: number, clientY: number) {
        if (!this.isDragging) return;
        this.isDragging = false;
        this.element.style.cursor = 'grab';
        this.enableTextSelection();
        this.onDragEnd?.({ type: 'dragend', x: clientX, y: clientY });
        if (this.requestId !== null) {
            cancelAnimationFrame(this.requestId);
            this.requestId = null;
        }
    }

    /** 设置元素位置 */
    private setPosition(x: number, y: number): void {
        this.element.style.left = `${x}px`;
        this.element.style.top = `${y}px`;
    }

    /** 应用边界限制 */
    private applyBoundary(value: number, axis: 'X' | 'Y'): number {
        const rect = this.element.getBoundingClientRect();
        const size = axis === 'X' ? rect.width : rect.height;

        const min = axis === 'X' ? (this.boundary.minX ?? 0) : (this.boundary.minY ?? 0);
        const max =
            axis === 'X'
                ? (this.boundary.maxX ?? window.innerWidth - size)
                : (this.boundary.maxY ?? window.innerHeight - size);

        return Math.min(Math.max(value, min), max);
    }

    /** 应用吸附到网格 */
    private applySnap(value: number, grid: number): number {
        return Math.round(value / grid) * grid;
    }

    /** 销毁实例，解绑事件 */
    public destroy(): void {
        this.unbindEvents();
    }
}

export default Draggable;
