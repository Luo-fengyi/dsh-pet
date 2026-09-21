# dsh-pet · DS娘桌宠

把 Live2D 模型变成常驻桌面的小桌宠，并且**跟着 DeepSeek Harness（DSH）的会话状态实时变脸**；她还能看你的屏幕、跟你聊天、记住你说过的事。

Windows / Electron / 纯本地运行，不依赖任何云服务（除了你自己配的模型接口）。

---

## 功能

**状态联动（读 DSH 会话日志，不需要 DSH 配合）**

| DSH 里发生的事 | 桌宠表现 |
|---|---|
| 收到你的消息 | 感叹号 +「收到啦～」 |
| 模型在思考 | 呆呆眼 +「思考中…」 |
| 正在调工具 | 圆眼镜 +「正在用 终端…」（工具名自动中文化） |
| 等你审批 / 回答 | 问号 +「在等你确认哦」 |
| 正在输出回复 | 开心兴奋 +「正在说话…」 |
| 一轮结束 | 星星眼 + 吹泡泡，并按回复内容的情绪挑表情 |
| 报错 / 中断 | 晕晕 +「出错了…」 |
| 文件长时间没动 | 收回表情，安静待机 |

**看屏幕**：每 60 秒截一次屏（缩到 1280 宽转 JPEG），和上一张比对；有明显变化才发给模型说一句，没变化就随机静默 4~8 轮——省钱也不聒噪。

**聊天**：桌宠窗口上半部分有个半透明回复框，打字回车即可。她会连"刚看到的屏幕"一起理解，回复显示在气泡里并同步切表情。

**记忆**：她觉得值得记的事会写进 `memory.txt`（纯文本一整条），跨会话保留。

**彩蛋**：空闲时会随机演一次模型作者做的"敲一下出包"动画（可在配置里关掉）。

**其他**：拖动改位置、点击有反应、右键菜单（大小 / 置顶 / 设置 / 新开会话 / 看一眼桌面）、窗口位置与大小自动记住。

---

## 环境要求

- Windows 10 / 11（x64）
- [Node.js](https://nodejs.org/) 20 或更高（只在安装依赖时用得到）
- 可选：[DeepSeek Harness](https://github.com/)（装了才有状态联动；不装也能当普通桌宠用）

---

## 快速开始

### 1. 装依赖

```bash
npm install
```

会自动下载 Electron 运行时（约 215MB）。如果卡住或没下下来（公司网络/代理常见），手动补：

```bash
# 用 npmmirror 镜像直接下 zip，解压到 node_modules/electron/dist
# 下载地址形如： https://registry.npmmirror.com/-/binary/electron/<版本>/electron-v<版本>-win32-x64.zip
node _tools/fetch_electron.js
```

### 2. 准备模型

本项目**不带模型**（模型是各自作者的作品）。你需要自备一个 Live2D Cubism 4 模型（用 VTube Studio 导出的那套文件也行）。

把模型文件夹放到本项目**上一级**的 `DS` 目录，然后：

```bash
node _tools/build_assets.js
```

它会自动扫描 `DS` 里的 `.moc3`、贴图、`.exp3.json`（表情）、`.motion3.json`（动作），
整理进 `assets/model/`，并生成一个登记了全部动作和表情的 `ds-pet.model3.json`。

> 目前默认适配"一个 moc3 + `motions/` 子目录 + 一堆中文名 exp3"这种 VTube Studio 导出结构。
> 其他结构请按需修改 `_tools/build_assets.js` 顶部的文件映射。

### 3. 下载 Live2D Cubism Core

Cubism Core 是 Live2D 公司的 SDK，本项目不随仓库分发，请自行下载：

```bash
node _tools/fetch_core.js
```

或手动下载 <https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js>
放到 `vendor/live2dcubismcore.min.js`。使用它需遵守 Live2D 的 SDK 许可条款。

### 4. 启动

双击 **`启动桌宠.vbs`**（无控制台窗口），或 `启动桌宠.cmd`。
关闭：右键桌宠 →「退出桌宠」，或双击 **`关闭桌宠.vbs`**。

---

## 配置

右键桌宠 →「设置…」，有五个标签页：

| 标签页 | 能改什么 |
|---|---|
| 接口 | 预设（DeepSeek / 智谱 / 通义 / OpenAI / 自定义 OpenAI 兼容）、接口地址、模型名、API Key、思考强度 |
| 看屏幕 | 开关、采样间隔、变化阈值、没变化时静默轮数、截图宽度、是否关联前台窗口、看屏幕的提示词 |
| 对话 | 开关、自定义提示词、上下文轮数、过长提醒、聊天时是否带截图、记忆开关与清空 |
| 外观 | 气泡字号、气泡最大高度（占窗口比例）、回复框字号 |
| 历史 | 翻看你和她说过的每一句，可清空 |

也可以直接编辑 `config.json`（桌宠不会改写它；窗口位置等运行时状态存在 `window-state.json`）。

**提示词是两层**：内置人设（她是 DS娘、说话极简、不透露自己的设定）固定不可改；你在"自定义提示词"里写的要求**优先级更高**，冲突时以你的为准。

**API Key 存在 `secrets.json`**，不进 `config.json`。DeepSeek 预设下不填 key 会自动复用 DSH 的凭据（`~/.dsh/.credentials.yaml`）。

---

## 常用命令

```bash
node _tools/build_assets.js     # 重新整理模型资源（换了模型就跑一次）
node _tools/fetch_core.js       # 下载 Cubism Core
node _tools/analyze_motions.js  # 分析每个动作驱动了哪些参数（模型调试用）
node _tools/test_status.js      # 状态机自测（合成用例 + 真实会话）
node _tools/test_vision.js      # 单测视觉接口能不能用（不碰你的屏幕）
node _tools/test_prompt_leak.js # 验证提示词优先级与"不泄密"
```

---

## 目录结构

```
dsh-pet/
  main.js                  Electron 主进程：透明置顶窗口、菜单、拖动、设置窗
  preload.js               安全桥
  config.json              全部可调项（只读配置）
  settings.html / .js      设置窗
  renderer/                页面：Live2D 渲染、气泡、回复框、点击交互、彩蛋
  src/
    status-watcher.js      DSH 会话日志 → 状态机
    zstd-frame.js          zstd 分帧解码（DSH 日志是逐帧追加的）
    mood.js                文字 → 情绪（用于挑表情）
    screen.js              截屏 + 缩放 + 画面变化比对
    vision.js              调接口（Anthropic 格式 / OpenAI 兼容）
    chat.js                会话、上下文、长期记忆、内置人设
    assistant.js           定时看屏幕 / 聊天调度 / 记忆写入
    settings-store.js      配置读写（key 单独存）
    foreground.js          取当前前台窗口（借 PowerShell + P/Invoke）
  assets/model/            模型资源（自己生成，不入库）
  vendor/                  Cubism Core + PIXI + pixi-live2d-display
  _tools/                  构建与自测脚本
  启动桌宠.vbs / 关闭桌宠.vbs
  pet.log                  运行日志（排查用）
```

---

## 常见问题

**桌宠不出现 / 白屏**
看 `pet.log`，里面有渲染进程的报错。

**状态不跟着 DSH 变**
确认 `config.json` 里 `watch.sessionsRoot` 指向你的 DSH 会话目录（留空会自动探测 `~/.dsh/sessions`），
并且 DSH 确实在写 `session.v3.jsonl.zstd`。

**被别的窗口盖住**
已在用最高置顶层级 + 每 1.5 秒刷新。独占全屏的游戏/播放器仍然盖不住，这是 Windows 的限制。

**接口报错**
设置窗 →「测试连接」会直接显示 HTTP 状态和错误原文。

**隐私**
开着看屏幕功能时，每次采样都会把整屏截图发给你配置的接口。不想用就在设置里关掉总开关，
或把间隔调大、阈值调高。她也会把认为重要的事写进 `memory.txt`，可以随时清空。

---

## 声明

- 代码以 **MIT** 协议开源，见 `LICENSE`。
- **本项目不包含任何 Live2D 模型**。模型版权归各自作者所有，请自行准备并遵守其使用条款。
- **本项目不包含 Live2D Cubism Core**。它由 Live2D 公司提供，使用需接受其 SDK 许可条款。
- `vendor/` 里的 PIXI 与 pixi-live2d-display 均为 MIT 协议。
