"""Target tab: target list, state polling, halt/resume/reset actions."""

import tkinter as tk
from tkinter import ttk

RESET_MODES = ["halt", "run", "init"]


class TargetTab(ttk.Frame):
    def __init__(self, master, app):
        super().__init__(master, padding=8)
        self.app = app
        self._rows = []
        self._iid_map = {}

        bar = ttk.Frame(self)
        bar.pack(fill="x", pady=(0, 6))
        self.auto_var = tk.BooleanVar(value=bool(app.settings.get("auto_poll", True)))
        ttk.Checkbutton(bar, text="自动轮询", variable=self.auto_var,
                        command=self._sync_poll).pack(side="left")
        ttk.Label(bar, text="间隔(ms):").pack(side="left", padx=(12, 2))
        self.interval_var = tk.StringVar(value=str(app.settings.get("poll_interval_ms", 1000)))
        sb = ttk.Spinbox(bar, from_=200, to=10000, increment=100, width=7,
                         textvariable=self.interval_var, command=self._sync_poll)
        sb.pack(side="left")
        sb.bind("<FocusOut>", lambda e: self._sync_poll())
        ttk.Button(bar, text="刷新", command=lambda: app.session.refresh_now()).pack(
            side="left", padx=12)

        tree_wrap = ttk.Frame(self)
        tree_wrap.pack(fill="both", expand=True)
        cols = ("cur", "name", "type", "endian", "tap", "state")
        self.tree = ttk.Treeview(tree_wrap, columns=cols, show="headings",
                                 selectmode="browse")
        headers = {"cur": "*", "name": "目标名称", "type": "类型",
                   "endian": "端序", "tap": "TAP", "state": "状态"}
        widths = {"cur": 34, "name": 190, "type": 100, "endian": 70, "tap": 190, "state": 140}
        for c in cols:
            self.tree.heading(c, text=headers[c])
            self.tree.column(c, width=widths[c],
                             anchor="center" if c in ("cur", "endian") else "w",
                             stretch=(c in ("name", "tap", "state")))
        ysb = ttk.Scrollbar(tree_wrap, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=ysb.set)
        self.tree.pack(side="left", fill="both", expand=True)
        ysb.pack(side="left", fill="y")
        self.tree.tag_configure("current", font=("Microsoft YaHei UI", 9, "bold"))
        self.tree.bind("<Double-Button-1>", lambda e: self._select_current())

        actions = ttk.LabelFrame(self, text="目标操作（作用于选中目标）", padding=8)
        actions.pack(fill="x", pady=(8, 0))
        ttk.Button(actions, text="⏸ 暂停 (halt)", command=lambda: self._action("halt")).pack(
            side="left", padx=3)
        ttk.Button(actions, text="▶ 继续 (resume)", command=lambda: self._action("resume")).pack(
            side="left", padx=3)
        ttk.Button(actions, text="软复位暂停 (soft_reset_halt)",
                   command=lambda: self._action("soft_reset_halt")).pack(side="left", padx=3)
        ttk.Label(actions, text="复位:").pack(side="left", padx=(14, 3))
        self.reset_var = tk.StringVar(value="halt")
        ttk.Combobox(actions, textvariable=self.reset_var, state="readonly",
                     values=RESET_MODES, width=6).pack(side="left")
        ttk.Button(actions, text="执行复位",
                   command=lambda: self._action("reset " + self.reset_var.get())).pack(
            side="left", padx=3)
        ttk.Label(actions, foreground="#6b7280",
                  text="双击列表行可将该目标设为当前目标").pack(side="right")

    # ------------------------------------------------------------------
    def set_connected(self, connected):
        self._sync_poll()

    def _sync_poll(self):
        try:
            interval = int(self.interval_var.get())
        except ValueError:
            interval = 1000
        interval = max(200, min(10000, interval))
        self.interval_var.set(str(interval))
        self.app.settings["auto_poll"] = bool(self.auto_var.get())
        self.app.settings["poll_interval_ms"] = interval
        self.app.session.poll_enabled = bool(self.auto_var.get())

    def update_rows(self, rows):
        self._rows = rows
        selected = self.tree.selection()
        sel_name = self._iid_map.get(selected[0]) if selected else None
        self.tree.delete(*self.tree.get_children())
        self._iid_map = {}
        for idx, row in enumerate(rows):
            tags = ("current",) if row["current"] else ()
            iid = self.tree.insert(
                "", "end",
                values=("●" if row["current"] else "", row["name"], row["type"],
                        row["endian"], row["tap"], row["state"]),
                tags=tags)
            self._iid_map[iid] = row["name"]
            if sel_name == row["name"]:
                self.tree.selection_set(iid)
                self.tree.see(iid)

    def _selected_row(self):
        sel = self.tree.selection()
        name = self._iid_map.get(sel[0]) if sel else None
        if name:
            for row in self._rows:
                if row["name"] == name:
                    return row
        return self._rows[0] if self._rows else None

    def _select_current(self):
        row = self._selected_row()
        if not row or row["current"]:
            return
        name = row["name"]
        self.app.session.call_async(
            "targets %s" % name,
            on_ok=lambda res: self.app.post(self.app.session.refresh_now),
            on_err=lambda exc: self.app.notify(
                "切换目标失败: %s" % exc, error=True))

    def _action(self, command):
        row = self._selected_row()
        if not row:
            self.app.notify("没有可操作的目标", error=True)
            return
        name = row["name"]
        need_switch = not row["current"]
        session = self.app.session

        def worker():
            try:
                if need_switch:
                    session.call("targets %s" % name, timeout=8.0)
                session.call(command, timeout=30.0)
            except Exception as exc:  # noqa: BLE001
                self.app.post(lambda e=exc: self.app.notify(
                    "命令失败: %s" % e, error=True))
                return
            self.app.post(session.refresh_now)

        import threading
        threading.Thread(target=worker, daemon=True).start()
