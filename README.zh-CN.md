# OpenOCD-GUI

[English](README.md) | **简体中文**

[OpenOCD](https://openocd.org)（适配 OpenOCD **0.12.0+dev**）的跨平台图形前端，基于 **Tauri 2** 构建——Rust 后端 + Web 前端，打包为小巧的原生可执行文件，无需任何脚本运行时。

[![Rust](https://img.shields.io/badge/rust-stable-orange)]() [![Tauri](https://img.shields.io/badge/Tauri-2-blue)]() [![License: MIT](https://img.shields.io/badge/license-MIT-green)]() [![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey)]()

> **历史**：v0.1.x 曾以 Python/Tkinter 实现。v0.2.0 起项目切换到 Tauri 2 作为主框架——Python 实现已从仓库移除（git 历史仍可查）。

## ✨ 功能

| 模块 | 说明 |
|---|---|
| ⚙️ **配置** | 自动检测 `openocd` 可执行文件与脚本目录；两个独立的 cfg 选择框，支持输入筛选（type-to-search）—— 接口（`-f interface/*.cfg`）在前、目标/板级（`-f target/*.cfg` 或 `board/*.cfg`）在后，加载顺序不会错，另有接口行与目标/板级行各自的只读 **查看 cfg 内容** 按钮；自动检测到多个 `openocd` 时会弹窗可选；附加命令（`-c`）、端口、可选的 OpenOCD 日志文件（等价 `-l`）、调试级别；连接预设的保存与加载就在这同一个字段集里（共享 `~/.openocd_gui` 布局） |
| 📜 **日志** | 彩色分级实时输出、过滤、自动滚动 |
| 💻 **控制台** | 基于 TCL RPC 端口的交互式命令行、历史记录、快捷命令 |
| 🎯 **目标** | 目标表格自动轮询、halt / resume / 软复位 / reset（halt·run·init）、切换当前目标 |
| 🧮 **寄存器** | 分组寄存器转储、筛选、暂停时自动刷新、双击改值 |
| 🧠 **内存** | 8/16/32/64 位十六进制查看/编辑器、翻页、ASCII 列、双击改值，默认读取数量 160 |
| ⬇️ **烧写** | 一键固件烧写（`program`，支持 verify / preverify / reset / 偏移；非 ASCII 路径自动按 ANSI 编码页编码）、flash bank 信息（表格加高，并补上 名称 / 驱动 / 基址 / 大小 / 总线宽 / 芯片宽 的列说明）、扇区擦除 |
| 🛑 **断点** | 硬件/软件断点与观察点（`bp/rbp/wp/rwp`）列表化管理；表格行可点选，**删除选中** 作用于选中行，另有 `#` 序号列，增删失败会显示失败原因 |
| 🔗 **GDB** | 连接信息、一键复制命令行、一键启动外部 GDB，以及 **自动检测**（扫描 `PATH` 与常见 Arm GNU Toolchain 安装位置）与 **检测版本**；多个候选以弹窗和路径框下拉两种方式列出 |
| ℹ️ **关于** | 版本信息、OpenOCD 版本检测、配置目录、当前界面语言，以及 OpenOCD 官方文档 / 本项目 / P4rfa1t/OpenOCD 三个可点击链接 |

### 🆕 本轮新增（v0.3.4）

- **配置** —— 接口 cfg / 目标·板级 cfg 改为可输入筛选（type-to-search）的选择框，脚本库条目再多也能秒搜
- **查看 cfg 内容** —— 拆成两个按钮，分别放在接口 cfg 行与目标/板级 cfg 行上，各自只读预览该行 cfg 全文（含路径），不再是一个总按钮
- **日志文件（服务端口 / 调试）** —— 恢复文件选择按钮：OpenOCD 会把自身日志追加写入该文件，等价命令行 `-l`；留空则输出只显示在日志页
- **烧写** —— Flash 存储体表格加高，并补充列说明（名称 / 驱动 / 基址 / 大小 / 总线宽 / 芯片宽）
- **GDB** —— 新增「自动检测」（扫描 `PATH` 与常见 Arm GNU Toolchain 安装位置）与「检测版本」
- **关于** —— 新增页面：版本信息、OpenOCD 版本检测、配置目录，以及 OpenOCD 官方文档 / 本项目 / P4rfa1t/OpenOCD 三个可点击链接
- **断点 / 观察点** —— 表格行可点选，「删除选中」作用于选中行，新增 `#` 序号列，表格加高
- **断点 / 观察点，失败反馈** —— 增删失败时会显示失败原因（表格下方的 `#bp-hint` / `#wp-hint` 行内提示 + 日志页 + 弹窗）；OpenOCD 拒绝参数时会提示 `bp` / `wp` 只接受十六进制数值地址，`main` 这类符号名与 `0x…+4` 这类表达式都不会被解析
- **多候选选择** —— 自动检测到多个 OpenOCD 或 GDB 时会弹窗让你选用其中一个；路径框下拉里也会列出全部候选，不必重新检测即可切换
- **内存** —— 默认读取数量 160
- **断点 / 观察点，实时计数** —— 表格会显示当前注册的条目数（`#bp-count` / `#wp-count`）；空表不再看着像坏掉，而是渲染一行占位说明
- **断点 / 观察点，成败判定改为核对条目数** —— 不再看 TCL 返回值：OpenOCD 的 `breakpoint_add` 失败时只把原因写进它自己的日志、TCL 侧照样回空串，所以本工具在每条命令后重新列一遍断点/观察点，比对条目数来判定成败
- **断点 / 观察点，前置校验** —— 发送命令前先校验地址与长度：长度只能是 1 / 2 / 4，地址必须是长度的整数倍（提示里直接给出最近的合法地址）
- **Hybrid 断点** —— 解析器现在会识别 OpenOCD 在 Hybrid 断点下方追加的 `|--->linked with ContextID: 0x…` 续行，并把它挂到上一条断点上
- **界面文案表（i18n）** —— 每一句用户可见文案都集中到 `ui/i18n.js`（zh 表 301 个键）：`index.html` 只留键名（`data-i18n`、`data-i18n-placeholder`），`app.js` 统一走 `t("键", { … })`，以后加语言是改数据、不是改代码
- **语言设置会持久化** —— 选择存在设置文件的 `lang` 字段里；当前语言缺的键自动回落 `zh`，两边都缺的键原样显示键名，一眼就能看出漏翻
- **下拉不再依赖中文文案** —— 日志过滤与内存宽度改用 `<option value>` 判断（`all|info|warn|err`、`mdw|mdh|mdb|mdd`），不再按显示出来的中文取值
- **页面描述精简** —— 配置页（cfg 加载顺序）、日志文件用途、Flash 存储体、GDB 自动检测、关于页说明这些长段都压到一两行
- **烧写输出落进文本框** —— 烧写/擦除不再只在下面显示一行「(命令已执行)」：`runWithLog()` 先记下日志缓冲区的位置，命令返回后再等 350ms 取增量，于是 `** Programming Started **` 横幅、进度行、`** Programming Finished **` / `** Verified OK **` 都落在同一个文本框里；失败时把日志与错误一起显示，并在日志页记一条 `Error:`；失败判定也会看 OpenOCD 自己的输出：`failLine()` 逐行扫描并跳过 `Warn` / `Info` / `Debug` / `User` 级别的行，像「Warn : could not read memory…」这种不再算失败，只有错误行才算；命中处前后各取约 80 字符（不再把整行截断到 200 字符，免得把真正的错误切掉）。状态届时显示「失败」而不是「完成」（这一行同样会记进日志页）
- **烧写日志去重** —— OpenOCD 会把同一条错误既写进 stderr（日志页已收）又当 TCL 响应回一份，展示前已去重：抓到的日志里已经含有该响应时就不再重复显示，同一段错误不会出现两遍
- **关窗口会清理 OpenOCD 子进程** —— 以前直接关窗口会把子进程留在那儿，它继续占着调试器（libusb）与端口，于是下次启动报 `libusb_open() failed with LIBUSB_ERROR_ACCESS` / `open failed`。现在由一个 `shutdown_openocd(state, graceful)` 同时服务「停止」按钮与 Tauri 的 `ExitRequested` / `Exit`；启动之前还会先探测 TCL 端口：残留的 OpenOCD 先用 `version` 确认身份，再请它 `shutdown` 并等它退出，端口仍被占着就直接报错、提示结束 `openocd.exe`
- **启动即退出的诊断提示** —— OpenOCD 启动后 4 秒内就退出时，后端发 `ocd-hint` 事件，日志页会提示多半是上一个 OpenOCD 还占着调试器
- **连接状态机** —— 状态标签由后端事件驱动，走「已停止 → 启动中… → 运行中 →（点停止）停止中… → 已停止」；主动「停止」不会再显示「异常退出」（后端只在非主动停止时才发失败事件）
- **语言重刷后动态文案不被打回** —— 切换/重刷语言后，状态标签与 TCL 标签由 JS 按新语言重写（`i18n-applied` → `refreshDynamicLabels`），不会被 `data-i18n` 的静态文案覆盖
- **错误提示改为页内浮层** —— 不再用原生 `alert`：它是系统模态对话框，会把主窗口置灰，弹窗没关掉时连窗口都关不了。现在错误只在页内浮层里显示（`showModal`，标题「出错了」），状态栏同步显示同一条，窗口随时可关
- **版本** —— 0.3.4

## 🚀 快速开始

### 方式一 — 下载现成二进制

每次推 `main` 都会把下面这些文件作为构建 [Artifacts](https://github.com/P4rfa1t/OpenOCD-GUI/actions/workflows/build.yml) 产出（下载需登录 GitHub）；推 `v*` 标签则把同一批文件发布成 [Release](https://github.com/P4rfa1t/OpenOCD-GUI/releases)（三个平台都构建成功才会发布）。**v0.3.4** 一共有这些：

| 产物 | 内容 | 怎么跑 |
|---|---|---|
| `OpenOCD-GUI-windows-x86_64` | 单个自包含的 `openocd-gui.exe` | 双击即可 |
| `OpenOCD-GUI-linux-x86_64` | 裸二进制 `openocd-gui` **和** `OpenOCD-GUI-linux-x86_64.tar.gz` | 解包即跑（在 POSIX 上解包就已带可执行位；万一丢了再 `chmod +x`），或 `tar xzf OpenOCD-GUI-linux-x86_64.tar.gz && ./openocd-gui` |
| `OpenOCD-GUI-linux-packages` | `.deb` / `.AppImage`（best-effort） | 装 `.deb`，或直接运行 AppImage（解包就已带可执行位） |
| `OpenOCD-GUI-macos-aarch64` | 裸二进制 `openocd-gui`（Apple Silicon）**和** `OpenOCD-GUI-macos-aarch64.tar.gz` | 终端里 `xattr -d com.apple.quarantine ./openocd-gui && ./openocd-gui` |
| `OpenOCD-GUI-macos-packages` | `.dmg` / `OpenOCD-GUI-macos-app.tar.gz`（best-effort） | 挂载 `.dmg`，或解包 tar 得到 `OpenOCD-GUI.app` |

在 Releases 页上，两个裸二进制为了不重名分别叫 `OpenOCD-GUI-linux-x86_64` 与 `OpenOCD-GUI-macos-aarch64`（`openocd-gui.exe` 与两个 tar 包保持原名）；它们是没有扩展名的可执行文件，不是压缩包。

- **Windows** — 只依赖 WebView2 Runtime，Windows 10/11 系统自带（老系统装 [Evergreen 运行时](https://developer.microsoft.com/microsoft-edge/webview2/)）。发布版用 **MSVC** 工具链构建，`WebView2Loader` 已静态链接进 exe；0.2.0 时期的 mingw 构建需要外挂 DLL，那些已被取代 —— Releases 页上目前仍挂着 0.2.0 的那套压缩包，v0.3.4 不再需要它。
- **Linux** — x86_64 产物里那两个文件是同一个二进制的两份，都能用：我们产出的 zip 实测记录的是 `100755`（`-rwxr-xr-x`，在下载回来的产物上量过），但 GitHub 不保证 artifact 的权限（官方 Actions 文档说文件一律回落到 `644`），所以可靠的还是 tar 包：解包即跑。若裸文件丢了可执行位（经 Windows 解压、或浏览器下载后重新打包），补一条 `chmod +x` 即可。两种方式都需要 WebKitGTK 4.1 运行时（`libwebkit2gtk-4.1-0`、`libgtk-3-0`，Ubuntu 22.04+）、OpenOCD ≥ 0.12 以及 X11/Wayland 会话。`.deb` / `.AppImage` 是 best-effort：打包步骤失败时该产物可能为空。
- **macOS** — 裸二进制是 Mach-O 可执行文件，本来就**没有扩展名**，这是正常的、不是下载残缺；它也不是 `.app`，不能双击，要从终端 `./openocd-gui` 启动。浏览器下载来的文件会带 quarantine 属性被 Gatekeeper 拦下，用 `xattr -d com.apple.quarantine ./openocd-gui` 清掉（或在「系统设置 → 隐私与安全性」里放行）。CI 里做了 ad-hoc 签名（`codesign --sign -`），但没有 Apple 开发者证书、未 notarize，所以首次运行仍可能被拦。

### 方式二 — 源码构建

前置：[Rust](https://rustup.rs) 工具链 + OpenOCD ≥ 0.12（GUI 使用 0.12 引入的 `gdb port` / `tcl port` / `telnet port` 层级命令语法）。

```bash
git clone https://github.com/P4rfa1t/OpenOCD-GUI.git
cd OpenOCD-GUI/src-tauri
cargo build --release
```

**Windows** — 用 **MSVC** 工具链（`rustup default stable-x86_64-pc-windows-msvc`）。产出单文件、自包含的 exe，`WebView2Loader` 已静态链接，不需要外挂任何 DLL：

```bash
cargo build --release --target x86_64-pc-windows-msvc
# → target/x86_64-pc-windows-msvc/release/openocd-gui.exe（单文件）
```

如果一定要用 **GNU/mingw**（`x86_64-pc-windows-gnu`）构建，loader 是动态链接的，`WebView2Loader.dll` 必须和 exe 放在一起。链接器不在 PATH 时，添加 `src-tauri/.cargo/config.toml`（已 gitignore，机器相关）：

```toml
[target.x86_64-pc-windows-gnu]
linker = "C:/msys64/ucrt64/bin/gcc.exe"
```

**Linux** — 先装 WebKitGTK 开发包：

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev pkg-config
# Fedora: sudo dnf install webkit2gtk4.1-devel gtk3-devel librsvg2-devel
# Arch:   sudo pacman -S webkit2gtk-4.1 gtk3 librsvg
cargo build --release
# → target/release/openocd-gui
```

**macOS** — 直接 `cargo build --release` 即可（WebKit 由系统提供）。启动外部 GDB 会通过 `osascript` 打开 Terminal。

### 日常工作流

1. **配置**页 → 设置可执行文件（或"自动检测"），选择 `interface` + `target` 配置，按需添加附加命令如 `adapter speed 3000`、`transport select swd`
2. 工具栏 **▶ 启动** → OpenOCD 启动，GUI 自动连接其 TCL RPC 端口（默认 6666）
3. 用 **目标 / 寄存器 / 内存 / 断点** 各页控制目标；**烧写**页烧录固件
4. **GDB** 页提供现成的连接命令行（`target remote localhost:3333`），供外部 GDB 使用
5. **■ 停止** 先向 OpenOCD 发送优雅的 `shutdown`（失败则回退到强制终止）；关闭窗口会走同一套清理，不会再留下占着调试器的 OpenOCD
6. **前端启动期检查（开发者）** —— 启动期的 JS 异常 grep 与静态检查都发现不了，可开 WebView2 远程调试跑一遍 release exe：`$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9338'`（再加 `$env:OPENOCD_GUI_AUTOSTART='1'` 可让它自己起服务），然后 `curl http://127.0.0.1:9338/json` 取 `webSocketDebuggerUrl`，用 DevTools 协议执行 `Runtime.evaluate`：`(async()=>{try{await boot();return 'BOOT_OK'}catch(e){return 'BOOT_ERR: '+e.message}})()`

## 🧱 架构

```
OpenOCD-GUI/
├── src-tauri/            # Rust 后端
│   └── src/main.rs       #   openocd 进程管理、TCL RPC 客户端（0x1A 帧、
│                         #   ANSI 路径编码）、监督/轮询线程、
│                         #   设置与预设（~/.openocd_gui，JSON）
└── ui/                   # Web 前端（原生 HTML/CSS/JS，无 node 构建）
    ├── index.html        #   布局与样式（只留 i18n 键名）
    ├── i18n.js           #   界面文案表（zh，可再加语言）
    └── app.js            #   页面逻辑、OpenOCD 输出解析器、IPC
```

GUI 与 OpenOCD 只通过两个通道通信：子进程 **stdout**（→ 日志视图）和 **TCL RPC** 端口（帧格式 = `命令 + 0x1A` → `结果 + 0x1A`）。不链接、不修改 OpenOCD 内部实现。

### 调试钩子

- 环境变量 `OPENOCD_GUI_AUTOSTART=1` → 应用启动时自动点击"启动"（端到端测试用）
- `%TEMP%/ocd_gui_tauri.log` — 后端/前端诊断日志

### 新增一门语言

界面上的每一句文案都集中在 `ui/i18n.js`，`zh` 既是基准表（301 个键）也是回落语言。加一门语言：

1. 在 `I18N` 里加一份与 `zh` 键名完全相同的表 —— 漏掉的键会自动回落 `zh`，两边都没有的键会原样显示键名，便于发现漏翻
2. 把 `{ code: "xx", label: "…" }` 加进 `LANGS`，label 就是「关于」页显示的语言名
3. 把 `~/.openocd_gui/settings.json`（Windows 上是 `%USERPROFILE%\.openocd_gui\settings.json`）里的 `lang` 改成该 code ——「关于」页有「打开目录」按钮可以直达，程序每次保存设置时也会把这个字段写回去

`t("键名", { name: 值 })` 支持 `{name}` 插值。前端是打包进二进制的静态文件，改完文案表要重启（或重新构建）应用才会生效。

## 🗺️ 计划

- [ ] 烧写页实时进度捕获（stdout 进度目前显示在日志页）
- [ ] 非 ANSI 可表示路径的 8.3 短路径回退
- [x] Linux/macOS CI 构建（Linux 走 WebKitGTK）
- [ ] TCL 帧协议与解析器的 Rust 单元测试
- [x] Linux 打包：`.deb` / `.AppImage` 已作为 best-effort 产物产出（见上）；AUR 未做

## 📄 许可证

MIT —— 详见 [LICENSE](LICENSE)。OpenOCD 本体为 GPL-2.0，**不**随本项目分发；本项目仅启动并与之通信。
