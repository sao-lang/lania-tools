# @lania-tools/json

简繁体中文转换字典数据包，提供简体→繁体、繁体→简体的双向映射表。

## 数据文件

| 文件 | 说明 | 条目数 |
|------|------|--------|
| `simpledToTraditional.json` | 简体中文 → 繁体中文映射 | ~2700+ |
| `traditionalToSimpled.json` | 繁体中文 → 简体中文映射 | ~2700+ |

## 使用方式

### 与 convert-chinese-text 配合使用

```typescript
import { createChineseConverter, convertPageChinese } from '@lania-tools/tools/convert-chinese-text';
import simpledToTraditional from '@lania-tools/json/simpledToTraditional.json';
import traditionalToSimpled from '@lania-tools/json/traditionalToSimpled.json';

// 文本转换
const toTraditional = createChineseConverter(500);
toTraditional('中国台湾', simpledToTraditional); // "中國臺灣"

const toSimplified = createChineseConverter(500);
toSimplified('中國臺灣', traditionalToSimpled); // "中国台湾"

// 页面批量转换
convertPageChinese(simpledToTraditional, document.body);
```

### 直接使用

```typescript
import simpledToTraditional from '@lania-tools/json/simpledToTraditional.json';

// 字典是一个简单的 Record<string, string>
simpledToTraditional['国']; // "國"
simpledToTraditional['发']; // "發"

// 遍历字典
Object.entries(simpledToTraditional).forEach(([simplified, traditional]) => {
  console.log(`${simplified} → ${traditional}`);
});
```

## 数据格式

```json
{
  "国": "國",
  "发": "發",
  "书": "書",
  "龙": "龍",
  ...
}
```

## 注意事项

- 字典基于字符级映射，不支持词组级转换（如 "头发" → "頭髮" 需要结合上下文）
- 适用于常见简繁体转换场景，不覆盖所有生僻字
- 与 `@lania-tools/tools` 的 `convert-chinese-text` 模块配合使用效果最佳