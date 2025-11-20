type ConvertOptions = {
    observeMutations?: boolean;
    batchSize?: number;
    excludeSelectors?: string[];
    useCache?: boolean;
    maxCacheSize?: number; // 最大缓存条数
};

/** 双端队列实现 */
class Deque<T> {
    private _queue: T[] = [];
    push(val: T) {
        this._queue.push(val);
    }
    shift(): T | undefined {
        return this._queue.shift();
    }
    unshift(val: T) {
        this._queue.unshift(val);
    }
    get length() {
        return this._queue.length;
    }
}

/** 字符替换工具（高性能 + LRU缓存 + 正则转义） */
export const convertChinese = (() => {
    let pattern: RegExp;
    let dict: Record<string, string> = {};
    const cache = new Map<string, string>();
    const maxCacheSize = 500;

    const escapeRegExp = (s: string) =>
        s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    return (
        text: string,
        dictionary: Record<string, string>,
        useCache = true,
    ) => {
        if (!text || !dictionary || !Object.keys(dictionary).length)
            return text;

        // 字典变化或首次初始化
        if (dict !== dictionary) {
            dict = dictionary;
            const keys = Object.keys(dict).map(escapeRegExp);
            pattern = new RegExp(keys.join('|'), 'g');
            cache.clear();
        }

        if (useCache && cache.has(text)) return cache.get(text)!;

        const result = text.replace(pattern, (match) => dict[match] || match);

        if (useCache) {
            cache.set(text, result);
            // 简单 LRU 控制
            if (cache.size > maxCacheSize) {
                const firstKey = cache.keys().next().value;
                firstKey && cache.delete(firstKey);
            }
        }

        return result;
    };
})();

/** 页面文本批量处理工具 */
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

    const shouldExclude = (node: Node | null) =>
        node?.nodeType === Node.ELEMENT_NODE &&
        excludeSelectors.some((sel) => (node as HTMLElement).closest(sel));

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

    const queue = new Deque<Node>();
    getTextNodes(targetElement).forEach((n) => queue.push(n));

    const processBatch = () => {
        const end = Math.min(batchSize, queue.length);
        for (let i = 0; i < end; i++) {
            const node = queue.shift()!;
            const oldText = node.textContent || '';
            const newText = convertChinese(oldText, dictionary, useCache);
            if (oldText !== newText) node.textContent = newText;
        }

        if (queue.length > 0) {
            const idle =
                window.requestIdleCallback ||
                // eslint-disable-next-line @typescript-eslint/ban-types
                ((fn: Function) => setTimeout(fn, 16));
            idle(processBatch);
        }
    };

    processBatch();

    // 观察 DOM 变化
    let observer: MutationObserver | null = null;
    if (observeMutations) {
        let scheduled = false;
        const pendingNodes = new Set<Node>();

        const handleMutations = (mutations: MutationRecord[]) => {
            for (const m of mutations) {
                for (const n of Array.from(m.addedNodes)) {
                    if (!shouldExclude(n)) {
                        getTextNodes(n).forEach((node) =>
                            pendingNodes.add(node),
                        );
                    }
                }
            }
            if (!scheduled) {
                scheduled = true;
                const idle =
                    window.requestIdleCallback ||
                    // eslint-disable-next-line @typescript-eslint/ban-types
                    ((fn: Function) => setTimeout(fn, 50));
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

    return () => observer?.disconnect();
};
