"""Registers tab: dump/edit target registers."""

import threading
import tkinter as tk
from tkinter import ttk

from openocd_gui.core import parsers
from openocd_gui.ui.widgets import ask_text_dialog, parse_int


class RegistersTab(ttk.Frame):
    def __init__(self, master, app):
        super().__init__(master, padding=8)
        self.app = app
        self._regs = []
        self._iid_map = {}
        self._pending = False

        bar = ttk.Frame(self)
        bar.pack(fill="x", pady=(0, 6))
        ttk.Button(bar, text="刷新", command=self.refresh).pack(side="left")
        self.auto_var = tk.BooleanVar(value=bool(app.settings.get("auto_refresh_regs", True)))
        ttk.Checkbutton(bar, text="暂停时自动刷新", variable=self.auto_var,
                        command=self._sync_auto).pack(side="left", padx=10)
        ttk.Label(bar, text="筛选:").pack(side="left", padx=(10, 2))
        self.filter_var = tk.StringVar()
        self.filter_var.trace_add("write", lambda *_: self._render())
        ttk.Entry(bar, textvariable=self.filter_var, width=16).pack(side="left")
        self.status_var = tk.StringVar(value="")
        ttk.Label(bar, textvariable=self.status_var, foreground="#4b5563").pack(
            side="right")

        wrap = ttk.Frame(self)
        wrap.pack(fill="both", expand=True)
        cols = ("num", "group", "name", "size", "value", "flags")
        self.tree = ttk.Treeview(wrap, columns=cols, show="headings", selectmode="browse")
        headers = {"num": "#", "group": "组", "name": "名称",
                   "size": "位宽", "value": "值", "flags": "标志"}
        widths = {"num": 44, "group": 120, "name": 140, "size": 56, "value": 150, "flags": 70}
        for c in cols:
            self.tree.heading(c, text=headers[c])
            self.tree.column(c, width=widths[c],
                             anchor="center" if c in ("num", "size", "flags") else "w",
                             stretch=(c in ("group", "name", "value")))
        ysb = ttk.Scrollbar(wrap, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=ysb.set)
        self.tree.pack(side="left", fill="both", expand=True)
        ysb.pack(side="left", fill="y")
        self.tree.tag_configure("dirty", foreground="#b9770e")
        self.tree.bind("<Double-Button-1>", self._edit_value)

        ttk.Label(self, foreground="#6b7280",
                  text="双击寄存器行可修改其值（目标需处于 halted 状态）").pack(anchor="w",
                                                                     pady=(4, 0))
        self._sync_auto()

    def set_connected(self, connected):
        if connected:
            self.refresh()

    def _sync_auto(self):
        self.app.settings["auto_refresh_regs"] = bool(self.auto_var.get())
        if not hasattr(self, "_auto_scheduled"):
            self._auto_scheduled = True
            self.after(1000, self._auto_tick)

    def _auto_tick(self):
        try:
            if (self.auto_var.get() and self.app.session.tcl.connected
                    and self.app.last_target_state == "halted"
                    and not self._pending):
                self.refresh()
        finally:
            self.after(1000, self._auto_tick)

    # ------------------------------------------------------------------
    def refresh(self):
        if self._pending:
            return
        self._pending = True
        self.status_var.set("读取中…")

        def on_ok(text):
            def apply():
                self._pending = False
                regs, err = parsers.parse_regs(text)
                if err:
                    self.status_var.set(err)
                    return
                self._regs = regs
                self.status_var.set("%d 个寄存器" % len(regs))
                self._render()
            self.app.post(apply)

        def on_err(exc):
            def apply():
                self._pending = False
                self.status_var.set("读取失败: %s" % exc)
            self.app.post(apply)

        self.app.session.call_async("reg", on_ok=on_ok, on_err=on_err, timeout=20.0)

    def _render(self):
        needle = self.filter_var.get().strip().lower()
        self.tree.delete(*self.tree.get_children())
        self._iid_map = {}
        for reg in self._regs:
            hay = (reg["name"] + " " + reg["group"]).lower()
            if needle and needle not in hay:
                continue
            value = parsers.pad_hex_value(reg["value"], reg["size"]) if reg["value"] else "—"
            iid = self.tree.insert("", "end", values=(
                reg["num"], reg["group"], reg["name"], "/%d" % reg["size"],
                value, "dirty" if reg["dirty"] else ""),
                tags=("dirty",) if reg["dirty"] else ())
            self._iid_map[iid] = reg

    def _edit_value(self, event):
        iid = self.tree.identify_row(event.y)
        reg = self._iid_map.get(iid)
        if not reg:
            return
        current = parsers.pad_hex_value(reg["value"], reg["size"]) if reg["value"] else "0x0"

        def validate(text):
            if parse_int(text, 16) is None:
                return "请输入十六进制数值（如 0x1234 或 1234）"
            return None

        new = ask_text_dialog(
            self, "修改寄存器", "新值（十六进制）— %s:" % reg["name"],
            initial=current, validate=validate)
        if new is None:
            return
        value = parse_int(new, 16)
        name = reg["name"]

        def worker():
            try:
                self.app.session.call("reg %s 0x%x" % (name, value), timeout=10.0)
            except Exception as exc:  # noqa: BLE001
                self.app.post(lambda e=exc: self.app.notify(
                    "写入寄存器失败: %s" % e, error=True))
                return
            self.app.post(self.refresh)

        threading.Thread(target=worker, daemon=True).start()
