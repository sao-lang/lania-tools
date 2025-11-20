type TimeFormatter = (time: Date) => string;

const padZero = (num: number): string => num.toString().padStart(2, '0');

const parseDateComponents = (time: Date) => ({
    year: time.getFullYear(),
    month: time.getMonth() + 1,
    date: time.getDate(),
    hour: time.getHours(),
    minute: time.getMinutes(),
    second: time.getSeconds(),
});

const splitFormatter = (formatter: string): [string, string, string] => {
    const separators = ['/', '-', ':', '.'];
    const separator = separators.find((sep) => formatter.includes(sep)) || ' ';
    const [left, right] = formatter.split(separator);
    return [left, right, separator];
};

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

export const formatTime = (
    time: Date | number,
    formatter?: TimeFormatter,
): string => {
    // 处理时间戳和 Date 对象
    const date = typeof time === 'number' ? new Date(time) : time;

    // 如果 formatter 是函数，调用 formatter 函数进行自定义格式化
    if (formatter) {
        if (typeof formatter === 'function') {
            return formatter(date);
        }
    }

    // 默认格式化逻辑
    const {
        year,
        month,
        date: day,
        hour,
        minute,
        second,
    } = parseDateComponents(date);
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
        // 默认格式，如果没有提供 formatter
        return `${formattedComponents.YYYY}-${formattedComponents.MM}-${formattedComponents.DD} ${formattedComponents.HH}:${formattedComponents.mm}:${formattedComponents.SS}`;
    }

    const [leftFormat, rightFormat, leftSeparator] = splitFormatter(formatter);

    const leftResult = formatWithComponents(
        formattedComponents,
        leftFormat,
        leftSeparator,
    );
    const rightResult = formatWithComponents(
        formattedComponents,
        rightFormat,
        leftSeparator,
    );

    return `${leftResult} ${rightResult}`.trim();
};

export default formatTime;
