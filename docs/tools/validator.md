# 表单校验 Validator

## 定位

规则化的数据校验器：支持同步 / 异步规则、跨字段校验、动态规则与结果缓存。

```ts
import { Validator, Rules } from '@lania-tools/tools/validator';
```

## 最小示例

```ts
const validator = new Validator({
    username: [Rules.required('请输入用户名'), Rules.minLength(3)],
    email: [Rules.required(), Rules.email()],
    age: Rules.range(18, 120),
});

const result = await validator.validate({
    username: 'ab',
    email: 'not-an-email',
    age: 10,
});

// {
//   isValid: false,
//   errors: {
//     username: 'Length must be at least 3',
//     email: 'Invalid email',
//     age: 'Value must be between 18 and 120',
//   }
// }
```

## 数据结构

```ts
type ValidationRuleResult = {
    status: boolean;
    message?: string;
};

type ValidationRuleFn<T = any> = (
    value: T,
    allValues?: Record<string, T>,
) => ValidationRuleResult | Promise<ValidationRuleResult>;

interface ValidationRules<T = any> {
    [field: string]: ValidationRuleFn<T> | ValidationRuleFn<T>[];
}

type ValidationResult = {
    isValid: boolean;
    errors: Record<string, string>;
};
```

## Validator 类

### `new Validator<T>(rules)`

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `rules` | `ValidationRules<T>` | 静态规则 |

每个字段可以配置单条规则或规则数组。

### `validate(data): Promise<ValidationResult>`

```ts
const { isValid, errors } = await validator.validate(formData);
```

执行流程：

```text
validate(data)
  ├─ cacheKey = JSON.stringify(data)
  ├─ 命中缓存 → 直接返回（不再执行规则）
  └─ performValidation
      ├─ 合并 rules 与 dynamicRules（同名覆盖）
      ├─ 遍历字段（按 rules 的定义顺序）
      │    ├─ 取出规则（单条或数组）
      │    ├─ 依次执行
      │    ├─ 失败 → errors[field] = message || 'Validation failed'
      │    │         isValid = false
      │    │         跳过该字段剩余规则
      │    └─ 成功 → 继续下一条
      └─ 返回 { isValid, errors }
```

- **每个字段只保留第一条错误**。
- 字段的**执行顺序**是规则对象的 key 顺序。
- 未在规则中声明的字段会被忽略。

### `setDynamicRules(rules): void`

运行时替换动态规则，与静态规则合并：

```ts
const validator = new Validator({
    email: [Rules.required(), Rules.email()],
});

validator.setDynamicRules({
    phone: [Rules.required(), Rules.phone()],
});
```

合并顺序：`{ ...staticRules, ...dynamicRules }`，**同名字段以动态规则为准**。

### `getErrors(): Record<string, string>`

返回最后一次验证错误的**副本**：

```ts
const errors = validator.getErrors();
errors.username = 'changed'; // 不影响内部状态
```

### `clearCache(): void`

清空结果缓存与错误记录。数据不变但规则变化时（例如 `setDynamicRules` 后）建议调用。

## 内置规则

`Rules` 是规则工厂集合，每个方法返回一个 `ValidationRuleFn`。

### `required(message?)`

```ts
Rules.required();                    // 'This field is required'
Rules.required('请输入用户名');
```

通过条件：`value !== null && value !== undefined && value !== ''`。

| 值 | 结果 |
| --- | --- |
| `''` | 失败 |
| `null` / `undefined` | 失败 |
| `0` | 通过 |
| `false` | 通过 |
| `[]` | 通过 |

### `minLength(min, message?)`

```ts
Rules.minLength(3); // 'Length must be at least 3'
```

仅对字符串有效，非字符串直接失败。

### `maxLength(max, message?)`

```ts
Rules.maxLength(20); // 'Length must be at most 20'
```

### `pattern(regexp, message?)`

```ts
Rules.pattern(/^[a-z]+$/i, '只能包含字母'); // 默认 'Invalid format'
```

仅对字符串有效。注意带 `g` 标志的正则会保留 `lastIndex`，多次校验可能出错，建议不要使用 `g`。

### `email(message?)`

```ts
Rules.email(); // 'Invalid email'
```

正则：`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`。只做基础格式校验。

### `phone(message?)`

```ts
Rules.phone(); // 'Invalid phone number'
```

正则：`/^(\+\d{1,3}[- ]?)?\d{10}$/`，即 10 位数字，可选 1-3 位国家码。

### `range(min, max, message?)`

```ts
Rules.range(18, 120); // 'Value must be between 18 and 120'
```

要求是数字且满足 `min <= value <= max`（闭区间）。

### `min(min, message?)` / `max(max, message?)`

```ts
Rules.min(0);  // 'Value must be greater than or equal to 0'
Rules.max(100); // 'Value must be less than or equal to 100'
```

### `integer(message?)`

```ts
Rules.integer(); // 'Value must be an integer'
```

要求 `typeof value === 'number'` 且 `Number.isInteger(value)`。

### `url(message?)`

```ts
Rules.url(); // 'Invalid URL'
```

正则：`/^https?:\/\/[^\s]+$/`。

### `date(message?)`

```ts
Rules.date(); // 'Invalid date'
```

通过 `new Date(value).getTime()` 是否为 `NaN` 判断。注意数字时间戳也能通过。

### `matchField(otherField, message?)`

```ts
Rules.matchField('password', '两次密码不一致'); // 默认 'Must match password'
```

规则函数会拿到 `allValues`，比较 `value === allValues[otherField]`。

### `custom(fn, message?)`

```ts
Rules.custom((value, allValues) => value !== allValues?.forbidden, '包含敏感词');
// 默认 'Validation failed'
```

`fn` 返回布尔值。

## 异步规则

规则可以直接返回 Promise：

```ts
const validator = new Validator({
    username: [
        Rules.required(),
        async (value) => {
            const available = await api.checkUsername(value);
            return { status: available, message: '用户名已被占用' };
        },
    ],
});
```

- 所有规则通过 `await Promise.resolve(...)` 统一处理；
- 异步规则**串行**执行；
- 任一异步规则抛错会被捕获，视为失败并输出 `An error occurred during validation.`。

## 错误兜底

### 规则返回非对象

```ts
const rule = (() => 123) as any;
```

非对象返回值被视为通过（`{ status: true }`）。

### 规则抛错

```ts
const validator = new Validator({
    name: () => {
        throw new Error('boom');
    },
});
```

结果：

```ts
{ isValid: false, errors: { name: 'An error occurred during validation.' } }
```

同时打印 `console.error('Error executing validation rule:', error)`。

### 规则失败但没给 message

```ts
const validator = new Validator({ name: () => ({ status: false }) });
```

`errors.name === 'Validation failed'`。

## 完整示例：注册表单

```ts
import { Validator, Rules } from '@lania-tools/tools/validator';

type RegisterForm = {
    username: string;
    password: string;
    confirm: string;
    age: number;
    website: string;
    inviteCode: string;
};

const validator = new Validator<RegisterForm>({
    username: [
        Rules.required('请输入用户名'),
        Rules.minLength(3),
        Rules.maxLength(20),
        async (value) => ({
            status: !(await api.usernameExists(value)),
            message: '用户名已被占用',
        }),
    ],
    password: [
        Rules.required('请输入密码'),
        Rules.minLength(8, '密码至少 8 位'),
        Rules.pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, '需同时包含大小写字母与数字'),
    ],
    confirm: [Rules.required(), Rules.matchField('password', '两次密码不一致')],
    age: [Rules.required(), Rules.integer(), Rules.range(18, 120, '年龄需在 18-120 之间')],
    website: Rules.url('请输入合法网址'),
    inviteCode: Rules.custom((value) => value.length === 6 || value === '', '邀请码为 6 位'),
});

export async function submit(form: RegisterForm) {
    const { isValid, errors } = await validator.validate(form);
    if (!isValid) return { ok: false as const, errors };
    return { ok: true as const, data: await api.register(form) };
}
```

## 缓存行为

```ts
await validator.validate(data); // 执行规则
await validator.validate(data); // 直接返回缓存
await validator.validate({ ...data }); // key 相同 → 仍命中缓存
await validator.validate({ ...data, age: 30 }); // key 变化 → 重新校验
```

缓存 key 是 `JSON.stringify(data)`：

| 情况 | 是否命中 |
| --- | --- |
| 同一对象、同一内容 | 是 |
| 新对象、内容相同且 key 顺序相同 | 是 |
| 内容相同但 key 顺序不同 | 否（会重新校验） |
| 内容不同 | 否 |

需要忽略缓存时调用 `clearCache()`。

## 注意事项

| 场景 | 说明 |
| --- | --- |
| `required` 与 `0` | `0` / `false` 视为有效值 |
| 正则 `g` 标志 | 会保留 `lastIndex`，多次校验可能失败 |
| 缓存 | 数据含不可序列化值时 key 可能失真 |
| 错误结构 | 每字段只保留第一条错误 |
| 异步 | 字段内规则串行，字段多时注意耗时 |
| 动态规则 | 同名覆盖静态规则，切换后建议 `clearCache()` |
| 跨字段 | `allValues` 是传入 `validate` 的整个对象 |

## 测试覆盖

`packages/tools/tests/validator.test.ts`（48 个用例）与 `edge-cases.test.ts`：

- 全部内置规则的正反例与默认消息；
- 规则数组与「首个失败即停止」；
- 跨字段 `matchField` / `custom`；
- 异步规则；
- 动态规则覆盖；
- 缓存命中与 `clearCache`；
- 规则抛错兜底、非对象返回值、缺失 message 的默认文案；
- `getErrors` 返回副本。
