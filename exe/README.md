# exe/ — 四框架打包产物（本地文件，不入 git）

四个跨平台框架对同一应用（OpenOCD-GUI）的打包产物，2026-10-26 在 Windows 11 x64 上构建并实测。
体积/内存等完整对比见 [ports/COMPARISON.md](../ports/COMPARISON.md)。

| 文件 | 框架 | 体积 | 内容 | 运行内存 |
|---|---|---|---|---|
| `OpenOCD-GUI-PySide6.exe` | PySide6 6.12 (PyInstaller onefile) | 51 MB | **完整移植版**（全部 9 个功能页） | ≈127 MB |
| `OpenOCD-GUI-PyQt6.exe` | PyQt6 (PyInstaller onefile) | 39 MB | **完整移植版**（与 PySide6 同源，5 处枚举适配） | ≈119 MB |
| `OpenOCD-GUI-Tauri2.exe` | Tauri 2 (Rust, release) | 6.5 MB | **完整移植版**（Rust 后端 + Web 前端） | ≈100 MB+（WebView2） |
| `Wails2-Benchmark-Demo.exe` | Wails v2 (Go + WebView2) | 4.4 MB | ⚠ **基准演示程序**（1000 行表格最小应用，非完整移植） | 13 MB 主进程 + WebView2 |

## 使用说明

- 前三个是同一应用的三个框架实现，**共享同一份配置** `~/.openocd_gui/settings.json`，可直接双击对拍体验
- PySide6/PyQt6 版为 PyInstaller onefile，首次启动需解压（约 3-4 秒）；Tauri/Wails 版即点即开
- Tauri 版带测试钩子：设置环境变量 `OPENOCD_GUI_AUTOSTART=1` 启动会自动点击"启动"按钮（调试用）
- ⚠ 请用**双击 / 资源管理器 / cmd / PowerShell** 启动：Tauri 版在 MSYS2/Git-Bash 环境下直接启动会报
  api-ms-win-*.dll 加载错误（msys 加载器怪癖，Windows 正常启动方式不受影响）
- ⚠ Wails 版若双击闪退：删除 `%TEMP%\Wails2-Benchmark-Demo` 目录后重试——强杀过的 WebView2
  进程会在该用户数据目录留下坏锁，导致后续同名进程启动即退（设置环境变量
  `WEBVIEW2_USER_DATA_FOLDER` 指向新目录亦可绕过）
- 主版本（Tkinter）的 exe 在 [GitHub Release v0.1.0](https://github.com/P4rfa1t/OpenOCD-GUI/releases/tag/v0.1.0)

## 为何不入 git

单文件最大 51 MB，四个合计超 100 MB——二进制大文件不适合进 git 仓库。
需要分发时应作为 GitHub Release 资产上传（主版本已采用该方式）。

## 重新构建

```bash
# PySide6 / PyQt6（PyQt6 需先将 ports/pyside6 复制并把 PySide6 替换为 PyQt6 + 枚举适配）
pip install PySide6 PyInstaller
pyinstaller --onefile --noconsole --name OpenOCD-GUI-PySide6 \
  --paths <仓库根> --paths ports/pyside6 ports/pyside6/run_qt.py

# Tauri 2
cd ports/tauri2/src-tauri && cargo build --release

# Wails v2（基准演示）
go build -ldflags="-s -w -H windowsgui"   # 项目结构见 ports/COMPARISON.md 描述
```
