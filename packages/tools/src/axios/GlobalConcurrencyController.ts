export class GlobalConcurrencyController {
    private maxConcurrent: number;
    private activeCount = 0;
    private queue: (() => void)[] = [];

    constructor(maxConcurrent: number) {
        this.maxConcurrent = maxConcurrent > 0 ? maxConcurrent : Infinity;
    }

    async run<T>(task: () => Promise<T>): Promise<T> {
        if (this.activeCount >= this.maxConcurrent) {
            await new Promise<void>((resolve) => this.queue.push(resolve));
        }
        this.activeCount++;
        try {
            return await task();
        } finally {
            this.activeCount--;
            const next = this.queue.shift();
            if (next) next();
        }
    }
}
