/**
 * @file type-utils.ts
 * @description 通用类型判断工具函数集合，提供更安全、统一的变量类型判断方式。
 */

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

/**
 * @description 维护一份内部映射表，用于加速 Object.prototype.toString 的类型识别。
 * 例如：[object Date] → "date"
 */
const class2type: Record<string, VarTypes> = (() => {
    // 使用 const tuple 保证严格类型推导
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
 * @description 获取任意变量的具体类型（比 typeof 更准确）
 * 
 * @example
 * type(123)              // "number"
 * type([])               // "array"
 * type(null)             // "null"
 * type(new Map())        // "map"
 */
export const type = (obj: unknown): VarTypes => {
    if (obj === null) return 'null';
    if (obj === undefined) return 'undefined';

    const typeString = Object.prototype.toString.call(obj);
    return class2type[typeString] ?? 'object'; // 兜底处理
};

/** ---------------------- 基础类型判断函数 ---------------------- */

/**
 * @description 是否为函数
 */
// eslint-disable-next-line @typescript-eslint/ban-types
export const isFunction = (obj: unknown): obj is Function =>
    type(obj) === 'function';

/**
 * @description 是否为布尔值
 */
export const isBoolean = (obj: unknown): obj is boolean =>
    type(obj) === 'boolean';

/**
 * @description 是否为数字
 */
export const isNumber = (obj: unknown): obj is number =>
    type(obj) === 'number';

/**
 * @description 是否为字符串
 */
export const isString = (obj: unknown): obj is string =>
    type(obj) === 'string';

/**
 * @description 是否为数组（使用内置 Array.isArray 更快）
 */
export const isArray = Array.isArray;

/**
 * @description 是否为普通对象（非 null，且不是数组）
 */
export const isObject = (obj: unknown): obj is object =>
    obj !== null && typeof obj === 'object' && !isArray(obj);

/**
 * @description 是否为空对象 {}
 */
export const isEmptyObject = (obj: unknown): boolean =>
    isObject(obj) && Object.keys(obj).length === 0;

/**
 * @description 判断是否为类数组对象
 * 具有 length 属性 且 length >= 0
 */
export const isArrayLike = (obj: unknown): obj is ArrayLike<unknown> => {
    if (!obj) return false;
    if (isFunction(obj) || isWindow(obj)) return false;

    const length = (obj as ArrayLike<unknown>).length;
    return typeof length === 'number' && length >= 0 && Number.isInteger(length);
};

/**
 * @description 判断是否为浏览器 window 对象
 */
export const isWindow = (obj: unknown): obj is Window =>
    obj != null && obj === (obj as Window).window;

/**
 * @description 是否为 HTMLElement 节点
 */
export const isHTMLElement = (obj: unknown): obj is HTMLElement =>
    typeof HTMLElement !== 'undefined' && obj instanceof HTMLElement;

/**
 * @description 判断是否为原始类型（primitive value）
 * 包括：null、undefined、number、string、boolean、bigint、symbol
 */
export const isPrimitive = (obj: unknown): boolean => {
    return (
        obj === null || (typeof obj !== 'object' && typeof obj !== 'function')
    );
};

/**
 * @description 是否是假值
 * 包括：false、0、''、null、undefined、NaN
 */
export const isFalsy = (obj: unknown): boolean => {
    return (
        obj === false ||
        obj === 0 ||
        obj === '' ||
        obj == null || // null 或 undefined
        Number.isNaN(obj as number)
    );
};
