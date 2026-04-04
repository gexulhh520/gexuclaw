"""
测试浏览器工具的 get_page_markdown 功能
测试 URL: http://www.baidu.com/s?wd=%E9%94%A6%E6%B1%9F%E9%85%92%E5%BA%97+%E8%82%A1%E4%BB%B7+600754
"""
import asyncio
import sys
import os

# 添加 backend 到路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

from tools.browser.tool import BrowserTool
from tools.network.tool import NetworkTool


async def test_get_page_markdown():
    """测试获取页面 Markdown"""
    tool = BrowserTool()
    
    # 测试 URL
    test_url = "http://www.baidu.com/s?wd=%E9%94%A6%E6%B1%9F%E9%85%92%E5%BA%97+%E8%82%A1%E4%BB%B7+600754"
    
    print("=" * 60)
    print("测试浏览器工具 - 获取页面 Markdown")
    print("=" * 60)
    
    # 1. 启动浏览器
    print("\n[1] 启动浏览器...")
    result = await tool.launch_browser(browser_session_id="test_session")
    print(f"结果: {result}")
    
    if not result.success:
        print("启动浏览器失败!")
        return
    
    session_id = result.data.get("session_id")
    print(f"Session ID: {session_id}")
    
    try:
        # 2. 导航到目标页面
        print(f"\n[2] 导航到页面: {test_url}")
        result = await tool.navigate(session_id=session_id, url=test_url)
        print(f"结果: {result}")
        
        if not result.success:
            print("导航失败!")
            return
        
        # 3. 等待页面加载完成
        print("\n[3] 等待 3 秒让页面完全加载...")
        await asyncio.sleep(3)
        
        # 4. 获取页面 Markdown
        print("\n[4] 获取页面 Markdown...")
        result = await tool.get_page_markdown(session_id=session_id)
        
        if result.success:
            print(f"\n成功! 页面 URL: {result.meta.get('url')}")
            print(f"内容长度: {result.meta.get('length')} 字符")
            print("\n" + "=" * 60)
            print("Markdown 内容预览 (前 2000 字符):")
            print("=" * 60)
            content = result.data
            print(content[:2000] if len(content) > 2000 else content)
            if len(content) > 2000:
                print("\n... (内容已截断)")
            
            # 保存到文件
            output_file = "test_output.md"
            with open(output_file, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"\n完整内容已保存到: {output_file}")
        else:
            print(f"获取 Markdown 失败: {result.error}")
        
        # 5. 测试获取指定元素的 Markdown
        print("\n[5] 测试获取指定元素 (#content_left) 的 Markdown...")
        result = await tool.get_page_markdown(
            session_id=session_id, 
            selector="#content_left"
        )
        
        if result.success:
            print(f"成功! 内容长度: {result.meta.get('length')} 字符")
            print("\n左侧内容区 Markdown 预览 (前 1000 字符):")
            print("-" * 60)
            content = result.data
            print(content[:1000] if len(content) > 1000 else content)
        else:
            print(f"获取指定元素失败: {result.error}")
        
    finally:
        # 6. 关闭浏览器
        print("\n[6] 关闭浏览器...")
        result = await tool.close_session(session_id=session_id)
        print(f"结果: {result}")
    
    print("\n" + "=" * 60)
    print("测试完成!")
    print("=" * 60)


async def test_network_fetch_and_convert():
    """测试使用 NetworkTool 获取页面并转换为 Markdown"""
    network_tool = NetworkTool()
    
    # 测试 URL
    test_url = "http://www.baidu.com/s?wd=%E9%94%A6%E6%B1%9F%E9%85%92%E5%BA%97+%E8%82%A1%E4%BB%B7+600754"
    
    print("\n" + "=" * 60)
    print("测试 NetworkTool - 获取页面并转 Markdown")
    print("=" * 60)
    
    # 1. 使用 NetworkTool 获取页面
    print(f"\n[1] 使用 NetworkTool 获取页面: {test_url}")
    result = await network_tool.fetch_url(test_url)
    
    if not result.success:
        print(f"获取页面失败: {result.error}")
        return
    
    print(f"成功! HTTP 状态码: {result.data.get('status')}")
    html_content = result.data.get('content', '')
    print(f"HTML 内容长度: {len(html_content)} 字符")
    
    # 2. 使用 markdownify 转换 HTML 为 Markdown
    print("\n[2] 转换 HTML 为 Markdown...")
    try:
        from markdownify import markdownify as md
        markdown_content = md(html_content, heading_style="ATX")
        
        # 限制返回内容长度
        max_length = 10000
        if len(markdown_content) > max_length:
            markdown_content = markdown_content[:max_length] + "\n\n... (内容已截断)"
        
        print(f"Markdown 内容长度: {len(markdown_content)} 字符")
        print("\n" + "=" * 60)
        print("Markdown 内容预览 (前 2000 字符):")
        print("=" * 60)
        print(markdown_content[:2000] if len(markdown_content) > 2000 else markdown_content)
        if len(markdown_content) > 2000:
            print("\n... (内容已截断)")
        
        # 保存到文件
        output_file = "test_network_output.md"
        with open(output_file, "w", encoding="utf-8") as f:
            f.write(markdown_content)
        print(f"\n完整内容已保存到: {output_file}")
        
    except ImportError:
        print("错误: 未安装 markdownify，请运行: pip install markdownify")
    except Exception as e:
        print(f"转换失败: {e}")
    
    print("\n" + "=" * 60)
    print("NetworkTool 测试完成!")
    print("=" * 60)


async def main():
    """主函数：运行所有测试"""
    # 测试 1: 浏览器工具
    await test_get_page_markdown()
    
    # 测试 2: NetworkTool
    await test_network_fetch_and_convert()


if __name__ == "__main__":
    asyncio.run(main())
