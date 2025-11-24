/** 页面文本批量处理配置选项 */
export type ConvertOptions = {
    /** 是否观察 DOM 变化，自动处理新增节点文本 */
    observeMutations?: boolean;
    /** 每次批量处理的文本节点数量 */
    batchSize?: number;
    /** 排除处理的选择器列表 */
    excludeSelectors?: string[];
    /** 是否使用缓存提高性能 */
    useCache?: boolean;
    /** 最大缓存条数，超过会删除最早的记录 (默认为 500) */
    maxCacheSize?: number;
};

/**
 * 双端队列（Deque）实现，基于数组，用于批量处理队列管理。
 * 注意：shift/unshift 操作复杂度为 O(N)。
 */
class Deque<T> {
    private _queue: T[] = [];

    /** 尾部添加元素 */
    push(val: T) {
        this._queue.push(val);
    }

    /** 头部取出元素 */
    shift(): T | undefined {
        // 使用 Array.shift()，虽然是 O(N)，但在大多数场景下代码更简洁
        return this._queue.shift();
    }

    /** 队列长度 */
    get length() {
        return this._queue.length;
    }
}

/**
 * 高性能字符替换工具，支持真正的 LRU 缓存。
 *
 * @param text 待替换的文本
 * @param dictionary 字典对象
 * @param useCache 是否使用缓存
 * @param cacheMap 全局 Map 缓存实例
 * @param maxCacheSize 最大缓存条数
 * @returns 替换后的文本
 */
export const createChineseConverter = (maxCacheSize: number = 500) => {
    let pattern: RegExp;
    let dict: Record<string, string> = {};
    // 使用 Map 作为缓存，因为它保持插入顺序
    const cache = new Map<string, string>();
    const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    return (text: string, dictionary: Record<string, string>, useCache = true) => {
        if (!text || !dictionary || !Object.keys(dictionary).length) return text;

        // 字典变化或首次初始化：重新构建正则，清空缓存
        if (dict !== dictionary) {
            dict = dictionary;
            const keys = Object.keys(dict).map(escapeRegExp);
            // 确保字典不为空时才创建 RegExp，防止 keys.join('|') 是空字符串
            pattern = keys.length ? new RegExp(keys.join('|'), 'g') : /($^)/;
            cache.clear();
        }

        // 缓存命中并实现 LRU
        if (useCache && cache.has(text)) {
            const result = cache.get(text)!;
            // 1. 删除旧的 key
            cache.delete(text);
            // 2. 重新插入 key，使其成为 Map 中“最新使用”的元素（移到尾部）
            cache.set(text, result);
            return result;
        }

        // 文本替换
        const result = text.replace(pattern, (match) => dict[match] || match);

        // 更新缓存并维护 LRU
        if (useCache) {
            // 如果缓存未命中，将其添加到末尾 (最新使用)
            cache.set(text, result);

            // 维护最大缓存条数 (FIFO 即 LRU 的淘汰策略)
            if (cache.size > maxCacheSize) {
                // Map 的迭代器头部即为最久未使用的 key
                const firstKey = cache.keys().next().value;
                if (firstKey) cache.delete(firstKey);
            }
        }

        return result;
    };
};

/**
 * 批量处理页面文本，将符合字典的中文文本替换为对应内容
 *
 * @param dictionary 字典对象
 * @param targetElement 目标 DOM 元素，默认 document.body
 * @param options 配置选项
 * @returns 返回停止观察 DOM 的函数
 */
export const convertPageChinese = (
    dictionary: Record<string, string>,
    targetElement: HTMLElement = document.body,
    options: ConvertOptions = {},
): (() => void) => {
    const {
        observeMutations = false,
        batchSize = 100,
        excludeSelectors = [],
        useCache = true,
        maxCacheSize = 500, // 默认值 500
    } = options;

    if (!dictionary || !Object.keys(dictionary).length) return () => {};

    // 1. 使用工厂函数创建转换器，传入 maxCacheSize
    const convertChinese = createChineseConverter(maxCacheSize);

    /** 判断节点是否被排除 */
    const shouldExclude = (node: Node | null): boolean =>
        node?.nodeType === Node.ELEMENT_NODE &&
        excludeSelectors.some((sel) => (node as HTMLElement).closest(sel));

    /** 获取文本节点数组 */
    const getTextNodes = (root: Node) => {
        const nodes: Node[] = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            // 注意：这里检查的是 text node 的 parentNode
            acceptNode: (node) =>
                shouldExclude(node.parentNode)
                    ? NodeFilter.FILTER_REJECT
                    : NodeFilter.FILTER_ACCEPT,
        });
        let node;
        while ((node = walker.nextNode())) {
            // 忽略空白或只有换行的文本节点
            if (node.textContent?.trim().length) {
                nodes.push(node);
            }
        }
        return nodes;
    };

    // 初始化队列
    const queue = new Deque<Node>();
    getTextNodes(targetElement).forEach((n) => queue.push(n));

    // 使用 requestIdleCallback 的 Polyfill
    const idleCallback =
        window.requestIdleCallback ||
        ((fn: (deadline?: { didTimeout: boolean; timeRemaining: () => number }) => void) =>
            setTimeout(fn, 16));

    /** 批量处理文本节点 */
    const processBatch = () => {
        const end = Math.min(batchSize, queue.length);
        for (let i = 0; i < end; i++) {
            const node = queue.shift()!;
            // 避免处理已经被其他操作移除的节点
            if (!node.parentElement) continue;

            const oldText = node.textContent || '';
            const newText = convertChinese(oldText, dictionary, useCache);

            if (oldText !== newText) {
                node.textContent = newText;
            }
        }

        if (queue.length > 0) {
            idleCallback(processBatch);
        }
    };
    processBatch();

    // 观察 DOM 变化
    let observer: MutationObserver | null = null;
    if (observeMutations) {
        let scheduled = false;
        // 改进：收集新增的父元素，统一处理，降低同步操作开销
        const pendingElements = new Set<Node>();

        /** MutationObserver 回调 */
        const handleMutations = (mutations: MutationRecord[]) => {
            for (const m of mutations) {
                for (const n of Array.from(m.addedNodes)) {
                    // 仅关注元素节点，并排除黑名单节点
                    if (n.nodeType === Node.ELEMENT_NODE && !shouldExclude(n)) {
                        pendingElements.add(n);
                    }
                }
            }
            if (pendingElements.size > 0 && !scheduled) {
                scheduled = true;
                // 延迟执行节点收集和处理
                idleCallback(() => {
                    scheduled = false;
                    // 统一获取文本节点并加入队列
                    pendingElements.forEach((el) => {
                        getTextNodes(el).forEach((node) => queue.push(node));
                    });
                    pendingElements.clear();
                    // 开始处理队列中的新节点
                    processBatch();
                });
            }
        };

        observer = new MutationObserver(handleMutations);
        observer.observe(targetElement, { childList: true, subtree: true });
    }

    /** 返回停止观察 DOM 的方法 */
    return () => observer?.disconnect();
};
