# OpenClaw 浏览器启动流程详解

## 概述

本文档详细说明 OpenClaw 如何创建浏览器 Profile、启动 Chrome 浏览器，以及 Playwright 如何连接控制浏览器。

---

## 一、Profile 创建流程

### 1.1 创建入口

**文件**: `src/browser/profiles-service.ts:80`

```typescript
const createProfile = async (params: CreateProfileParams): Promise<CreateProfileResult> => {
  const name = params.name.trim();  // 如: "deepseek"
  
  // 1. 验证名称格式
  if (!isValidProfileName(name)) {
    throw new BrowserValidationError(
      "invalid profile name: use lowercase letters, numbers, and hyphens only",
    );
  }
  
  // 2. 检查是否已存在
  if (name in resolvedProfiles) {
    throw new BrowserConflictError(`profile "${name}" already exists`);
  }
  
  // 3. 分配颜色
  const usedColors = getUsedColors(resolvedProfiles);
  const profileColor = allocateColor(usedColors);
  // 颜色池: ["#FF4500", "#0066CC", "#00AA00", "#9933FF", ...]
  
  // 4. 分配 CDP 端口
  const usedPorts = getUsedPorts(resolvedProfiles);
  const range = { start: 18800, end: 18899 };  // 端口范围
  const cdpPort = allocateCdpPort(usedPorts, range);
  // 分配原则: 从 18800 开始，找到第一个未使用的端口
  
  // 5. 创建配置对象
  const profileConfig = {
    cdpPort,      // 如: 18801
    color,        // 如: "#0066CC"
  };
  
  // 6. 写入配置文件
  const nextConfig = {
    ...cfg,
    browser: {
      ...cfg.browser,
      profiles: {
        ...rawProfiles,
        [name]: profileConfig,
      },
    },
  };
  await writeConfigFile(nextConfig);
  // 写入: ~/.openclaw/openclaw.json
};
```

### 1.2 生成的配置示例

```json
// ~/.openclaw/openclaw.json
{
  "browser": {
    "enabled": true,
    "profiles": {
      "deepseek": {
        "cdpPort": 18801,
        "color": "#0066CC"
      },
      "openclaw": {
        "cdpPort": 18800,
        "color": "#FF4500"
      }
    }
  }
}
```

---

## 二、用户数据目录创建

### 2.1 目录结构

```
~/.openclaw/
├── openclaw.json                    # 主配置文件
└── browser/
    └── deepseek/                    # Profile 目录
        └── user-data/               # Chrome 用户数据目录
            ├── Local State          # Chrome 状态文件
            ├── Default/             # 默认用户配置
            │   ├── Cookies          # Cookie 数据库
            │   ├── Preferences      # 用户偏好设置
            │   ├── Login Data       # 保存的密码
            │   └── ...
            └── .openclaw-profile-decorated  # 装饰标记文件
```

### 2.2 目录创建时机

**文件**: `src/browser/chrome.ts:272`

```typescript
function launchChrome(profile: ResolvedBrowserProfile) {
  // 解析用户数据目录路径
  const userDataDir = resolveOpenClawUserDataDir(profile.name);
  // 返回: ~/.openclaw/browser/deepseek/user-data
  
  // 创建目录（如果不存在）
  fs.mkdirSync(userDataDir, { recursive: true });
  
  // 后续启动 Chrome...
}
```

### 2.3 路径解析函数

**文件**: `src/browser/chrome.ts:70`

```typescript
export function resolveOpenClawUserDataDir(
  profileName = DEFAULT_OPENCLAW_BROWSER_PROFILE_NAME
) {
  return path.join(CONFIG_DIR, "browser", profileName, "user-data");
  // CONFIG_DIR = ~/.openclaw
}
```

---

## 三、Chrome 启动流程

### 3.1 启动入口

**文件**: `src/browser/chrome.ts:260`

```typescript
export async function launchChrome(
  resolved: ResolvedBrowserConfig,
  profile: ResolvedBrowserProfile
): Promise<RunningChrome> {
  // 1. 确保端口可用
  await ensurePortAvailable(profile.cdpPort);
  
  // 2. 查找 Chrome 可执行文件
  const exe = resolveBrowserExecutable(resolved);
  // 返回: { kind: "chrome", path: "/usr/bin/google-chrome" }
  
  // 3. 创建用户数据目录
  const userDataDir = resolveOpenClawUserDataDir(profile.name);
  fs.mkdirSync(userDataDir, { recursive: true });
  
  // 4. 检查是否需要装饰 Profile
  const needsDecorate = !isProfileDecorated(userDataDir, profile.name, profile.color);
  
  // 5. 首次启动引导（创建默认文件）
  if (needsBootstrap) {
    const bootstrap = spawnOnce();
    // 等待创建 Local State 和 Preferences
    await waitForPrefsCreated();
    bootstrap.kill();
  }
  
  // 6. 装饰 Profile（设置颜色等）
  if (needsDecorate) {
    decorateOpenClawProfile(userDataDir, { color: profile.color });
  }
  
  // 7. 正式启动 Chrome
  const proc = spawnOnce();
  
  // 8. 等待 CDP 就绪
  await waitForCdpReady(profile.cdpPort);
  
  return {
    pid: proc.pid,
    exe,
    userDataDir,
    cdpPort: profile.cdpPort,
    startedAt: Date.now(),
    proc,
  };
}
```

### 3.2 Chrome 查找逻辑

**文件**: `src/browser/chrome.executables.ts`

```typescript
export function resolveBrowserExecutableForPlatform(
  resolved: ResolvedBrowserConfig,
  platform: NodeJS.Platform
): BrowserExecutable | null {
  // 按优先级查找
  
  // Windows 路径
  const windowsPaths = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    // ...
  ];
  
  // macOS 路径
  const macPaths = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    // ...
  ];
  
  // Linux 路径
  const linuxPaths = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/brave-browser",
    "/usr/bin/microsoft-edge",
    // ...
  ];
  
  // 返回第一个找到的可执行文件
  return findFirstExisting(paths);
}
```

### 3.3 启动参数详解

**文件**: `src/browser/chrome.ts:285-330`

```typescript
const spawnOnce = () => {
  const args: string[] = [
    // ==================== 核心参数 ====================
    
    // CDP 调试端口（必需）
    // Playwright 通过此端口连接 Chrome
    `--remote-debugging-port=${profile.cdpPort}`,  // 如: 18801
    
    // 用户数据目录（关键！）
    // 保留登录态、Cookie、LocalStorage 等
    `--user-data-dir=${userDataDir}`,  // 如: ~/.openclaw/browser/deepseek/user-data
    
    // ==================== 首次运行优化 ====================
    
    // 跳过首次运行向导
    "--no-first-run",
    
    // 不检查默认浏览器
    "--no-default-browser-check",
    
    // ==================== 禁用功能 ====================
    
    // 禁用 Google 同步
    "--disable-sync",
    
    // 禁用后台网络活动
    "--disable-background-networking",
    
    // 禁用组件更新
    "--disable-component-update",
    
    // 禁用特定功能（翻译、媒体路由）
    "--disable-features=Translate,MediaRouter",
    
    // ==================== 崩溃恢复 ====================
    
    // 禁用"上次未正常关闭"提示
    "--disable-session-crashed-bubble",
    
    // 隐藏恢复提示气泡
    "--hide-crash-restore-bubble",
    
    // ==================== 密码存储 ====================
    
    // 使用基本密码存储（避免系统密钥链依赖）
    "--password-store=basic",
    
    // ==================== 无头模式（可选）====================
    
    // 启用新版无头模式
    "--headless=new",
    
    // 禁用 GPU（无头模式需要）
    "--disable-gpu",
    
    // ==================== 沙箱（可选）====================
    
    // 禁用沙箱（Docker 或特殊环境需要）
    "--no-sandbox",
    "--disable-setuid-sandbox",
    
    // ==================== Linux 特殊优化 ====================
    
    // 禁用 /dev/shm 使用（避免内存不足问题）
    "--disable-dev-shm-usage",
    
    // ==================== 用户自定义参数 ====================
    
    // 追加用户配置的额外参数
    ...resolved.extraArgs,  // 如: ["--window-size=1920,1080"]
    
    // ==================== 初始页面 ====================
    
    // 始终打开空白页，确保有目标存在
    "about:blank",
  ];
  
  // 使用 Node.js spawn 启动进程
  return spawn(exe.path, args, {
    stdio: "pipe",  // 管道标准输入输出
    env: {
      ...process.env,
      HOME: os.homedir(),  // 设置 HOME 环境变量
    },
  });
};
```

### 3.4 启动参数分类表

| 类别 | 参数 | 说明 |
|------|------|------|
| **核心** | `--remote-debugging-port` | CDP 调试端口，Playwright 连接用 |
| **核心** | `--user-data-dir` | 用户数据目录，保留登录态 |
| **优化** | `--no-first-run` | 跳过首次运行向导 |
| **优化** | `--no-default-browser-check` | 不检查默认浏览器 |
| **禁用** | `--disable-sync` | 禁用 Google 同步 |
| **禁用** | `--disable-background-networking` | 禁用后台网络 |
| **禁用** | `--disable-component-update` | 禁用组件更新 |
| **禁用** | `--disable-features` | 禁用特定功能 |
| **恢复** | `--disable-session-crashed-bubble` | 禁用崩溃提示 |
| **密码** | `--password-store=basic` | 基本密码存储 |
| **无头** | `--headless=new` | 新版无头模式 |
| **无头** | `--disable-gpu` | 禁用 GPU |
| **沙箱** | `--no-sandbox` | 禁用沙箱 |
| **Linux** | `--disable-dev-shm-usage` | 禁用 /dev/shm |

---

## 四、Playwright 连接流程

### 4.1 连接入口

**文件**: `src/browser/pw-session.ts`

```typescript
import { chromium } from "playwright-core";

export async function createBrowserSession(
  profile: ResolvedBrowserProfile
): Promise<BrowserSession> {
  // 1. 构建 CDP URL
  const cdpUrl = `http://127.0.0.1:${profile.cdpPort}`;
  
  // 2. 通过 CDP 连接已启动的 Chrome
  const browser = await chromium.connectOverCDP(cdpUrl);
  
  // 3. 获取或创建上下文
  const context = browser.contexts()[0] || await browser.newContext();
  
  // 4. 获取或创建页面
  const page = context.pages()[0] || await context.newPage();
  
  return {
    browser,
    context,
    page,
    profile,
  };
}
```

### 4.2 连接流程图

```
┌─────────────────────────────────────────┐
│  1. Chrome 启动完成                      │
│     - 进程 PID: 12345                   │
│     - CDP 端口: 18801                   │
│     - 监听: ws://127.0.0.1:18801        │
└─────────────────────────────────────────┘
                    │
                    │ 等待 CDP 就绪
                    ▼
┌─────────────────────────────────────────┐
│  2. Playwright 连接                      │
│     chromium.connectOverCDP()           │
│     URL: http://127.0.0.1:18801         │
└─────────────────────────────────────────┘
                    │
                    │ WebSocket 握手
                    ▼
┌─────────────────────────────────────────┐
│  3. CDP 会话建立                         │
│     - 获取 Browser 实例                  │
│     - 获取 Context                       │
│     - 获取 Page                          │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│  4. 浏览器控制就绪                       │
│     - 可以执行: page.click()             │
│     - 可以执行: page.type()              │
│     - 可以执行: page.screenshot()        │
└─────────────────────────────────────────┘
```

### 4.3 连接代码示例

```typescript
// 连接到已启动的 Chrome
const browser = await chromium.connectOverCDP("http://127.0.0.1:18801");

// 获取默认上下文
const context = browser.contexts()[0];

// 获取默认页面
const page = context.pages()[0];

// 执行操作
await page.goto("https://chat.deepseek.com");
await page.fill('textarea', 'Hello');
await page.press('textarea', 'Enter');

// 截图
await page.screenshot({ path: 'screenshot.png' });
```

---

## 五、完整流程图

```
┌─────────────────────────────────────────────────────────────┐
│                     Profile 创建阶段                         │
│                  (profiles-service.ts)                       │
├─────────────────────────────────────────────────────────────┤
│  1. 验证名称格式 (小写字母、数字、连字符)                      │
│  2. 分配颜色 (从预设调色板)                                  │
│  3. 分配 CDP 端口 (18800-18899)                             │
│  4. 写入配置: ~/.openclaw/openclaw.json                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  用户数据目录创建阶段                         │
│                      (chrome.ts)                             │
├─────────────────────────────────────────────────────────────┤
│  创建目录: ~/.openclaw/browser/{profile}/user-data           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Chrome 启动阶段                           │
│                      (chrome.ts)                             │
├─────────────────────────────────────────────────────────────┤
│  1. 查找 Chrome 可执行文件                                   │
│     - Windows: chrome.exe, msedge.exe...                     │
│     - macOS: Google Chrome.app...                            │
│     - Linux: google-chrome, chromium...                      │
│                                                              │
│  2. 构建启动参数                                             │
│     --remote-debugging-port=18801                           │
│     --user-data-dir=~/.openclaw/browser/deepseek/user-data   │
│     --no-first-run                                          │
│     --disable-sync                                          │
│     ...                                                      │
│                                                              │
│  3. 使用 Node.js spawn 启动                                  │
│     spawn("/usr/bin/google-chrome", args)                    │
│                                                              │
│  4. 等待 CDP 就绪                                            │
│     轮询: http://127.0.0.1:18801/json/version                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Playwright 连接阶段                         │
│                     (pw-session.ts)                          │
├─────────────────────────────────────────────────────────────┤
│  1. 通过 CDP 连接                                            │
│     chromium.connectOverCDP("http://127.0.0.1:18801")       │
│                                                              │
│  2. 获取 Browser/Context/Page 实例                           │
│                                                              │
│  3. 浏览器控制就绪！                                         │
│     - page.goto()                                            │
│     - page.click()                                           │
│     - page.type()                                            │
│     - page.screenshot()                                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 六、关键文件位置

| 功能 | 文件路径 |
|------|----------|
| Profile 创建 | `src/browser/profiles-service.ts:80` |
| Chrome 启动 | `src/browser/chrome.ts:260` |
| Chrome 查找 | `src/browser/chrome.executables.ts` |
| Playwright 连接 | `src/browser/pw-session.ts` |
| Profile 配置 | `~/.openclaw/openclaw.json` |
| 用户数据目录 | `~/.openclaw/browser/{profile}/user-data` |

---

## 七、常见问题

### Q1: 为什么使用 `--user-data-dir`？
**A**: 保留登录态、Cookie、LocalStorage 等用户数据，实现"记住登录状态"功能。

### Q2: 为什么使用 `spawn` 而不是 Playwright 直接启动？
**A**: 需要自定义启动参数（如 `--user-data-dir`、Profile 装饰等），并且需要精细控制浏览器生命周期。

### Q3: CDP 端口范围为什么是 18800-18899？
**A**: 避免与系统端口冲突，同时预留足够端口支持多 Profile（最多 100 个）。

### Q4: 如何调试浏览器启动问题？
**A**: 
1. 检查配置文件: `cat ~/.openclaw/openclaw.json`
2. 手动启动 Chrome 测试参数
3. 查看日志: `openclaw logs browser`

---

*文档生成时间: 2026-03-30*
