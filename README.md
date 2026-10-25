# OpenOCD-GUI

**English** | [简体中文](README.zh-CN.md)

A cross-platform GUI front-end for [OpenOCD](https://openocd.org) (verified against OpenOCD **0.12.0+dev**), built with **Tauri 2** — Rust backend + web frontend, packaged as a small native executable with no scripting runtime required.

[![Rust](https://img.shields.io/badge/rust-stable-orange)]() [![Tauri](https://img.shields.io/badge/Tauri-2-blue)]() [![License: MIT](https://img.shields.io/badge/license-MIT-green)]() [![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey)]()

> **History**: v0.1.x was implemented in Python/Tkinter. In v0.2.0 the project moved to Tauri 2 as its primary framework — the Python implementation was removed from the tree (still in git history), and the framework evaluation behind this decision is preserved in [docs/framework-evaluation.md](docs/framework-evaluation.md) (measured comparison of Tkinter / PySide6 / PyQt6 / Tauri 2 / Wails v2 / Flutter).

## ✨ Features

| Module | Description |
|---|---|
| ⚙️ **Config** | Auto-detect the `openocd` executable & scripts dir, two independent single-select cfg slots — interface (`-f interface/*.cfg`) then target/board (`-f target/*.cfg` or `board/*.cfg`) — so load order can never be wrong; extra commands (`-c`), ports, debug level, connection presets (shared `~/.openocd_gui` layout) |
| 📜 **Log** | Live colored OpenOCD output with level filtering, autoscroll |
| 💻 **Console** | Interactive command console over the TCL RPC port, history, quick commands |
| 🎯 **Target** | Target table with auto-polling, halt / resume / soft reset / reset (halt·run·init), switch current target |
| 🧮 **Registers** | Register dump (grouped), filter, live refresh while halted, double-click to edit |
| 🧠 **Memory** | Hex viewer/editor for 8/16/32/64-bit accesses, paging, ASCII column, double-click to modify |
| ⬇️ **Flash** | One-click firmware programming (`program` with verify / preverify / reset / offset; non-ASCII paths encoded to the ANSI codepage), flash bank info, sector erase |
| 🛑 **Breakpoints** | Hardware/software breakpoints and watchpoints (`bp/rbp/wp/rwp`) with list management |
| 🔗 **GDB** | Connection info, ready-to-copy command line, one-click external GDB launch |

## 🚀 Getting Started

### Option 1 — Download a prebuilt binary

**Windows** — a single self-contained **`OpenOCD-GUI.exe`**, no DLLs beside it. Grab it from the [releases](https://github.com/P4rfa1t/OpenOCD-GUI/releases/latest) page.

- WebView2 Runtime is required — preinstalled on Windows 10/11 (older systems: [Evergreen installer](https://developer.microsoft.com/microsoft-edge/webview2/))
- The release is built with the **MSVC** toolchain, which links `WebView2Loader` statically into the exe. Older 0.2.0 builds used mingw and needed a separate `WebView2Loader.dll` — those are superseded.

**Linux** — build from source (below) or take the CI artifact `OpenOCD-GUI-linux-x86_64`. Requirements: OpenOCD ≥ 0.12, GTK 3 + WebKitGTK 4.1 runtime (`libwebkit2gtk-4.1-0`, `libgtk-3-0`), and an X11/Wayland session.

**macOS** — CI artifact `OpenOCD-GUI-macos-aarch64`; WebKit is part of the OS.

### Option 2 — Build from source

Prerequisites: [Rust](https://rustup.rs) + OpenOCD ≥ 0.12 (the GUI uses the hierarchical `gdb port` / `tcl port` / `telnet port` syntax).

```bash
git clone https://github.com/P4rfa1t/OpenOCD-GUI.git
cd OpenOCD-GUI/src-tauri
cargo build --release
```

**Windows** — use the **MSVC** toolchain (`rustup default stable-x86_64-pc-windows-msvc`). It produces one self-contained exe with `WebView2Loader` linked statically, so there is nothing to ship beside it:

```bash
cargo build --release --target x86_64-pc-windows-msvc
# → target/x86_64-pc-windows-msvc/release/openocd-gui.exe  (single file)
```

If you must build with **GNU/mingw** (`x86_64-pc-windows-gnu`), the loader is linked dynamically and `WebView2Loader.dll` must sit next to the exe. When the linker isn't in PATH, add `src-tauri/.cargo/config.toml` (gitignored, machine-specific):

```toml
[target.x86_64-pc-windows-gnu]
linker = "C:/msys64/ucrt64/bin/gcc.exe"
```

**Linux** — install the WebKitGTK dev packages first:

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev pkg-config
# Fedora: sudo dnf install webkit2gtk4.1-devel gtk3-devel librsvg2-devel
# Arch:   sudo pacman -S webkit2gtk-4.1 gtk3 librsvg
cargo build --release
# → target/release/openocd-gui
```

**macOS** — `cargo build --release` works out of the box (WebKit ships with the OS). Launching external GDB opens Terminal via `osascript`.

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
- [x] Linux/macOS CI builds (WebKitGTK on Linux)
- [ ] Rust unit tests for the TCL framing & parsers

## 📄 License

MIT — see [LICENSE](LICENSE). OpenOCD itself is GPL-2.0 and is **not** bundled; this project only launches and talks to it.
