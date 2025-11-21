/**
 * 时间格式化函数类型
 * @param time Date 对象
 * @returns 格式化后的字符串
 */
export type TimeFormatter = (time: Date) => string;

/**
 * 数字补零工具
 * @param num 数字
 * @returns 两位数字字符串，不足补零
 */
const padZero = (num: number): string => num.toString().padStart(2, '0');

/**
 * 拆解 Date 对象各个组件
 * @param time Date 对象
 * @returns 年、月、日、时、分、秒
 */
const parseDateComponents = (time: Date) => ({
    year: time.getFullYear(),
    month: time.getMonth() + 1,
    date: time.getDate(),
    hour: time.getHours(),
    minute: time.getMinutes(),
    second: time.getSeconds(),
});

/**
 * 分割格式字符串，尝试识别常见分隔符
 * @param formatter 格式字符串
 * @returns [左部分, 右部分, 分隔符]
 */
const splitFormatter = (formatter: string): [string, string, string] => {
    const separators = ['/', '-', ':', '.'];
    const separator = separators.find((sep) => formatter.includes(sep)) || ' ';
    const [left, right] = formatter.split(separator);
    return [left, right, separator];
};

/**
 * 根据格式组件生成对应格式化字符串
 * @param components 格式化组件字典，如 YYYY, MM, DD...
 * @param format 格式字符串
 * @param separator 分隔符
 * @returns 格式化后的字符串
 */
const formatWithComponents = (
    components: Record<string, string>,
    format: string,
    separator: string,
): string => {
    const [part1, part2, part3] = format.split(separator);
    return [
        components[part1] || '',
        part2 ? separator : '',
        components[part2] || '',
        part3 ? separator : '',
        components[part3] || '',
    ].join('');
};

/**
 * 时间格式化函数
 * 支持：
 * 1. 时间戳或 Date 对象
 * 2. 自定义函数格式化
 * 3. 默认格式化 "YYYY-MM-DD HH:mm:SS"
 *
 * @param time Date 对象或时间戳
 * @param formatter 可选：格式字符串或自定义格式化函数
 * @returns 格式化后的字符串
 */
export const formatTime = (time: Date | number, formatter?: TimeFormatter | string): string => {
    // 处理时间戳和 Date 对象
    const date = typeof time === 'number' ? new Date(time) : time;

    // 如果 formatter 是函数，调用自定义函数
    if (formatter && typeof formatter === 'function') {
        return formatter(date);
    }

    // 拆解时间组件
    const { year, month, date: day, hour, minute, second } = parseDateComponents(date);

    const formattedComponents = {
        YYYY: year.toString(),
        MM: padZero(month),
        M: month.toString(),
        DD: padZero(day),
        D: day.toString(),
        HH: padZero(hour),
        H: hour.toString(),
        hh: padZero(hour % 12 || 12),
        h: (hour % 12 || 12).toString(),
        mm: padZero(minute),
        m: minute.toString(),
        SS: padZero(second),
        S: second.toString(),
    };

    // 默认格式：YYYY-MM-DD HH:mm:SS
    if (!formatter) {
        return `${formattedComponents.YYYY}-${formattedComponents.MM}-${formattedComponents.DD} ${formattedComponents.HH}:${formattedComponents.mm}:${formattedComponents.SS}`;
    }

    // 如果 formatter 是字符串，则尝试拆分
    const [leftFormat, rightFormat, leftSeparator] = splitFormatter(formatter as string);

    const leftResult = formatWithComponents(formattedComponents, leftFormat, leftSeparator);
    const rightResult = formatWithComponents(formattedComponents, rightFormat, leftSeparator);

    return `${leftResult} ${rightResult}`.trim();
};

export default formatTime;
