# OpenOCD-GUI

**English** | [简体中文](README.zh-CN.md)

A cross-platform GUI front-end for [OpenOCD](https://openocd.org) (verified against OpenOCD **0.12.0+dev**), built with **Tauri 2** — Rust backend + web frontend, packaged as a small native executable with no scripting runtime required.

[![Rust](https://img.shields.io/badge/rust-stable-orange)]() [![Tauri](https://img.shields.io/badge/Tauri-2-blue)]() [![License: MIT](https://img.shields.io/badge/license-MIT-green)]() [![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey)]()

> **History**: v0.1.x was implemented in Python/Tkinter. In v0.2.0 the project moved to Tauri 2 as its primary framework — the Python implementation was removed from the tree (still in git history).

## ✨ Features

| Module | Description |
|---|---|
| ⚙️ **Config** | Auto-detect the `openocd` executable & scripts dir, two independent cfg slots with type-to-search — interface (`-f interface/*.cfg`) then target/board (`-f target/*.cfg` or `board/*.cfg`) — so load order can never be wrong, plus a read-only **View cfg contents** button on each cfg row; a picker appears when auto-detect finds several `openocd` binaries; extra commands (`-c`), ports, optional OpenOCD log file (`-l` equivalent), debug level; named connection presets are saved and loaded inside this same fieldset (shared `~/.openocd_gui` layout) |
| 📜 **Log** | Live colored OpenOCD output with level filtering, autoscroll |
| 💻 **Console** | Interactive command console over the TCL RPC port, history, quick commands |
| 🎯 **Target** | Target table with auto-polling, halt / resume / soft reset / reset (halt·run·init), switch current target |
| 🧮 **Registers** | Register dump (grouped), filter, live refresh while halted, double-click to edit |
| 🧠 **Memory** | Hex viewer/editor for 8/16/32/64-bit accesses, paging, ASCII column, double-click to modify, default read count 160 |
| ⬇️ **Flash** | One-click firmware programming (`program` with verify / preverify / reset / offset; non-ASCII paths encoded to the ANSI codepage), flash bank info (taller table with a name / driver / base / size / bus width / chip width legend), sector erase |
| 🛑 **Breakpoints** | Hardware/software breakpoints and watchpoints (`bp/rbp/wp/rwp`) with list management; clickable rows, *Delete selected* acts on the selection, `#` index column, failure reason shown for any failed add/remove |
| 🔗 **GDB** | Connection info, ready-to-copy command line, one-click external GDB launch, *Auto-detect* (scans `PATH` and the usual Arm GNU Toolchain install locations) and *Detect version*; several candidates are offered in a picker and as path-field dropdown entries |
| ℹ️ **About** | Version info, OpenOCD version detection, config directory, and three clickable links — OpenOCD documentation / this project / P4rfa1t/OpenOCD |

### 🆕 New in this build (v0.3.2)

- **Config** — the interface cfg and the target/board cfg slots are now type-to-search selects: type to filter, so a large scripts library is searched instantly
- **View cfg contents** — split into two buttons, one on the interface cfg row and one on the target/board cfg row; each opens a read-only preview of that row's cfg in full (path included) instead of one shared button
- **Log file (service ports / debug)** — the file-chooser button is back: OpenOCD appends its own log to that file, the equivalent of `-l` on the command line; leave it empty and output stays in the Log tab only
- **Flash** — the flash-bank table is taller and now carries the column legend (name / driver / base / size / bus width / chip width)
- **GDB** — new *Auto-detect* (scans `PATH` and the common Arm GNU Toolchain install locations) and *Detect version*
- **About** — a new page: version info, OpenOCD version detection, the config directory, and three clickable links (OpenOCD documentation, this project, P4rfa1t/OpenOCD)
- **Breakpoints / watchpoints** — table rows are clickable, *Delete selected* acts on the selected rows, plus a new `#` index column and a taller table
- **Breakpoints / watchpoints, failure feedback** — a failed add/remove now reports the reason inline (`#bp-hint` / `#wp-hint` under the table), in the Log tab and as a popup; when OpenOCD rejects the argument, the hint points out that `bp` / `wp` take hexadecimal numeric addresses only — symbol names such as `main` and expressions such as `0x…+4` are not parsed
- **Multiple candidates** — when auto-detect finds several OpenOCD or GDB binaries, a dialog lets you pick one; the path field also lists every candidate in its dropdown, so you can switch without re-detecting
- **Memory** — the default read count is now 160
- **Breakpoints / watchpoints, live counts** — the table shows how many entries are currently registered (`#bp-count` / `#wp-count`), and an empty table renders an inline placeholder row instead of looking broken
- **Breakpoints / watchpoints, honest success verdict** — an add/remove is no longer judged by its TCL return value: when `breakpoint_add` fails, OpenOCD writes the reason only to its own log and still answers with an empty string, so the tool re-lists breakpoints/watchpoints after every command and compares the entry count
- **Breakpoints / watchpoints, upfront validation** — address and length are checked before the command is sent: the length must be 1, 2 or 4, and the address must be a multiple of it (the hint prints the nearest aligned address to use)
- **Hybrid breakpoints** — the parser now follows the `|--->linked with ContextID: 0x…` continuation line OpenOCD prints under a Hybrid breakpoint and attaches it to the entry above
- **Version** — 0.3.2

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
└── ui/                   # web frontend (vanilla HTML/CSS/JS, no node build)
    ├── index.html        #   layout + styling
    └── app.js            #   tab logic, OpenOCD output parsers, IPC
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
