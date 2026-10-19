# 时间格式化 formatTime

## 定位

把 `Date` 或时间戳格式化为字符串，支持模板字符串与自定义函数。

```ts
import { formatTime } from '@lania-tools/tools/format-time';
```

## 签名

```ts
type TimeFormatter = (time: Date) => string;

function formatTime(
    time: Date | number,
    formatter?: TimeFormatter | string,
): string;
```

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `time` | `Date \| number` | `Date` 对象或毫秒时间戳 |
| `formatter` | `string \| (date: Date) => string` | 模板或自定义函数 |

不传 `formatter` 时使用默认格式：`YYYY-MM-DD HH:mm:SS`。

```ts
formatTime(new Date(2026, 9, 19, 8, 5, 3)); // '2026-10-19 08:05:03'
formatTime(1792368303000);                  // 按时间戳格式化
```

## 占位符

| 占位符 | 含义 | 示例（2026-10-09 08:05:03） |
| --- | --- | --- |
| `YYYY` | 四位年份 | `2026` |
| `MM` | 两位月份 | `10` |
| `M` | 月份 | `10` |
| `DD` | 两位日期 | `09` |
| `D` | 日期 | `9` |
| `HH` | 两位 24 小时 | `08` |
| `H` | 24 小时 | `8` |
| `hh` | 两位 12 小时 | `08` |
| `h` | 12 小时 | `8` |
| `mm` | 两位分钟 | `05` |
| `m` | 分钟 | `5` |
| `SS` | 两位秒 | `03` |
| `S` | 秒 | `3` |

### 示例

```ts
const date = new Date(2026, 9, 9, 8, 5, 3);

formatTime(date, 'YYYY/MM/DD');        // '2026/10/09'
formatTime(date, 'YYYY-M-D');          // '2026-10-9'
formatTime(date, 'HH:mm');             // '08:05'
formatTime(date, 'H:m:S');             // '8:5:3'
formatTime(date, 'hh:mm');             // '08:05'
formatTime(date, 'YYYY年MM月DD日');      // '2026年10月09日'
```

### 12 小时制细节

```ts
hour = 0  → hh = '12'   （凌晨 12 点）
hour = 12 → hh = '12'   （中午 12 点）
hour = 13 → hh = '01'
```

实现：`padZero(hour % 12 || 12)`。

## 自定义函数

```ts
formatTime(date, (d) => d.toISOString());

formatTime(date, (d) => {
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return '刚刚';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
    return formatTime(d, 'YYYY-MM-DD');
});
```

函数模式下完全绕过模板，可以直接访问 `Date` 的全部 API。

## 原理

```text
formatTime(time, formatter)
  ├─ number → new Date(number)
  ├─ formatter 是函数 → formatter(date)
  ├─ 拆解组件：year / month / date / hour / minute / second
  ├─ 生成占位符字典
  └─ 按字典顺序 replaceAll
```

替换顺序：

```text
YYYY → MM → M → DD → D → HH → H → hh → h → mm → m → SS → S
```

**长占位符必须排在短占位符之前**，否则 `MM` 会先被 `M` 替换成 `10`，再替换 `MM` 就失效了。当前顺序满足这一点。

## 常见模板

| 场景 | 模板 | 结果 |
| --- | --- | --- |
| 默认 | 不传 | `2026-10-19 08:05:03` |
| 日期 | `YYYY-MM-DD` | `2026-10-19` |
| 时间 | `HH:mm` | `08:05` |
| 紧凑 | `YYYYMMDDHHmmSS` | `20261019080503` |
| 可读 | `YYYY年MM月DD日 HH:mm` | `2026年10月19日 08:05` |
| 12 小时 | `hh:mm` | `08:05` |

## 注意事项

| 问题 | 说明 |
| --- | --- |
| 时区 | 使用本地时区（`getFullYear` 等） |
| `S` 的含义 | 是「秒」，不是毫秒 |
| 模板中的普通字母 | 含 `M`、`D`、`H`、`m`、`S` 的文本会被误替换（如 `formatTime(d, 'TODAY YYYY')`） |
| `replaceAll` | 需要 ES2021 运行时（现代浏览器 / Node 14+） |
| 无效日期 | 不会抛错，会输出 `NaN` 相关内容 |
| 时间戳单位 | 毫秒；秒级时间戳需要先乘 1000 |

### 模板中的字母冲突

```ts
formatTime(date, 'YYYY-MM-DD');       // ✅
formatTime(date, 'TODAY: YYYY-MM-DD'); // ❌ 'TODAY' 中的 D、A 会被替换
```

需要字面文本时改用自定义函数：

```ts
formatTime(date, (d) => `Today: ${formatTime(d, 'YYYY-MM-DD')}`);
```

## 测试覆盖

`packages/tools/tests/format-time.test.ts`（29 个用例）：

- 默认格式；
- 全部占位符；
- 补零（`MM` / `DD` / `HH` / `mm` / `SS`）；
- 12 小时制的 0 点与 12 点；
- 时间戳输入；
- 自定义函数；
- 年份四位输出。
