# 类型判断

## 定位

`typeof` 无法区分数组、`null`、`Date` 等类型。本模块基于 `Object.prototype.toString` 提供统一、可读的类型判断，并带有 TypeScript 类型守卫。

```ts
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
} from '@lania-tools/tools/type';
```

## `type(obj): VarTypes`

返回精确的类型字符串。

```ts
type(123);              // 'number'
type('a');              // 'string'
type(true);             // 'boolean'
type(() => {});         // 'function'
type({});               // 'object'
type([]);               // 'array'
type(new Date());       // 'date'
type(new Error());      // 'error'
type(new Set());        // 'set'
type(new Map());        // 'map'
type(new WeakMap());    // 'weakmap'
type(new WeakSet());    // 'weakset'
type(/a/);              // 'regexp'
type(Symbol());         // 'symbol'
type(1n);               // 'bigint'
type(new ArrayBuffer(8)); // 'arraybuffer'
type(null);             // 'null'
type(undefined);        // 'undefined'
```

### 实现

```ts
const class2type = { '[object Array]': 'array', '[object Date]': 'date', ... };

function type(obj: unknown): VarTypes {
    if (obj === null) return 'null';
    if (obj === undefined) return 'undefined';
    return class2type[Object.prototype.toString.call(obj)] ?? 'object';
}
```

映射表在模块加载时一次性构建，判断时只做一次查表。

### 与 `typeof` 对比

| 值 | `typeof` | `type()` |
| --- | --- | --- |
| `[]` | `'object'` | `'array'` |
| `null` | `'object'` | `'null'` |
| `new Date()` | `'object'` | `'date'` |
| `new Map()` | `'object'` | `'map'` |
| `NaN` | `'number'` | `'number'` |
| `1n` | `'bigint'` | `'bigint'` |

未知的 `Symbol.toStringTag`（例如自定义类返回 `'MyThing'`）会回退为 `'object'`。

## 判断函数

所有函数都返回 `boolean`，并在 TypeScript 中作为类型守卫使用。

### `isFunction(obj): obj is Function`

```ts
isFunction(() => {});          // true
isFunction(async () => {});    // true
isFunction(class {});          // true
isFunction(/a/);               // false
```

### `isBoolean(obj): obj is boolean`

```ts
isBoolean(false); // true
isBoolean(new Boolean(true)); // false（包装对象）
```

### `isNumber(obj): obj is number`

```ts
isNumber(1);     // true
isNumber(NaN);   // true
isNumber('1');   // false
```

需要排除 `NaN` 时使用 `Number.isFinite`。

### `isString(obj): obj is string`

```ts
isString('');              // true
isString(new String('a')); // false（包装对象）
```

### `isArray(obj): obj is any[]`

直接复用 `Array.isArray`，性能最好。

```ts
isArray([]);         // true
isArray(new Array(3)); // true
isArray({ length: 0 }); // false
```

### `isObject(obj): obj is object`

「非 `null` 且非数组的对象」。

```ts
isObject({});            // true
isObject(new Date());    // true
isObject([]);            // false
isObject(null);          // false
isObject(function () {}); // false
```

> 注意 `isObject(new Date())` 为 `true`。需要精确判断时用 `type()`。

### `isEmptyObject(obj): boolean`

```ts
isEmptyObject({});                    // true
isEmptyObject({ a: 1 });              // false
isEmptyObject([]);                    // false（不是“对象”）
isEmptyObject(Object.create(null));   // true
isEmptyObject(null);                  // false
```

### `isArrayLike(obj): obj is ArrayLike<unknown>`

条件：非空、不是函数、不是 `window`、`length` 是非负整数。

```ts
isArrayLike([1, 2]);            // true
isArrayLike('ab');              // true
isArrayLike({ length: 0 });     // true
isArrayLike({ length: -1 });    // false
isArrayLike({ length: 1.5 });   // false
isArrayLike(function () {});    // false
isArrayLike(window);            // false
isArrayLike(null);              // false
```

### `isWindow(obj): obj is Window`

```ts
isWindow(window);          // true（浏览器）
isWindow({ window: null }); // false
```

判断方式是比较 `obj === obj.window`，因此跨 Realm 的 window 可能判断失败。

### `isHTMLElement(obj): obj is HTMLElement`

```ts
isHTMLElement(document.body);       // true
isHTMLElement(document.createElement('div')); // true
isHTMLElement(document.createTextNode('a'));  // false
isHTMLElement({});                  // false
```

非浏览器环境中 `HTMLElement` 不存在，函数返回 `false` 而不抛错。

### `isPrimitive(obj): boolean`

原始类型：`null`、`undefined`、`number`、`string`、`boolean`、`bigint`、`symbol`。

```ts
isPrimitive(null);       // true
isPrimitive(1);          // true
isPrimitive('a');        // true
isPrimitive(Symbol());   // true
isPrimitive({});         // false
isPrimitive(() => {});   // false
```

### `isFalsy(obj): boolean`

显式判断六种假值：`false`、`0`、`''`、`null`、`undefined`、`NaN`。

```ts
isFalsy(false);      // true
isFalsy(0);          // true
isFalsy('');         // true
isFalsy(null);       // true
isFalsy(undefined);  // true
isFalsy(NaN);        // true

isFalsy([]);         // false
isFalsy({});         // false
isFalsy('0');        // false
isFalsy('false');    // false
```

与 `!value` 的区别在于「语义显式」：阅读代码时能立刻看出判断的是哪几种情况。

## 组合示例：安全的数据归一化

```ts
import { type, isArrayLike, isPrimitive } from '@lania-tools/tools/type';

function normalize(input: unknown): string[] {
    if (input == null) return [];

    switch (type(input)) {
        case 'array':
            return (input as unknown[]).map(String);
        case 'string':
            return input === '' ? [] : [input as string];
        case 'set':
            return Array.from(input as Set<unknown>, String);
        default:
            if (isPrimitive(input)) return [String(input)];
            if (isArrayLike(input)) return Array.from(input as ArrayLike<unknown>, String);
            return [String(input)];
    }
}
```

## 注意事项

| 问题 | 说明 |
| --- | --- |
| 跨 iframe | `isHTMLElement` / `isWindow` 依赖同一 Realm 的构造器 |
| 包装对象 | `new String/Number/Boolean` 不会被判为原始类型 |
| `NaN` | `isNumber(NaN)` 为 `true`，需要额外排除 |
| `Symbol.toStringTag` | 自定义标签会回退为 `'object'` |
| 性能 | `type()` 有一次 `toString` 调用与查表，比 `typeof` 慢，但比字符串比较快得多 |

## 测试覆盖

`packages/tools/tests/type.test.ts`（49 个用例）覆盖全部函数与边界：包装对象的否定、`isArrayLike` 的负数 / 非整数 / 函数、`isFalsy(NaN)`、`isEmptyObject` 非对象、未知 `Symbol.toStringTag` 回退。
