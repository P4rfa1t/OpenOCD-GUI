# OpenOCD-GUI

[English](README.md) | **简体中文**

[OpenOCD](https://openocd.org)（适配 OpenOCD **0.12.0+dev**）的跨平台图形前端，基于 **Tauri 2** 构建——Rust 后端 + Web 前端，打包为小巧的原生可执行文件，无需任何脚本运行时。

[![Rust](https://img.shields.io/badge/rust-stable-orange)]() [![Tauri](https://img.shields.io/badge/Tauri-2-blue)]() [![License: MIT](https://img.shields.io/badge/license-MIT-green)]() [![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey)]()

> **历史**：v0.1.x 曾以 Python/Tkinter 实现。v0.2.0 起项目切换到 Tauri 2 作为主框架——Python 实现已从仓库移除（git 历史仍可查），本次选型的实测依据保存在 [docs/framework-evaluation.md](docs/framework-evaluation.md)（Tkinter / PySide6 / PyQt6 / Tauri 2 / Wails v2 / Flutter 六框架对比）。

## ✨ 功能

| 模块 | 说明 |
|---|---|
| ⚙️ **配置** | 自动检测 `openocd` 可执行文件与脚本目录、`interface / target / board` 脚本选择、有序配置列表（`-f`）、附加命令（`-c`）、端口、调试级别、连接预设（共享 `~/.openocd_gui` 布局） |
| 📜 **日志** | 彩色分级实时输出、过滤、自动滚动 |
| 💻 **控制台** | 基于 TCL RPC 端口的交互式命令行、历史记录、快捷命令 |
| 🎯 **目标** | 目标表格自动轮询、halt / resume / 软复位 / reset（halt·run·init）、切换当前目标 |
| 🧮 **寄存器** | 分组寄存器转储、筛选、暂停时自动刷新、双击改值 |
| 🧠 **内存** | 8/16/32/64 位十六进制查看/编辑器、翻页、ASCII 列、双击改值 |
| ⬇️ **烧写** | 一键固件烧写（`program`，支持 verify / preverify / reset / 偏移；非 ASCII 路径自动按 ANSI 编码页编码）、flash bank 信息、扇区擦除 |
| 🛑 **断点** | 硬件/软件断点与观察点（`bp/rbp/wp/rwp`）列表化管理 |
| 🔗 **GDB** | 连接信息、一键复制命令行、一键启动外部 GDB |

## 🚀 快速开始

### 方式一 — 下载 Windows 可执行文件

从 [Releases](https://github.com/P4rfa1t/OpenOCD-GUI/releases/latest) 下载 **`OpenOCD-GUI.exe`** 和 **`WebView2Loader.dll`**，**两个文件放在同一目录**。

- 需要 WebView2 Runtime——Windows 10/11 系统自带（老系统装 [Evergreen 运行时](https://developer.microsoft.com/microsoft-edge/webview2/)）
- 之所以需要单独的 `WebView2Loader.dll`，是因为发布构建使用 **mingw** 工具链（动态链接 loader）；用 MSVC 工具链自行构建可静态嵌入——见下方构建说明

### 方式二 — 源码构建

前置：[Rust](https://rustup.rs) 工具链 + OpenOCD ≥ 0.12（GUI 使用 0.12 引入的 `gdb port` / `tcl port` / `telnet port` 层级命令语法）。

```bash
git clone https://github.com/P4rfa1t/OpenOCD-GUI.git
cd OpenOCD-GUI/src-tauri
cargo build --release
```

工具链说明：

- **MSVC**（Windows 默认）：产出单文件、自包含的 exe
- **GNU/mingw**（`x86_64-pc-windows-gnu`）：构建会动态链接 `WebView2Loader.dll`——cargo 会把它放到 `target/release/` 里，分发时与 exe 一起打包。若链接器不在 PATH，添加 `src-tauri/.cargo/config.toml`（已 gitignore，机器相关）：
  ```toml
  [target.x86_64-pc-windows-gnu]
  linker = "C:/msys64/ucrt64/bin/gcc.exe"
  ```

### 日常工作流

1. **配置**页 → 设置可执行文件（或"自动检测"），选择 `interface` + `target` 配置，按需添加附加命令如 `adapter speed 3000`、`transport select swd`
2. 工具栏 **▶ 启动** → OpenOCD 启动，GUI 自动连接其 TCL RPC 端口（默认 6666）
3. 用 **目标 / 寄存器 / 内存 / 断点** 各页控制目标；**烧写**页烧录固件
4. **GDB** 页提供现成的连接命令行（`target remote localhost:3333`），供外部 GDB 使用
5. **■ 停止** 先向 OpenOCD 发送优雅的 `shutdown`（失败则回退到强制终止）

## 🧱 架构

```
OpenOCD-GUI/
├── src-tauri/            # Rust 后端
│   └── src/main.rs       #   openocd 进程管理、TCL RPC 客户端（0x1A 帧、
│                         #   ANSI 路径编码）、监督/轮询线程、
│                         #   设置与预设（~/.openocd_gui，JSON）
├── ui/                   # Web 前端（原生 HTML/CSS/JS，无 node 构建）
│   ├── index.html        #   布局与样式
│   └── app.js            #   页面逻辑、OpenOCD 输出解析器、IPC
├── exe/                  # 本地构建产物（二进制已 gitignore，含 README）
└── docs/
    └── framework-evaluation.md   # 选型依据（六框架实测对比）
```

GUI 与 OpenOCD 只通过两个通道通信：子进程 **stdout**（→ 日志视图）和 **TCL RPC** 端口（帧格式 = `命令 + 0x1A` → `结果 + 0x1A`）。不链接、不修改 OpenOCD 内部实现。

### 调试钩子

- 环境变量 `OPENOCD_GUI_AUTOSTART=1` → 应用启动时自动点击"启动"（端到端测试用）
- `%TEMP%/ocd_gui_tauri.log` — 后端/前端诊断日志

## 🗺️ 计划

- [ ] 烧写页实时进度捕获（stdout 进度目前显示在日志页）
- [ ] 非 ANSI 可表示路径的 8.3 短路径回退
- [ ] Linux/macOS CI 构建（Linux 走 WebKitGTK）
- [ ] TCL 帧协议与解析器的 Rust 单元测试

## 📄 许可证

MIT —— 详见 [LICENSE](LICENSE)。OpenOCD 本体为 GPL-2.0，**不**随本项目分发；本项目仅启动并与之通信。
