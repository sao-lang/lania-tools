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
    /** 最大缓存条数，超过会删除最早的记录 */
    maxCacheSize?: number;
};

/** 双端队列（Deque）实现，用于批量处理队列管理 */
class Deque<T> {
    private _queue: T[] = [];

    /** 尾部添加元素 */
    push(val: T) {
        this._queue.push(val);
    }

    /** 头部取出元素 */
    shift(): T | undefined {
        return this._queue.shift();
    }

    /** 头部添加元素 */
    unshift(val: T) {
        this._queue.unshift(val);
    }

    /** 队列长度 */
    get length() {
        return this._queue.length;
    }
}

/**
 * 高性能字符替换工具
 * - 支持 LRU 缓存
 * - 支持正则转义
 * - 可选择是否使用缓存
 */
export const convertChinese = (() => {
    let pattern: RegExp;
    let dict: Record<string, string> = {};
    const cache = new Map<string, string>();
    const maxCacheSize = 500;

    /** 转义正则特殊字符 */
    const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    return (text: string, dictionary: Record<string, string>, useCache = true) => {
        if (!text || !dictionary || !Object.keys(dictionary).length) return text;

        // 字典变化或首次初始化
        if (dict !== dictionary) {
            dict = dictionary;
            const keys = Object.keys(dict).map(escapeRegExp);
            pattern = new RegExp(keys.join('|'), 'g');
            cache.clear();
        }

        // 缓存命中
        if (useCache && cache.has(text)) return cache.get(text)!;

        // 替换文本
        const result = text.replace(pattern, (match) => dict[match] || match);

        // 更新缓存并维护 LRU
        if (useCache) {
            cache.set(text, result);
            if (cache.size > maxCacheSize) {
                const firstKey = cache.keys().next().value;
                firstKey && cache.delete(firstKey);
            }
        }

        return result;
    };
})();

/**
 * 批量处理页面文本，将符合字典的中文文本替换为对应内容
 * - 支持批量处理和 requestIdleCallback 避免阻塞
 * - 可选择是否观察 DOM 变化动态处理新增文本
 *
 * @param dictionary 字典对象，key 为原始文本，value 为替换文本
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
    } = options;

    if (!dictionary || !Object.keys(dictionary).length) return () => {};

    /** 判断节点是否被排除 */
    const shouldExclude = (node: Node | null) =>
        node?.nodeType === Node.ELEMENT_NODE &&
        excludeSelectors.some((sel) => (node as HTMLElement).closest(sel));

    /** 获取文本节点数组 */
    const getTextNodes = (root: Node) => {
        const nodes: Node[] = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) =>
                shouldExclude(node.parentNode)
                    ? NodeFilter.FILTER_REJECT
                    : NodeFilter.FILTER_ACCEPT,
        });
        let node;
        while ((node = walker.nextNode())) nodes.push(node);
        return nodes;
    };

    // 初始化队列
    const queue = new Deque<Node>();
    getTextNodes(targetElement).forEach((n) => queue.push(n));

    /** 批量处理文本节点 */
    const processBatch = () => {
        const end = Math.min(batchSize, queue.length);
        for (let i = 0; i < end; i++) {
            const node = queue.shift()!;
            const oldText = node.textContent || '';
            const newText = convertChinese(oldText, dictionary, useCache);
            if (oldText !== newText) node.textContent = newText;
        }

        if (queue.length > 0) {
            // eslint-disable-next-line @typescript-eslint/ban-types
            const idle = window.requestIdleCallback || ((fn: Function) => setTimeout(fn, 16));
            idle(processBatch);
        }
    };

    processBatch();

    // 观察 DOM 变化
    let observer: MutationObserver | null = null;
    if (observeMutations) {
        let scheduled = false;
        const pendingNodes = new Set<Node>();

        /** MutationObserver 回调 */
        const handleMutations = (mutations: MutationRecord[]) => {
            for (const m of mutations) {
                for (const n of Array.from(m.addedNodes)) {
                    if (!shouldExclude(n)) {
                        getTextNodes(n).forEach((node) => pendingNodes.add(node));
                    }
                }
            }
            if (!scheduled) {
                scheduled = true;
                // eslint-disable-next-line @typescript-eslint/ban-types
                const idle = window.requestIdleCallback || ((fn: Function) => setTimeout(fn, 50));
                idle(() => {
                    scheduled = false;
                    pendingNodes.forEach((node) => queue.push(node));
                    pendingNodes.clear();
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
