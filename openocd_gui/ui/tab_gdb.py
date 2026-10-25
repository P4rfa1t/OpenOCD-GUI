"""GDB tab: connection info and external GDB launcher."""

import subprocess
import sys
import tkinter as tk
from tkinter import ttk, filedialog

from openocd_gui.ui.widgets import split_args


class GdbTab(ttk.Frame):
    def __init__(self, master, app):
        super().__init__(master, padding=10)
        self.app = app

        info = ttk.LabelFrame(self, text="GDB 服务器", padding=8)
        info.pack(fill="x")
        self.info_var = tk.StringVar(value="")
        ttk.Label(info, textvariable=self.info_var, font=("Microsoft YaHei UI", 10)).pack(
            anchor="w")
        ttk.Label(info, foreground="#4b5563",
                  text="OpenOCD 启动后即可用 GDB 连接（无需等待目标暂停）。"
                  ).pack(anchor="w", pady=(4, 0))
        self.refresh_info()

        cfg = ttk.LabelFrame(self, text="外部 GDB 调试器", padding=8)
        cfg.pack(fill="x", pady=(10, 0))
        cfg.columnconfigure(1, weight=1)
        ttk.Label(cfg, text="GDB 程序:").grid(row=0, column=0, sticky="w", pady=2)
        row0 = ttk.Frame(cfg)
        row0.grid(row=0, column=1, columnspan=2, sticky="ew")
        self.gdb_var = tk.StringVar(value=app.settings.get("gdb_path", "arm-none-eabi-gdb"))
        self.gdb_var.trace_add("write", lambda *_: self._sync())
        ttk.Entry(row0, textvariable=self.gdb_var).pack(side="left", fill="x",
                                                        expand=True)
        ttk.Button(row0, text="浏览…", command=self._browse_gdb).pack(
            side="left", padx=6)

        ttk.Label(cfg, text="GDB 参数:").grid(row=1, column=0, sticky="w", pady=2)
        self.args_var = tk.StringVar(value=app.settings.get(
            "gdb_args", '-ex "target remote localhost:3333"'))
        self.args_var.trace_add("write", lambda *_: self._sync())
        ttk.Entry(cfg, textvariable=self.args_var).grid(
            row=1, column=1, columnspan=2, sticky="ew")

        self.preview_var = tk.StringVar(value="")
        ttk.Label(cfg, text="完整命令行:").grid(row=2, column=0, sticky="w", pady=(8, 2))
        ttk.Label(cfg, textvariable=self.preview_var, foreground="#1f6feb").grid(
            row=2, column=1, columnspan=2, sticky="w")
        self._update_preview()

        btns = ttk.Frame(cfg)
        btns.grid(row=3, column=0, columnspan=3, sticky="w", pady=(8, 0))
        ttk.Button(btns, text="复制命令行", command=self._copy).pack(side="left")
        ttk.Button(btns, text="在新控制台启动 GDB", command=self._launch).pack(
            side="left", padx=8)

        ttk.Label(self, foreground="#6b7280", justify="left", text=(
            "提示:\n"
            "• 常用参数: -ex \"target remote localhost:3333\"，加载 ELF 后可用 load / continue / step 调试\n"
            "• 断点/观察点也可以在本页之外通过 GDB 或『断点』标签页设置\n"
            "• 若使用 gdbserver 模式，请确保端口未被占用"
        )).pack(anchor="w", pady=(10, 0))

    def refresh_info(self):
        gdb_port = self.app.settings.get("gdb_port", 3333)
        bind = self.app.settings.get("bind", "127.0.0.1")
        host = "localhost" if bind in ("127.0.0.1", "localhost", "0.0.0.0", "") else bind
        self.info_var.set("连接地址: %s:%s  (target remote %s:%s)" %
                          (host, gdb_port, host, gdb_port))

    def set_connected(self, connected):
        pass

    def _sync(self):
        self.app.settings["gdb_path"] = self.gdb_var.get().strip()
        self.app.settings["gdb_args"] = self.args_var.get().strip()
        self._update_preview()

    def _update_preview(self):
        self.preview_var.set("%s %s" % (self.gdb_var.get(), self.args_var.get()))
        self.refresh_info()

    def _browse_gdb(self):
        path = filedialog.askopenfilename(
            title="选择 GDB 可执行文件",
            filetypes=[("GDB", "gdb*"), ("所有文件", "*.*")])
        if path:
            self.gdb_var.set(path)

    def _copy(self):
        cmd = "%s %s" % (self.gdb_var.get(), self.args_var.get())
        top = self.winfo_toplevel()
        top.clipboard_clear()
        top.clipboard_append(cmd)
        self.app.notify("已复制: %s" % cmd)

    def _launch(self):
        gdb = self.gdb_var.get().strip()
        if not gdb:
            self.app.notify("请先设置 GDB 程序路径", error=True)
            return
        args = split_args(self.args_var.get())
        try:
            creationflags = subprocess.CREATE_NEW_CONSOLE if sys.platform == "win32" else 0
            subprocess.Popen([gdb] + args, creationflags=creationflags)
            self.app.notify("已启动 GDB: %s" % gdb)
        except OSError as exc:
            self.app.notify("启动 GDB 失败: %s" % exc, error=True)
