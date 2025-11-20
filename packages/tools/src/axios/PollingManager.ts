import { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { GlobalConcurrencyController } from './GlobalConcurrencyController';

export interface PollingConfig<T> {
    key: string;
    url: string;
    config?: AxiosRequestConfig;
    onSuccess?: (res: AxiosResponse<T>) => void;
    onError?: (err: any) => void;
    interval?: number;
    maxRetries?: number;
    method?: 'get' | 'post' | 'delete' | 'put';
}

export class PollingManager {
    // eslint-disable-next-line no-undef
    private pollingTasks: Map<string, NodeJS.Timeout> = new Map();

    constructor(
        private instance: AxiosInstance,
        private concurrencyController: GlobalConcurrencyController,
    ) {}

    public poll<T>(
        {
            key,
            url,
            method = 'get',
            config,
            onSuccess,
            onError,
            interval = 5000,
            maxRetries = 3,
        }: PollingConfig<T> = {} as PollingConfig<T>,
    ) {
        // 先清除
        if (this.pollingTasks.has(key)) {
            this.stopPolling(key);
        }
        let attempts = 0;
        const pollRequest = async () => {
            // 超过最大次数，不执行了
            if (attempts >= maxRetries) return;
            try {
                // 利用并发管理器请求
                await this.concurrencyController.run(async () => {
                    const res = await this.instance[method](url, config);
                    onSuccess?.(res);
                });
            } catch (err) {
                onError?.(err);
            } finally {
                attempts++;
                if (attempts < maxRetries) {
                    this.pollingTasks.set(
                        key,
                        setTimeout(pollRequest, interval),
                    );
                }
            }
        };
        pollRequest();
    }

    public stopPolling(key: string) {
        const timeout = this.pollingTasks.get(key);
        if (timeout) clearTimeout(timeout);
        this.pollingTasks.delete(key);
    }
}
