import { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { GlobalConcurrencyController } from './GlobalConcurrencyController';

// --- 辅助接口和类型 ---

// PollingConfig 接口不变
export interface PollingConfig<T> {
    key: string;
    url: string;
    config?: AxiosRequestConfig;
    onSuccess?: (res: AxiosResponse<T>) => void;
    onError?: (err: any) => void;
    interval?: number;
    // maxPollingTimes 更明确地表示“总轮询次数”（包括第一次）
    maxPollingTimes?: number;
    method?: 'get' | 'post' | 'delete' | 'put';
}

/**
 * 内部状态结构：用于管理单个轮询任务的生命周期和状态
 */
interface PollingState {
    // 轮询的唯一标识
    key: string;
    // 轮询是否被外部调用 stopPolling 停止
    isStopped: boolean;
    // 当前已尝试的轮询次数
    attempts: number;
    // 存储 setTimeout 的 ID，用于取消
    timeoutId: NodeJS.Timeout | null;
    // 任务执行所需的所有配置
    config: PollingConfig<any>;
}

export class PollingManager {
    // 使用 Map 存储 PollingState 对象，以便管理每个轮询的完整状态
    private pollingTasks: Map<string, PollingState> = new Map();

    constructor(
        private instance: AxiosInstance,
        private concurrencyController: GlobalConcurrencyController,
    ) {}

    /**
     * 启动或重启一个轮询任务。
     */
    public poll<T>(
        {
            key,
            url,
            method = 'get',
            config,
            onSuccess,
            onError,
            interval = 5000,
            maxPollingTimes = 3, // 使用 maxPollingTimes
        }: PollingConfig<T> = {} as PollingConfig<T>,
    ) {
        if (!key) {
            console.error('Polling key must be provided.');
            return;
        }

        // 如果该 key 已存在，先停止之前的轮询
        if (this.pollingTasks.has(key)) {
            this.stopPolling(key);
        }

        // 初始化新的状态对象
        const state: PollingState = {
            key,
            isStopped: false,
            attempts: 0,
            timeoutId: null,
            config: {
                key,
                url,
                method,
                config,
                onSuccess,
                onError,
                interval,
                maxPollingTimes,
            } as PollingConfig<any>,
        };
        this.pollingTasks.set(key, state);

        // 立即开始第一次轮询
        this.executePoll(state);
    }

    /**
     * 内部方法：执行单个轮询请求和调度下一个请求
     */
    private executePoll(state: PollingState): void {
        const { key, url, method, config, onSuccess, onError, interval, maxPollingTimes } =
            state.config;

        // 核心退出条件：如果被外部停止，或者已达到最大轮询次数
        if (state.isStopped || state.attempts >= maxPollingTimes!) {
            // 达到最大次数或已停止，执行清理
            this.pollingTasks.delete(key);
            return;
        }

        // 封装轮询请求逻辑
        const requestTask = async () => {
            // 再次检查中止状态，以防任务在排队时被 stopPolling
            if (state.isStopped) return;

            try {
                // 使用并发控制器来执行实际的 HTTP 请求
                const res = await this.instance[method!](url, config);
                onSuccess?.(res);
            } catch (err) {
                // 请求失败时，通知调用者
                onError?.(err);
            } finally {
                state.attempts++; // 无论成功失败，尝试次数都增加

                // 检查是否需要继续轮询
                if (state.attempts < maxPollingTimes!) {
                    // 调度下一个轮询请求
                    state.timeoutId = setTimeout(() => {
                        this.executePoll(state);
                    }, interval);
                } else {
                    // 达到最大次数，执行清理
                    this.pollingTasks.delete(key);
                }
            }
        };

        // 将请求加入并发控制器
        // 注意：这里不需要等待 run() 结果，因为任务状态的更新是在 finally 块中完成的。
        this.concurrencyController.run(requestTask).catch(() => {
            // 如果并发控制器内部出现未捕获的错误，或者 task() 抛出错误，
            // 都会在这里被捕获，但 executePoll 内部的 finally 已经处理了 attempts++。
            // 这里的 catch 主要用于处理 run 方法抛出的任何其他异常（例如，如果 task 本身同步抛出）。
            // 在我们的设计中，requestTask 的 try/catch 已经覆盖了 HTTP 错误。
            // 因此这个 catch 可以忽略，或者用于额外的日志记录。
            // 为了简洁和防止重复处理，我们依赖 requestTask 内部的 finally。
        });
    }

    /**
     * 停止指定的轮询任务并清理资源。
     */
    public stopPolling(key: string) {
        const state = this.pollingTasks.get(key);

        if (state) {
            // 1. 设置停止标志，阻止任何正在排队或未来调度的任务执行。
            state.isStopped = true;

            // 2. 清除下一个 setTimeout，防止后续轮询被触发。
            if (state.timeoutId) {
                clearTimeout(state.timeoutId);
            }

            // 3. 移除任务，释放内存。
            this.pollingTasks.delete(key);

            console.log(`Polling task '${key}' has been stopped.`);
        }
    }
}
