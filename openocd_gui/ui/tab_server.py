"""Configuration tab: OpenOCD executable, scripts, config files, ports, profiles."""

import threading
import tkinter as tk
from tkinter import ttk, filedialog, messagebox

from openocd_gui.core import detector, settings as settings_store
from openocd_gui.ui.widgets import ScriptPicker, mono_font

CATEGORY_LABELS = [("interface", "接口 interface"), ("target", "目标 target"),
                   ("board", "板级 board")]

DEBUG_LEVELS = ["0（默认）", "1（最少）", "2（警告）", "3（信息）", "4（调试）"]


class ServerTab(ttk.Frame):
    def __init__(self, master, app):
        super().__init__(master, padding=10)
        self.app = app
        self.settings = app.settings
        self._loading = True
        self._scripts = {"interface": [], "target": [], "board": []}

        top = ttk.Frame(self)
        top.pack(fill="x")
        self._build_exe_section(top)
        self._build_scripts_section(top)

        main = ttk.Frame(self)
        main.pack(fill="both", expand=True, pady=(8, 0))
        left = ttk.Frame(main)
        left.pack(side="left", fill="both", expand=True)
        right = ttk.Frame(main)
        right.pack(side="left", fill="both", expand=True, padx=(8, 0))
        self._build_configs_section(left)
        self._build_commands_section(right)
        self._build_ports_section(right)
        self._build_profiles_section(right)

        self.refresh_from_settings()
        self._loading = False
        self._rescan_scripts()
        if self.exe_var.get().strip():
            self._query_version()

    # ------------------------------------------------------------------ exe
    def _build_exe_section(self, parent):
        box = ttk.LabelFrame(parent, text="OpenOCD 程序", padding=8)
        box.pack(fill="x", expand=True, side="left")
        box.columnconfigure(0, weight=1)

        self.exe_var = tk.StringVar()
        ent = ttk.Entry(box, textvariable=self.exe_var)
        ent.grid(row=0, column=0, sticky="ew", pady=2)
        self.exe_var.trace_add("write", lambda *_: self._sync("openocd_path", self.exe_var))

        btns = ttk.Frame(box)
        btns.grid(row=0, column=1, padx=6)
        ttk.Button(btns, text="浏览…", command=self._browse_exe).pack(side="left", padx=2)
        ttk.Button(btns, text="自动检测", command=self._autodetect).pack(side="left", padx=2)

        self.version_var = tk.StringVar(value="版本: 未知")
        ttk.Label(box, textvariable=self.version_var, foreground="#4b5563").grid(
            row=1, column=0, columnspan=2, sticky="w", pady=(4, 0))
        ttk.Button(box, text="检测版本", command=self._query_version).grid(
            row=1, column=1, sticky="e")

    def _browse_exe(self):
        path = filedialog.askopenfilename(
            title="选择 openocd 可执行文件",
            filetypes=[("openocd", "openocd*"), ("所有文件", "*.*")])
        if path:
            self.exe_var.set(path)

    def _autodetect(self):
        cands = detector.find_openocd_candidates()
        if not cands:
            self.app.notify("未找到 openocd，请手动指定路径", error=True)
            return
        self.exe_var.set(cands[0])
        guess = detector.guess_scripts_dir(cands[0])
        if guess:
            self.scripts_var.set(guess)
        if len(cands) > 1:
            self.app.notify("找到 %d 个 openocd，已使用第 1 个: %s" % (len(cands), cands[0]))
        self._query_version()
        self._rescan_scripts()

    def _query_version(self):
        exe = self.exe_var.get().strip()
        if not exe:
            return
        self.version_var.set("版本: 检测中…")

        def worker():
            ver = detector.query_version(exe)
            self.app.post(lambda: self.version_var.set(
                "版本: %s" % ver if ver else "版本: 无法获取"))
            if ver:
                self.app.post(lambda: self.app.status_version.config(
                    text="OpenOCD: %s" % ver))
        threading.Thread(target=worker, daemon=True).start()

    # ------------------------------------------------------------------ scripts
    def _build_scripts_section(self, parent):
        box = ttk.LabelFrame(parent, text="脚本目录 (-s)", padding=8)
        box.pack(fill="x", expand=True, side="left", padx=(8, 0))
        box.columnconfigure(0, weight=1)

        self.scripts_var = tk.StringVar()
        ent = ttk.Entry(box, textvariable=self.scripts_var)
        ent.grid(row=0, column=0, sticky="ew", pady=2)
        self.scripts_var.trace_add("write", lambda *_: self._sync_scripts())

        btns = ttk.Frame(box)
        btns.grid(row=0, column=1, padx=6)
        ttk.Button(btns, text="浏览…", command=self._browse_scripts).pack(side="left", padx=2)
        ttk.Button(btns, text="重新扫描", command=self._rescan_scripts).pack(side="left", padx=2)

        self.scan_info_var = tk.StringVar(value="未扫描")
        ttk.Label(box, textvariable=self.scan_info_var, foreground="#4b5563").grid(
            row=1, column=0, columnspan=2, sticky="w", pady=(4, 0))

    def _browse_scripts(self):
        path = filedialog.askdirectory(title="选择 OpenOCD scripts 目录")
        if path:
            self.scripts_var.set(path)

    def _sync_scripts(self):
        if self._loading:
            return
        self.settings["scripts_dir"] = self.scripts_var.get().strip()

    def _rescan_scripts(self):
        scripts_dir = self.scripts_var.get().strip()

        def worker():
            result = detector.scan_config_scripts(scripts_dir)
            def apply():
                self._scripts = result
                self.scan_info_var.set(
                    "interface %d · target %d · board %d" %
                    (len(result["interface"]), len(result["target"]), len(result["board"])))
                self._update_picker_items()
            self.app.post(apply)
        threading.Thread(target=worker, daemon=True).start()

    # ------------------------------------------------------------------ configs
    def _build_configs_section(self, parent):
        box = ttk.LabelFrame(parent, text="配置文件（按加载顺序）", padding=8)
        box.pack(fill="both", expand=True)

        wrap = ttk.Frame(box)
        wrap.pack(fill="both", expand=True)
        self.cfg_tree = ttk.Treeview(wrap, columns=("idx", "cfg"), show="headings",
                                     height=7, selectmode="browse")
        self.cfg_tree.heading("idx", text="#")
        self.cfg_tree.heading("cfg", text="配置文件 (-f)")
        self.cfg_tree.column("idx", width=36, anchor="center", stretch=False)
        self.cfg_tree.column("cfg", width=320, anchor="w")
        ysb = ttk.Scrollbar(wrap, orient="vertical", command=self.cfg_tree.yview)
        self.cfg_tree.configure(yscrollcommand=ysb.set)
        self.cfg_tree.pack(side="left", fill="both", expand=True)
        ysb.pack(side="left", fill="y")

        btns = ttk.Frame(box)
        btns.pack(fill="x", pady=(6, 0))
        ttk.Button(btns, text="↑ 上移", command=lambda: self._move_cfg(-1)).pack(side="left", padx=2)
        ttk.Button(btns, text="↓ 下移", command=lambda: self._move_cfg(1)).pack(side="left", padx=2)
        ttk.Button(btns, text="✕ 删除", command=self._remove_cfg).pack(side="left", padx=2)
        ttk.Button(btns, text="添加自定义文件…", command=self._add_custom_cfg).pack(side="left", padx=2)

        picker_area = ttk.Frame(box)
        picker_area.pack(fill="both", expand=True, pady=(8, 0))
        row = ttk.Frame(picker_area)
        row.pack(fill="x")
        ttk.Label(row, text="从脚本库添加:").pack(side="left")
        self.category_var = tk.StringVar(value=CATEGORY_LABELS[0][1])
        cb = ttk.Combobox(row, textvariable=self.category_var, state="readonly",
                          values=[label for _, label in CATEGORY_LABELS], width=16)
        cb.pack(side="left", padx=6)
        cb.bind("<<ComboboxSelected>>", lambda e: self._update_picker_items())
        self.picker = ScriptPicker(picker_area, "脚本（双击添加）", self._add_cfg, height=6)
        self.picker.pack(fill="both", expand=True, pady=(4, 0))

    def _current_category(self):
        for key, label in CATEGORY_LABELS:
            if label == self.category_var.get():
                return key
        return "interface"

    def _update_picker_items(self):
        self.picker.set_items(self._scripts.get(self._current_category(), []))

    def _add_cfg(self, relpath):
        cfgs = list(self.settings["configs"])
        cfgs.append(relpath)
        self.settings["configs"] = cfgs
        self._render_cfgs()

    def _add_custom_cfg(self):
        path = filedialog.askopenfilename(title="选择配置文件",
                                          filetypes=[("OpenOCD 配置", "*.cfg"), ("所有文件", "*.*")])
        if path:
            self._add_cfg(path)

    def _selected_cfg_index(self):
        sel = self.cfg_tree.selection()
        if not sel:
            return None
        return self.cfg_tree.index(sel[0])

    def _move_cfg(self, delta):
        idx = self._selected_cfg_index()
        cfgs = list(self.settings["configs"])
        if idx is None or not 0 <= idx + delta < len(cfgs):
            return
        cfgs[idx], cfgs[idx + delta] = cfgs[idx + delta], cfgs[idx]
        self.settings["configs"] = cfgs
        self._render_cfgs(select=idx + delta)

    def _remove_cfg(self):
        idx = self._selected_cfg_index()
        if idx is None:
            return
        cfgs = list(self.settings["configs"])
        del cfgs[idx]
        self.settings["configs"] = cfgs
        self._render_cfgs()

    def _render_cfgs(self, select=None):
        self.cfg_tree.delete(*self.cfg_tree.get_children())
        for i, cfg in enumerate(self.settings["configs"]):
            iid = self.cfg_tree.insert("", "end", values=(i + 1, cfg))
            if select is not None and i == select:
                self.cfg_tree.selection_set(iid)
                self.cfg_tree.see(iid)

    # ------------------------------------------------------------------ commands
    def _build_commands_section(self, parent):
        box = ttk.LabelFrame(parent, text="附加命令 (-c，每行一条，在配置文件之后执行)", padding=8)
        box.pack(fill="x")
        self.cmd_text = tk.Text(box, height=4, font=mono_font(9), undo=False,
                                background="#fbfbfb")
        self.cmd_text.pack(fill="x")
        self.cmd_text.bind("<KeyRelease>", lambda e: self._sync_commands())
        ttk.Label(box, foreground="#6b7280",
                  text="示例: adapter speed 3000 ／ reset_config srst_only srst_nogate ／ gdb_memory_map enable"
                  ).pack(anchor="w", pady=(3, 0))

    def _sync_commands(self):
        if self._loading:
            return
        lines = [ln.strip() for ln in self.cmd_text.get("1.0", "end").splitlines()]
        self.settings["extra_commands"] = [ln for ln in lines if ln]

    # ------------------------------------------------------------------ ports
    def _build_ports_section(self, parent):
        box = ttk.LabelFrame(parent, text="服务端口与调试", padding=8)
        box.pack(fill="x", pady=8)
        box.columnconfigure(1, weight=1)
        box.columnconfigure(3, weight=1)

        ttk.Label(box, text="GDB 端口").grid(row=0, column=0, sticky="w", padx=2, pady=2)
        self.gdb_port_var = tk.StringVar()
        ttk.Entry(box, textvariable=self.gdb_port_var, width=8, justify="center").grid(
            row=0, column=1, sticky="w")
        ttk.Label(box, text="TCL 端口").grid(row=0, column=2, sticky="e", padx=2)
        self.tcl_port_var = tk.StringVar()
        ttk.Entry(box, textvariable=self.tcl_port_var, width=8, justify="center").grid(
            row=0, column=3, sticky="w")

        ttk.Label(box, text="Telnet 端口").grid(row=1, column=0, sticky="w", padx=2, pady=2)
        self.telnet_port_var = tk.StringVar()
        ttk.Entry(box, textvariable=self.telnet_port_var, width=8, justify="center").grid(
            row=1, column=1, sticky="w")
        ttk.Label(box, text="监听地址").grid(row=1, column=2, sticky="e", padx=2)
        self.bind_var = tk.StringVar()
        ttk.Entry(box, textvariable=self.bind_var, width=14).grid(row=1, column=3, sticky="w")

        ttk.Label(box, text="调试级别").grid(row=2, column=0, sticky="w", padx=2, pady=2)
        self.debug_var = tk.StringVar(value=DEBUG_LEVELS[0])
        cb = ttk.Combobox(box, textvariable=self.debug_var, state="readonly",
                          values=DEBUG_LEVELS, width=10)
        cb.grid(row=2, column=1, sticky="w")
        cb.bind("<<ComboboxSelected>>", lambda e: self._sync_ports())

        ttk.Label(box, text="日志文件").grid(row=3, column=0, sticky="w", padx=2, pady=2)
        self.log_file_var = tk.StringVar()
        row3 = ttk.Frame(box)
        row3.grid(row=3, column=1, columnspan=3, sticky="ew")
        ttk.Entry(row3, textvariable=self.log_file_var).pack(
            side="left", fill="x", expand=True)
        ttk.Button(row3, text="…", width=3,
                   command=lambda: self._browse_log()).pack(side="left", padx=4)

        for var, key in ((self.gdb_port_var, "gdb_port"), (self.tcl_port_var, "tcl_port"),
                         (self.telnet_port_var, "telnet_port")):
            var.trace_add("write", lambda *a, v=var, k=key: self._sync_int_var(v, k))
        self.bind_var.trace_add("write", lambda *_: self._sync("bind", self.bind_var))
        self.log_file_var.trace_add("write", lambda *_: self._sync("log_file", self.log_file_var))

    def _browse_log(self):
        path = filedialog.asksaveasfilename(title="选择日志文件",
                                            filetypes=[("日志", "*.log"), ("所有文件", "*.*")])
        if path:
            self.log_file_var.set(path)

    def _sync(self, key, var):
        if self._loading:
            return
        self.settings[key] = var.get().strip()

    def _sync_int_var(self, var, key):
        if self._loading:
            return
        text = var.get().strip()
        if text.isdigit() and 0 < int(text) < 65536:
            self.settings[key] = int(text)
            self.app.update_ports_status()

    def _sync_ports(self):
        if self._loading:
            return
        try:
            level = DEBUG_LEVELS.index(self.debug_var.get())
        except ValueError:
            level = 0
        self.settings["debug_level"] = level

    # ------------------------------------------------------------------ profiles
    def _build_profiles_section(self, parent):
        box = ttk.LabelFrame(parent, text="配置预设", padding=8)
        box.pack(fill="x")
        self.profile_var = tk.StringVar()
        self.profile_cb = ttk.Combobox(box, textvariable=self.profile_var,
                                       state="readonly", values=())
        self.profile_cb.pack(side="left", fill="x", expand=True, padx=(0, 6))
        ttk.Button(box, text="保存为预设", command=self._save_profile).pack(side="left", padx=2)
        ttk.Button(box, text="加载", command=self._load_profile).pack(side="left", padx=2)
        ttk.Button(box, text="删除", command=self._delete_profile).pack(side="left", padx=2)
        self._refresh_profiles()

    def _refresh_profiles(self):
        self.profile_cb.config(values=settings_store.list_profiles())

    def _save_profile(self):
        from openocd_gui.ui.widgets import ask_text_dialog
        name = ask_text_dialog(self, "保存预设", "预设名称:",
                               initial=self.profile_var.get(),
                               validate=lambda v: "名称不能为空" if not v.strip() else None)
        if not name:
            return
        try:
            saved = settings_store.save_profile(name, self.settings.profile_subset())
        except OSError as exc:
            self.app.notify("保存预设失败: %s" % exc, error=True)
            return
        self.profile_var.set(saved)
        self._refresh_profiles()
        self.app.notify("预设『%s』已保存" % saved)

    def _load_profile(self):
        name = self.profile_var.get().strip()
        if not name:
            self.app.notify("请先选择一个预设", error=True)
            return
        subset = settings_store.load_profile(name)
        if not subset:
            self.app.notify("预设『%s』读取失败" % name, error=True)
            return
        self.settings.apply_profile(subset)
        self._loading = True
        self.refresh_from_settings()
        self._loading = False
        self._rescan_scripts()
        self._query_version()
        self.app.update_ports_status()
        self.app.notify("已加载预设『%s』" % name)

    def _delete_profile(self):
        name = self.profile_var.get().strip()
        if not name:
            return
        if not messagebox.askyesno("删除预设", "确定删除预设『%s』？" % name):
            return
        settings_store.delete_profile(name)
        self.profile_var.set("")
        self._refresh_profiles()

    # ------------------------------------------------------------------ sync
    def refresh_from_settings(self):
        s = self.settings
        self.exe_var.set(s["openocd_path"])
        self.scripts_var.set(s["scripts_dir"])
        self._render_cfgs()
        self.cmd_text.delete("1.0", "end")
        self.cmd_text.insert("1.0", "\n".join(s.get("extra_commands", [])))
        self.gdb_port_var.set(str(s["gdb_port"]))
        self.tcl_port_var.set(str(s["tcl_port"]))
        self.telnet_port_var.set(str(s["telnet_port"]))
        self.bind_var.set(s["bind"])
        self.debug_var.set(DEBUG_LEVELS[max(0, min(4, int(s["debug_level"])))])
        self.log_file_var.set(s["log_file"])
