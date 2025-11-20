export type VarTypes =
    | 'number'
    | 'string'
    | 'boolean'
    | 'function'
    | 'object'
    | 'array'
    | 'date'
    | 'error'
    | 'set'
    | 'map'
    | 'weakmap'
    | 'weakset'
    | 'regexp'
    | 'symbol'
    | 'bigint'
    | 'arraybuffer'
    | 'null'
    | 'undefined';

/** 内部类型映射缓存 */
const class2type: Record<string, VarTypes> = (() => {
    const types = [
        'Boolean',
        'Null',
        'Number',
        'String',
        'Function',
        'Array',
        'Date',
        'RegExp',
        'Object',
        'Error',
        'Set',
        'Map',
        'WeakMap',
        'WeakSet',
        'ArrayBuffer',
        'Symbol',
        'BigInt',
    ] as const;

    const map: Record<string, VarTypes> = {} as Record<string, VarTypes>;
    types.forEach((t) => {
        map[`[object ${t}]`] = t.toLowerCase() as VarTypes;
    });
    return map;
})();

/**
 * @name type
 * @description 判断变量类型
 */
export const type = (obj: unknown): VarTypes => {
    if (obj === null) return 'null';
    if (obj === undefined) return 'undefined';
    const t = Object.prototype.toString.call(obj);
    return (class2type[t] as VarTypes) ?? 'object';
};

/** 基础类型判断函数 */
// eslint-disable-next-line @typescript-eslint/ban-types
export const isFunction = (obj: unknown): obj is Function =>
    type(obj) === 'function';
export const isBoolean = (obj: unknown): obj is boolean =>
    type(obj) === 'boolean';
export const isNumber = (obj: unknown): obj is number => type(obj) === 'number';
export const isString = (obj: unknown): obj is string => type(obj) === 'string';
export const isArray = Array.isArray; // 内置更快更安全

export const isObject = (obj: unknown): obj is object =>
    obj !== null && typeof obj === 'object' && !isArray(obj);

export const isEmptyObject = (obj: unknown): boolean =>
    isObject(obj) && Object.keys(obj).length === 0;

export const isArrayLike = (obj: unknown): obj is ArrayLike<unknown> => {
    if (!obj) return false;
    if (isFunction(obj) || isWindow(obj)) return false;
    const length = (obj as ArrayLike<unknown>).length;
    return (
        typeof length === 'number' && length >= 0 && Number.isInteger(length)
    );
};

export const isWindow = (obj: unknown): obj is Window =>
    obj != null && obj === (obj as Window).window;

export const isHTMLElement = (obj: unknown): obj is HTMLElement =>
    obj instanceof HTMLElement;

export const isPrimitive = (obj: unknown): boolean => {
    return (
        obj === null || (typeof obj !== 'object' && typeof obj !== 'function')
    );
};

export const isFalsy = (obj: unknown): boolean => {
    // null/undefined/false/0/NaN/'' 都认为是假值
    return (
        obj === false ||
        obj === 0 ||
        obj === '' ||
        obj == null ||
        Number.isNaN(obj as number)
    );
};
