"""Breakpoints & watchpoints tab (bp/rbp/wp/rwp)."""

import tkinter as tk
from tkinter import ttk, messagebox

from openocd_gui.core import parsers
from openocd_gui.ui.widgets import ask_text_dialog, parse_int, mono_font

BP_TYPES = ["软件 (默认)", "硬件 (hw)"]
WP_ACCESS = [("读 (r)", "r"), ("写 (w)", "w"), ("读写 (a)", "a")]
LENGTHS = ["1", "2", "4", "8"]


class BreakpointsTab(ttk.Frame):
    def __init__(self, master, app):
        super().__init__(master, padding=8)
        self.app = app
        self._bp = []
        self._wp = []
        self._bp_map = {}
        self._wp_map = {}

        paned = ttk.PanedWindow(self, orient="vertical")

        # ---------------- breakpoints ----------------
        bp = ttk.LabelFrame(paned, text="断点 (bp / rbp)", padding=8)
        paned.add(bp, weight=1)

        add = ttk.Frame(bp)
        add.pack(fill="x", pady=(0, 6))
        self.bp_type_var = tk.StringVar(value=BP_TYPES[0])
        ttk.Combobox(add, textvariable=self.bp_type_var, state="readonly",
                     values=BP_TYPES, width=10).pack(side="left")
        ttk.Label(add, text="地址:").pack(side="left", padx=(10, 2))
        self.bp_addr_var = tk.StringVar()
        ttk.Entry(add, textvariable=self.bp_addr_var, width=14,
                  font=mono_font(9), justify="center").pack(side="left")
        ttk.Label(add, text="长度:").pack(side="left", padx=(10, 2))
        self.bp_len_var = tk.StringVar(value="2")
        ttk.Combobox(add, textvariable=self.bp_len_var, state="readonly",
                     values=LENGTHS, width=4).pack(side="left")
        ttk.Button(add, text="添加断点", command=self._add_bp).pack(
            side="left", padx=10)
        ttk.Button(add, text="刷新", command=self.refresh).pack(side="right")

        bp_wrap = ttk.Frame(bp)
        bp_wrap.pack(fill="both", expand=True)
        cols = ("type", "addr", "len", "extra")
        self.bp_tree = ttk.Treeview(bp_wrap, columns=cols, show="headings",
                                    height=4)
        headers = {"type": "类型", "addr": "地址", "len": "长度", "extra": "备注"}
        widths = {"type": 90, "addr": 150, "len": 70, "extra": 220}
        for c in cols:
            self.bp_tree.heading(c, text=headers[c])
            self.bp_tree.column(c, width=widths[c],
                                anchor="center" if c in ("type", "len") else "w")
        ysb = ttk.Scrollbar(bp_wrap, orient="vertical", command=self.bp_tree.yview)
        self.bp_tree.configure(yscrollcommand=ysb.set)
        self.bp_tree.pack(side="left", fill="both", expand=True)
        ysb.pack(side="left", fill="y")

        bp_btns = ttk.Frame(bp)
        bp_btns.pack(fill="x", pady=(4, 0))
        ttk.Button(bp_btns, text="删除选中", command=self._remove_bp).pack(side="left")
        ttk.Button(bp_btns, text="全部删除", command=self._remove_all_bp).pack(
            side="left", padx=6)

        # ---------------- watchpoints ----------------
        wp = ttk.LabelFrame(paned, text="观察点 (wp / rwp)", padding=8)
        paned.add(wp, weight=1)

        addw = ttk.Frame(wp)
        addw.pack(fill="x", pady=(0, 6))
        ttk.Label(addw, text="地址:").pack(side="left")
        self.wp_addr_var = tk.StringVar()
        ttk.Entry(addw, textvariable=self.wp_addr_var, width=14,
                  font=mono_font(9), justify="center").pack(side="left", padx=2)
        ttk.Label(addw, text="长度:").pack(side="left", padx=(8, 2))
        self.wp_len_var = tk.StringVar(value="4")
        ttk.Combobox(addw, textvariable=self.wp_len_var, state="readonly",
                     values=LENGTHS, width=4).pack(side="left")
        ttk.Label(addw, text="访问:").pack(side="left", padx=(8, 2))
        self.wp_access_var = tk.StringVar(value=WP_ACCESS[2][0])
        ttk.Combobox(addw, textvariable=self.wp_access_var, state="readonly",
                     values=[lbl for lbl, _ in WP_ACCESS], width=9).pack(side="left")
        ttk.Label(addw, text="值(可选):").pack(side="left", padx=(8, 2))
        self.wp_value_var = tk.StringVar()
        ttk.Entry(addw, textvariable=self.wp_value_var, width=10,
                  font=mono_font(9), justify="center").pack(side="left")
        ttk.Label(addw, text="掩码(可选):").pack(side="left", padx=(8, 2))
        self.wp_mask_var = tk.StringVar()
        ttk.Entry(addw, textvariable=self.wp_mask_var, width=10,
                  font=mono_font(9), justify="center").pack(side="left")
        ttk.Button(addw, text="添加观察点", command=self._add_wp).pack(
            side="left", padx=10)

        wp_wrap = ttk.Frame(wp)
        wp_wrap.pack(fill="both", expand=True)
        wcols = ("addr", "len", "rw", "value", "mask")
        self.wp_tree = ttk.Treeview(wp_wrap, columns=wcols, show="headings",
                                    height=4)
        wheaders = {"addr": "地址", "len": "长度", "rw": "访问",
                    "value": "值", "mask": "掩码"}
        wwidths = {"addr": 150, "len": 70, "rw": 60, "value": 130, "mask": 130}
        for c in wcols:
            self.wp_tree.heading(c, text=wheaders[c])
            self.wp_tree.column(c, width=wwidths[c], anchor="center")
        ysb2 = ttk.Scrollbar(wp_wrap, orient="vertical", command=self.wp_tree.yview)
        self.wp_tree.configure(yscrollcommand=ysb2.set)
        self.wp_tree.pack(side="left", fill="both", expand=True)
        ysb2.pack(side="left", fill="y")

        wp_btns = ttk.Frame(wp)
        wp_btns.pack(fill="x", pady=(4, 0))
        ttk.Button(wp_btns, text="删除选中", command=self._remove_wp).pack(side="left")
        ttk.Button(wp_btns, text="全部删除", command=self._remove_all_wp).pack(
            side="left", padx=6)

        paned.pack(fill="both", expand=True)

    def set_connected(self, connected):
        if connected:
            self.refresh()

    # ------------------------------------------------------------------ refresh
    def refresh(self):
        session = self.app.session

        def bp_ok(text):
            def apply():
                self._bp = parsers.parse_breakpoints(text)
                self.bp_tree.delete(*self.bp_tree.get_children())
                self._bp_map = {}
                for b in self._bp:
                    extra = b["orig_instr"] or ("num=%s" % b["num"] if b["num"] else "")
                    if b["asid"]:
                        extra = "asid=%s %s" % (b["asid"], extra)
                    iid = self.bp_tree.insert("", "end", values=(
                        b["type"], b["addr"] or b["asid"], b["len"], extra))
                    self._bp_map[iid] = b
            self.app.post(apply)

        def wp_ok(text):
            def apply():
                self._wp = parsers.parse_watchpoints(text)
                self.wp_tree.delete(*self.wp_tree.get_children())
                self._wp_map = {}
                for w in self._wp:
                    iid = self.wp_tree.insert("", "end", values=(
                        w["addr"], w["len"], w["rw"], w["value"], w["mask"]))
                    self._wp_map[iid] = w
            self.app.post(apply)

        session.call_async("bp", on_ok=bp_ok, timeout=15.0)
        session.call_async("wp", on_ok=wp_ok, timeout=15.0)

    def _hex_or_none(self, text):
        if not text.strip():
            return None
        return parse_int(text, 16)

    # ------------------------------------------------------------------ bp
    def _add_bp(self):
        addr = self._hex_or_none(self.bp_addr_var.get())
        if addr is None:
            self.app.notify("断点地址无效（十六进制，如 0x08000198）", error=True)
            return
        cmd = "bp 0x%x %s" % (addr, self.bp_len_var.get())
        if self.bp_type_var.get() == BP_TYPES[1]:
            cmd += " hw"
        self._run(cmd)

    def _remove_bp(self):
        sel = self.bp_tree.selection()
        if not sel:
            self.app.notify("请先在列表中选择断点", error=True)
            return
        b = self._bp_map.get(sel[0])
        if not b:
            return
        target_val = b["addr"] or b["asid"]
        if target_val:
            self._run("rbp %s" % target_val)

    def _remove_all_bp(self):
        if not self._bp:
            return
        if not messagebox.askyesno("删除断点", "确定删除全部断点？"):
            return
        self._run("rbp all")

    # ------------------------------------------------------------------ wp
    def _add_wp(self):
        addr = self._hex_or_none(self.wp_addr_var.get())
        if addr is None:
            self.app.notify("观察点地址无效（十六进制，如 0x20000000）", error=True)
            return
        rw = "a"
        for lbl, val in WP_ACCESS:
            if lbl == self.wp_access_var.get():
                rw = val
        cmd = "wp 0x%x %s %s" % (addr, self.wp_len_var.get(), rw)
        value = self._hex_or_none(self.wp_value_var.get())
        if value is not None:
            cmd += " 0x%x" % value
            mask = self._hex_or_none(self.wp_mask_var.get())
            if mask is not None:
                cmd += " 0x%x" % mask
        self._run(cmd)

    def _remove_wp(self):
        sel = self.wp_tree.selection()
        if not sel:
            self.app.notify("请先在列表中选择观察点", error=True)
            return
        w = self._wp_map.get(sel[0])
        if w:
            self._run("rwp %s" % w["addr"])

    def _remove_all_wp(self):
        if not self._wp:
            return
        if not messagebox.askyesno("删除观察点", "确定删除全部观察点？"):
            return
        self._run("rwp all")

    # ------------------------------------------------------------------ run
    def _run(self, cmd):
        session = self.app.session

        def on_err(exc):
            self.app.post(lambda: self.app.notify(
                "命令失败: %s" % exc, error=True))

        session.call_async(cmd, on_ok=lambda _: None, on_err=on_err, timeout=15.0)
        # give OpenOCD a moment, then refresh the lists
        self.after(300, self.refresh)
