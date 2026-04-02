"""
测试 BrowserManager 是否正常工作
"""
import asyncio
from tools.browser.browser_manager import get_browser_manager
from tools.browser.session_manager import get_session_manager


async def test_browser_manager():
    print("=== 测试 BrowserManager ===\n")
    
    # 1. 获取 BrowserManager
    bm = get_browser_manager()
    print(f"[Test] BrowserManager 实例: {bm}")
    
    # 2. 初始化
    print("\n[Test] 正在初始化...")
    await bm.initialize()
    print("[Test] 初始化完成!")
    
    # 3. 创建 Context
    session_id = "test_session_001"
    print(f"\n[Test] 创建 Context: {session_id}")
    context = await bm.get_or_create_context(session_id)
    print(f"[Test] Context 创建成功: {context}")
    
    # 4. 创建 Page
    print(f"\n[Test] 创建 Page...")
    page = await context.new_page()
    print(f"[Test] Page 创建成功: {page}")
    
    # 5. 导航到百度
    print(f"\n[Test] 导航到 https://www.baidu.com...")
    await page.goto("https://www.baidu.com", wait_until="networkidle")
    title = await page.title()
    print(f"[Test] 页面标题: {title}")
    
    # 6. 截图
    print(f"\n[Test] 截图...")
    screenshot_bytes = await page.screenshot()
    print(f"[Test] 截图成功，大小: {len(screenshot_bytes)} bytes")
    
    # 7. 关闭 Page
    print(f"\n[Test] 关闭 Page...")
    await page.close()
    print("[Test] Page 已关闭")
    
    # 8. 关闭 Context
    print(f"\n[Test] 关闭 Context...")
    await bm.close_context(session_id)
    print("[Test] Context 已关闭")
    
    # 9. 关闭 BrowserManager
    print(f"\n[Test] 关闭 BrowserManager...")
    await bm.shutdown()
    print("[Test] BrowserManager 已关闭")
    
    print("\n=== 所有测试通过! ===")


if __name__ == "__main__":
    asyncio.run(test_browser_manager())
