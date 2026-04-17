#!/usr/bin/env python
"""测试 KnowledgeTool"""

from tools.tool_registry import registry
from tools.tool_discovery import discover_tools

# 发现所有工具
discover_tools()

# 获取 knowledge 工具实例
knowledge_tool = registry.get_tool('knowledge')
print(f'工具类别: {knowledge_tool.category}')
print(f'工具描述: {knowledge_tool.description}')
print(f'操作列表:')
for op in knowledge_tool.get_operations():
    param_names = [p['name'] for p in op.parameters]
    print(f'  - {op.name}: {op.description}')
    print(f'    参数: {param_names}')

# 测试 check 操作
print('\n--- 测试 check 操作 ---')
result = knowledge_tool.execute('check', {'user_id': 1})
print(f'check(user_id=1): success={result.success}, data={result.data}')

# 测试 stats 操作
print('\n--- 测试 stats 操作 ---')
result = knowledge_tool.execute('stats', {'user_id': 1})
print(f'stats(user_id=1): success={result.success}, data={result.data}')

# 测试 search 操作（无数据情况）
print('\n--- 测试 search 操作（无数据） ---')
result = knowledge_tool.execute('search', {'query': '测试', 'user_id': 1})
print(f'search(query="测试", user_id=1): success={result.success}, data={result.data}')
