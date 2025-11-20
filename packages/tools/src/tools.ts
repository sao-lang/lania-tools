type Fn = (...args: any) => any;
// eslint-disable-next-line @typescript-eslint/ban-types
type FnArgsType<F extends Function> = F extends (...args: infer A) => any
    ? A
    : never;
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
 * @name deepClone
 * @description 深拷贝函数
 * @param {T} obj 目标对象
 * @returns {T} 目标对象的一个副本
 */
export function deepClone<T>(
    value: T,
    map: WeakMap<object, any> = new WeakMap(),
): T {
    // 处理 null、undefined、以及原始值（如字符串、数字、布尔值等）
    if (value === null || typeof value !== 'object') {
        return value;
    }

    // 处理循环引用的情况
    if (map.has(value as object)) {
        return map.get(value as object);
    }

    // 处理数组
    if (Array.isArray(value)) {
        const arrClone: any[] = [];
        map.set(value, arrClone);
        for (const item of value) {
            arrClone.push(deepClone(item, map));
        }
        return arrClone as T;
    }

    // 处理对象
    const objClone: Record<string, any> = {};
    map.set(value, objClone);
    for (const key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
            objClone[key] = deepClone((value as Record<string, any>)[key], map);
        }
    }
    return objClone as T;
}

type CopyOptions = {
    text?: string;
    imageUrl?: string;
};

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
                const imageBlob = await fetch(imageUrl).then((response) =>
                    response.blob(),
                );
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


