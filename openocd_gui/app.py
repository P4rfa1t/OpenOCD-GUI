"""OpenOCD-GUI main window: toolbar, notebook tabs, status bar, event pump."""

import queue
import sys
import threading
import time
import webbrowser

import tkinter as tk
from tkinter import ttk, messagebox

from openocd_gui import __version__, __project_url__
from openocd_gui.core import events
from openocd_gui.core.events import EventBus
from openocd_gui.core.session import Session
from openocd_gui.core.settings import Settings
from openocd_gui.ui import (
    tab_server, tab_console, tab_target, tab_registers,
    tab_memory, tab_flash, tab_breakpoints, tab_gdb,
)

STATE_COLORS = {
    events.SERVER_STOPPED: "#9ca3af",
    events.SERVER_STARTING: "#f59e0b",
    events.SERVER_RUNNING: "#10b981",
    events.SERVER_STOPPING: "#f59e0b",
    events.SERVER_FAILED: "#ef4444",
}
STATE_LABELS = {
    events.SERVER_STOPPED: "已停止",
    events.SERVER_STARTING: "启动中…",
    events.SERVER_RUNNING: "运行中",
    events.SERVER_STOPPING: "停止中…",
    events.SERVER_FAILED: "异常退出",
}


class App:
    def __init__(self, root, argv=None):
        self.root = root
        self.argv = list(argv or [])
        self.settings = Settings()
        self.bus = EventBus()
        self.session = Session(self.bus, self.settings)
        self.ui_queue = queue.Queue()
        self.last_target_state = ""
        self._log_capture = None  # list while a tab is mirroring LOG lines

        root.title("OpenOCD-GUI")
        root.minsize(980, 620)
        self._build_style()
        self._build_menu()
        self._build_toolbar()
        self._build_tabs()
        self._build_statusbar()
        self._apply_geometry()
        root.protocol("WM_DELETE_WINDOW", self.on_close)

        self._pump()
        self.update_ports_status()
        if "--smoke" in self.argv:
            root.after(1800, self._smoke_quit)

    # ------------------------------------------------------------- style
    def _build_style(self):
        style = ttk.Style()
        if "clam" in style.theme_names():
            style.theme_use("clam")
        style.configure(".", font=("Microsoft YaHei UI", 9))
        style.configure("Treeview", rowheight=24)
        style.configure("TNotebook.Tab", padding=(12, 5))

    def _apply_geometry(self):
        geom = self.settings.get("window_geometry") or "1120x700"
        try:
            self.root.geometry(geom)
        except tk.TclError:
            pass

    # ------------------------------------------------------------- menu
    def _build_menu(self):
        menubar = tk.Menu(self.root)
        m_file = tk.Menu(menubar, tearoff=0)
        m_file.add_command(label="退出", command=self.on_close)
        menubar.add_cascade(label="文件", menu=m_file)

        m_view = tk.Menu(menubar, tearoff=0)
        m_view.add_command(label="增大字体", command=lambda: self._bump_font(+1))
        m_view.add_command(label="减小字体", command=lambda: self._bump_font(-1))
        menubar.add_cascade(label="视图", menu=m_view)

        m_help = tk.Menu(menubar, tearoff=0)
        m_help.add_command(label="OpenOCD 文档",
                           command=lambda: webbrowser.open("http://openocd.org/doc/html/index.html"))
        m_help.add_command(label="项目主页", command=lambda: webbrowser.open(__project_url__))
        m_help.add_separator()
        m_help.add_command(label="关于", command=self._about)
        menubar.add_cascade(label="帮助", menu=m_help)
        self.root.config(menu=menubar)

    def _bump_font(self, delta):
        import tkinter.font as tkfont
        for name in ("TkDefaultFont", "TkTextFont", "TkMenuFont", "TkHeadingFont"):
            try:
                font = tkfont.nametofont(name)
                size = font.cget("size") + delta
                if 8 <= size <= 18:
                    font.configure(size=size)
            except tk.TclError:
                pass

    def _about(self):
        messagebox.showinfo(
            "关于 OpenOCD-GUI",
            "OpenOCD-GUI v%s\n\nOpenOCD 的图形前端（Python + Tkinter，无第三方依赖）。\n"
            "通过进程管理和 TCL RPC 接口控制 OpenOCD。\n\n%s" % (__version__, __project_url__))

    # ------------------------------------------------------------- toolbar
    def _build_toolbar(self):
        bar = tk.Frame(self.root, bg="#f3f4f6")
        bar.pack(fill="x")

        self.btn_start = tk.Button(
            bar, text="▶  启动", command=self.start_server,
            bg="#059669", fg="white", activebackground="#047857",
            activeforeground="white", relief="flat", padx=16, pady=4,
            font=("Microsoft YaHei UI", 10, "bold"), cursor="hand2")
        self.btn_start.pack(side="left", padx=(10, 6), pady=8)

        self.btn_stop = tk.Button(
            bar, text="■  停止", command=self.stop_server,
            bg="#dc2626", fg="white", activebackground="#b91c1c",
            activeforeground="white", relief="flat", padx=16, pady=4,
            font=("Microsoft YaHei UI", 10, "bold"), cursor="hand2")
        self.btn_stop.pack(side="left", padx=6, pady=8)

        self.state_dot = tk.Canvas(bar, width=14, height=14, bg="#f3f4f6",
                                   highlightthickness=0)
        self.state_dot.pack(side="left", padx=(14, 4))
        self._dot = self.state_dot.create_oval(2, 2, 12, 12, fill=STATE_COLORS[events.SERVER_STOPPED],
                                               outline="")

        self.state_label = tk.Label(bar, text="已停止", bg="#f3f4f6",
                                    font=("Microsoft YaHei UI", 10))
        self.state_label.pack(side="left")

        self.tcl_label = tk.Label(bar, text="TCL: 未连接", bg="#f3f4f6",
                                  fg="#6b7280", font=("Microsoft YaHei UI", 10))
        self.tcl_label.pack(side="left", padx=(18, 0))

        self.target_label = tk.Label(bar, text="目标: —", bg="#f3f4f6",
                                     fg="#6b7280", font=("Microsoft YaHei UI", 10))
        self.target_label.pack(side="left", padx=(18, 0))

    # ------------------------------------------------------------- tabs
    def _build_tabs(self):
        self.notebook = ttk.Notebook(self.root)
        self.notebook.pack(fill="both", expand=True, padx=6, pady=(0, 2))

        self.tab_server = tab_server.ServerTab(self.notebook, self)
        self.tab_console = tab_console.ConsoleTab(self.notebook, self)
        self.tab_log_holder = ttk.Frame(self.notebook)
        from openocd_gui.ui.widgets import LogView
        self.log_view = LogView(self.tab_log_holder)
        self.log_view.pack(fill="both", expand=True)
        self.tab_target = tab_target.TargetTab(self.notebook, self)
        self.tab_registers = tab_registers.RegistersTab(self.notebook, self)
        self.tab_memory = tab_memory.MemoryTab(self.notebook, self)
        self.tab_flash = tab_flash.FlashTab(self.notebook, self)
        self.tab_breakpoints = tab_breakpoints.BreakpointsTab(self.notebook, self)
        self.tab_gdb = tab_gdb.GdbTab(self.notebook, self)

        self.notebook.add(self.tab_server, text=" 配置 ")
        self.notebook.add(self.tab_log_holder, text=" 日志 ")
        self.notebook.add(self.tab_console, text=" 控制台 ")
        self.notebook.add(self.tab_target, text=" 目标 ")
        self.notebook.add(self.tab_registers, text=" 寄存器 ")
        self.notebook.add(self.tab_memory, text=" 内存 ")
        self.notebook.add(self.tab_flash, text=" 烧写 ")
        self.notebook.add(self.tab_breakpoints, text=" 断点/观察点 ")
        self.notebook.add(self.tab_gdb, text=" GDB ")

        # Tabs that require a live TCL connection.
        self._conn_tabs = [
            self.tab_console, self.tab_target, self.tab_registers,
            self.tab_memory, self.tab_flash, self.tab_breakpoints,
        ]
        self._set_conn_tabs_enabled(False)

    def _set_conn_tabs_enabled(self, enabled):
        state = "normal" if enabled else "disabled"
        for tab in self._conn_tabs:
            try:
                self.notebook.tab(tab, state=state)
            except tk.TclError:
                pass
        for tab in (self.tab_target, self.tab_registers, self.tab_memory,
                    self.tab_flash, self.tab_breakpoints):
            tab.set_connected(enabled)

    # ------------------------------------------------------------- statusbar
    def _build_statusbar(self):
        bar = tk.Frame(self.root, bg="#e5e7eb")
        bar.pack(fill="x", side="bottom")
        self.status_version = tk.Label(bar, text="OpenOCD: 未检测", bg="#e5e7eb",
                                       fg="#4b5563", anchor="w")
        self.status_version.pack(side="left", padx=8, pady=2)
        self.status_ports = tk.Label(bar, text="", bg="#e5e7eb", fg="#4b5563",
                                     anchor="w")
        self.status_ports.pack(side="left", padx=16)
        self.status_message = tk.Label(bar, text="", bg="#e5e7eb", fg="#2563eb",
                                       anchor="e")
        self.status_message.pack(side="right", padx=8)

    def set_status_message(self, text, error=False):
        self.status_message.config(text=text, fg="#dc2626" if error else "#2563eb")

    def update_ports_status(self):
        self.status_ports.config(
            text="GDB %s · TCL %s · Telnet %s" % (
                self.settings["gdb_port"], self.settings["tcl_port"],
                self.settings["telnet_port"]))

    # ------------------------------------------------------------- pump
    def post(self, fn):
        """Run fn in the UI thread (called from worker threads)."""
        self.ui_queue.put(fn)

    def notify(self, message, error=False):
        self.bus.emit(events.NOTIFY, (error, message))

    def _pump(self):
        try:
            if not self.root.winfo_exists():
                return
        except tk.TclError:
            return
        for kind, payload in self.bus.drain():
            handler = {
                events.LOG: self._on_log,
                events.SERVER_STATE: self._on_server_state,
                events.TCL_STATE: self._on_tcl_state,
                events.TARGETS: self._on_targets,
                events.NOTIFY: self._on_notify,
            }.get(kind)
            if handler:
                handler(payload)
        while True:
            try:
                fn = self.ui_queue.get_nowait()
            except queue.Empty:
                break
            try:
                fn()
            except Exception as exc:  # keep the pump alive
                print("UI callback error: %r" % exc, file=sys.stderr)
        if self.root.winfo_exists():
            self.root.after(60, self._pump)

    def _on_log(self, line):
        self.log_view.append_line(line)
        if self._log_capture is not None:
            self._log_capture.append(line)

    def begin_log_capture(self):
        """Mirror subsequent LOG lines until end_log_capture() (UI thread)."""
        self._log_capture = []

    def end_log_capture(self):
        """Stop mirroring and return the captured lines (UI thread)."""
        lines = self._log_capture if self._log_capture is not None else []
        self._log_capture = None
        return lines

    def _on_server_state(self, payload):
        state, detail = payload
        color = STATE_COLORS.get(state, "#9ca3af")
        self.state_dot.itemconfigure(self._dot, fill=color)
        self.state_label.config(text=STATE_LABELS.get(state, state))
        self.btn_start.config(
            state="normal" if state in (events.SERVER_STOPPED, events.SERVER_FAILED) else "disabled")
        self.btn_stop.config(
            state="normal" if state in (events.SERVER_STARTING, events.SERVER_RUNNING) else "disabled")
        if state == events.SERVER_RUNNING:
            self.set_status_message("OpenOCD 服务器已就绪")

    def _on_tcl_state(self, connected):
        self.tcl_label.config(
            text="TCL: 已连接" if connected else "TCL: 未连接",
            fg="#059669" if connected else "#6b7280")
        self._set_conn_tabs_enabled(connected)
        if connected:
            self.session.refresh_now()

    def _on_targets(self, rows):
        current = next((r for r in rows if r["current"]), rows[0] if rows else None)
        if current:
            state = current["state"]
            self.last_target_state = state
            color = "#059669" if state == "running" else ("#d97706" if state == "halted" else "#6b7280")
            self.target_label.config(text="目标: %s" % state, fg=color)
        self.tab_target.update_rows(rows)

    def _on_notify(self, payload):
        is_error, message = payload
        if is_error:
            self.set_status_message(message, error=True)
            messagebox.showerror("OpenOCD-GUI", message)
        else:
            self.set_status_message(message)

    # ------------------------------------------------------------- actions
    def start_server(self):
        self.settings.save()
        try:
            self.session.start()
        except ValueError as exc:
            self.notify(str(exc), error=True)
            self.notebook.select(self.tab_server)
        except (RuntimeError, OSError) as exc:
            self.notify("启动失败: %s" % exc, error=True)
        else:
            self.update_ports_status()
            self.set_status_message("正在启动 OpenOCD…")
            self.log_view.append_line(
                "════════════════ %s ▶ 启动 OpenOCD ════════════════"
                % time.strftime("%Y-%m-%d %H:%M:%S"))

    def stop_server(self):
        self.btn_stop.config(state="disabled")
        threading.Thread(target=self._stop_worker, daemon=True).start()

    def _stop_worker(self):
        try:
            self.session.stop()
        except Exception:
            pass

    def on_close(self):
        try:
            self.settings["window_geometry"] = self.root.geometry()
            self.settings.save()
        except Exception:
            pass
        try:
            if self.session.proc.alive:
                self.session.stop()
        except Exception:
            pass
        self.root.destroy()

    def _smoke_quit(self):
        self.root.destroy()


def _enable_windows_dpi():
    if sys.platform != "win32":
        return
    try:
        import ctypes
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(2)
        except Exception:
            ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass


def main(argv=None):
    argv = sys.argv[1:] if argv is None else list(argv)
    _enable_windows_dpi()
    root = tk.Tk()
    try:
        import ctypes
        dpi = ctypes.windll.user32.GetDpiForSystem()
        if dpi:
            root.tk.call("tk", "scaling", dpi / 72.0)
    except Exception:
        pass
    App(root, argv)
    root.mainloop()


if __name__ == "__main__":
    main()
