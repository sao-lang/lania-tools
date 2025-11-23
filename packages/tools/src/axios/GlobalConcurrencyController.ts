/**
 * 结构体：表示一个等待中的任务。
 */
interface QueuedTask<T> {
    // 原始异步任务
    task: () => Promise<T>;
    // 任务完成时调用的 Promise resolve 函数
    resolve: (value: T) => void;
    // 任务失败时调用的 Promise reject 函数
    reject: (reason?: any) => void;
}

export class GlobalConcurrencyController {
    private maxConcurrent: number;
    private activeCount = 0;
    // 队列存储 QueuedTask 结构，用于处理 resolve/reject
    private queue: QueuedTask<any>[] = []; 

    /**
     * @param maxConcurrent 最大并发数。如果传入 0 或负数，则视为 Infinity (无限)。
     */
    constructor(maxConcurrent: number) {
        // 确保 maxConcurrent 是一个正数，否则设置为 Infinity
        this.maxConcurrent = maxConcurrent > 0 ? maxConcurrent : Infinity;
    }

    /**
     * 内部调度器：检查队列并启动下一个任务。
     */
    private scheduleNext(): void {
        // 确保队列中有任务并且当前活动任务数未超过限制（以防万一）
        if (this.queue.length > 0 && this.activeCount < this.maxConcurrent) {
            const nextTask = this.queue.shift();

            // 如果成功取出任务，立即开始执行
            if (nextTask) {
                // 启动任务，但不需要等待它的结果。
                // 这里的 activeCount 增加是在 run 方法的 finally 块执行之前。
                this.executeTask(nextTask);
            }
        }
    }

    /**
     * 执行实际任务并处理结果
     */
    private executeTask<T>(queuedTask: QueuedTask<T>): void {
        // 增加活跃任务计数
        this.activeCount++; 

        // 执行任务并处理其结果
        queuedTask.task()
            .then(result => {
                queuedTask.resolve(result); // 成功时通知等待的 Promise
            })
            .catch(error => {
                queuedTask.reject(error);   // 失败时通知等待的 Promise
            })
            .finally(() => {
                // 任务完成，减少活跃任务计数
                this.activeCount--; 
                
                // 尝试启动队列中的下一个任务
                this.scheduleNext();
            });
    }

    /**
     * 运行一个异步任务，如果并发数已满则将其排队。
     * @param task 要执行的异步函数，返回一个 Promise<T>。
     * @returns 任务执行结果的 Promise。
     */
    async run<T>(task: () => Promise<T>): Promise<T> {
        // 1. 如果有空闲的槽位，立即执行任务。
        if (this.activeCount < this.maxConcurrent) {
            this.activeCount++; // 提前增加计数，保证原子性
            try {
                return await task();
            } finally {
                this.activeCount--; // 任务完成，减少计数
                this.scheduleNext(); // 尝试启动下一个排队任务
            }
        }

        // 2. 如果没有空闲槽位，将任务排队等待。
        return new Promise<T>((resolve, reject) => {
            this.queue.push({ task, resolve, reject });
            
            // 额外调用 scheduleNext(): 
            // 如果 maxConcurrent 恰好为 0（虽然构造函数会将其转为 Infinity），
            // 或者 activeCount 刚刚减少，这个调用可以确保任务在 activeCount 恢复后立即开始。
            // 尤其在任务从队列中被启动，但 activeCount 还没来得及增加时，它可以防止死锁。
            this.scheduleNext(); 
        });
    }
}
