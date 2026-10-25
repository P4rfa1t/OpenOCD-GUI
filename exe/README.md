# exe/ — 打包产物（本地文件，不入 git）

当前保留的框架打包产物。体积/内存等多框架完整对比（Tkinter/PySide6/PyQt6/Tauri 2/Wails/Flutter）
见 [ports/COMPARISON.md](../ports/COMPARISON.md)。

| 文件 | 框架 | 体积 | 内容 | 运行内存 |
|---|---|---|---|---|
| `OpenOCD-GUI-Tauri2.exe` | Tauri 2 (Rust, release) | 6.5 MB | **完整移植版**（全部功能页，Rust 后端 + Web 前端） | ≈100 MB+（WebView2） |
| `WebView2Loader.dll` | — | 157 KB | ⚠ **必须与 exe 同目录**（见下） | — |

## 使用说明

- **`OpenOCD-GUI-Tauri2.exe` 与 `WebView2Loader.dll` 必须放在同一目录**：本项目用 windows-gnu (mingw)
  工具链构建，WebView2Loader 只能动态链接（MSVC 工具链才能静态打进 exe）。缺它时双击报
  "找不到 WebView2Loader.dll"。分发时两个文件一起打包即可
- 与其他版本**共享同一份配置** `~/.openocd_gui/settings.json`
- ⚠ 请用**双击 / 资源管理器 / cmd / PowerShell** 启动：本 exe 在 MSYS2/Git-Bash 环境下直接启动会报
  api-ms-win-*.dll 加载错误（msys 加载器怪癖，Windows 正常启动方式不受影响）
- 测试钩子：设置环境变量 `OPENOCD_GUI_AUTOSTART=1` 启动会自动点击"启动"按钮（调试用）；
  `%TEMP%\ocd_gui_tauri.log` 记录后端打点日志
- 主版本（Tkinter）的 exe 在 [GitHub Release v0.1.0](https://github.com/P4rfa1t/OpenOCD-GUI/releases/tag/v0.1.0)

## 为何不入 git

二进制大文件不适合进 git 仓库；需要分发时应作为 GitHub Release 资产上传（主版本已采用该方式）。

## 重新构建

```bash
cd ports/tauri2/src-tauri
cargo build --release
# 产物: target/release/openocd-gui.exe
```
