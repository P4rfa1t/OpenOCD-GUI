# OpenOCD-GUI

A cross-platform GUI front-end for [OpenOCD](https://openocd.org) (verified against OpenOCD **0.12.0+dev**)，written in pure Python + Tkinter — **zero third-party dependencies**.

OpenOCD 的图形前端（适配 OpenOCD **0.12.0+dev**，例如 [P4rfa1t/openocd](https://github.com/P4rfa1t/openocd) 分支），纯 Python + Tkinter 实现，**无任何第三方依赖**。

[![Python](https://img.shields.io/badge/python-3.8%2B-blue)]() [![License: MIT](https://img.shields.io/badge/license-MIT-green)]() [![No deps](https://img.shields.io/badge/dependencies-none-success)]()

---

## ✨ Features / 功能

| Module | Description / 说明 |
|---|---|
| ⚙️ **配置 Config** | Auto-detect the `openocd` executable & scripts dir, searchable picker for `interface / target / board` scripts, ordered config list (`-f`), extra commands (`-c`), ports, debug level, connection presets |
| 📜 **日志 Log** | Live colored OpenOCD output with level filtering, autoscroll, export |
| 💻 **控制台 Console** | Interactive command console over the TCL RPC port, command history, quick commands |
| 🎯 **目标 Target** | Target table with auto-polling, halt / resume / soft reset / reset (halt·run·init), switch current target |
| 🧮 **寄存器 Registers** | Full register dump (grouped), filter, live refresh while halted, double-click to edit |
| 🧠 **内存 Memory** | Hex viewer/editor for 8/16/32/64-bit accesses (`mdb/mdh/mdw/mdd`), paging, ASCII column, double-click to modify |
| ⬇️ **烧写 Flash** | One-click firmware programming (`program` with verify / preverify / reset / offset), flash bank info, sector erase |
| 🛑 **断点 Breakpoints** | Hardware/software breakpoints and watchpoints (`bp/rbp/wp/rwp`) with list management |
| 🔗 **GDB** | Connection info, ready-to-copy command line, one-click external GDB launch |

## 🚀 Getting Started / 快速开始

### Prerequisites / 前置条件

- **OpenOCD ≥ 0.12** on your system (the GUI uses the hierarchical `gdb port` / `tcl port` / `telnet port` syntax)
- **Python 3.8+** with Tkinter (bundled with python.org installers)

### Run / 运行

```bash
git clone https://github.com/P4rfa1t/OpenOCD-GUI.git
cd OpenOCD-GUI
python run.py          # Linux / macOS: python3 run.py
```

On Windows you can also double-click **`openocd_gui.pyw`** (starts without a console window).

> 中文用户：启动后在「配置」页点击 **自动检测** 即可自动找到 openocd.exe 与脚本目录；选择接口（如 `interface/stlink.cfg`）与目标（如 `target/stm32f4x.cfg`）后点工具栏 **▶ 启动**。

### Daily workflow / 日常工作流

1. **配置** tab → set executable, pick `interface` + `target` configs (save as a preset for next time)
2. Toolbar **▶ 启动** → OpenOCD starts, the GUI auto-connects to its TCL RPC port
3. Use **目标 / 寄存器 / 内存 / 断点** tabs to control the target; **烧写** to flash firmware
4. **GDB** tab gives you a ready-made command line (`target remote localhost:3333`) for external GDB
5. **■ 停止** sends a graceful `shutdown` to OpenOCD (falls back to terminate)

## 🧱 Architecture / 架构

```
OpenOCD-GUI/
├── run.py / openocd_gui.pyw     # launchers
├── openocd_gui/
│   ├── app.py                   # main window, event pump, toolbar/status bar
│   ├── core/
│   │   ├── events.py            # thread-safe event bus
│   │   ├── openocd.py           # process management + argv builder
│   │   ├── tcl.py               # TCL RPC client (0x1A framing)
│   │   ├── session.py           # supervision: connect/reconnect/polling
│   │   ├── parsers.py           # output parsers (targets/reg/md/bp/wp/banks)
│   │   ├── detector.py          # find openocd, scripts scanning
│   │   └── settings.py          # settings & profiles (~/.openocd_gui)
│   └── ui/                      # one module per tab + shared widgets
└── tests/                       # unit tests for parsers & argv builder
```

The GUI communicates with OpenOCD through two channels only:
- **stdout** of the spawned process → colored log view
- **TCL RPC** (default port 6666, frame = `command + 0x1A` → `result + 0x1A`) → everything else (state polling, register/memory access, flash, breakpoints)

GUI 与 OpenOCD 只通过两个通道通信：子进程 **stdout**（日志）和 **TCL RPC** 端口（其余全部功能），因此不依赖任何 OpenOCD 内部实现细节。

## 🧪 Development / 开发

```bash
python -m unittest discover -s tests   # parser & command-builder tests
python run.py --smoke                  # headless UI construction check
```

## 🗺️ Roadmap / 计划

- [ ] ELF-aware register/memory views (parse DWARF via external tools)
- [ ] Semihosting / RTT console
- [ ] Multi-language UI (EN)
- [ ] Package as a single executable (PyInstaller)

## 📄 License

MIT — see [LICENSE](LICENSE). OpenOCD itself is GPL-2.0 and is **not** bundled; this project only launches and talks to it.
