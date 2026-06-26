import { describe, it, expect } from 'vitest';
import {
    type,
    isFunction,
    isBoolean,
    isNumber,
    isString,
    isArray,
    isObject,
    isEmptyObject,
    isArrayLike,
    isWindow,
    isHTMLElement,
    isPrimitive,
    isFalsy,
} from '../src/type';

describe('type', () => {
    it('should return "number" for numbers', () => {
        expect(type(42)).toBe('number');
        expect(type(NaN)).toBe('number');
        expect(type(Infinity)).toBe('number');
    });

    it('should return "string" for strings', () => {
        expect(type('hello')).toBe('string');
        expect(type('')).toBe('string');
    });

    it('should return "boolean" for booleans', () => {
        expect(type(true)).toBe('boolean');
        expect(type(false)).toBe('boolean');
    });

    it('should return "function" for functions', () => {
        expect(type(() => {})).toBe('function');
        expect(type(function () {})).toBe('function');
    });

    it('should return "object" for plain objects', () => {
        expect(type({})).toBe('object');
        expect(type({ a: 1 })).toBe('object');
    });

    it('should return "array" for arrays', () => {
        expect(type([])).toBe('array');
        expect(type([1, 2, 3])).toBe('array');
    });

    it('should return "date" for Date objects', () => {
        expect(type(new Date())).toBe('date');
    });

    it('should return "error" for Error objects', () => {
        expect(type(new Error())).toBe('error');
        expect(type(new TypeError())).toBe('error');
    });

    it('should return "set" for Set objects', () => {
        expect(type(new Set())).toBe('set');
    });

    it('should return "map" for Map objects', () => {
        expect(type(new Map())).toBe('map');
    });

    it('should return "weakmap" for WeakMap objects', () => {
        expect(type(new WeakMap())).toBe('weakmap');
    });

    it('should return "weakset" for WeakSet objects', () => {
        expect(type(new WeakSet())).toBe('weakset');
    });

    it('should return "regexp" for RegExp objects', () => {
        expect(type(/abc/)).toBe('regexp');
        expect(type(new RegExp('abc'))).toBe('regexp');
    });

    it('should return "symbol" for symbols', () => {
        expect(type(Symbol('test'))).toBe('symbol');
    });

    it('should return "bigint" for bigints', () => {
        expect(type(BigInt(123))).toBe('bigint');
    });

    it('should return "arraybuffer" for ArrayBuffer', () => {
        expect(type(new ArrayBuffer(8))).toBe('arraybuffer');
    });

    it('should return "null" for null', () => {
        expect(type(null)).toBe('null');
    });

    it('should return "undefined" for undefined', () => {
        expect(type(undefined)).toBe('undefined');
    });
});

describe('isFunction', () => {
    it('should return true for functions', () => {
        expect(isFunction(() => {})).toBe(true);
    });
    it('should return false for non-functions', () => {
        expect(isFunction(123)).toBe(false);
        expect(isFunction('str')).toBe(false);
        expect(isFunction({})).toBe(false);
    });
});

describe('isBoolean', () => {
    it('should return true for booleans', () => {
        expect(isBoolean(true)).toBe(true);
        expect(isBoolean(false)).toBe(true);
    });
    it('should return false for non-booleans', () => {
        expect(isBoolean(1)).toBe(false);
        expect(isBoolean('true')).toBe(false);
    });
});

describe('isNumber', () => {
    it('should return true for numbers', () => {
        expect(isNumber(42)).toBe(true);
        expect(isNumber(NaN)).toBe(true);
    });
    it('should return false for non-numbers', () => {
        expect(isNumber('42')).toBe(false);
    });
});

describe('isString', () => {
    it('should return true for strings', () => {
        expect(isString('hello')).toBe(true);
        expect(isString('')).toBe(true);
    });
    it('should return false for non-strings', () => {
        expect(isString(123)).toBe(false);
    });
});

describe('isArray', () => {
    it('should return true for arrays', () => {
        expect(isArray([])).toBe(true);
        expect(isArray([1, 2, 3])).toBe(true);
    });
    it('should return false for non-arrays', () => {
        expect(isArray({})).toBe(false);
        expect(isArray('str')).toBe(false);
    });
});

describe('isObject', () => {
    it('should return true for plain objects', () => {
        expect(isObject({})).toBe(true);
        expect(isObject({ a: 1 })).toBe(true);
    });
    it('should return false for arrays', () => {
        expect(isObject([])).toBe(false);
    });
    it('should return false for null', () => {
        expect(isObject(null)).toBe(false);
    });
    it('should return false for primitives', () => {
        expect(isObject(123)).toBe(false);
        expect(isObject('str')).toBe(false);
    });
});

describe('isEmptyObject', () => {
    it('should return true for empty objects', () => {
        expect(isEmptyObject({})).toBe(true);
    });
    it('should return false for non-empty objects', () => {
        expect(isEmptyObject({ a: 1 })).toBe(false);
    });
    it('should return false for non-objects', () => {
        expect(isEmptyObject([])).toBe(false);
        expect(isEmptyObject(null)).toBe(false);
        expect(isEmptyObject('str')).toBe(false);
    });
});

describe('isArrayLike', () => {
    it('should return true for arrays', () => {
        expect(isArrayLike([1, 2, 3])).toBe(true);
    });
    it('should return true for array-like objects', () => {
        expect(isArrayLike({ length: 3, 0: 'a', 1: 'b', 2: 'c' })).toBe(true);
    });
    it('should return true for strings', () => {
        expect(isArrayLike('hello')).toBe(true);
    });
    it('should return false for functions', () => {
        expect(isArrayLike(() => {})).toBe(false);
    });
    it('should return false for null/undefined', () => {
        expect(isArrayLike(null)).toBe(false);
        expect(isArrayLike(undefined)).toBe(false);
    });
    it('should return false for objects without length', () => {
        expect(isArrayLike({ a: 1 })).toBe(false);
    });
});

describe('isWindow', () => {
    it('should return true for window object', () => {
        expect(isWindow(window)).toBe(true);
    });
    it('should return false for non-window objects', () => {
        expect(isWindow({})).toBe(false);
        expect(isWindow(null)).toBe(false);
        expect(isWindow(undefined)).toBe(false);
    });
});

describe('isHTMLElement', () => {
    it('should return true for HTMLElement', () => {
        const div = document.createElement('div');
        expect(isHTMLElement(div)).toBe(true);
    });
    it('should return false for non-elements', () => {
        expect(isHTMLElement({})).toBe(false);
        expect(isHTMLElement('str')).toBe(false);
    });
});

describe('isPrimitive', () => {
    it('should return true for primitives', () => {
        expect(isPrimitive(null)).toBe(true);
        expect(isPrimitive(undefined)).toBe(true);
        expect(isPrimitive(42)).toBe(true);
        expect(isPrimitive('str')).toBe(true);
        expect(isPrimitive(true)).toBe(true);
        expect(isPrimitive(Symbol('test'))).toBe(true);
        expect(isPrimitive(BigInt(123))).toBe(true);
    });
    it('should return false for objects and functions', () => {
        expect(isPrimitive({})).toBe(false);
        expect(isPrimitive([])).toBe(false);
        expect(isPrimitive(() => {})).toBe(false);
    });
});

describe('isFalsy', () => {
    it('should return true for falsy values', () => {
        expect(isFalsy(false)).toBe(true);
        expect(isFalsy(0)).toBe(true);
        expect(isFalsy('')).toBe(true);
        expect(isFalsy(null)).toBe(true);
        expect(isFalsy(undefined)).toBe(true);
        expect(isFalsy(NaN)).toBe(true);
    });
    it('should return false for truthy values', () => {
        expect(isFalsy(true)).toBe(false);
        expect(isFalsy(1)).toBe(false);
        expect(isFalsy('hello')).toBe(false);
        expect(isFalsy({})).toBe(false);
        expect(isFalsy([])).toBe(false);
    });
});