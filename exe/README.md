# exe/ — 打包产物（本地文件，不入 git）

当前保留的构建产物。体积/内存等多框架完整对比（Tkinter/PySide6/PyQt6/Tauri 2/Wails/Flutter）
见 [ports/COMPARISON.md](../ports/COMPARISON.md)。

| 文件 | 框架 / 工具链 | 体积 | 内容 |
|---|---|---|---|
| `OpenOCD-GUI.exe` | Tauri 2 (Rust, MSVC, release) | 6.2 MB | **完整移植版**，WebView2Loader 已静态链接，**单文件即可运行** |
| `OpenOCD-GUI.exe.mingw.bak` | Tauri 2 (Rust, mingw, release) | 6.5 MB | 旧 mingw 构建，需同目录 `WebView2Loader.dll`；仅作回滚保留 |
| `WebView2Loader.dll` | — | 157 KB | 仅供上面的 mingw 备份使用；MSVC 版不需要 |

## 使用说明

- **`OpenOCD-GUI.exe` 单文件即可运行**：用 MSVC 工具链构建，WebView2Loader 静态链接进 exe，
  不再需要旁边的 DLL
- 需要 WebView2 Runtime（Windows 10/11 自带）
- 与其他版本**共享同一份配置** `~/.openocd_gui/settings.json`
- ⚠ 请用**双击 / 资源管理器 / cmd / PowerShell** 启动：在 MSYS2/Git-Bash 环境下直接启动可能报
  api-ms-win-*.dll 加载错误（msys 加载器怪癖，Windows 正常启动方式不受影响）
- 测试钩子：设置环境变量 `OPENOCD_GUI_AUTOSTART=1` 启动会自动点击"启动"按钮（调试用）；
  `%TEMP%\ocd_gui_tauri.log` 记录后端打点日志
- 主版本（Tkinter）的 exe 在 [GitHub Release v0.1.0](https://github.com/P4rfa1t/OpenOCD-GUI/releases/tag/v0.1.0)

## 为何不入 git

二进制大文件不适合进 git 仓库；需要分发时应作为 GitHub Release 资产上传（主版本已采用该方式）。

## 重新构建

**Windows（单文件，推荐）**

```bash
cd src-tauri
rustup default stable-x86_64-pc-windows-msvc
cargo build --release --target x86_64-pc-windows-msvc
# 产物: target/x86_64-pc-windows-msvc/release/openocd-gui.exe（单文件，无需 DLL）
```

没有装 Visual Studio 时，用 cargo-xwin 复用 Rust 自带的 lld-link：

```bash
cargo install cargo-xwin --locked
rustup target add x86_64-pc-windows-msvc
# llvm-rc 是资源编译器（tauri-winres 需要），可从 LLVM-MinGW 取
export RC=/path/to/llvm-rc.exe
export RC_x86_64_pc_windows_msvc=$RC
cargo xwin build --release --target x86_64-pc-windows-msvc
```

**Linux**

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev pkg-config
cd src-tauri && cargo build --release
# 产物: target/release/openocd-gui
```
