interface EventContext {
    [key: string]: any;
}

type EventHandler<T = any> = (eventData?: T, context?: EventContext) => void;
type AsyncEventHandler<T = any> = (
    eventData?: T,
    context?: EventContext,
) => Promise<void>;

interface PriorityEventHandler<T = EventHandler | AsyncEventHandler> {
    handler: T;
    priority: number;
    once?: boolean;
}

interface EventOptions {
    namespace?: string; // 使 namespace 成为可选的
    priority?: number;
    once?: boolean;
}

class NamespaceManager {
    private namespaces: Set<string> = new Set();

    public registerNamespace(namespace: string): void {
        this.namespaces.add(namespace);
    }

    public isValidNamespace(namespace: string): boolean {
        return this.namespaces.has(namespace);
    }
}

export class EventBus {
    private events: Map<string, PriorityEventHandler[]> = new Map();
    private eventCounts: Map<string, number> = new Map();
    private namespaceManager = new NamespaceManager();

    // 注册事件处理器
    public on<T = any>(
        event: string,
        handler: EventHandler<T> | AsyncEventHandler<T>,
        options: EventOptions = {},
    ): void {
        const { namespace = 'global', priority = 0, once = false } = options;

        if (
            namespace !== 'global' &&
            !this.namespaceManager.isValidNamespace(namespace)
        ) {
            throw new Error(`Namespace ${namespace} is not registered`);
        }

        const key = this.formatKey(namespace, event);

        if (!this.events.has(key)) {
            this.events.set(key, []);
        }

        this.events.get(key)?.push({ handler, priority, once });
        this.events.get(key)?.sort((a, b) => b.priority - a.priority);
    }

    // 触发事件
    public async emit<T = any>(
        event: string,
        eventData?: T,
        options: { namespace?: string } = {},
    ): Promise<void> {
        const { namespace = 'global' } = options;

        if (
            namespace !== 'global' &&
            !this.namespaceManager.isValidNamespace(namespace)
        ) {
            throw new Error(`Namespace ${namespace} is not registered`);
        }

        const key = this.formatKey(namespace, event);
        const handlers = this.events.get(key);

        if (handlers) {
            this.eventCounts.set(key, (this.eventCounts.get(key) || 0) + 1);

            for (const { handler, once } of handlers) {
                try {
                    if (handler.constructor.name === 'AsyncFunction') {
                        await (handler as AsyncEventHandler<T>)(
                            eventData,
                            {} as EventContext,
                        );
                    } else {
                        (handler as EventHandler<T>)(
                            eventData,
                            {} as EventContext,
                        );
                    }
                } catch (error) {
                    console.error(
                        `Error occurred while handling event '${key}':`,
                        error,
                    );
                }

                if (once) {
                    this.events.set(
                        key,
                        handlers.filter((h) => h.handler !== handler),
                    );
                }
            }
        }
    }

    // 批量触发事件
    public async emitBatch<T = any>(
        events: { event: string; data?: T; options?: { namespace?: string } }[],
    ): Promise<void> {
        for (const { event, data, options } of events) {
            await this.emit(event, data, options);
        }
    }

    // 获取事件触发次数
    public getEventCount(namespace: string, event: string): number {
        return this.eventCounts.get(this.formatKey(namespace, event)) || 0;
    }

    // 注销事件处理器
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

    // 清除所有事件
    public clear(): void {
        this.events.clear();
        this.eventCounts.clear();
    }

    // 注册命名空间
    public registerNamespace(namespace: string): void {
        this.namespaceManager.registerNamespace(namespace);
    }

    private formatKey(namespace: string, event: string): string {
        return `${namespace}:${event}`;
    }
}

export default EventBus;