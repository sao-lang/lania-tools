export type ValidationResult = {
    isValid: boolean;
    errors: Record<string, string>;
};

export type ValidationRuleResult = {
    message?: string;
    status: boolean;
};

export type ValidationRuleFn<T> = (value: T) => Promise<ValidationRuleResult> | ValidationRuleResult;

export interface ValidationRules<T> {
    [field: string]: ValidationRuleFn<T> | ValidationRuleFn<T>[];
}

export class Validator<T> {
    private rules: ValidationRules<T>;
    private dynamicRules: ValidationRules<T> = {};
    private errors: Record<string, string> = {};
    private cache: Map<string, ValidationResult> = new Map();

    constructor(rules: ValidationRules<T>) {
        this.rules = rules;
    }

    // Set dynamic rules
    public setDynamicRules(rules: ValidationRules<T>): void {
        this.dynamicRules = rules;
    }

    // Validate form data
    public async validate(data: Record<string, T>): Promise<ValidationResult> {
        const cacheKey = this.generateCacheKey(data);
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey)!;
        }

        const result = await this.performValidation(data);
        this.cache.set(cacheKey, result);
        return result;
    }

    // Generate a cache key based on form data
    private generateCacheKey(data: Record<string, T>): string {
        return JSON.stringify(data);
    }

    // Perform validation against all rules
    private async performValidation(data: Record<string, T>): Promise<ValidationResult> {
        this.errors = {};
        let isValid = true;

        // Combine static and dynamic rules
        const allRules = { ...this.rules, ...this.dynamicRules };

        for (const [field, fieldRules] of Object.entries(allRules)) {
            const value = data[field];
            const rules = Array.isArray(fieldRules) ? fieldRules : [fieldRules];

            for (const rule of rules) {
                const result = await this.executeRule(rule, value);
                if (!result.status) {
                    this.errors[field] = result.message || 'Validation failed';
                    isValid = false;
                    break; // Stop checking further rules for this field
                }
            }
        }

        return {
            isValid,
            errors: this.errors,
        };
    }

    // Execute a single validation rule
    private async executeRule(rule: ValidationRuleFn<T>, value: T): Promise<ValidationRuleResult> {
        try {
            const result = await Promise.resolve(rule(value));
            return typeof result === 'object' && result !== null ? result : { status: true };
        } catch (error) {
            console.error('Error executing validation rule:', error);
            return { status: false, message: 'An error occurred during validation.' };
        }
    }
}

export default Validator;