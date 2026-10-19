/**
 * @file logger.ts
 * @description 轻量结构化日志：级别过滤、命名空间、上下文、历史缓冲、可插拔输出。
 */

/** 日志级别（含用于静默的 silent） */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/** 可实际输出的日志级别 */
export type ActiveLogLevel = Exclude<LogLevel, 'silent'>;

/** 级别阈值：数值越大越严重 */
export const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
    silent: 100,
};

/** 一条日志记录 */
export interface LogRecord {
    /** 级别 */
    level: ActiveLogLevel;
    /** 主消息 */
    message: string;
    /** 附加参数（原样传递，默认输出交给 console） */
    args: unknown[];
    /** 合并后的上下文 */
    context: Record<string, unknown>;
    /** 完整命名空间，例如 `api:user` */
    name: string;
    /** 毫秒时间戳 */
    timestamp: number;
    /** 格式化后的时间字符串；未开启 timestamp 时为空串 */
    time: string;
}

/** 日志输出器 */
export type LogHandler = (record: LogRecord) => void;

/** Logger 配置 */
export interface LoggerOptions {
    /** 命名空间，例如 `api` */
    name?: string;
    /** 最低输出级别，默认取全局级别（初始 `info`） */
    level?: LogLevel;
    /** 固定上下文，会合并进每条日志 */
    context?: Record<string, unknown>;
    /** 是否在输出中包含时间，默认 `false` */
    timestamp?: boolean;
    /** 自定义时间格式，仅在 timestamp 为 true 时生效 */
    timeFormatter?: (date: Date) => string;
    /** 自定义输出器，默认输出到 console */
    handler?: LogHandler;
    /** 历史记录条数上限，默认 `0`（不记录） */
    historySize?: number;
}

interface LoggerCore {
    level: LogLevel;
    handler: LogHandler;
    timestamp: boolean;
    timeFormatter: (date: Date) => string;
    historySize: number;
    history: LogRecord[];
}

const pad = (value: number, length = 2): string => value.toString().padStart(length, '0');

const defaultTimeFormatter = (date: Date): string =>
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(
        date.getMilliseconds(),
        3,
    )}`;

function getConsole(): Console | undefined {
    return typeof console !== 'undefined' ? console : undefined;
}

function assertLogLevel(level: string): asserts level is LogLevel {
    if (!Object.prototype.hasOwnProperty.call(LOG_LEVEL_ORDER, level)) {
        throw new Error(`Invalid log level: ${level}`);
    }
}

/**
 * 将任意值安全地转为可读字符串。
 *
 * 处理了循环引用、Error、Map、Set、BigInt、Symbol、函数与正则，
 * 避免日志本身因为序列化失败而抛错。
 */
export function safeStringify(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'undefined') return 'undefined';
    if (typeof value === 'bigint') return `${value}n`;
    if (typeof value === 'symbol') return value.toString();
    if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
    if (value instanceof Error) {
        return value.stack || `${value.name}: ${value.message}`;
    }

    const seen = new WeakSet<object>();
    try {
        const json = JSON.stringify(value, (_key, val) => {
            if (typeof val === 'bigint') return `${val}n`;
            if (typeof val === 'symbol') return val.toString();
            if (typeof val === 'function') return `[Function ${val.name || 'anonymous'}]`;
            if (val instanceof Error) {
                return { name: val.name, message: val.message, stack: val.stack };
            }
            if (val instanceof Map) return Array.from(val.entries());
            if (val instanceof Set) return Array.from(val);
            if (val instanceof RegExp) return val.toString();
            if (typeof val === 'object' && val !== null) {
                if (seen.has(val)) return '[Circular]';
                seen.add(val);
            }
            return val;
        });
        return json === undefined ? String(value) : json;
    } catch {
        return String(value);
    }
}

/** 默认输出器：根据级别映射到对应的 console 方法 */
export const defaultLogHandler: LogHandler = (record) => {
    const consoleRef = getConsole();
    if (!consoleRef) return;

    const method = (consoleRef as any)[record.level] ?? consoleRef.log;
    if (typeof method !== 'function') return;

    const prefix: unknown[] = [];
    if (record.time) prefix.push(record.time);
    if (record.name) prefix.push(`[${record.name}]`);
    prefix.push(`[${record.level.toUpperCase()}]`);

    const payload = [...prefix, record.message];
    if (Object.keys(record.context).length > 0) payload.push(record.context);
    payload.push(...record.args);

    method.apply(consoleRef, payload);
};

/** 将一条记录格式化为单行字符串，便于写入文件或上报 */
export function formatLogRecord(record: LogRecord): string {
    const parts: string[] = [];
    if (record.time) parts.push(record.time);
    if (record.name) parts.push(`[${record.name}]`);
    parts.push(`[${record.level.toUpperCase()}]`);
    parts.push(record.message);
    if (Object.keys(record.context).length > 0) parts.push(safeStringify(record.context));
    record.args.forEach((arg) => parts.push(safeStringify(arg)));
    return parts.join(' ');
}

let reportingHandlerError = false;

function reportHandlerError(error: unknown): void {
    if (reportingHandlerError) return;
    reportingHandlerError = true;
    try {
        getConsole()?.error?.('[logger] log handler threw an error:', error);
    } finally {
        reportingHandlerError = false;
    }
}

const coreRegistry = new Set<LoggerCore>();
const namedLoggers = new Map<string, Logger>();
let globalLevel: LogLevel = 'info';

function createCore(options: LoggerOptions): LoggerCore {
    const level = options.level ?? globalLevel;
    assertLogLevel(level);

    const historySize = Math.max(0, Math.floor(options.historySize ?? 0));
    const core: LoggerCore = {
        level,
        handler: options.handler ?? defaultLogHandler,
        timestamp: options.timestamp ?? false,
        timeFormatter: options.timeFormatter ?? defaultTimeFormatter,
        historySize,
        history: [],
    };
    coreRegistry.add(core);
    return core;
}

/**
 * Logger 实例。
 *
 * 通过 `createLogger` 创建；同一实例派生的 `child` 共享级别、输出器与历史缓冲。
 */
export class Logger {
    /** 完整命名空间 */
    public readonly name: string;
    private readonly core: LoggerCore;
    private readonly context: Record<string, unknown>;

    private constructor(core: LoggerCore, name: string, context: Record<string, unknown>) {
        this.core = core;
        this.name = name;
        this.context = context;
    }

    /** 创建独立的 Logger（独立级别、输出器与历史缓冲） */
    public static create(options: LoggerOptions = {}): Logger {
        const core = createCore(options);
        return new Logger(core, options.name ?? '', { ...(options.context ?? {}) });
    }

    /**
     * 派生一个子 Logger。
     *
     * - 名称以 `:` 拼接；
     * - 上下文浅合并（同名键以子级为准）；
     * - 与父级共享级别、输出器与历史缓冲。
     */
    public child(name: string, context: Record<string, unknown> = {}): Logger {
        const childName = name ? (this.name ? `${this.name}:${name}` : name) : this.name;
        return new Logger(this.core, childName, { ...this.context, ...context });
    }

    /** 仅附加上下文，不改变名称 */
    public withContext(context: Record<string, unknown>): Logger {
        return new Logger(this.core, this.name, { ...this.context, ...context });
    }

    /** 当前最低输出级别 */
    public getLevel(): LogLevel {
        return this.core.level;
    }

    /** 设置最低输出级别（对当前实例及其所有 child 生效） */
    public setLevel(level: LogLevel): void {
        assertLogLevel(level);
        this.core.level = level;
    }

    /** 判断某个级别是否会被输出，用于避免昂贵的日志参数构造 */
    public isLevelEnabled(level: ActiveLogLevel): boolean {
        return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[this.core.level];
    }

    /** 替换输出器（对当前实例及其所有 child 生效） */
    public setHandler(handler: LogHandler): void {
        this.core.handler = handler;
    }

    public debug(message: string, ...args: unknown[]): void {
        this.write('debug', message, args);
    }

    public info(message: string, ...args: unknown[]): void {
        this.write('info', message, args);
    }

    public warn(message: string, ...args: unknown[]): void {
        this.write('warn', message, args);
    }

    public error(message: string, ...args: unknown[]): void {
        this.write('error', message, args);
    }

    /** 以动态级别输出 */
    public log(level: ActiveLogLevel, message: string, ...args: unknown[]): void {
        this.write(level, message, args);
    }

    /**
     * 条件日志：条件为假时以 error 级别输出。
     *
     * 注意与 Node 的 `console.assert` 一致，条件为真时完全静默。
     */
    public assert(condition: unknown, message: string, ...args: unknown[]): void {
        if (!condition) this.error(message, ...args);
    }

    /**
     * 开始计时，返回结束函数。
     *
     * @example
     * const end = logger.time('fetch users');
     * await fetchUsers();
     * end(); // debug: fetch users: 42ms
     */
    public time(label = 'timer'): () => number {
        const start = Date.now();
        return () => {
            const duration = Date.now() - start;
            this.debug(`${label}: ${duration}ms`);
            return duration;
        };
    }

    /** 最近的历史记录（副本） */
    public getHistory(): LogRecord[] {
        return [...this.core.history];
    }

    /** 清空历史记录 */
    public clearHistory(): void {
        this.core.history.length = 0;
    }

    private write(level: ActiveLogLevel, message: string, args: unknown[]): void {
        if (!this.isLevelEnabled(level)) return;

        const timestamp = Date.now();
        const record: LogRecord = {
            level,
            message,
            args,
            context: { ...this.context },
            name: this.name,
            timestamp,
            time: this.core.timestamp ? this.core.timeFormatter(new Date(timestamp)) : '',
        };

        if (this.core.historySize > 0) {
            this.core.history.push(record);
            if (this.core.history.length > this.core.historySize) {
                this.core.history.shift();
            }
        }

        try {
            this.core.handler(record);
        } catch (error) {
            // 日志不应中断业务流程
            reportHandlerError(error);
        }
    }
}

/** 创建独立的 Logger */
export function createLogger(options: LoggerOptions = {}): Logger {
    return Logger.create(options);
}

/**
 * 按名称获取共享实例。
 *
 * 同名多次调用返回同一个 Logger；与 `createLogger` 的区别是不重复创建。
 */
export function getLogger(name = 'app'): Logger {
    const existing = namedLoggers.get(name);
    if (existing) return existing;

    const logger = Logger.create({ name });
    namedLoggers.set(name, logger);
    return logger;
}

/** 设置全局最低级别：影响所有已创建实例与后续创建的实例 */
export function setGlobalLevel(level: LogLevel): void {
    assertLogLevel(level);
    globalLevel = level;
    coreRegistry.forEach((core) => {
        core.level = level;
    });
}

/** 当前全局最低级别 */
export function getGlobalLevel(): LogLevel {
    return globalLevel;
}

/**
 * 清空按名称缓存的实例、已注册的 core 与全局级别。
 *
 * 主要用于测试与热更新；已创建的实例仍可继续使用，但不再受全局级别控制。
 */
export function clearLoggers(): void {
    namedLoggers.clear();
    coreRegistry.clear();
    globalLevel = 'info';
}

export default Logger;
