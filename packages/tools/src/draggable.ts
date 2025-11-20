export interface DragBoundary {
    minX?: number;
    maxX?: number;
    minY?: number;
    maxY?: number;
}

export interface CustomDragEvent {
    type: 'dragstart' | 'drag' | 'dragend' | 'boundary';
    x: number;
    y: number;
}

export interface DraggableOptions {
    boundary?: DragBoundary;
    onDragStart?: (event: CustomDragEvent) => void;
    onDrag?: (event: CustomDragEvent) => void;
    onDragEnd?: (event: CustomDragEvent) => void;
    onBoundaryHit?: (event: CustomDragEvent) => void;
    initialPosition?: { x: number; y: number };
    enableTouch?: boolean;
    enableAnimation?: boolean;
    snapToGrid?: { x: number; y: number };
    snapThreshold?: number;
    enableSnap?: boolean;
}

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

    private disableTextSelection(): void {
        document.body.style.userSelect = 'none';
    }

    private enableTextSelection(): void {
        document.body.style.userSelect = '';
    }

    private onMouseDown = (e: MouseEvent) => {
        this.startDrag(e.clientX, e.clientY);
        this.onDragStart?.({ type: 'dragstart', x: e.clientX, y: e.clientY });
    };

    private onMouseMove = (e: MouseEvent) => {
        this.dragMove(e.clientX, e.clientY);
    };

    private onMouseUp = (e: MouseEvent) => {
        this.endDrag(e.clientX, e.clientY);
    };

    private onTouchStart = (e: TouchEvent) => {
        e.preventDefault();
        const touch = e.touches[0];
        this.startDrag(touch.clientX, touch.clientY);
        this.onDragStart?.({ type: 'dragstart', x: touch.clientX, y: touch.clientY });
    };

    private onTouchMove = (e: TouchEvent) => {
        if (!this.isDragging) return;
        e.preventDefault();
        const touch = e.touches[0];
        this.dragMove(touch.clientX, touch.clientY);
    };

    private onTouchEnd = (e: TouchEvent) => {
        if (!this.isDragging) return;
        const touch = e.changedTouches[0];
        this.endDrag(touch.clientX, touch.clientY);
    };

    private startDrag(clientX: number, clientY: number) {
        this.disableTextSelection();
        const rect = this.element.getBoundingClientRect();
        this.offsetX = clientX - rect.left;
        this.offsetY = clientY - rect.top;
        this.isDragging = true;
        this.element.style.cursor = 'grabbing';
    }

    private dragMove(clientX: number, clientY: number) {
        if (!this.isDragging) return;

        if (this.requestId !== null) cancelAnimationFrame(this.requestId);

        this.requestId = requestAnimationFrame(() => {
            let moveX = clientX - this.offsetX;
            let moveY = clientY - this.offsetY;

            // 应用边界
            moveX = this.applyBoundary(moveX, 'X');
            moveY = this.applyBoundary(moveY, 'Y');

            // 应用 snap
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
                ((this.boundary.minX !== undefined && Math.abs(moveX - this.boundary.minX) < threshold) ||
                    (this.boundary.maxX !== undefined && Math.abs(moveX - this.boundary.maxX) < threshold) ||
                    (this.boundary.minY !== undefined && Math.abs(moveY - this.boundary.minY) < threshold) ||
                    (this.boundary.maxY !== undefined && Math.abs(moveY - this.boundary.maxY) < threshold))
            ) {
                this.onBoundaryHit?.({ type: 'boundary', x: moveX, y: moveY });
            }

            this.onDrag?.({ type: 'drag', x: clientX, y: clientY });
        });
    }

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

    private setPosition(x: number, y: number): void {
        this.element.style.left = `${x}px`;
        this.element.style.top = `${y}px`;
    }

    private applyBoundary(value: number, axis: 'X' | 'Y'): number {
        const rect = this.element.getBoundingClientRect();
        const size = axis === 'X' ? rect.width : rect.height;

        const min = axis === 'X' ? this.boundary.minX ?? 0 : this.boundary.minY ?? 0;
        const max =
            axis === 'X'
                ? this.boundary.maxX ?? window.innerWidth - size
                : this.boundary.maxY ?? window.innerHeight - size;

        return Math.min(Math.max(value, min), max);
    }

    private applySnap(value: number, grid: number): number {
        return Math.round(value / grid) * grid;
    }

    public destroy(): void {
        this.unbindEvents();
    }
}

export default Draggable;
