# OpenOCD-GUI 前端框架对比（实测）

> 注：v0.2.0 起 Tauri 2 已成为本项目主框架；本文档是 2026-10 选型时的实测记录。文中提到的 `ports/pyside6`、`ports/tauri2` 等移植代码已随重构移除（git 历史可查），Tauri 移植即现在的仓库主结构。

同一应用（OpenOCD-GUI 全部功能：配置/日志/控制台/目标/寄存器/内存/烧写/断点/GDB）在三个框架上完整移植，
另有三个框架做了构建/打包/运行基准测试。全部在**同一台机器**（Windows 11 x64，2026-10）实测。

- **Tkinter 主版本**（仓库根，`python run.py`）— 纯标准库
- **PySide6 移植**（`ports/pyside6/`，`python ports/pyside6/run_qt.py`）— 复用 `openocd_gui/core/`，只重写 UI 层
- **Tauri 2 移植**（`ports/tauri2/`，`cargo build --release`）— Rust 后端 + 原生 JS 前端，全栈重写
- **PyQt6 基准**（未入仓库）— PySide6 移植版机械适配（import 替换 + 枚举作用域修正，共 5 处），全功能冒烟通过
- **Wails v2 基准**（未入仓库）— Go 1.27 + WebView2，最小应用（1000 行表格）+ 无控制台构建
- **Flutter 基准**（未入仓库）— SDK 3.47.8 就绪，**Windows 构建被硬性依赖卡住，未完成**

## 实测数据

| 指标 | Tkinter | PySide6 | PyQt6 | Tauri 2 | Wails v2 | Flutter |
|---|---|---|---|---|---|---|
| **exe 体积** | 13.3 MB | 51.1 MB | 38.8 MB | 6.5 MB | **4.4 MB** | 未实测* |
| **运行内存** (启动即空闲) | **≈45 MB** | ≈127 MB | ≈119 MB | ≈100+ MB¹ | 13 MB 主进程 + WebView2¹ | 未实测* |
| **启动速度** | ~1 s | ~3-4 s（onefile 解压） | ~3-4 s | ~1 s | ~1 s | — |
| **新写代码量** | 3207 行 | 1614 行 | ≈1614 行（+5 处适配） | 1531 行（Rust+JS） | —（最小基准） | — |
| **用户需要安装什么** | Python 3.8+ 或 exe | 同左 | 同左 | **什么都不用**² | **什么都不用**² | 仅运行时无需³ |
| **构建前置要求** | 无 | 无 | 无 | Rust 工具链 | Go 工具链 | **Visual Studio C++ 工具链**（约 2-4 GB） |
| **Linux/macOS** | 代码就绪未实测 | 代码就绪未实测 | 同左 | 需目标平台各编一次（Linux 用 WebKitGTK） | 同左 | 需各平台工具链 |
| **许可证兼容** (项目 MIT) | ✓ PSF | ✓ LGPL | ⚠ **GPL**（闭源需商业授权） | ✓ MIT 栈 | ✓ BSD/MIT 栈 | ✓ BSD |

\* Flutter 3.47.8 的 Windows 桌面构建硬性要求 Visual Studio C++ 工具链（runner 为 CMake/MSVC 工程），本机未装。
官方模板产物经验值约 20-30 MB 目录 + 100-200 MB 内存，仅供参考、非实测。
¹ WebView2 子进程与系统内其他 WebView2/Edge 应用共享运行时；多实例同时开时分摊更低。
² WebView2 运行时 Win10/11 自带；Win7/8 或精简系统需装 WebView2 Runtime。
³ 运行免依赖，但**开发机构建**必须装 VS C++ 工具链——这是六个框架中唯一的硬性大体积前置。

## 开发体验对比

| 维度 | Tkinter | PySide6/PyQt6 | Tauri 2 | Wails v2 | Flutter |
|---|---|---|---|---|---|
| 上手成本 | 最低（标准库） | 低（会 Python 即可） | 高（Rust + 前端 + IPC） | 中（Go + 前端；Go 比 Rust 好上手） | 中高（Dart + 独立概念树） |
| UI 表达力 | 弱 | **强**（QTableView/QDockWidget/QSS） | **最强**（Web 生态） | **最强**（Web 生态） | 强（自绘组件库一致） |
| 改 UI 的反馈速度 | 重启应用 | 重启应用 | **热重载** | **热重载**（dev 模式） | **热重载**（最强的 stateful hot reload） |
| 生态（串口/图表/地图） | 几乎没有 | Qt 全家桶 | npm 全生态 | npm 全生态 | pub 生态（中等） |
| 首次构建耗时 | 秒级 | ~2 分钟 | ~10 分钟（数百 crate） | ~1-2 分钟（Go 快） | 首次很长（拉引擎产物+VS 编译） |
| 杀软误报率（未签名） | 中 | 中偏高 | 低 | 低 | 低 |
| 国内网络适配 | pip 镜像即可 | pip 镜像即可 | crates.io 一般可用 | **需 GOPROXY=goproxy.cn** | **需 FLUTTER_STORAGE/pub 镜像** |

## 本次移植中发现的真实差异

- **PyQt6 与 PySide6 的真实差距比想象小**：同一份 UI 代码只改了 import 和 5 处枚举作用域（PyQt6 强制 `Qt.ItemFlag.ItemIsEditable` 这类全限定写法）就能跑；PyQt6 的 exe 反而更小（38.8 vs 51.1 MB）。**决定性差异是许可证**：PyQt6 GPL（闭源要买 Riverbank 商业授权），PySide6 LGPL 可白嫖——开源 MIT 项目选 PySide6 即可
- **Wails v2 是本轮黑马**：4.4MB 最小、Go 主进程仅 13MB、构建只要 1-2 分钟（Go 编译快于 Rust 一个量级）、前端同样是整个 Web 生态。代价：绑定/IPC 能力弱于 Tauri，Linux 同样走 WebKitGTK；国内需配 GOPROXY
- **Flutter 的门槛在构建端而非运行端**：Windows 桌面构建硬性要求 Visual Studio C++ 工具链（runner 是 CMake/MSVC 工程，约 2-4GB）——六个框架中唯一的重前置，工具类项目明显减分；网络还需配 pub/storage 镜像
- **PySide6 移植 1614 行 vs Tkinter UI 层 2285 行**：Qt 布局 API 更紧凑，同一套功能反而少写 ~30% UI 代码；`core/` 层零改动直接复用（当初分层的回报）
- **Tauri 的 exe 小（6.5MB）但内存不小**：WebView2 渲染进程吃内存与 Qt 同量级；"轻"主要体现在分发体积
- **Tauri/Wails 全栈重写无法复用 Python core**：TCL RPC 帧、解析器、命令行构建、监督重连全部重写一遍，包括烧写的中文路径 ANSI 编码也要重新实现（Tauri 用 Win32 `WideCharToMultiByte`）
- **Tauri v2 的 capabilities 权限文件是硬门槛**：缺 `capabilities/default.json`（含 `core:default`）时，前端的 `listen()` 静默抛错、整个 UI 初始化链中断——窗口能开、invoke 自定义命令能通，表面正常但事件全断。这是本次移植最大的一个坑，已用 mock openocd 端到端测试定位并修复
- **onefile 打包的启动代价**：PyInstaller onefile 每次启动先解压到临时目录（Qt 版 3-4 秒）；Tauri/Wails/Tk 无此问题
- 完整移植功能对齐度：Tkinter=100%；PySide6/PyQt6≈100%（文件对话框等价）；Tauri≈95%（简化了配置文件列表的上下移，改用文本框逐行编辑）
- **验证方式**：Tauri 版通过 mock openocd（假 TCL 服务器）做了全链路端到端测试（spawn → stdout 日志流 → TCL 连接 → targets 轮询 → UI 显示 halted ✓）；PyQt6 全功能冒烟 ✓；Wails 最小应用渲染+内存实测 ✓；Flutter 构建受阻如实记录。Tauri 测试钩子保留——`OPENOCD_GUI_AUTOSTART=1` 环境变量可让应用自动点击启动，`%TEMP%\ocd_gui_tauri.log` 记录后端打点

## 选型建议

- **保持 Tkinter 主版本**：零依赖是这个工具类项目的真实卖点，13MB/45MB 的开销也很难被打败
- **想要现代化界面/复杂交互**（内存大表、图表、主题）：选 **PySide6**——迁移成本最低（复用 core，1-2 天），LGPL 与 MIT 兼容；**不要选 PyQt6**：代码几乎零差距，但 GPL 许可证是实打实的法律负担
- **想要最小分发体积 + Web 前端**：**Wails v2 是 Windows 侧更顺手的选择**（4.4MB、Go 构建快、心智负担低于 Rust）；Tauri 2 能力上限更高（安全模型、插件生态、未来移动端），愿意投入 Rust 再选
- **Flutter**：双端自绘一致性好，但 Windows 构建强制 VS C++ 工具链 + Dart 生态孤立，对本项目不推荐
- 两个完整移植版保留在 `ports/` 下作为可运行的参考实现，不是主分支的替代品；PyQt6/Wails/Flutter 基准未入仓库（PyQt6 适配仅 5 处机械修改，需要时从 ports/pyside6 一分钟派生）
