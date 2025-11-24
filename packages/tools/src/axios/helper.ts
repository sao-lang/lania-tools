import { AxiosRequestConfig } from 'axios';

/**
 * 内部辅助函数：稳定地序列化对象（通过对键排序）
 * 确保相同内容的参数对象，无论属性顺序如何，都能得到相同的字符串结果。
 * @param obj 待序列化的对象 (params 或 data)
 * @returns 稳定序列化后的字符串
 */
function stableStringify(obj: any): string {
    if (typeof obj !== 'object' || obj === null) {
        // 对于非对象或 null，直接使用 JSON.stringify 处理
        return JSON.stringify(obj);
    }

    // 1. 获取所有自身的、可枚举的字符串键
    const keys = Object.keys(obj);

    // 2. 对键进行排序，确保顺序稳定
    keys.sort();

    // 3. 按排序后的键构建新的对象字符串
    const parts: string[] = [];
    for (const key of keys) {
        const value = obj[key];
        // 递归地对值进行稳定序列化
        const stringifiedValue = stableStringify(value);

        // 键名本身必须是 JSON 字符串
        parts.push(`"${key}":${stringifiedValue}`);
    }

    return `{${parts.join(',')}}`;
}

/**
 * 生成请求的唯一 Key。
 * Key 由请求方法、URL、以及稳定序列化后的参数和数据组成。
 * 解决了原始代码中因 JSON.stringify 顺序不稳定导致的 Key 不一致问题。
 *
 * @param req Axios 请求配置对象
 * @returns 唯一的请求 Key 字符串
 */
export function generateRequestKey(req: AxiosRequestConfig): string {
    // 1. 获取请求方法，默认 'get'
    const method = req.method ? req.method.toLowerCase() : 'get';

    // 2. 获取请求 URL
    const url = req.url || '';

    // 3. 稳定序列化 URL 参数
    // 如果 req.params 是对象，使用 stableStringify；否则使用空字符串
    const params = req.params ? stableStringify(req.params) : '';

    // 4. 稳定序列化请求体数据
    // 如果 req.data 是对象，使用 stableStringify；否则使用空字符串
    const data = req.data ? stableStringify(req.data) : '';

    // 5. 组合成唯一的 Key： method:url:params:data
    return `${method}:${url}:${params}:${data}`;
}
