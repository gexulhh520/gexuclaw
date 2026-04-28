import type { AgentPlugin } from "../plugin.schema.js";
import { nowIso } from "../../../shared/time.js";

/**
 * 内置浏览器基础能力文档插件
 * 提供浏览器工具的使用指南、最佳实践和参考模板
 * 
 * 这是一个最小内置插件示例，用于验证插件系统闭环
 */
export const builtinBrowserCoreDocs: AgentPlugin = {
  pluginId: "builtin-browser-core-docs",
  pluginType: "builtin",
  name: "浏览器基础能力文档",
  description: "提供浏览器工具的使用指南、最佳实践和参考模板",

  prompts: [
    {
      promptId: "page-analysis-template",
      title: "页面分析模板",
      description: "分析网页内容的标准模板",
      content: `## 页面分析任务

请按以下步骤分析页面：

1. **页面概述**: 页面主题和主要功能
2. **内容结构**: 主要区块和内容组织
3. **关键信息**: 提取重要数据和文本
4. **交互元素**: 按钮、链接、表单等
5. **结论**: 总结页面价值

输出格式：
- 使用结构化文本
- 关键数据用表格展示
- 重要链接单独列出

示例：
### 页面概述
这是一个电商商品详情页，展示 iPhone 15 Pro 的产品信息。

### 内容结构
- 顶部导航栏
- 商品图片轮播
- 价格和购买按钮
- 详细参数表
- 用户评价区

### 关键信息
| 项目 | 内容 |
|------|------|
| 商品名称 | iPhone 15 Pro |
| 价格 | ¥7999 |
| 库存 | 有货 |

### 交互元素
- [立即购买] 按钮
- [加入购物车] 按钮
- [收藏] 图标

### 结论
页面信息完整，购买流程清晰。`,
      usageHint: "当需要系统性分析网页内容时使用",
    },
    {
      promptId: "screenshot-best-practices",
      title: "截图最佳实践",
      description: "如何有效使用截图工具",
      content: `## 截图最佳实践

### 截图类型选择

1. **全屏截图**
   - 用途: 展示整体页面布局
   - 场景: 页面概览、设计评审
   - 工具: browser.screenshot

2. **元素截图**
   - 用途: 聚焦特定区域
   - 场景: 突出显示某个功能、报错信息
   - 工具: browser.screenshot + selector

3. **对比截图**
   - 用途: 展示变化
   - 场景: 前后对比、A/B 测试
   - 方法: 多次截图后并排展示

### 注意事项

- 确保页面完全加载后再截图
- 注意敏感信息脱敏（密码、个人信息）
- 截图前关闭弹窗和广告
- 保持浏览器窗口大小一致（建议 1920x1080）

### 常见问题

Q: 截图模糊怎么办？
A: 检查浏览器缩放比例是否为 100%

Q: 长页面如何截图？
A: 使用全页截图模式，或分段截图`,
      usageHint: "当需要使用 browser.screenshot 工具时参考",
    },
    {
      promptId: "data-extraction-guide",
      title: "数据提取指南",
      description: "从网页提取结构化数据的方法",
      content: `## 数据提取指南

### 提取策略

1. **识别数据模式**
   - 列表数据: 商品列表、搜索结果
   - 表格数据: 统计报表、价格表
   - 卡片数据: 用户信息、产品卡片

2. **选择提取方法**
   - 简单列表: CSS 选择器
   - 复杂表格: 结构分析 + 行列映射
   - 嵌套数据: 递归提取

### CSS 选择器参考

| 目标 | 选择器示例 |
|------|-----------|
| 商品名称 | .product-title, h3.title |
| 价格 | .price, [data-price] |
| 评分 | .rating, .stars |
| 链接 | a[href], .product-link |

### 输出格式

提取的数据应输出为结构化格式：

\`\`\`json
{
  "items": [
    {
      "title": "商品名称",
      "price": "价格",
      "rating": "评分"
    }
  ]
}
\`\`\``,
      usageHint: "当需要从网页提取数据时参考",
    },
  ],

  resources: [
    {
      resourceId: "common-selectors",
      title: "常用 CSS 选择器参考",
      description: "提取页面内容时的常用选择器",
      contentType: "markdown",
      content: `| 目标 | 选择器 | 说明 |
|------|--------|------|
| 文章标题 | h1, h2, .title, [data-title] | 主标题和副标题 |
| 正文内容 | article, .content, main, .post | 主要内容区域 |
| 链接列表 | a[href], .link, .url | 所有链接 |
| 表格数据 | table, tr, td, th | 表格行列 |
| 列表项 | li, .item, .list-item | 列表中的条目 |
| 图片 | img[src], .image, .photo | 图片元素 |
| 按钮 | button, .btn, [role="button"] | 可点击按钮 |
| 表单输入 | input, textarea, select | 表单控件 |
| 价格 | .price, [data-price], .amount | 价格信息 |
| 评分 | .rating, .stars, [data-rating] | 评分显示 |

### 组合选择器示例

\`\`\`
// 商品卡片内的标题
.product-card h3.title

// 表格中的数据行（不包括表头）
table tbody tr

// 带链接的图片
a img[src]
\`\`\``,
    },
    {
      resourceId: "browser-errors",
      title: "常见浏览器错误及处理",
      description: "浏览器操作中的常见错误和解决方案",
      contentType: "markdown",
      content: `| 错误 | 原因 | 解决方案 |
|------|------|----------|
| 页面加载超时 | 网络慢或页面过大 | 增加超时时间，或分段加载 |
| 元素未找到 | 选择器错误或元素未渲染 | 等待元素出现，或更新选择器 |
| 点击无效 | 元素被遮挡或未启用 | 检查元素状态，或滚动到可见区域 |
| 弹窗拦截 | 浏览器安全策略 | 处理弹窗，或使用无头模式 |
| 登录失效 | Cookie 过期 | 重新登录，或检查会话状态 |
| 反爬虫拦截 | IP 被封或验证码 | 降低频率，或使用代理 |

### 调试技巧

1. 先截图确认页面状态
2. 检查控制台错误信息
3. 验证选择器是否正确
4. 确认网络请求状态`,
    },
  ],

  // 默认挂载到 browser 类型 Agent
  defaultAttachTargets: ["browser"],

  status: "active",
  createdAt: nowIso(),
  updatedAt: nowIso(),
};
