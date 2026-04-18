# 知识库 API 契约文档

## 文档信息

- 文档编号：`KB-02`
- 文档类型：API 契约文档
- 所属目录：`.trae/documents/knowledge-base/`
- 创建时间：`2026-04-17`
- 最近更新时间：`2026-04-17`

## 时间线

### 2026-04-17

- 首次整理多知识库第一阶段的 API 契约
- 明确知识库、知识库文档、会话引入的请求和响应结构
- 与总方案文档建立字段级衔接，作为后端实现依据

## 关联文档

- [00-知识库文档导航.md](file:///d:/戈旭接的项目/gexuclaw/.trae/documents/knowledge-base/00-知识库文档导航.md)
- [01-多知识库分类与聊天引入设计方案.md](file:///d:/戈旭接的项目/gexuclaw/.trae/documents/knowledge-base/01-多知识库分类与聊天引入设计方案.md)
- 计划补充：`03-知识库开发任务清单.md`

## 一、范围说明

本契约文档覆盖第一阶段和与其直接耦合的接口：

- 知识库 CRUD
- 知识库文档管理
- 知识库检索测试
- 聊天会话中的知识库引入字段

统一约定：

- 所有接口均要求登录
- 除特别说明外，均返回 JSON
- 路径前缀统一为 `/api`
- 第一阶段沿用现有用户隔离逻辑，不支持跨用户访问

---

## 二、字段命名约定

### 2.1 命名规则

- 接口字段统一使用 `snake_case`
- 前后端展示名称由前端自行转中文
- 布尔字段统一使用 `is_` / `has_` 前缀

### 2.2 状态字段

知识库文档处理状态：

- `pending`
- `processing`
- `success`
- `failed`

---

## 三、通用数据结构

### 3.1 KnowledgeBase

```json
{
  "id": 1,
  "user_id": 12,
  "name": "合同审查库",
  "category": "法律业务",
  "description": "用于合同审查与条款比对",
  "is_default": false,
  "document_count": 6,
  "chunk_count": 132,
  "created_at": "2026-04-17T10:00:00Z",
  "updated_at": "2026-04-17T10:30:00Z"
}
```

### 3.2 KnowledgeDocument

```json
{
  "id": 10,
  "knowledge_base_id": 1,
  "user_id": 12,
  "original_filename": "劳动合同法.pdf",
  "stored_filename": "a1b2c3d4_劳动合同法.pdf",
  "file_path": "/documents/2026/04/a1b2c3d4_劳动合同法.pdf",
  "file_type": "application/pdf",
  "status": "success",
  "chunks_count": 38,
  "error_message": "",
  "created_at": "2026-04-17T10:05:00Z",
  "updated_at": "2026-04-17T10:06:00Z"
}
```

### 3.3 SearchResult

```json
{
  "content": "用人单位与劳动者协商一致，可以解除劳动合同。",
  "knowledge_base_id": 1,
  "knowledge_base_name": "劳动法库",
  "category": "法律业务",
  "document_id": 10,
  "filename": "劳动合同法.pdf",
  "chunk_index": 2,
  "score": 0.92
}
```

---

## 四、知识库管理接口

### 4.1 创建知识库

- 方法：`POST`
- 路径：`/api/knowledge-bases`

请求体：

```json
{
  "name": "合同审查库",
  "category": "法律业务",
  "description": "用于合同审查与条款比对"
}
```

校验规则：

- `name` 必填，1-100 字符
- `category` 选填，最长 100 字符
- `description` 选填，最长 1000 字符
- 同一用户下 `name` 唯一

成功响应：

```json
{
  "id": 1,
  "user_id": 12,
  "name": "合同审查库",
  "category": "法律业务",
  "description": "用于合同审查与条款比对",
  "is_default": false,
  "document_count": 0,
  "chunk_count": 0,
  "created_at": "2026-04-17T10:00:00Z",
  "updated_at": "2026-04-17T10:00:00Z"
}
```

错误响应：

- `400`：参数校验失败
- `409`：知识库名称重复

### 4.2 获取我的知识库列表

- 方法：`GET`
- 路径：`/api/knowledge-bases`

查询参数：

- `category`：可选，按分类筛选
- `include_stats`：可选，默认 `true`

成功响应：

```json
[
  {
    "id": 1,
    "user_id": 12,
    "name": "合同审查库",
    "category": "法律业务",
    "description": "用于合同审查与条款比对",
    "is_default": false,
    "document_count": 6,
    "chunk_count": 132,
    "created_at": "2026-04-17T10:00:00Z",
    "updated_at": "2026-04-17T10:30:00Z"
  }
]
```

### 4.3 获取知识库详情

- 方法：`GET`
- 路径：`/api/knowledge-bases/{knowledge_base_id}`

成功响应：

```json
{
  "id": 1,
  "user_id": 12,
  "name": "合同审查库",
  "category": "法律业务",
  "description": "用于合同审查与条款比对",
  "is_default": false,
  "document_count": 6,
  "chunk_count": 132,
  "created_at": "2026-04-17T10:00:00Z",
  "updated_at": "2026-04-17T10:30:00Z"
}
```

错误响应：

- `404`：知识库不存在

### 4.4 更新知识库

- 方法：`PUT`
- 路径：`/api/knowledge-bases/{knowledge_base_id}`

请求体：

```json
{
  "name": "合同审查知识库",
  "category": "法律业务",
  "description": "更新后的描述"
}
```

成功响应：

```json
{
  "id": 1,
  "user_id": 12,
  "name": "合同审查知识库",
  "category": "法律业务",
  "description": "更新后的描述",
  "is_default": false,
  "document_count": 6,
  "chunk_count": 132,
  "created_at": "2026-04-17T10:00:00Z",
  "updated_at": "2026-04-17T11:00:00Z"
}
```

错误响应：

- `404`：知识库不存在
- `409`：更新后的名称与现有知识库冲突

### 4.5 删除知识库

- 方法：`DELETE`
- 路径：`/api/knowledge-bases/{knowledge_base_id}`

成功响应：

```json
{
  "success": true,
  "message": "知识库已删除"
}
```

约束说明：

- 默认知识库是否允许删除，由后端策略决定
- 若删除成功，需要级联清理文档记录、原始文件和向量分块

---

## 五、知识库文档接口

### 5.1 上传文档到知识库

- 方法：`POST`
- 路径：`/api/knowledge-bases/{knowledge_base_id}/documents`
- Content-Type：`multipart/form-data`

表单字段：

- `file`：必填，支持 PDF、DOC、DOCX、ZIP

成功响应：

```json
{
  "success": true,
  "document": {
    "id": 10,
    "knowledge_base_id": 1,
    "user_id": 12,
    "original_filename": "劳动合同法.pdf",
    "stored_filename": "a1b2c3d4_劳动合同法.pdf",
    "file_path": "/documents/2026/04/a1b2c3d4_劳动合同法.pdf",
    "file_type": "application/pdf",
    "status": "pending",
    "chunks_count": 0,
    "error_message": "",
    "created_at": "2026-04-17T10:05:00Z",
    "updated_at": "2026-04-17T10:05:00Z"
  },
  "task_id": "celery-task-id"
}
```

错误响应：

- `400`：文件格式不支持
- `404`：知识库不存在
- `413`：文件过大

### 5.2 获取知识库文档列表

- 方法：`GET`
- 路径：`/api/knowledge-bases/{knowledge_base_id}/documents`

成功响应：

```json
[
  {
    "id": 10,
    "knowledge_base_id": 1,
    "user_id": 12,
    "original_filename": "劳动合同法.pdf",
    "stored_filename": "a1b2c3d4_劳动合同法.pdf",
    "file_path": "/documents/2026/04/a1b2c3d4_劳动合同法.pdf",
    "file_type": "application/pdf",
    "status": "success",
    "chunks_count": 38,
    "error_message": "",
    "created_at": "2026-04-17T10:05:00Z",
    "updated_at": "2026-04-17T10:06:00Z"
  }
]
```

### 5.3 删除知识库文档

- 方法：`DELETE`
- 路径：`/api/knowledge-bases/{knowledge_base_id}/documents/{document_id}`

成功响应：

```json
{
  "success": true,
  "message": "文档已删除"
}
```

约束说明：

- 删除后需要同步清理数据库记录、原始文件和向量分块

---

## 六、知识库检索测试接口

### 6.1 检索指定知识库

- 方法：`POST`
- 路径：`/api/knowledge-bases/search`

请求体：

```json
{
  "query": "劳动合同解除条件",
  "knowledge_base_ids": [1, 2],
  "top_k": 8
}
```

校验规则：

- `query` 必填
- `knowledge_base_ids` 至少 1 个
- `top_k` 默认为 `8`，建议限制为 `1-20`

成功响应：

```json
{
  "query": "劳动合同解除条件",
  "results": [
    {
      "content": "用人单位与劳动者协商一致，可以解除劳动合同。",
      "knowledge_base_id": 1,
      "knowledge_base_name": "劳动法库",
      "category": "法律业务",
      "document_id": 10,
      "filename": "劳动合同法.pdf",
      "chunk_index": 2,
      "score": 0.92
    }
  ],
  "results_count": 1
}
```

---

## 七、聊天会话接口扩展

### 7.1 创建会话

现有接口：

- `POST /api/sessions`

建议请求体扩展：

```json
{
  "title": "新会话",
  "provider": "deepseek",
  "model": "deepseek-chat",
  "knowledge_base_ids": [1, 3]
}
```

说明：

- 第一阶段允许为空数组
- 若不传则默认 `[]`

### 7.2 获取会话详情

现有接口：

- `GET /api/sessions/{session_id}`

响应体建议新增：

```json
{
  "id": 100,
  "session_id": "uuid",
  "user_id": 12,
  "title": "新会话",
  "provider": "deepseek",
  "model": "deepseek-chat",
  "knowledge_base_ids": [1, 3],
  "created_at": "2026-04-17T10:00:00Z",
  "updated_at": "2026-04-17T10:20:00Z"
}
```

### 7.3 更新会话知识库

建议新增接口：

- 方法：`PUT`
- 路径：`/api/sessions/{session_id}/knowledge-bases`

请求体：

```json
{
  "knowledge_base_ids": [1, 3]
}
```

成功响应：

```json
{
  "success": true,
  "session_id": "uuid",
  "knowledge_base_ids": [1, 3]
}
```

### 7.4 发送消息

现有接口：

- `POST /api/v1/chat`

请求体建议扩展：

```json
{
  "session_id": "uuid",
  "content": "请结合知识库分析这份协议",
  "provider": "deepseek",
  "model": "deepseek-chat",
  "knowledge_base_ids": [1, 3],
  "metadata": {}
}
```

说明：

- 若请求里未传 `knowledge_base_ids`，后端应退回使用会话已绑定的列表
- 后端执行知识检索时只能使用当前允许的知识库范围

---

## 八、错误码建议

### 8.1 通用错误

- `400`：请求参数错误
- `401`：未登录或 token 无效
- `403`：无权访问该知识库或文档
- `404`：资源不存在
- `409`：名称冲突
- `413`：上传文件过大
- `500`：服务端内部错误

### 8.2 错误体格式

```json
{
  "detail": "知识库不存在"
}
```

---

## 九、实施优先级

建议按以下顺序实现：

1. 知识库 CRUD
2. 会话 `knowledge_base_ids` 字段
3. 文档上传改为绑定知识库
4. 文档列表和删除
5. 检索测试接口

这样前后端可以尽早开始联调基础能力。
