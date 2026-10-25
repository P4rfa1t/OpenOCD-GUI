"""Console tab: send arbitrary OpenOCD commands over the TCL RPC connection."""

import tkinter as tk
from tkinter import ttk

from openocd_gui.ui.widgets import ConsoleView

QUICK_COMMANDS = [
    ("poll", "poll"), ("targets", "targets"), ("version", "version"),
    ("halt", "halt"), ("resume", "resume"),
    ("reset halt", "reset halt"), ("reset run", "reset run"), ("reset init", "reset init"),
    ("flash banks", "flash banks"), ("shutdown", "shutdown"),
]


class ConsoleTab(ttk.Frame):
    def __init__(self, master, app):
        super().__init__(master, padding=8)
        self.app = app

        bar = ttk.Frame(self)
        bar.pack(fill="x", pady=(0, 6))
        ttk.Label(bar, text="快捷命令:").pack(side="left")
        for label, cmd in QUICK_COMMANDS:
            ttk.Button(bar, text=label, width=9,
                       command=lambda c=cmd: self.send(c)).pack(side="left", padx=2)
        ttk.Label(bar, foreground="#6b7280",
                  text="提示: 日志类输出（如烧写进度）显示在『日志』标签页"
                  ).pack(side="right")

        self.view = ConsoleView(self, self.send)
        self.view.pack(fill="both", expand=True)

    def send(self, cmd):
        if cmd.strip() == "shutdown":
            self.view.print_result("已请求关闭 OpenOCD（若被拒绝，请用工具栏『停止』）")
        self.app.session.call_async(
            cmd,
            on_ok=lambda res, c=cmd: self.app.post(lambda: self.view.print_result(res)),
            on_err=lambda exc, c=cmd: self.app.post(lambda: self.view.print_error(str(exc))),
            timeout=60.0,
        )
