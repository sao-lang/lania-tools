import { describe, it, expect } from 'vitest';
import { Rules, Validator } from '../src/validator';

describe('Rules', () => {
    describe('required', () => {
        it('should pass for non-empty values', () => {
            const rule = Rules.required();
            expect(rule('hello').status).toBe(true);
            expect(rule(0).status).toBe(true);
            expect(rule(false).status).toBe(true);
            expect(rule({}).status).toBe(true);
        });
        it('should fail for empty values', () => {
            const rule = Rules.required();
            expect(rule('').status).toBe(false);
            expect(rule(null).status).toBe(false);
            expect(rule(undefined).status).toBe(false);
        });
        it('should use custom message', () => {
            const rule = Rules.required('必填');
            expect(rule('').message).toBe('必填');
        });
    });

    describe('minLength', () => {
        it('should pass when string length >= min', () => {
            const rule = Rules.minLength(3);
            expect(rule('abc').status).toBe(true);
            expect(rule('abcd').status).toBe(true);
        });
        it('should fail when string length < min', () => {
            const rule = Rules.minLength(3);
            expect(rule('ab').status).toBe(false);
        });
        it('should fail for non-string values', () => {
            const rule = Rules.minLength(3);
            expect(rule(123).status).toBe(false);
        });
        it('should use custom message', () => {
            const rule = Rules.minLength(3, '太短了');
            expect(rule('a').message).toBe('太短了');
        });
    });

    describe('maxLength', () => {
        it('should pass when string length <= max', () => {
            const rule = Rules.maxLength(5);
            expect(rule('abc').status).toBe(true);
            expect(rule('abcde').status).toBe(true);
        });
        it('should fail when string length > max', () => {
            const rule = Rules.maxLength(5);
            expect(rule('abcdef').status).toBe(false);
        });
        it('should use custom message', () => {
            const rule = Rules.maxLength(5, '太长了');
            expect(rule('abcdef').message).toBe('太长了');
        });
    });

    describe('pattern', () => {
        it('should pass when regex matches', () => {
            const rule = Rules.pattern(/^\d+$/);
            expect(rule('12345').status).toBe(true);
        });
        it('should fail when regex does not match', () => {
            const rule = Rules.pattern(/^\d+$/);
            expect(rule('abc').status).toBe(false);
        });
        it('should fail for non-string values', () => {
            const rule = Rules.pattern(/^\d+$/);
            expect(rule(123).status).toBe(false);
        });
    });

    describe('email', () => {
        it('should pass for valid emails', () => {
            const rule = Rules.email();
            expect(rule('test@example.com').status).toBe(true);
            expect(rule('a@b.co').status).toBe(true);
        });
        it('should fail for invalid emails', () => {
            const rule = Rules.email();
            expect(rule('notanemail').status).toBe(false);
            expect(rule('@example.com').status).toBe(false);
            expect(rule('test@').status).toBe(false);
        });
    });

    describe('phone', () => {
        it('should pass for valid phone numbers', () => {
            const rule = Rules.phone();
            expect(rule('1234567890').status).toBe(true);
            expect(rule('+861234567890').status).toBe(true);
        });
        it('should fail for invalid phone numbers', () => {
            const rule = Rules.phone();
            expect(rule('123').status).toBe(false);
            expect(rule('abcdefghij').status).toBe(false);
        });
    });

    describe('range', () => {
        it('should pass when value is within range', () => {
            const rule = Rules.range(1, 10);
            expect(rule(5).status).toBe(true);
            expect(rule(1).status).toBe(true);
            expect(rule(10).status).toBe(true);
        });
        it('should fail when value is outside range', () => {
            const rule = Rules.range(1, 10);
            expect(rule(0).status).toBe(false);
            expect(rule(11).status).toBe(false);
        });
        it('should fail for non-number values', () => {
            const rule = Rules.range(1, 10);
            expect(rule('5').status).toBe(false);
        });
    });

    describe('integer', () => {
        it('should pass for integers', () => {
            const rule = Rules.integer();
            expect(rule(5).status).toBe(true);
            expect(rule(0).status).toBe(true);
            expect(rule(-3).status).toBe(true);
        });
        it('should fail for non-integers', () => {
            const rule = Rules.integer();
            expect(rule(5.5).status).toBe(false);
            expect(rule('5').status).toBe(false);
        });
    });

    describe('matchField', () => {
        it('should pass when fields match', () => {
            const rule = Rules.matchField('password');
            expect(rule('abc123', { password: 'abc123' }).status).toBe(true);
        });
        it('should fail when fields do not match', () => {
            const rule = Rules.matchField('password');
            expect(rule('abc123', { password: 'xyz' }).status).toBe(false);
        });
    });

    describe('max', () => {
        it('should pass when value <= max', () => {
            const rule = Rules.max(10);
            expect(rule(10).status).toBe(true);
            expect(rule(5).status).toBe(true);
        });
        it('should fail when value > max', () => {
            const rule = Rules.max(10);
            expect(rule(11).status).toBe(false);
        });
    });

    describe('min', () => {
        it('should pass when value >= min', () => {
            const rule = Rules.min(5);
            expect(rule(5).status).toBe(true);
            expect(rule(10).status).toBe(true);
        });
        it('should fail when value < min', () => {
            const rule = Rules.min(5);
            expect(rule(4).status).toBe(false);
        });
    });

    describe('custom', () => {
        it('should pass when custom function returns true', () => {
            const rule = Rules.custom((v) => v > 0);
            expect(rule(5).status).toBe(true);
        });
        it('should fail when custom function returns false', () => {
            const rule = Rules.custom((v) => v > 0);
            expect(rule(-1).status).toBe(false);
        });
        it('should pass allValues to custom function', () => {
            const rule = Rules.custom((v, all) => v === all?.other);
            expect(rule(5, { other: 5 }).status).toBe(true);
            expect(rule(5, { other: 3 }).status).toBe(false);
        });
    });

    describe('url', () => {
        it('should pass for valid URLs', () => {
            const rule = Rules.url();
            expect(rule('https://example.com').status).toBe(true);
            expect(rule('http://example.com/path').status).toBe(true);
        });
        it('should fail for invalid URLs', () => {
            const rule = Rules.url();
            expect(rule('not a url').status).toBe(false);
            expect(rule('ftp://example.com').status).toBe(false);
        });
    });

    describe('date', () => {
        it('should pass for valid date strings', () => {
            const rule = Rules.date();
            expect(rule('2024-01-01').status).toBe(true);
            expect(rule('2024/01/01').status).toBe(true);
        });
        it('should fail for invalid date strings', () => {
            const rule = Rules.date();
            expect(rule('not a date').status).toBe(false);
        });
        it('should pass for Date objects', () => {
            const rule = Rules.date();
            expect(rule(new Date()).status).toBe(true);
        });
    });
});

describe('Validator', () => {
    it('should validate a single field with a single rule', async () => {
        const validator = new Validator({
            name: Rules.required(),
        });
        const result = await validator.validate({ name: 'John' });
        expect(result.isValid).toBe(true);
        expect(result.errors).toEqual({});
    });

    it('should return error for invalid field', async () => {
        const validator = new Validator({
            name: Rules.required(),
        });
        const result = await validator.validate({ name: '' });
        expect(result.isValid).toBe(false);
        expect(result.errors.name).toBeDefined();
    });

    it('should validate multiple fields', async () => {
        const validator = new Validator({
            name: Rules.required(),
            age: Rules.range(1, 120),
        });
        const result = await validator.validate({ name: 'John', age: 30 });
        expect(result.isValid).toBe(true);
    });

    it('should validate multiple rules per field', async () => {
        const validator = new Validator({
            username: [Rules.required(), Rules.minLength(3), Rules.maxLength(20)],
        });
        const result1 = await validator.validate({ username: 'ab' });
        expect(result1.isValid).toBe(false);

        const result2 = await validator.validate({ username: 'validUser' });
        expect(result2.isValid).toBe(true);
    });

    it('should support async rules', async () => {
        const asyncRule = () => async (value: string) => {
            await new Promise((r) => setTimeout(r, 10));
            return { status: value === 'valid', message: 'Invalid async value' };
        };
        const validator = new Validator({
            field: asyncRule,
        });
        const result = await validator.validate({ field: 'valid' });
        expect(result.isValid).toBe(true);
    });

    it('should support dynamic rules', async () => {
        const validator = new Validator({
            name: Rules.required(),
        });
        validator.setDynamicRules({ name: Rules.minLength(10) });
        const result = await validator.validate({ name: 'short' });
        expect(result.isValid).toBe(false);
    });

    it('should cache validation results', async () => {
        const validator = new Validator({
            name: Rules.required(),
        });
        const result1 = await validator.validate({ name: 'John' });
        const result2 = await validator.validate({ name: 'John' });
        expect(result1).toEqual(result2);
    });

    it('should clear cache', async () => {
        const validator = new Validator({
            name: Rules.required(),
        });
        await validator.validate({ name: 'John' });
        validator.clearCache();
        const errors = validator.getErrors();
        expect(errors).toEqual({});
    });

    it('should return errors from getErrors', async () => {
        const validator = new Validator({
            name: Rules.required(),
        });
        await validator.validate({ name: '' });
        const errors = validator.getErrors();
        expect(errors.name).toBeDefined();
    });

    it('should stop at first failing rule per field', async () => {
        let secondRuleCalled = false;
        const firstRule = Rules.required();
        const secondRule = () => () => {
            secondRuleCalled = true;
            return { status: true };
        };
        const validator = new Validator({
            field: [firstRule, secondRule],
        });
        await validator.validate({ field: '' });
        expect(secondRuleCalled).toBe(false);
    });

    it('should handle cross-field validation', async () => {
        const validator = new Validator({
            password: Rules.required(),
            confirmPassword: Rules.matchField('password'),
        });
        const result = await validator.validate({
            password: 'secret',
            confirmPassword: 'secret',
        });
        expect(result.isValid).toBe(true);

        const result2 = await validator.validate({
            password: 'secret',
            confirmPassword: 'different',
        });
        expect(result2.isValid).toBe(false);
    });

    it('should handle rule execution errors gracefully', async () => {
        const errorRule = () => {
            throw new Error('Rule error');
        };
        const validator = new Validator({
            field: errorRule,
        });
        const result = await validator.validate({ field: 'test' });
        expect(result.isValid).toBe(false);
    });
});