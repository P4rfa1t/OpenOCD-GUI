"""Shared Tk widgets: log view, console view, script picker, dialogs, helpers."""

import tkinter as tk
import tkinter.font as tkfont
from tkinter import ttk, filedialog


def mono_font(size=9):
    """Return a monospace font family available on this platform."""
    try:
        families = tkfont.families()
        for fam in ("Consolas", "Cascadia Mono", "Courier New", "Courier"):
            if fam in families:
                return (fam, size)
    except tk.TclError:
        pass
    return ("Courier", size)


def split_args(s):
    """Split a command line on whitespace, honouring double quotes."""
    args, cur, in_q = [], [], False
    for ch in s:
        if ch == '"':
            in_q = not in_q
        elif ch.isspace() and not in_q:
            if cur:
                args.append("".join(cur))
                cur = []
        else:
            cur.append(ch)
    if cur:
        args.append("".join(cur))
    return args


def parse_int(text, base=16, default=None):
    """Parse '0x..' or bare hex/decimal text. Returns default on failure."""
    text = (text or "").strip()
    if not text:
        return default
    try:
        if text.lower().startswith("0x"):
            return int(text, 16)
        if base == 16:
            return int(text, 16)
        return int(text, base)
    except ValueError:
        return default


# --------------------------------------------------------------------------
class LogView(ttk.Frame):
    """Colored, filterable OpenOCD log output."""

    MAX_LINES = 20000
    RENDER_CAP = 6000

    FILTERS = [
        ("全部", None),
        ("信息及以上", {"info", "user", "warning", "error", "raw"}),
        ("警告+错误", {"warning", "error", "raw"}),
        ("仅错误", {"error", "raw"}),
    ]

    TAG_COLORS = {
        "error": "#c0392b",
        "warning": "#b9770e",
        "debug": "#8e8e8e",
        "user": "#1f6feb",
    }

    def __init__(self, master):
        super().__init__(master)
        from openocd_gui.core.parsers import classify_log_line
        self._classify = classify_log_line
        self._lines = []  # (level, text)

        bar = ttk.Frame(self)
        bar.pack(fill="x", pady=(0, 4))
        ttk.Label(bar, text="过滤:").pack(side="left")
        self.filter_var = tk.StringVar(value=self.FILTERS[0][0])
        cb = ttk.Combobox(bar, textvariable=self.filter_var, state="readonly",
                          values=[name for name, _ in self.FILTERS], width=12)
        cb.pack(side="left", padx=(4, 12))
        cb.bind("<<ComboboxSelected>>", lambda e: self._rerender())
        self.autoscroll_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(bar, text="自动滚动", variable=self.autoscroll_var).pack(side="left")
        self.count_var = tk.StringVar(value="0 行")
        ttk.Label(bar, textvariable=self.count_var).pack(side="right")
        ttk.Button(bar, text="保存日志", command=self._save).pack(side="right", padx=4)
        ttk.Button(bar, text="清空", command=self.clear).pack(side="right")

        content = ttk.Frame(self)
        content.pack(fill="both", expand=True)
        self.text = tk.Text(content, wrap="none", state="disabled",
                            font=mono_font(9), relief="flat",
                            background="#fbfbfb", foreground="#1a1a1a")
        ysb = ttk.Scrollbar(content, orient="vertical", command=self.text.yview)
        xsb = ttk.Scrollbar(content, orient="horizontal", command=self.text.xview)
        self.text.configure(yscrollcommand=ysb.set, xscrollcommand=xsb.set)
        xsb.pack(side="bottom", fill="x")
        self.text.pack(side="left", fill="both", expand=True)
        ysb.pack(side="left", fill="y")
        for level, color in self.TAG_COLORS.items():
            self.text.tag_configure(level, foreground=color)

    def _allowed(self):
        for name, allowed in self.FILTERS:
            if name == self.filter_var.get():
                return allowed
        return None

    def append_line(self, line):
        level = self._classify(line)
        self._lines.append((level, line))
        if len(self._lines) > self.MAX_LINES:
            del self._lines[: len(self._lines) - self.MAX_LINES]
        self.count_var.set("%d 行" % len(self._lines))
        allowed = self._allowed()
        if allowed is not None and level not in allowed:
            return
        self._insert(len(self._lines) - 1)

    def _insert(self, index):
        level, line = self._lines[index]
        self.text.configure(state="normal")
        if level in self.TAG_COLORS:
            self.text.insert("end", line + "\n", level)
        else:
            self.text.insert("end", line + "\n")
        self._trim()
        if self.autoscroll_var.get():
            self.text.see("end")
        self.text.configure(state="disabled")

    def _trim(self):
        if int(self.text.index("end-1c").split(".")[0]) > self.MAX_LINES:
            self.text.delete("1.0", "%d.0" % (self.RENDER_CAP // 2))

    def _rerender(self):
        allowed = self._allowed()
        self.text.configure(state="normal")
        self.text.delete("1.0", "end")
        lines = self._lines[-self.RENDER_CAP:]
        for level, line in lines:
            if allowed is not None and level not in allowed:
                continue
            if level in self.TAG_COLORS:
                self.text.insert("end", line + "\n", level)
            else:
                self.text.insert("end", line + "\n")
        self.text.see("end")
        self.text.configure(state="disabled")

    def clear(self):
        self._lines = []
        self.count_var.set("0 行")
        self.text.configure(state="normal")
        self.text.delete("1.0", "end")
        self.text.configure(state="disabled")

    def _save(self):
        path = filedialog.asksaveasfilename(
            defaultextension=".log",
            filetypes=[("日志文件", "*.log"), ("所有文件", "*.*")],
            title="保存日志")
        if not path:
            return
        try:
            with open(path, "w", encoding="utf-8") as f:
                for _, line in self._lines:
                    f.write(line + "\n")
        except OSError as exc:
            from tkinter import messagebox
            messagebox.showerror("保存日志", "写入失败: %s" % exc)


# --------------------------------------------------------------------------
class ConsoleView(ttk.Frame):
    """Prompt + result console with command history."""

    def __init__(self, master, on_command):
        super().__init__(master)
        self.on_command = on_command
        self._history = []
        self._hist_idx = None

        self.text = tk.Text(self, wrap="word", state="disabled",
                            font=mono_font(9), relief="flat",
                            background="#111827", foreground="#e5e7eb",
                            insertbackground="#e5e7eb")
        ysb = ttk.Scrollbar(self, orient="vertical", command=self.text.yview)
        self.text.configure(yscrollcommand=ysb.set)
        self.text.grid(row=0, column=0, sticky="nsew")
        ysb.grid(row=0, column=1, sticky="ns")
        self.rowconfigure(0, weight=1)
        self.columnconfigure(0, weight=1)
        self.text.tag_configure("prompt", foreground="#34d399",
                                font=mono_font(9) + ("bold",))
        self.text.tag_configure("error", foreground="#f87171")
        self.text.tag_configure("result", foreground="#e5e7eb")

        entry_bar = ttk.Frame(self)
        entry_bar.grid(row=1, column=0, sticky="ew", pady=(6, 0))
        ttk.Label(entry_bar, text="命令:").pack(side="left")
        self.entry_var = tk.StringVar()
        self.entry = ttk.Entry(entry_bar, textvariable=self.entry_var,
                               font=mono_font(9))
        self.entry.pack(side="left", fill="x", expand=True, padx=6)
        self.entry.bind("<Return>", self._submit)
        self.entry.bind("<Up>", self._history_prev)
        self.entry.bind("<Down>", self._history_next)
        ttk.Button(entry_bar, text="发送", command=self._submit).pack(side="left")

    def _submit(self, *_):
        cmd = self.entry_var.get().strip()
        if not cmd:
            return
        self._history.append(cmd)
        self._hist_idx = None
        self.entry_var.set("")
        self.print_cmd(cmd)
        self.on_command(cmd)

    def _history_prev(self, *_):
        if not self._history:
            return "break"
        if self._hist_idx is None:
            self._hist_idx = len(self._history) - 1
        elif self._hist_idx > 0:
            self._hist_idx -= 1
        self.entry_var.set(self._history[self._hist_idx])
        return "break"

    def _history_next(self, *_):
        if self._hist_idx is None:
            return "break"
        if self._hist_idx < len(self._history) - 1:
            self._hist_idx += 1
            self.entry_var.set(self._history[self._hist_idx])
        else:
            self._hist_idx = None
            self.entry_var.set("")
        return "break"

    def _write(self, text, tag=None):
        self.text.configure(state="normal")
        self.text.insert("end", text + "\n", tag or ())
        self.text.see("end")
        self.text.configure(state="disabled")

    def print_cmd(self, cmd):
        self._write("openocd> " + cmd, "prompt")

    def print_result(self, result):
        self._write(result if result else "(无输出)", "result")

    def print_error(self, message):
        self._write("错误: %s" % message, "error")


# --------------------------------------------------------------------------
class ScriptPicker(ttk.LabelFrame):
    """Search box + list box for choosing a .cfg script."""

    def __init__(self, master, title, on_add, height=8):
        super().__init__(master, text=title, padding=6)
        self.on_add = on_add
        self._items = []

        top = ttk.Frame(self)
        top.pack(fill="x")
        ttk.Label(top, text="筛选:").pack(side="left")
        self.search_var = tk.StringVar()
        ent = ttk.Entry(top, textvariable=self.search_var)
        ent.pack(side="left", fill="x", expand=True, padx=4)
        ent.bind("<KeyRelease>", lambda e: self._refresh())

        box = ttk.Frame(self)
        box.pack(fill="both", expand=True, pady=(4, 0))
        self.listbox = tk.Listbox(box, height=height, activestyle="dotbox",
                                  font=mono_font(9))
        ysb = ttk.Scrollbar(box, orient="vertical", command=self.listbox.yview)
        self.listbox.configure(yscrollcommand=ysb.set)
        self.listbox.pack(side="left", fill="both", expand=True)
        ysb.pack(side="left", fill="y")
        self.listbox.bind("<Double-Button-1>", lambda e: self._add())

        ttk.Button(self, text="添加 →", command=self._add).pack(anchor="e", pady=(4, 0))

    def set_items(self, items):
        self._items = list(items)
        self._refresh()

    def _refresh(self):
        needle = self.search_var.get().strip().lower()
        self.listbox.delete(0, "end")
        for item in self._items:
            if not needle or needle in item.lower():
                self.listbox.insert("end", item)

    def _add(self):
        sel = self.listbox.curselection()
        if sel and self.on_add:
            self.on_add(self._items_full()[sel[0]])

    def _items_full(self):
        needle = self.search_var.get().strip().lower()
        return [i for i in self._items if not needle or needle in i.lower()]


# --------------------------------------------------------------------------
def ask_text_dialog(parent, title, label, initial="", validate=None):
    """Modal dialog with one text entry. Returns the string or None."""
    dlg = tk.Toplevel(parent)
    dlg.title(title)
    dlg.transient(parent)
    dlg.resizable(False, False)
    dlg.grab_set()
    dlg.protocol("WM_DELETE_WINDOW", lambda: dlg.destroy())

    result = {"value": None}

    ttk.Label(dlg, text=label).pack(padx=14, pady=(12, 4))
    var = tk.StringVar(value=initial)
    entry = ttk.Entry(dlg, textvariable=var, width=44, font=mono_font(10))
    entry.pack(padx=14, pady=(0, 4))
    err_var = tk.StringVar()
    ttk.Label(dlg, textvariable=err_var, foreground="#c0392b").pack(padx=14)

    def ok():
        value = var.get().strip()
        if validate:
            err = validate(value)
            if err:
                err_var.set(err)
                return
        result["value"] = value
        dlg.destroy()

    btns = ttk.Frame(dlg)
    btns.pack(pady=(6, 12))
    ttk.Button(btns, text="确定", command=ok).pack(side="left", padx=6)
    ttk.Button(btns, text="取消", command=lambda: dlg.destroy()).pack(side="left", padx=6)
    entry.bind("<Return>", lambda e: ok())
    entry.focus_set()
    entry.selection_range(0, "end")

    dlg.wait_window()
    return result["value"]
