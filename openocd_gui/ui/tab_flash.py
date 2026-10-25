"""Flash tab: firmware programming (program) and flash bank operations."""

import threading
import tkinter as tk
from tkinter import ttk, filedialog

from openocd_gui.core import parsers, tcl
from openocd_gui.ui.widgets import mono_font

FILETYPES = [
    ("固件镜像", "*.bin *.hex *.elf *.axf *.out *.mot *.s19 *.icf"),
    ("ELF", "*.elf *.axf *.out"),
    ("Intel HEX / Motorola S-Record", "*.hex *.mot *.s19"),
    ("二进制", "*.bin"),
    ("所有文件", "*.*"),
]


class FlashTab(ttk.Frame):
    def __init__(self, master, app):
        super().__init__(master, padding=8)
        self.app = app
        self._banks = []
        self._busy = False

        # ---- program ----
        prog = ttk.LabelFrame(self, text="固件烧写 (program)", padding=8)
        prog.pack(fill="x")
        prog.columnconfigure(0, weight=1)
        ttk.Label(prog, text="镜像文件:").grid(row=0, column=0, sticky="w")
        row0 = ttk.Frame(prog)
        row0.grid(row=0, column=0, columnspan=3, sticky="ew", pady=(2, 6))
        self.file_var = tk.StringVar()
        ttk.Entry(row0, textvariable=self.file_var).pack(
            side="left", fill="x", expand=True)
        ttk.Button(row0, text="浏览…", command=self._browse_file).pack(
            side="left", padx=6)

        ttk.Label(prog, text="偏移地址(可选):").grid(row=1, column=0, sticky="w")
        self.offset_var = tk.StringVar()
        ttk.Entry(prog, textvariable=self.offset_var, width=14,
                  justify="center").grid(row=1, column=1, sticky="w", padx=4)
        ttk.Label(prog, foreground="#6b7280",
                  text="仅裸二进制(.bin)需要，如 0x08000000").grid(
            row=1, column=2, sticky="w")

        opts = ttk.Frame(prog)
        opts.grid(row=2, column=0, columnspan=3, sticky="w", pady=4)
        self.verify_var = tk.BooleanVar(value=True)
        self.reset_var = tk.BooleanVar(value=True)
        self.preverify_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(opts, text="烧写后校验 (verify)",
                        variable=self.verify_var).pack(side="left", padx=(0, 14))
        ttk.Checkbutton(opts, text="烧写后复位 (reset)",
                        variable=self.reset_var).pack(side="left", padx=(0, 14))
        ttk.Checkbutton(opts, text="烧写前校验 (preverify)",
                        variable=self.preverify_var).pack(side="left")

        self.program_btn = tk.Button(
            prog, text="⬇  烧写固件", command=self._program,
            bg="#2563eb", fg="white", activebackground="#1d4ed8",
            activeforeground="white", relief="flat", padx=18, pady=4,
            font=("Microsoft YaHei UI", 10, "bold"), cursor="hand2")
        self.program_btn.grid(row=3, column=0, sticky="w", pady=(8, 0))
        self.prog_status_var = tk.StringVar(value="")
        ttk.Label(prog, textvariable=self.prog_status_var,
                  foreground="#4b5563").grid(row=3, column=1, columnspan=2,
                                             sticky="w", pady=(10, 0), padx=8)

        # ---- banks ----
        banks = ttk.LabelFrame(self, text="Flash 存储体 (flash banks)", padding=8)
        banks.pack(fill="both", expand=True, pady=(10, 0))
        top = ttk.Frame(banks)
        top.pack(fill="x", pady=(0, 4))
        ttk.Button(top, text="刷新", command=self._refresh_banks).pack(side="left")
        ttk.Label(top, text="信息输出:").pack(side="left", padx=(16, 4))
        self.bank_info_var = tk.StringVar(value="0")
        ttk.Entry(top, textvariable=self.bank_info_var, width=4,
                  justify="center").pack(side="left")
        ttk.Button(top, text="信息 (flash info)", command=self._bank_info).pack(
            side="left", padx=4)
        ttk.Label(top, text="扇区范围:").pack(side="left", padx=(16, 2))
        self.sector_first_var = tk.StringVar(value="0")
        ttk.Entry(top, textvariable=self.sector_first_var, width=4,
                  justify="center").pack(side="left")
        ttk.Label(top, text="-").pack(side="left")
        self.sector_last_var = tk.StringVar(value="last")
        ttk.Entry(top, textvariable=self.sector_last_var, width=5,
                  justify="center").pack(side="left")
        ttk.Button(top, text="擦除扇区", command=self._erase_sectors).pack(
            side="left", padx=4)

        wrap = ttk.Frame(banks)
        wrap.pack(fill="both", expand=True)
        cols = ("num", "name", "driver", "base", "size", "buswidth", "chipwidth")
        self.tree = ttk.Treeview(wrap, columns=cols, show="headings", height=4)
        headers = {"num": "#", "name": "名称", "driver": "驱动", "base": "基址",
                   "size": "大小", "buswidth": "总线宽", "chipwidth": "芯片宽"}
        widths = {"num": 36, "name": 170, "driver": 110, "base": 110,
                  "size": 110, "buswidth": 70, "chipwidth": 70}
        for c in cols:
            self.tree.heading(c, text=headers[c])
            self.tree.column(c, width=widths[c],
                             anchor="center" if c not in ("name",) else "w")
        ysb = ttk.Scrollbar(wrap, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=ysb.set)
        self.tree.pack(side="left", fill="both", expand=True)
        ysb.pack(side="left", fill="y")

        self.out = tk.Text(self, height=8, state="disabled", font=mono_font(9),
                           wrap="none", background="#fbfbfb", relief="flat")
        self.out.pack(fill="both", expand=True, pady=(8, 0))

    def set_connected(self, connected):
        if connected:
            self._refresh_banks()

    def _write_out(self, text):
        self.out.configure(state="normal")
        self.out.delete("1.0", "end")
        self.out.insert("1.0", text)
        self.out.configure(state="disabled")

    def _captured_output(self, result, fallback):
        """Join captured log lines with the RPC reply (UI thread, after a
        short settle so trailing stdout lines reach the pump first)."""
        lines = self.app.end_log_capture()
        text = "\n".join(lines)
        if result:
            text = (text + "\n" if text else "") + result
        return text or fallback

    # ------------------------------------------------------------------ program
    def _browse_file(self):
        path = filedialog.askopenfilename(title="选择固件镜像", filetypes=FILETYPES)
        if path:
            self.file_var.set(path)

    def _program(self):
        if self._busy:
            return
        path = self.file_var.get().strip()
        if not path:
            self.app.notify("请先选择固件镜像文件", error=True)
            return
        # OpenOCD's Jim Tcl opens files with the ANSI codepage on Windows, so
        # non-ASCII paths must be encoded accordingly (or shortened to 8.3).
        try:
            path_bytes = tcl.path_to_rpc_bytes(path)
        except UnicodeEncodeError as exc:
            self.app.notify(
                "固件路径无法发送给 OpenOCD（%s）。请把文件移到纯英文路径后重试。" % exc,
                error=True)
            return
        parts = [b"program {" + path_bytes + b"}"]
        offset = self.offset_var.get().strip()
        if offset:
            try:
                parts.append(offset.encode("ascii"))
            except UnicodeEncodeError:
                self.app.notify("偏移地址包含非法字符: %s" % offset, error=True)
                return
        if self.preverify_var.get():
            parts.append(b"preverify")
        if self.verify_var.get():
            parts.append(b"verify")
        if self.reset_var.get():
            parts.append(b"reset")
        cmd = b" ".join(parts)

        self._busy = True
        self.program_btn.config(state="disabled", text="烧写中…")
        self.prog_status_var.set("执行中，日志输出在下方")
        self._write_out("")
        self.app.begin_log_capture()

        def finish(result, ok):
            def settle():
                text = self._captured_output(
                    result, "(命令已执行，无日志输出)")
                self._busy = False
                self.program_btn.config(state="normal", text="⬇  烧写固件")
                self.prog_status_var.set("完成" if ok else "失败")
                self._write_out(text)
                self.app.session.refresh_now()
            self.after(300, settle)  # let trailing log lines reach the pump

        def on_ok(result):
            self.app.post(lambda: finish(result, True))

        def on_err(exc):
            def apply():
                self.app.notify("烧写失败: %s" % exc, error=True)
                finish(str(exc), False)
            self.app.post(apply)

        self.app.session.call_async(cmd, on_ok=on_ok, on_err=on_err, timeout=300.0)

    # ------------------------------------------------------------------ banks
    def _refresh_banks(self):
        def on_ok(text):
            def apply():
                self._banks = parsers.parse_flash_banks(text)
                self.tree.delete(*self.tree.get_children())
                for b in self._banks:
                    self.tree.insert("", "end", values=(
                        b["num"], b["name"], b["driver"], b["base"],
                        b["size"], b["buswidth"], b["chipwidth"]))
                if not self._banks:
                    self._write_out(text or "(无 flash bank)")
            self.app.post(apply)

        def on_err(exc):
            self.app.post(lambda: self._write_out("flash banks 失败: %s" % exc))

        self.app.session.call_async("flash banks", on_ok=on_ok, on_err=on_err)

    def _bank_info(self):
        bank = self.bank_info_var.get().strip() or "0"

        def on_ok(text):
            self.app.post(lambda: self._write_out(text or "(无输出)"))

        def on_err(exc):
            self.app.post(lambda: self._write_out("flash info 失败: %s" % exc))

        self.app.session.call_async("flash info %s" % bank,
                                    on_ok=on_ok, on_err=on_err, timeout=30.0)

    def _erase_sectors(self):
        bank = self.bank_info_var.get().strip() or "0"
        first = self.sector_first_var.get().strip() or "0"
        last = self.sector_last_var.get().strip() or "last"
        if not self.app.session.tcl.connected:
            return
        cmd = "flash erase_sector %s %s %s" % (bank, first, last)
        self.app.begin_log_capture()

        def on_ok(text):
            def apply():
                def settle():
                    self._write_out(self._captured_output(
                        text, "擦除命令已执行"))
                    self.app.notify("扇区擦除完成")
                    self._bank_info()
                self.after(300, settle)
            self.app.post(apply)

        def on_err(exc):
            def apply():
                self._captured_output("", "")  # stop the capture
                self.app.notify("擦除失败: %s" % exc, error=True)
            self.app.post(apply)

        self.app.session.call_async(cmd, on_ok=on_ok, on_err=on_err, timeout=120.0)
