"""Memory tab: hex viewer/editor backed by mdw/mdh/mdb/mdd + mww/mwh/mwb/mdd."""

import threading
import tkinter as tk
from tkinter import ttk

from openocd_gui.core import parsers
from openocd_gui.ui.widgets import ask_text_dialog, parse_int, mono_font

# label -> (bytes, read cmd, write cmd)
WIDTHS = [
    ("32 位 (mdw)", 4, "mdw", "mww"),
    ("16 位 (mdh)", 2, "mdh", "mwh"),
    ("8 位 (mdb)", 1, "mdb", "mwb"),
    ("64 位 (mdd)", 8, "mdd", "mwd"),
]
BYTES_PER_LINE = 32  # OpenOCD dumps 32 bytes per line


class MemoryTab(ttk.Frame):
    def __init__(self, master, app):
        super().__init__(master, padding=8)
        self.app = app
        self._rows = []        # [(addr, [values])]
        self._size = 4
        self._addr0 = 0
        self._pending = False

        bar = ttk.Frame(self)
        bar.pack(fill="x", pady=(0, 6))
        ttk.Label(bar, text="地址:").pack(side="left")
        self.addr_var = tk.StringVar(value="0x08000000")
        ttk.Entry(bar, textvariable=self.addr_var, width=14,
                  font=mono_font(9), justify="center").pack(side="left", padx=4)
        ttk.Label(bar, text="数量:").pack(side="left", padx=(8, 0))
        self.count_var = tk.StringVar(value="64")
        ttk.Spinbox(bar, from_=1, to=1024, textvariable=self.count_var,
                    width=6, justify="center").pack(side="left", padx=4)
        ttk.Label(bar, text="宽度:").pack(side="left", padx=(8, 0))
        self.width_var = tk.StringVar(value=WIDTHS[0][0])
        cb = ttk.Combobox(bar, textvariable=self.width_var, state="readonly",
                          values=[w[0] for w in WIDTHS], width=10)
        cb.pack(side="left", padx=4)
        ttk.Button(bar, text="读取", command=self.read).pack(side="left", padx=8)
        ttk.Button(bar, text="◀ 上一页", command=lambda: self._page(-1)).pack(side="left", padx=2)
        ttk.Button(bar, text="下一页 ▶", command=lambda: self._page(1)).pack(side="left", padx=2)
        self.status_var = tk.StringVar(value="")
        ttk.Label(bar, textvariable=self.status_var, foreground="#4b5563").pack(side="right")

        self.tree_area = ttk.Frame(self)
        self.tree_area.pack(fill="both", expand=True)
        self._build_tree()

        ttk.Label(self, foreground="#6b7280",
                  text="双击数值单元格可修改内存（目标需处于 halted 状态）").pack(anchor="w",
                                                                     pady=(4, 0))

    # ------------------------------------------------------------------ tree
    def _build_tree(self):
        if hasattr(self, "tree"):
            self.tree.destroy()
        per_line = BYTES_PER_LINE // self._size
        cols = ["addr"] + ["v%d" % i for i in range(per_line)] + ["ascii"]
        self.tree = ttk.Treeview(self.tree_area, columns=cols, show="headings",
                                 selectmode="browse")
        self.tree.heading("addr", text="地址")
        self.tree.column("addr", width=110, anchor="center", stretch=False)
        digits = self._size * 2
        for i in range(per_line):
            self.tree.heading("v%d" % i, text="%X" % (i * self._size))
            self.tree.column("v%d" % i, width=digits * 8 + 8, anchor="center",
                             stretch=False)
        self.tree.heading("ascii", text="ASCII")
        self.tree.column("ascii", width=BYTES_PER_LINE * 8 + 10, anchor="w", stretch=False)
        xsb = ttk.Scrollbar(self.tree_area, orient="horizontal", command=self.tree.xview)
        ysb = ttk.Scrollbar(self.tree_area, orient="vertical", command=self.tree.yview)
        self.tree.configure(xscrollcommand=xsb.set, yscrollcommand=ysb.set)
        self.tree.grid(row=0, column=0, sticky="nsew")
        ysb.grid(row=0, column=1, sticky="ns")
        xsb.grid(row=1, column=0, sticky="ew")
        self.tree_area.rowconfigure(0, weight=1)
        self.tree_area.columnconfigure(0, weight=1)
        self.tree.bind("<Double-Button-1>", self._edit_cell)

    # ------------------------------------------------------------------ read
    def _width_conf(self):
        for label, size, rcmd, wcmd in WIDTHS:
            if label == self.width_var.get():
                return size, rcmd, wcmd
        return 4, "mdw", "mww"

    def read(self, addr=None):
        if self._pending:
            return
        if addr is None:
            addr = parse_int(self.addr_var.get(), 16)
            if addr is None:
                self.app.notify("地址格式无效（应为十六进制，如 0x08000000）", error=True)
                return
        count = parse_int(self.count_var.get(), 10)
        if count is None or not 1 <= count <= 1024:
            self.app.notify("数量无效（1-1024）", error=True)
            return
        size, rcmd, _ = self._width_conf()
        if size != self._size:
            self._size = size
            self._build_tree()
        self._addr0 = addr
        self._pending = True
        self.status_var.set("读取中…")
        cmd = "%s 0x%x %d" % (rcmd, addr, count)

        def on_ok(text):
            def apply():
                self._pending = False
                rows = parsers.parse_md(text)
                if not rows:
                    self.status_var.set("读取失败或无数据")
                    return
                self._rows = rows
                self.status_var.set("%d 项" % sum(len(v) for _, v in rows))
                self._render()
            self.app.post(apply)

        def on_err(exc):
            def apply():
                self._pending = False
                self.status_var.set("读取失败: %s" % exc)
            self.app.post(apply)

        self.app.session.call_async(cmd, on_ok=on_ok, on_err=on_err, timeout=20.0)

    def _page(self, direction):
        count = parse_int(self.count_var.get(), 10) or 64
        size, _, _ = self._width_conf()
        total = count * (size if size else 4)
        step = max(size, total)
        self.addr_var.set("0x%08X" % (self._addr0 + direction * step))
        self.read()

    # ------------------------------------------------------------------ render
    def _render(self):
        per_line = BYTES_PER_LINE // self._size
        digits = self._size * 2
        self.tree.delete(*self.tree.get_children())
        for addr, values in self._rows:
            cells = ["%0*X" % (digits, v) for v in values]
            cells += [""] * (per_line - len(cells))
            ascii_str = self._ascii(values)
            self.tree.insert("", "end", iid="0x%08X" % addr,
                             values=["0x%08X" % addr] + cells + [ascii_str])

    def _ascii(self, values):
        out = []
        for v in values:
            raw = v.to_bytes(self._size, byteorder="little")
            out.extend(raw)
        return "".join(chr(b) if 32 <= b < 127 else "." for b in out)

    # ------------------------------------------------------------------ edit
    def _edit_cell(self, event):
        iid = self.tree.identify_row(event.y)
        col = self.tree.identify_column(event.x)
        if not iid or not col:
            return
        try:
            col_idx = int(col.replace("#", ""))
        except ValueError:
            return
        if col_idx < 2:  # addr column or invalid
            return
        value_idx = col_idx - 2
        row_addr = int(iid, 16)
        for addr, values in self._rows:
            if addr == row_addr:
                if value_idx >= len(values):
                    return
                old = values[value_idx]
                break
        else:
            return
        cell_addr = row_addr + value_idx * self._size
        _, _, wcmd = self._width_conf()

        def validate(text):
            value = parse_int(text, 16)
            if value is None:
                return "请输入十六进制数值"
            if value >= (1 << (self._size * 8)):
                return "数值超出宽度（%d 字节）" % self._size
            return None

        new = ask_text_dialog(
            self, "修改内存", "新值（十六进制）— 地址 0x%08X:" % cell_addr,
            initial="0x%0*X" % (self._size * 2, old), validate=validate)
        if new is None:
            return
        value = parse_int(new, 16)
        cmd = "%s 0x%x 0x%x" % (wcmd, cell_addr, value)

        def worker():
            try:
                self.app.session.call(cmd, timeout=10.0)
            except Exception as exc:  # noqa: BLE001
                self.app.post(lambda e=exc: self.app.notify(
                    "写入内存失败: %s" % e, error=True))
                return
            self.app.post(lambda: self.read(self._addr0))

        threading.Thread(target=worker, daemon=True).start()

    def set_connected(self, connected):
        pass
