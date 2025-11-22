type Fn = (...args: any) => any;
// eslint-disable-next-line @typescript-eslint/ban-types
type FnArgsType<F extends Function> = F extends (...args: infer A) => any ? A : never;
type FnReturnType<K extends Fn> = (...args: FnArgsType<K>) => ReturnType<K>;

/**
 * @name debounce
 * @description 防抖函数
 * @param {(...args: any[]) => unknown} fn 回调函数
 * @param {number} wait 间隔时间
 * @param {boolean} immediate 是否立即执行
 */
export const debounce = <T extends Fn>(
    fn: T,
    wait?: number,
    immediate?: boolean,
): FnReturnType<T> & { cancel: () => void } => {
    // eslint-disable-next-line no-undef
    let timeout: NodeJS.Timeout | null;
    let result: ReturnType<T>;
    function debounced(this: unknown, ...args: FnArgsType<T>) {
        if (timeout) {
            clearTimeout(timeout);
        }
        if (immediate) {
            const callNow = !timeout;
            timeout = setTimeout(() => {
                timeout = null;
            }, wait || 1000);
            if (callNow) {
                result = fn.apply(this, args);
            }
        } else {
            timeout = setTimeout(() => {
                result = fn.apply(this, args);
            }, wait || 1000);
        }
        return result;
    }
    debounced.cancel = function () {
        if (timeout) {
            clearTimeout(timeout);
        }
    };
    return debounced;
};

type ThrottleOptions = { leading?: boolean; trailing?: boolean };
/**
 * @name throttle
 * @description 节流函数
 * @param {(...args: unknown[]) => unknown} fn 回调函数
 * @param {number} wait 间隔时间
 * @param {ThrottleOptions} options leading  开始就执行 trailing 最后也执行，两者相斥
 */
export const throttle = <T extends Fn>(
    func: T,
    wait = 1000,
    options?: ThrottleOptions,
): FnReturnType<T> & { cancel: () => void } => {
    // eslint-disable-next-line no-undef
    let timeout: NodeJS.Timeout | null = null;
    let previous = 0;
    let result: ReturnType<T>;
    if (!options) {
        options = {};
    }
    function throttled(this: unknown, ...args: FnArgsType<T>) {
        const now: number = new Date().getTime();
        if (!previous && options?.leading === false) {
            previous = now;
        }
        const remaining: number = wait - (now - previous);
        if (remaining <= 0 || remaining > wait) {
            if (timeout) {
                clearTimeout(timeout);
                timeout = null;
            }
            previous = now;
            result = func.apply(this, args);
        } else if (!timeout && options?.trailing !== false) {
            timeout = setTimeout(() => {
                previous = options?.leading === false ? 0 : Date.now();
                timeout = null;
                result = func.apply(this, args);
            }, remaining);
        }
        return result;
    }
    throttled.cancel = function () {
        if (timeout) {
            clearTimeout(timeout);
        }
        previous = 0;
    };
    return throttled;
};

/**
 * 健壮的深拷贝函数，支持常见类型（Date, RegExp, Map, Set）和循环引用。
 *
 * @param obj - 要克隆的对象
 * @param cache - 用于跟踪循环引用的 WeakMap
 * @returns 对象的深拷贝副本
 */
export const deepClone = <T>(obj: T, cache = new WeakMap()): T => {
    // 1. 基本类型和 null/undefined
    if (typeof obj !== 'object' || obj === null) {
        return obj;
    }

    // 2. 处理已缓存的循环引用
    if (cache.has(obj)) {
        return cache.get(obj);
    }

    // 3. 处理特殊对象类型
    if (obj instanceof Date) {
        return new Date(obj.getTime()) as T;
    }
    if (obj instanceof RegExp) {
        // 创建新的 RegExp，并保持 flags
        return new RegExp(obj.source, obj.flags) as T;
    }
    if (obj instanceof Map) {
        // 创建新的 Map，并递归克隆键值对
        const clonedMap = new Map();
        cache.set(obj, clonedMap); // 缓存
        obj.forEach((value, key) => {
            clonedMap.set(deepClone(key, cache), deepClone(value, cache));
        });
        return clonedMap as T;
    }
    if (obj instanceof Set) {
        // 创建新的 Set，并递归克隆元素
        const clonedSet = new Set();
        cache.set(obj, clonedSet); // 缓存
        obj.forEach((value) => {
            clonedSet.add(deepClone(value, cache));
        });
        return clonedSet as T;
    }

    // 4. 处理数组或普通对象
    const clone: any = Array.isArray(obj) ? [] : {};

    // 5. 缓存克隆对象，以处理后续的循环引用
    cache.set(obj, clone);

    // 6. 递归克隆属性/元素
    for (const key in obj) {
        // 确保只克隆对象自身的属性，而不是继承的属性
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            clone[key] = deepClone(obj[key], cache);
        }
    }

    return clone as T;
};

/**
 * 健壮的深度比较函数，支持常见类型（Date, RegExp, Map, Set）和循环引用。
 *
 * @param a - 第一个对象
 * @param b - 第二个对象
 * @param cacheA - 跟踪对象 a 的 WeakMap
 * @param cacheB - 跟踪对象 b 的 WeakMap
 * @returns 两个对象的值是否深度相等
 */
export const isDeepEqual = <T>(
    a: T,
    b: T,
    cacheA = new WeakMap(),
    cacheB = new WeakMap(),
): boolean => {
    // 1. 基本类型和简单情况
    if (a === b) return true;

    // 特殊情况： NaN !== NaN，所以需要特别处理
    if (Number.isNaN(a) && Number.isNaN(b)) return true;

    // 2. 检查类型（如果类型不同，则不相等）
    if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
        return false;
    }

    // 3. 检查对象构造函数（例如，Date 不能等于 Array）
    if (a.constructor !== b.constructor) {
        return false;
    }

    // 4. 处理循环引用
    if (cacheA.has(a) || cacheB.has(b)) {
        // 如果两个对象都已经被缓存，并且是来自同一次递归（即是循环引用），则视为相等
        return cacheA.get(a) === b && cacheB.get(b) === a;
    }

    // 5. 缓存当前对象，防止后续的循环引用导致无限递归
    cacheA.set(a, b);
    cacheB.set(b, a);

    // 6. 处理特殊对象类型
    if (a instanceof Date) {
        return a.getTime() === (b as unknown as Date).getTime();
    }
    if (a instanceof RegExp) {
        const bRegExp = b as unknown as RegExp;
        return a.source === bRegExp.source && a.flags === bRegExp.flags;
    }

    // 7. 处理 Map 类型
    if (a instanceof Map) {
        const bMap = b as unknown as Map<any, any>;
        if (a.size !== bMap.size) return false;

        let isEqual = true;
        // 必须比较 Map 元素的键和值
        a.forEach((valA, keyA) => {
            const valB = bMap.get(keyA);

            // 简单比较无法判断 Map 中 key 是否相同，需要深度比较键和值
            if (!isDeepEqual(valA, valB, cacheA, cacheB) || !bMap.has(keyA)) {
                isEqual = false;
            }
        });
        return isEqual;
    }

    // 8. 处理 Set 类型
    if (a instanceof Set) {
        const bSet = b as unknown as Set<any>;
        if (a.size !== bSet.size) return false;

        // Set 比较复杂：需要确保 Set A 中的每个元素都在 Set B 中存在一个深层相等项。
        const bArray = Array.from(bSet);
        return Array.from(a).every((valA) =>
            bArray.some((valB) => isDeepEqual(valA, valB, cacheA, cacheB)),
        );
    }

    // 9. 处理普通对象和数组

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
        // 递归比较属性
        if (
            !Object.prototype.hasOwnProperty.call(b, key) ||
            !isDeepEqual(a[key as keyof T], b[key as keyof T], cacheA, cacheB)
        ) {
            return false;
        }
    }

    return true;
};

type CopyOptions = {
    /**
     * 要复制的文本
     */
    text?: string;
    /**
     * 要复制的文件路径
     */
    imageUrl?: string;
};

/**
 * @name copy
 * @description 用于复制文本和图片。
 * @params options - 配置。
 */
export const copy = async (options: CopyOptions): Promise<void> => {
    const { text, imageUrl } = options;

    if (text) {
        // 复制文本
        try {
            if (navigator.clipboard) {
                // 使用 Clipboard API
                await navigator.clipboard.writeText(text);
                console.log('Text copied to clipboard using Clipboard API');
            } else {
                // 使用 document.execCommand
                copyTextFallback(text);
                console.log('Text copied to clipboard using fallback method');
            }
        } catch (err) {
            console.error('Failed to copy text: ', err);
        }
    } else if (imageUrl) {
        // 复制图片（Clipboard API 支持）
        try {
            if (navigator.clipboard && ClipboardItem) {
                const imageBlob = await fetch(imageUrl).then((response) => response.blob());
                const clipboardItem = new ClipboardItem({
                    'image/png': imageBlob,
                });
                await navigator.clipboard.write([clipboardItem]);
                console.log('Image copied to clipboard using Clipboard API');
            } else {
                console.warn('Clipboard API not available for images');
            }
        } catch (err) {
            console.error('Failed to copy image: ', err);
        }
    } else {
        throw new Error('Either text or imageUrl must be provided');
    }
};

// 辅助函数：使用 fallback 方法复制文本
const copyTextFallback = (text: string): void => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed'; // prevent scrolling to bottom of page in MS Edge.
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
    } catch (err) {
        console.error('Fallback: Failed to copy text:', err);
    }
    document.body.removeChild(textarea);
};
