# OpenOCD-GUI 前端框架对比（实测）

同一应用（OpenOCD-GUI 全部功能：配置/日志/控制台/目标/寄存器/内存/烧写/断点/GDB）分别用三个框架实现，
在**同一台机器**（Windows 11 x64，2026-10）上构建打包并实测。

- **Tkinter 主版本**（仓库根，`python run.py`）— 纯标准库
- **PySide6 移植**（`ports/pyside6/`，`python ports/pyside6/run_qt.py`）— 复用 `openocd_gui/core/`，只重写 UI 层
- **Tauri 2 移植**（`ports/tauri2/`，`cargo build --release` 或 `cargo tauri dev`）— Rust 后端 + 原生 JS 前端，全栈重写

## 实测数据

| 指标 | Tkinter | PySide6 | Tauri 2 |
|---|---|---|---|
| **exe 体积** (onefile/release) | **13.3 MB** | 51.1 MB | **6.5 MB** |
| **运行内存** (启动即空闲) | **≈45 MB** (37+8) | ≈127 MB (118+8) | ≈100+ MB¹ (25 主进程 + WebView2) |
| **启动速度** (双击到出窗口) | ~1 s | ~3-4 s（onefile 解压） | ~1 s |
| **新写代码量** | 3207 行（core 922 + UI 2285） | 1614 行（仅 UI，复用 core） | 1531 行（Rust 700 + JS/HTML 831，全栈） |
| **用户需要安装什么** | Python 3.8+（或用打包 exe） | 同左（或 exe） | **什么都不用**² |
| **Linux/macOS** | 代码就绪未实测 | 代码就绪未实测 | 需在目标平台各编译一次 |
| **许可证兼容** (项目 MIT) | ✓ Python PSF | ✓ PySide6 LGPL（勿用 GPL 的 PyQt） | ✓ MIT 栈 |

¹ WebView2 子进程与系统内其他 WebView2/Edge 应用共享运行时；多实例同时开时分摊更低。
² WebView2 运行时 Win10/11 系统自带；Win7/8 或精简系统需装 WebView2 Runtime。

## 开发体验对比

| 维度 | Tkinter | PySide6 | Tauri 2 |
|---|---|---|---|
| 上手成本 | 最低（标准库） | 低（会 Python 即可） | 高（Rust + 前端 + IPC 三套心智模型） |
| UI 表达力 | 弱（表格/停靠/DPI 都要自己凑） | **强**（QTableView/QDockWidget/QSS 主题） | **最强**（整个 Web 生态，任意 CSS/组件库） |
| 线程模型 | 自己搭事件泵 | 信号槽（跨线程安全，最省心） | Rust 线程 + emit 事件到 JS（编译器把关，但借用检查学习曲线陡） |
| 改 UI 的反馈速度 | 重启应用 | 重启应用 | **热重载**（改 HTML/JS 即时生效） |
| 生态（串口/图表/地图） | 几乎没有 | Qt 全家桶（串口、图表、3D） | npm 全生态 |
| 调试 | print | IDE 断点（Python） | Rust 断点 + 浏览器 DevTools（前端） |
| 首次编译/打包耗时 | 秒级 | ~2 分钟 | **~10 分钟**（数百 crate；增量后秒级） |
| 杀软误报率（未签名） | 中 | 中偏高 | 低（原生代码，无自解压壳） |

## 本次移植中发现的真实差异

- **PySide6 移植 1614 行 vs Tkinter UI 层 2285 行**：Qt 布局 API 更紧凑，同一套功能反而少写 ~30% UI 代码；`core/` 层零改动直接复用（当初分层的回报）
- **Tauri 的 exe 最小（6.5MB）但内存不小**：WebView2 渲染进程吃内存与 Qt 同量级；"轻"主要体现在分发体积
- **Tauri 全栈重写无法复用 Python core**：TCL RPC 帧、解析器、命令行构建、监督重连全部用 Rust/JS 重写一遍（1531 行），包括烧写的中文路径 ANSI 编码也要用 Win32 `WideCharToMultiByte` 重新实现
- **onefile 打包的启动代价**：PyInstaller onefile 每次启动先解压到临时目录（Qt 版 3-4 秒）；Tauri/Tk 无此问题
- 三版功能对齐度：Tkinter=100%；PySide6≈100%（文件对话框等价）；Tauri≈95%（简化了配置文件列表的上下移，改用文本框逐行编辑）

## 选型建议

- **保持 Tkinter 主版本**：零依赖是这个工具类项目的真实卖点，13MB/45MB 的开销也很难被打败
- **想要现代化界面/复杂交互**（内存大表、图表、主题）：选 **PySide6**——迁移成本最低（复用 core，1-2 天），LGPL 与 MIT 兼容
- **想要最小分发体积 + 热重载开发 + 愿意投入 Rust**：选 **Tauri 2**——但接受全栈重写和 WebView2 内存
- 两个移植版都保留在 `ports/` 下作为可运行的参考实现，不是主分支的替代品
