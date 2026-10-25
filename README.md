# OpenOCD-GUI

**English** | [简体中文](README.zh-CN.md)

A cross-platform GUI front-end for [OpenOCD](https://openocd.org) (verified against OpenOCD **0.12.0+dev**), built with **Tauri 2** — Rust backend + web frontend, packaged as a small native executable with no scripting runtime required.

[![Rust](https://img.shields.io/badge/rust-stable-orange)]() [![Tauri](https://img.shields.io/badge/Tauri-2-blue)]() [![License: MIT](https://img.shields.io/badge/license-MIT-green)]() [![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey)]()

> **History**: v0.1.x was implemented in Python/Tkinter. In v0.2.0 the project moved to Tauri 2 as its primary framework — the Python implementation was removed from the tree (still in git history), and the framework evaluation behind this decision is preserved in [docs/framework-evaluation.md](docs/framework-evaluation.md) (measured comparison of Tkinter / PySide6 / PyQt6 / Tauri 2 / Wails v2 / Flutter).

## ✨ Features

| Module | Description |
|---|---|
| ⚙️ **Config** | Auto-detect the `openocd` executable & scripts dir, picker for `interface / target / board` scripts, ordered config list (`-f`), extra commands (`-c`), ports, debug level, connection presets (shared `~/.openocd_gui` layout) |
| 📜 **Log** | Live colored OpenOCD output with level filtering, autoscroll |
| 💻 **Console** | Interactive command console over the TCL RPC port, history, quick commands |
| 🎯 **Target** | Target table with auto-polling, halt / resume / soft reset / reset (halt·run·init), switch current target |
| 🧮 **Registers** | Register dump (grouped), filter, live refresh while halted, double-click to edit |
| 🧠 **Memory** | Hex viewer/editor for 8/16/32/64-bit accesses, paging, ASCII column, double-click to modify |
| ⬇️ **Flash** | One-click firmware programming (`program` with verify / preverify / reset / offset; non-ASCII paths encoded to the ANSI codepage), flash bank info, sector erase |
| 🛑 **Breakpoints** | Hardware/software breakpoints and watchpoints (`bp/rbp/wp/rwp`) with list management |
| 🔗 **GDB** | Connection info, ready-to-copy command line, one-click external GDB launch |

## 🚀 Getting Started

### Option 1 — Download the Windows executable

Grab **`OpenOCD-GUI.exe`** + **`WebView2Loader.dll`** from the [releases](https://github.com/P4rfa1t/OpenOCD-GUI/releases/latest) page and keep **both files in the same folder**.

- WebView2 Runtime is required — preinstalled on Windows 10/11 (older systems: [Evergreen installer](https://developer.microsoft.com/microsoft-edge/webview2/))
- The separate `WebView2Loader.dll` is only needed because the shipped build uses the **mingw** toolchain (dynamically linked loader); an MSVC-built exe embeds it statically — see build notes below

### Option 2 — Build from source

Prerequisites: [Rust](https://rustup.rs) + OpenOCD ≥ 0.12 (the GUI uses the hierarchical `gdb port` / `tcl port` / `telnet port` syntax).

```bash
git clone https://github.com/P4rfa1t/OpenOCD-GUI.git
cd OpenOCD-GUI/src-tauri
cargo build --release
```

Toolchain notes:

- **MSVC** (default on Windows): produces a single self-contained exe
- **GNU/mingw** (`x86_64-pc-windows-gnu`): the build links `WebView2Loader.dll` dynamically — cargo drops the DLL next to the exe in `target/release/`; ship both files together. If your linker isn't in PATH, add `src-tauri/.cargo/config.toml` (gitignored, machine-specific):
  ```toml
  [target.x86_64-pc-windows-gnu]
  linker = "C:/msys64/ucrt64/bin/gcc.exe"
  ```

### Daily workflow

1. **Config** tab → set the executable (or *Auto-detect*), pick `interface` + `target` configs, optionally add commands such as `adapter speed 3000`, `transport select swd`
2. Toolbar **▶ 启动** → OpenOCD launches, the GUI auto-connects to its TCL RPC port (default 6666)
3. Use **Target / Registers / Memory / Breakpoints** tabs to control the target; **Flash** to program firmware
4. **GDB** tab gives you a ready-made command line (`target remote localhost:3333`) for an external GDB
5. **■ 停止** sends a graceful `shutdown` to OpenOCD (falls back to terminate)

## 🧱 Architecture

```
OpenOCD-GUI/
├── src-tauri/            # Rust backend
│   └── src/main.rs       #   openocd process mgmt, TCL RPC client (0x1A framing,
│                         #   ANSI path encoding), supervision/polling threads,
│                         #   settings & profiles (~/.openocd_gui, JSON)
├── ui/                   # web frontend (vanilla HTML/CSS/JS, no node build)
│   ├── index.html        #   layout + styling
│   └── app.js            #   tab logic, OpenOCD output parsers, IPC
├── exe/                  # local build outputs (gitignored binaries + README)
└── docs/
    └── framework-evaluation.md   # why Tauri 2 (measured 6-framework comparison)
```

The GUI talks to OpenOCD through exactly two channels: the **stdout** of the spawned process (→ log view) and the **TCL RPC** port (frame = `command + 0x1A` → `result + 0x1A`) for everything else. No OpenOCD internals are linked or patched.

### Debug hooks

- `OPENOCD_GUI_AUTOSTART=1` env var → the app presses **Start** by itself at launch (E2E testing)
- `%TEMP%/ocd_gui_tauri.log` — backend/frontend diagnostic trace

## 🗺️ Roadmap

- [ ] Live flash-progress capture into the Flash tab (stdout streaming is already displayed in Log)
- [ ] 8.3 short-path fallback for non-ANSI-representable firmware paths
- [ ] Linux/macOS CI builds (WebKitGTK on Linux)
- [ ] Rust unit tests for the TCL framing & parsers

## 📄 License

MIT — see [LICENSE](LICENSE). OpenOCD itself is GPL-2.0 and is **not** bundled; this project only launches and talks to it.
