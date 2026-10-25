# OpenOCD-GUI

[English](README.md) | **简体中文**

[OpenOCD](https://openocd.org)（适配 OpenOCD **0.12.0+dev**，例如 [P4rfa1t/openocd](https://github.com/P4rfa1t/openocd) 分支）的跨平台图形前端，纯 Python + Tkinter 实现，**无任何第三方依赖**。

[![Python](https://img.shields.io/badge/python-3.8%2B-blue)]() [![License: MIT](https://img.shields.io/badge/license-MIT-green)]() [![No deps](https://img.shields.io/badge/dependencies-none-success)]() [![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey)]()

## ✨ 功能

| 模块 | 说明 |
|---|---|
| ⚙️ **配置** | 自动检测 `openocd` 可执行文件与脚本目录、`interface / target / board` 脚本搜索选择、有序配置列表（`-f`）、附加命令（`-c`）、端口、调试级别、连接预设 |
| 📜 **日志** | 彩色分级实时输出、过滤、自动滚动、会话分隔线、导出 |
| 💻 **控制台** | 基于 TCL RPC 端口的交互式命令行、历史记录、快捷命令 |
| 🎯 **目标** | 目标表格自动轮询、halt / resume / 软复位 / reset（halt·run·init）、切换当前目标 |
| 🧮 **寄存器** | 分组寄存器转储、筛选、暂停时自动刷新、双击改值 |
| 🧠 **内存** | 8/16/32/64 位十六进制查看/编辑器（`mdb/mdh/mdw/mdd`）、翻页、ASCII 列、双击改值 |
| ⬇️ **烧写** | 一键固件烧写（`program`，支持 verify / preverify / reset / 偏移）、flash bank 信息、扇区擦除 |
| 🛑 **断点** | 硬件/软件断点与观察点（`bp/rbp/wp/rwp`）列表化管理 |
| 🔗 **GDB** | 连接信息、一键复制命令行、一键启动外部 GDB |

## 🚀 快速开始

### 方式一 — Windows 可执行文件（推荐）

从 [Releases](https://github.com/P4rfa1t/OpenOCD-GUI/releases/latest) 页面下载 **OpenOCD-GUI.exe** —— 单文件、无需安装 Python、**绝不出现控制台窗口**（GUI 子系统程序，与 `.pyw` 文件关联无关）。注意：部分杀毒软件可能对未签名的 PyInstaller 程序误报，可改用下方源码方式运行。

### 方式二 — 源码运行

#### 前置条件

- 系统中安装 **OpenOCD ≥ 0.12**（GUI 使用 0.12 引入的 `gdb port` / `tcl port` / `telnet port` 层级命令语法）
- **Python 3.8+** 且带 Tkinter（python.org 安装包自带；Debian/Ubuntu 需 `apt install python3-tk`）

#### 运行

```bash
git clone https://github.com/P4rfa1t/OpenOCD-GUI.git
cd OpenOCD-GUI
python run.py
```

Windows 下也可直接双击 **`openocd_gui.pyw`**（无控制台窗口启动）。

> **双击 `.pyw` 弹出空白终端？** 说明 `.pyw` 关联到了某个控制台程序（例如误放到 `C:\Windows` 的 `pyw.exe` 副本）。修复方法：把 `.pyw` 关联到 python.org 官方的无窗口 `pythonw.exe`：
> ```bat
> ftype Python.NoConFile="C:\Python安装路径\pythonw.exe" "%L" %*
> ```
> （或在 `HKCU\Software\Classes\Python.NoConFile\shell\open\command` 中按用户设置）。此外启动器本身在经 `python.exe` 打开时也会自动隐藏控制台窗口。

### 日常工作流

1. **配置**页 → 设置可执行文件（或点“自动检测”），选择 `interface` + `target` 配置，按需添加附加命令如 `adapter speed 3000`、`transport select swd`
2. 工具栏 **▶ 启动** → OpenOCD 启动，GUI 自动连接其 TCL RPC 端口
3. 用 **目标 / 寄存器 / 内存 / 断点** 各页控制目标；**烧写**页烧录固件
4. **GDB** 页提供现成的连接命令行（`target remote localhost:3333`），供外部 GDB 使用
5. **■ 停止** 先向 OpenOCD 发送优雅的 `shutdown`（失败则回退到强制终止）

## 🧱 架构

```
OpenOCD-GUI/
├── run.py / openocd_gui.pyw     # 启动器
├── openocd_gui/
│   ├── app.py                   # 主窗口、事件泵、工具栏/状态栏
│   ├── core/
│   │   ├── events.py            # 线程安全事件总线
│   │   ├── openocd.py           # 进程管理 + 命令行构建
│   │   ├── tcl.py               # TCL RPC 客户端（0x1A 帧协议）
│   │   ├── session.py           # 会话编排：连接/重连/轮询
│   │   ├── parsers.py           # 输出解析器（targets/reg/md/bp/wp/banks）
│   │   ├── detector.py          # openocd 检测、脚本扫描
│   │   └── settings.py          # 设置与预设（~/.openocd_gui）
│   └── ui/                      # 每个标签页一个模块 + 通用控件
└── tests/                       # 解析器与命令行构建的单元测试
```

GUI 与 OpenOCD 只通过两个通道通信：

- 子进程 **stdout** → 彩色日志视图
- **TCL RPC** 端口（默认 6666，帧格式 = `命令 + 0x1A` → `结果 + 0x1A`）→ 其余全部功能（状态轮询、寄存器/内存访问、烧写、断点）

不链接、不修改 OpenOCD 内部实现，因此既适配官方 OpenOCD 0.12+ 构建也适配自定义分支。

## 🌍 平台支持

纯标准库、按跨平台设计。在 **Windows** 上开发并完整测试；Linux/macOS 的代码路径已就位（进程启动参数有平台守卫、含 POSIX 下 openocd 的检测路径）但未经常性实测——欢迎反馈与补丁。

## 🧪 开发

```bash
python -m unittest discover -s tests   # 解析器与命令构建器测试
python run.py --smoke                  # 无头 UI 构建自检
```

## 🗺️ 计划

- [ ] ELF 感知的寄存器/内存视图
- [ ] Semihosting / RTT 控制台
- [ ] 英文界面本地化（当前界面为中文）
- [ ] PyInstaller 打包单文件可执行程序

## 📄 许可证

MIT —— 详见 [LICENSE](LICENSE)。OpenOCD 本体为 GPL-2.0，**不**随本项目分发；本项目仅启动并与之通信。
