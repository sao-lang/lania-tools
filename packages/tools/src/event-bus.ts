/**
 * 事件上下文，可携带任意数据
 */
export interface EventContext {
    [key: string]: any;
}

/**
 * 同步事件处理函数
 * @param eventData 事件数据
 * @param context 事件上下文
 */
export type EventHandler<T = any> = (eventData?: T, context?: EventContext) => void;

/**
 * 异步事件处理函数
 * @param eventData 事件数据
 * @param context 事件上下文
 */
export type AsyncEventHandler<T = any> = (eventData?: T, context?: EventContext) => Promise<void>;

/**
 * 带优先级的事件处理器
 */
interface PriorityEventHandler<T = EventHandler | AsyncEventHandler> {
    /** 事件处理函数 */
    handler: T;
    /** 优先级，数值越大优先级越高 */
    priority: number;
    /** 是否只执行一次 */
    once?: boolean;
}

/**
 * 事件注册选项
 */
interface EventOptions {
    /** 命名空间，默认为 'global' */
    namespace?: string;
    /** 优先级，默认为 0 */
    priority?: number;
    /** 是否只执行一次，默认为 false */
    once?: boolean;
}

/**
 * 命名空间管理器
 */
class NamespaceManager {
    private namespaces: Set<string> = new Set();

    /**
     * 注册命名空间
     * @param namespace 命名空间名称
     */
    public registerNamespace(namespace: string): void {
        this.namespaces.add(namespace);
    }

    /**
     * 判断命名空间是否已注册
     * @param namespace 命名空间名称
     * @returns 是否有效
     */
    public isValidNamespace(namespace: string): boolean {
        return this.namespaces.has(namespace);
    }
}

/**
 * 事件总线类
 * - 支持同步/异步事件
 * - 支持命名空间
 * - 支持事件优先级
 * - 支持一次性事件
 * - 支持事件触发次数统计
 */
export class EventBus {
    /** 存储事件与处理器列表 */
    private events: Map<string, PriorityEventHandler[]> = new Map();
    /** 存储事件触发次数 */
    private eventCounts: Map<string, number> = new Map();
    /** 命名空间管理器 */
    private namespaceManager = new NamespaceManager();

    /**
     * 注册事件处理器
     * @param event 事件名称
     * @param handler 同步或异步处理函数
     * @param options 配置项
     */
    public on<T = any>(
        event: string,
        handler: EventHandler<T> | AsyncEventHandler<T>,
        options: EventOptions = {},
    ): void {
        const { namespace = 'global', priority = 0, once = false } = options;

        if (namespace !== 'global' && !this.namespaceManager.isValidNamespace(namespace)) {
            throw new Error(`Namespace ${namespace} is not registered`);
        }

        const key = this.formatKey(namespace, event);

        if (!this.events.has(key)) {
            this.events.set(key, []);
        }

        this.events.get(key)?.push({ handler, priority, once });
        // 按优先级从大到小排序
        this.events.get(key)?.sort((a, b) => b.priority - a.priority);
    }

    /**
     * 触发事件
     * @param event 事件名称
     * @param eventData 事件数据
     * @param options 可选命名空间
     */
    public async emit<T = any>(
        event: string,
        eventData?: T,
        options: { namespace?: string } = {},
    ): Promise<void> {
        const { namespace = 'global' } = options;

        if (namespace !== 'global' && !this.namespaceManager.isValidNamespace(namespace)) {
            throw new Error(`Namespace ${namespace} is not registered`);
        }

        const key = this.formatKey(namespace, event);
        const handlers = this.events.get(key);

        if (handlers) {
            // 增加事件触发计数
            this.eventCounts.set(key, (this.eventCounts.get(key) || 0) + 1);

            for (const { handler, once } of handlers) {
                try {
                    if (handler.constructor.name === 'AsyncFunction') {
                        await (handler as AsyncEventHandler<T>)(eventData, {} as EventContext);
                    } else {
                        (handler as EventHandler<T>)(eventData, {} as EventContext);
                    }
                } catch (error) {
                    console.error(`Error occurred while handling event '${key}':`, error);
                }

                // 如果是一次性事件，执行后移除
                if (once) {
                    this.events.set(
                        key,
                        handlers.filter((h) => h.handler !== handler),
                    );
                }
            }
        }
    }

    /**
     * 批量触发事件
     * @param events 事件列表
     */
    public async emitBatch<T = any>(
        events: { event: string; data?: T; options?: { namespace?: string } }[],
    ): Promise<void> {
        for (const { event, data, options } of events) {
            await this.emit(event, data, options);
        }
    }

    /**
     * 获取事件触发次数
     * @param namespace 命名空间
     * @param event 事件名称
     * @returns 次数
     */
    public getEventCount(namespace: string, event: string): number {
        return this.eventCounts.get(this.formatKey(namespace, event)) || 0;
    }

    /**
     * 注销事件处理器
     * @param event 事件名称
     * @param handler 要移除的处理器
     * @param options 可选命名空间
     */
    public off<T = any>(
        event: string,
        handler: EventHandler<T> | AsyncEventHandler<T>,
        options: { namespace?: string } = {},
    ): void {
        const { namespace = 'global' } = options;
        const key = this.formatKey(namespace, event);
        const handlers = this.events.get(key);

        if (handlers) {
            this.events.set(
                key,
                handlers.filter((h) => h.handler !== handler),
            );
        }
    }

    /**
     * 清空所有事件和触发次数
     */
    public clear(): void {
        this.events.clear();
        this.eventCounts.clear();
    }

    /**
     * 注册命名空间
     * @param namespace 命名空间名称
     */
    public registerNamespace(namespace: string): void {
        this.namespaceManager.registerNamespace(namespace);
    }

    /**
     * 格式化事件键
     * @param namespace 命名空间
     * @param event 事件名称
     * @returns 格式化后的键
     */
    private formatKey(namespace: string, event: string): string {
        return `${namespace}:${event}`;
    }
}

export default EventBus;
