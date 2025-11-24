import { AxiosRequestConfig } from 'axios';
import { generateRequestKey } from './helper';
/**
 * 自定义取消错误类型
 * 用于在拦截器中区分是“网络错误”还是“被防抖取消”
 */
export interface CancelError {
    isCancel: boolean;
    message: string;
    type: 'debounce' | 'throttle';
}

interface DebounceItem {
    resolve: (config: AxiosRequestConfig) => void;
    reject: (reason: CancelError) => void;
    timer: any; // NodeJS.Timeout | number
}

interface ThrottleItem {
    lastTime: number;
}

// 文件: ./errors/CancelError.ts 或 DebounceThrottleManager.ts 内部

/**
 * 专用于表示请求被取消的错误。
 * 它兼容 Axios 的取消机制（通过 isCancel 属性），并允许使用 instanceof 进行类型安全判断。
 */
export class DebounceThrottleCancelError extends Error {
    // 必须包含此属性以兼容 Axios 的 axios.isCancel(error) 检查
    public isCancel: boolean = true;
    // 用于存储 Axios 自身的请求配置等信息，可选
    public config?: any;
    public type: 'debounce' | 'throttle';

    constructor(message: string = 'Request was cancelled.', type: 'debounce' | 'throttle') {
        // 调用 Error 构造函数
        super(message);
        // 设置 name 属性，有助于调试时识别错误类型
        this.name = 'CancelError';
        this.type = type;
        // 保持原型链在继承时的正确性（对旧版JS环境重要）
        // 现代 TypeScript 目标环境可能不需要，但保留更安全
        if (typeof Object.setPrototypeOf === 'function') {
            Object.setPrototypeOf(this, DebounceThrottleCancelError.prototype);
        } else {
            (this as any).__proto__ = DebounceThrottleCancelError.prototype;
        }
    }
}

// 注意：原代码中的 Fn 类型已移除，因为它不适用于 Promise 逻辑。
export class DebounceThrottleManager {
    private debounceMap = new Map<string, DebounceItem>();
    private throttleMap = new Map<string, ThrottleItem>();

    /**
     * 防抖请求
     */
    public debounceRequest(req: AxiosRequestConfig, delay = 300): Promise<AxiosRequestConfig> {
        const key = generateRequestKey(req);
        return new Promise((resolve, reject) => {
            // 1. 如果有旧请求在等待，直接取消它
            if (this.debounceMap.has(key)) {
                const pending = this.debounceMap.get(key)!;
                clearTimeout(pending.timer);
                pending.reject(
                    new DebounceThrottleCancelError('Request canceled by debounce', 'debounce'),
                );
            }
            // 2. 设立新定时器
            const timer = setTimeout(() => {
                this.debounceMap.delete(key);
                resolve(req); // 时间到，放行当前最新的 req
            }, delay);
            // 3. 记录本次请求，以便被下一次取消
            this.debounceMap.set(key, { resolve, reject, timer });
        });
    }

    /**
     * 节流请求
     */
    public throttleRequest(req: AxiosRequestConfig, interval = 1000): Promise<AxiosRequestConfig> {
        const key = generateRequestKey(req);
        const now = Date.now();

        return new Promise((resolve, reject) => {
            const record = this.throttleMap.get(key);
            // 如果在冷却时间内
            if (record && now - record.lastTime < interval) {
                reject(new DebounceThrottleCancelError('Request canceled by throttle', 'throttle'));
                return;
            }
            // 允许执行，更新时间
            this.throttleMap.set(key, { lastTime: now });
            resolve(req);
        });
    }

    /**
     * 可选：取消某个防抖/节流 (保留原有的 cancel 方法，但使用新的逻辑)
     */
    public cancelDebounce(req: AxiosRequestConfig) {
        const key = generateRequestKey(req);
        if (this.debounceMap.has(key)) {
            const pending = this.debounceMap.get(key)!;
            clearTimeout(pending.timer);
            pending.reject({ isCancel: true, message: 'Manually canceled', type: 'debounce' });
            this.debounceMap.delete(key);
        }
    }

    public cancelThrottle(req: AxiosRequestConfig) {
        // 节流通常只清除历史记录，不涉及 Promise
        const key = generateRequestKey(req);
        this.throttleMap.delete(key);
        // 如果你的 throttle 实现是 trailing edge，这里可能还需要 clear 一个 timer
    }

    /**
     * 清理所有状态 (例如组件卸载时)
     */
    public clear() {
        this.debounceMap.forEach((item) => {
            clearTimeout(item.timer);
            item.reject({ isCancel: true, message: 'Manager cleared', type: 'debounce' });
        });
        this.debounceMap.clear();
        this.throttleMap.clear();
    }
}
