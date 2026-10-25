# OpenOCD-GUI

**English** | [简体中文](README.zh-CN.md)

A cross-platform GUI front-end for [OpenOCD](https://openocd.org) (verified against OpenOCD **0.12.0+dev**), written in pure Python + Tkinter — **zero third-party dependencies**.

[![Python](https://img.shields.io/badge/python-3.8%2B-blue)]() [![License: MIT](https://img.shields.io/badge/license-MIT-green)]() [![No deps](https://img.shields.io/badge/dependencies-none-success)]() [![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey)]()

## ✨ Features

| Module | Description |
|---|---|
| ⚙️ **Config** | Auto-detect the `openocd` executable & scripts dir, searchable picker for `interface / target / board` scripts, ordered config list (`-f`), extra commands (`-c`), ports, debug level, connection presets |
| 📜 **Log** | Live colored OpenOCD output with level filtering, autoscroll, session separators, export |
| 💻 **Console** | Interactive command console over the TCL RPC port, command history, quick commands |
| 🎯 **Target** | Target table with auto-polling, halt / resume / soft reset / reset (halt·run·init), switch current target |
| 🧮 **Registers** | Full register dump (grouped), filter, live refresh while halted, double-click to edit |
| 🧠 **Memory** | Hex viewer/editor for 8/16/32/64-bit accesses (`mdb/mdh/mdw/mdd`), paging, ASCII column, double-click to modify |
| ⬇️ **Flash** | One-click firmware programming (`program` with verify / preverify / reset / offset), flash bank info, sector erase |
| 🛑 **Breakpoints** | Hardware/software breakpoints and watchpoints (`bp/rbp/wp/rwp`) with list management |
| 🔗 **GDB** | Connection info, ready-to-copy command line, one-click external GDB launch |

## 🚀 Getting Started

### Option 1 — Windows executable (recommended)

Download **[OpenOCD-GUI.exe](https://github.com/P4rfa1t/OpenOCD-GUI/releases/latest)** from the releases page — a single file, no Python installation needed, and **no console window ever** (GUI subsystem, independent of any `.pyw` file association). Note: some antivirus products may warn about unsigned PyInstaller binaries; the source build below is the alternative.

### Option 2 — Run from source

#### Prerequisites

- **OpenOCD ≥ 0.12** on your system (the GUI uses the hierarchical `gdb port` / `tcl port` / `telnet port` syntax introduced in 0.12)
- **Python 3.8+** with Tkinter (bundled with python.org installers; on Debian/Ubuntu: `apt install python3-tk`)

#### Run

```bash
git clone https://github.com/P4rfa1t/OpenOCD-GUI.git
cd OpenOCD-GUI
python run.py          # Linux / macOS: python3 run.py
```

On Windows you can also double-click **`openocd_gui.pyw`** (starts without a console window).

> **A blank terminal appears when double-clicking the `.pyw`?** Your `.pyw` association points to a console program (e.g. a stray `pyw.exe` copy). Fix it by associating `.pyw` with the official windowless `pythonw.exe` that ships with python.org Python:
> ```bat
> ftype Python.NoConFile="C:\Path\To\Python3xx\pythonw.exe" "%L" %*
> ```
> (or set it per-user in `HKCU\Software\Classes\Python.NoConFile\shell\open\command`). The launcher also hides a console window on its own when launched through `python.exe`.

### Daily workflow

1. **Config** tab → set the executable (or click *Auto-detect*), pick `interface` + `target` configs, optionally add extra commands such as `adapter speed 3000`, `transport select swd`
2. Toolbar **▶ Start** → OpenOCD launches, the GUI auto-connects to its TCL RPC port
3. Use the **Target / Registers / Memory / Breakpoints** tabs to control the target; **Flash** to program firmware
4. **GDB** tab gives you a ready-made command line (`target remote localhost:3333`) for an external GDB
5. **■ Stop** sends a graceful `shutdown` to OpenOCD (falls back to terminate)

## 🧱 Architecture

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

The GUI talks to OpenOCD through exactly two channels:

- the **stdout** of the spawned process → colored log view
- the **TCL RPC** port (default 6666, frame = `command + 0x1A` → `result + 0x1A`) → everything else (state polling, register/memory access, flash, breakpoints)

No OpenOCD internals are linked or patched, so it works with stock builds of OpenOCD 0.12+ as well as custom forks.

## 🌍 Platform support

Pure standard library, designed cross-platform. Developed and fully tested on **Windows**; the Linux/macOS code paths are in place (platform-guarded process flags, POSIX openocd detection paths) but not regularly exercised — feedback and patches welcome.

## 🧪 Development

```bash
python -m unittest discover -s tests   # parser & command-builder tests
python run.py --smoke                  # headless UI construction check
```

### Framework evaluation: PySide6 & Tauri 2 ports

The same app has also been ported to [PySide6](ports/pyside6/) (reusing `openocd_gui/core/`) and [Tauri 2](ports/tauri2/) (Rust + vanilla JS rewrite), with measured size/memory/LOC comparison in [ports/COMPARISON.md](ports/COMPARISON.md). The Tkinter version in the repo root remains the primary front-end.

## 🗺️ Roadmap

- [ ] ELF-aware register/memory views
- [ ] Semihosting / RTT console
- [ ] English UI localization (current UI labels are Chinese)
- [ ] Package as a single executable (PyInstaller)

## 📄 License

MIT — see [LICENSE](LICENSE). OpenOCD itself is GPL-2.0 and is **not** bundled; this project only launches and talks to it.
