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
 * 根据格式字符串和组件生成格式化结果
 * @param components 格式化组件字典
 * @param format 格式字符串
 * @returns 格式化后的字符串
 */
const formatWithComponents = (components: Record<string, string>, format: string): string => {
    let result = format;
    for (const [key, value] of Object.entries(components)) {
        result = result.replaceAll(key, value);
    }
    return result;
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
    const date = typeof time === 'number' ? new Date(time) : time;

    if (formatter && typeof formatter === 'function') {
        return formatter(date);
    }

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

    if (!formatter) {
        return `${formattedComponents.YYYY}-${formattedComponents.MM}-${formattedComponents.DD} ${formattedComponents.HH}:${formattedComponents.mm}:${formattedComponents.SS}`;
    }

    return formatWithComponents(formattedComponents, formatter as string);
};

export default formatTime;
