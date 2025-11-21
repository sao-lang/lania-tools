/**
 * @file Validator.ts
 * @description 通用数据/表单验证库，支持同步/异步规则、动态规则、跨字段验证、缓存机制
 */

/** 验证结果 */
export type ValidationResult = {
    /** 整体是否通过验证 */
    isValid: boolean;
    /** 每个字段的错误信息 */
    errors: Record<string, string>;
};

/** 单条验证规则返回值 */
export type ValidationRuleResult = {
    /** 失败提示信息，可选 */
    message?: string;
    /** 验证是否通过 */
    status: boolean;
};

/**
 * 验证规则函数类型
 * @template T 字段值类型
 * @param value 当前字段值
 * @param allValues 当前整个数据对象（可用于跨字段验证）
 * @returns 验证结果，可返回同步对象或 Promise 对象
 */
export type ValidationRuleFn<T = any> = (
    value: T,
    allValues?: Record<string, T>,
) => Promise<ValidationRuleResult> | ValidationRuleResult;

/** 验证规则集合，每个字段可对应单个或多个规则函数 */
export interface ValidationRules<T = any> {
    [field: string]: ValidationRuleFn<T> | ValidationRuleFn<T>[];
}

/**
 * @description 通用内置验证规则
 */
export const Rules = {
    /** 必填字段 */
    required:
        (message = 'This field is required'): ValidationRuleFn =>
        (value) => ({
            status: value !== null && value !== undefined && value !== '',
            message,
        }),

    /** 最小长度 */
    minLength:
        (min: number, message?: string): ValidationRuleFn =>
        (value) => ({
            status: typeof value === 'string' ? value.length >= min : false,
            message: message || `Length must be at least ${min}`,
        }),

    /** 最大长度 */
    maxLength:
        (max: number, message?: string): ValidationRuleFn =>
        (value) => ({
            status: typeof value === 'string' ? value.length <= max : false,
            message: message || `Length must be at most ${max}`,
        }),

    /** 正则校验 */
    pattern:
        (regex: RegExp, message?: string): ValidationRuleFn =>
        (value) => ({
            status: typeof value === 'string' ? regex.test(value) : false,
            message: message || 'Invalid format',
        }),

    /** 邮箱 */
    email:
        (message = 'Invalid email'): ValidationRuleFn =>
        (value) => ({
            status: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
            message,
        }),

    /** 手机号（中国手机号示例，可自定义） */
    phone:
        (message = 'Invalid phone number'): ValidationRuleFn =>
        (value) => ({
            status: /^(\+\d{1,3}[- ]?)?\d{10}$/.test(value),
            message,
        }),

    /** 数字范围 */
    range:
        (min: number, max: number, message?: string): ValidationRuleFn =>
        (value) => ({
            status: typeof value === 'number' && value >= min && value <= max,
            message: message || `Value must be between ${min} and ${max}`,
        }),

    /** 整数 */
    integer:
        (message = 'Value must be an integer'): ValidationRuleFn =>
        (value) => ({
            status: typeof value === 'number' && Number.isInteger(value),
            message,
        }),

    /** 跨字段值匹配 */
    matchField:
        (otherField: string, message?: string): ValidationRuleFn =>
        (value, allValues) => ({
            status: value === allValues?.[otherField],
            message: message || `Must match ${otherField}`,
        }),

    /** 最大值 */
    max:
        (max: number, message?: string): ValidationRuleFn =>
        (value) => ({
            status: typeof value === 'number' ? value <= max : false,
            message: message || `Value must be less than or equal to ${max}`,
        }),

    /** 最小值 */
    min:
        (min: number, message?: string): ValidationRuleFn =>
        (value) => ({
            status: typeof value === 'number' ? value >= min : false,
            message: message || `Value must be greater than or equal to ${min}`,
        }),

    /** 自定义回调验证 */
    custom:
        (
            fn: (value: any, allValues?: Record<string, any>) => boolean,
            message?: string,
        ): ValidationRuleFn =>
        (value, allValues) => ({
            status: fn(value, allValues),
            message: message || 'Validation failed',
        }),

    /** URL 格式 */
    url:
        (message = 'Invalid URL'): ValidationRuleFn =>
        (value) => ({
            status: typeof value === 'string' && /^https?:\/\/[^\s]+$/.test(value),
            message,
        }),

    /** 日期格式 */
    date:
        (message = 'Invalid date'): ValidationRuleFn =>
        (value) => ({
            status: !isNaN(new Date(value as any).getTime()),
            message,
        }),
};

/**
 * 通用验证器类
 * @template T 字段值类型
 */
export class Validator<T = any> {
    private rules: ValidationRules<T>;
    private dynamicRules: ValidationRules<T> = {};
    private errors: Record<string, string> = {};
    private cache: Map<string, ValidationResult> = new Map();

    /**
     * @param rules 初始化验证规则
     */
    constructor(rules: ValidationRules<T>) {
        this.rules = rules;
    }

    /**
     * 设置动态规则，可在运行时改变规则
     * @param rules 动态验证规则
     */
    public setDynamicRules(rules: ValidationRules<T>): void {
        this.dynamicRules = rules;
    }

    /**
     * 对数据进行验证
     * @param data 待验证对象
     * @returns 验证结果，包括整体是否通过及每个字段错误信息
     */
    public async validate(data: Record<string, T>): Promise<ValidationResult> {
        const cacheKey = this.generateCacheKey(data);
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey)!;
        }

        const result = await this.performValidation(data);
        this.cache.set(cacheKey, result);
        return result;
    }

    /**
     * 获取最后一次验证的错误信息
     */
    public getErrors(): Record<string, string> {
        return { ...this.errors };
    }

    /**
     * 清除缓存和错误信息
     */
    public clearCache(): void {
        this.cache.clear();
        this.errors = {};
    }

    /** 生成缓存 key */
    private generateCacheKey(data: Record<string, T>): string {
        return JSON.stringify(data);
    }

    /** 执行实际验证逻辑 */
    private async performValidation(data: Record<string, T>): Promise<ValidationResult> {
        this.errors = {};
        let isValid = true;

        const allRules: ValidationRules<T> = { ...this.rules, ...this.dynamicRules };

        for (const [field, fieldRules] of Object.entries(allRules)) {
            const value = data[field];
            const rules = Array.isArray(fieldRules) ? fieldRules : [fieldRules];

            for (const rule of rules) {
                const result = await this.executeRule(rule, value, data);
                if (!result.status) {
                    this.errors[field] = result.message || 'Validation failed';
                    isValid = false;
                    break; // 遇到失败即跳过该字段剩余规则
                }
            }
        }

        return { isValid, errors: this.errors };
    }

    /** 执行单条验证规则 */
    private async executeRule(
        rule: ValidationRuleFn<T>,
        value: T,
        allValues: Record<string, T>,
    ): Promise<ValidationRuleResult> {
        try {
            const result = await Promise.resolve(rule(value, allValues));
            return typeof result === 'object' && result !== null ? result : { status: true };
        } catch (error) {
            console.error('Error executing validation rule:', error);
            return { status: false, message: 'An error occurred during validation.' };
        }
    }
}

export default Validator;
