"""All tabs for the PySide6 port (mirrors the Tkinter UI functionality)."""

import subprocess
import sys
import threading

from PySide6.QtCore import Qt
from PySide6.QtGui import QFont
from PySide6.QtWidgets import (
    QCheckBox, QComboBox, QCompleter, QFileDialog, QGroupBox, QHBoxLayout,
    QHeaderView, QInputDialog, QLabel, QLineEdit, QListWidget, QListWidgetItem,
    QPlainTextEdit, QPushButton, QSpinBox, QTableWidget, QTableWidgetItem,
    QTabWidget, QTextEdit, QVBoxLayout, QWidget,
)

from openocd_gui.core import detector, parsers, settings as settings_store
from openocd_gui.core import tcl as tcl_core
from openocd_gui.core.parsers import classify_log_line


def parse_int(text, base=16, default=None):
    text = (text or "").strip()
    if not text:
        return default
    try:
        if text.lower().startswith("0x"):
            return int(text, 16)
        return int(text, base)
    except ValueError:
        return default


def mono(size=9):
    f = QFont("Consolas")
    f.setPointSize(size)
    return f


CATEGORY_LABELS = [("interface", "接口 interface"), ("target", "目标 target"),
                   ("board", "板级 board")]
DEBUG_LEVELS = ["0（默认）", "1（最少）", "2（警告）", "3（信息）", "4（调试）"]


# ==========================================================================
class ConfigTab(QWidget):
    def __init__(self, main, bridge):
        super().__init__()
        self.main, self.bridge = main, bridge
        self.settings = bridge.settings
        self._loading = True
        self._scripts = {"interface": [], "target": [], "board": []}
        root = QVBoxLayout(self)

        top = QHBoxLayout()
        root.addLayout(top)

        exe_box = QGroupBox("OpenOCD 程序")
        ex = QVBoxLayout(exe_box)
        row = QHBoxLayout()
        self.exe_edit = QLineEdit()
        row.addWidget(self.exe_edit)
        for text, fn in (("浏览…", self._browse_exe), ("自动检测", self._autodetect),
                         ("检测版本", self._query_version)):
            b = QPushButton(text)
            b.clicked.connect(fn)
            row.addWidget(b)
        ex.addLayout(row)
        self.version_lbl = QLabel("版本: 未知")
        ex.addWidget(self.version_lbl)
        top.addWidget(exe_box, 2)

        scripts_box = QGroupBox("脚本目录 (-s)")
        sc = QVBoxLayout(scripts_box)
        row = QHBoxLayout()
        self.scripts_edit = QLineEdit()
        row.addWidget(self.scripts_edit)
        b = QPushButton("浏览…")
        b.clicked.connect(self._browse_scripts)
        row.addWidget(b)
        b = QPushButton("重新扫描")
        b.clicked.connect(self._rescan)
        row.addWidget(b)
        sc.addLayout(row)
        self.scan_lbl = QLabel("未扫描")
        sc.addWidget(self.scan_lbl)
        top.addWidget(scripts_box, 2)
        root.addStretch()

        # config files list + picker
        cfg_box = QGroupBox("配置文件（按加载顺序）")
        cv = QVBoxLayout(cfg_box)
        self.cfg_list = QListWidget()
        self.cfg_list.setMaximumHeight(120)
        cv.addWidget(self.cfg_list)
        row = QHBoxLayout()
        for text, fn in (("↑", lambda: self._move(-1)), ("↓", lambda: self._move(1)),
                         ("✕ 删除", self._remove), ("添加自定义文件…", self._add_custom)):
            b = QPushButton(text)
            b.clicked.connect(fn)
            row.addWidget(b)
        row.addStretch()
        cv.addLayout(row)
        row = QHBoxLayout()
        row.addWidget(QLabel("从脚本库添加:"))
        self.category_cb = QComboBox()
        self.category_cb.addItems([l for _, l in CATEGORY_LABELS])
        self.category_cb.currentIndexChanged.connect(self._update_picker)
        row.addWidget(self.category_cb)
        self.picker_cb = QComboBox()
        self.picker_cb.setEditable(True)
        self.picker_cb.setCompleter(QCompleter([]))
        row.addWidget(self.picker_cb, 2)
        b = QPushButton("添加 →")
        b.clicked.connect(self._add_picked)
        row.addWidget(b)
        cv.addLayout(row)
        root.addWidget(cfg_box)

        bottom = QHBoxLayout()
        root.addLayout(bottom, 1)

        cmd_box = QGroupBox("附加命令 (-c，每行一条)")
        cv2 = QVBoxLayout(cmd_box)
        self.cmd_text = QPlainTextEdit()
        self.cmd_text.setMaximumHeight(90)
        self.cmd_text.setFont(mono())
        cv2.addWidget(self.cmd_text)
        self.cmd_text.textChanged.connect(self._sync_commands)
        bottom.addWidget(cmd_box, 2)

        port_box = QGroupBox("服务端口与调试")
        form = QVBoxLayout(port_box)
        row = QHBoxLayout()
        row.addWidget(QLabel("GDB"))
        self.gdb_edit = QLineEdit()
        row.addWidget(self.gdb_edit)
        row.addWidget(QLabel("TCL"))
        self.tcl_edit = QLineEdit()
        row.addWidget(self.tcl_edit)
        row.addWidget(QLabel("Telnet"))
        self.telnet_edit = QLineEdit()
        row.addWidget(self.telnet_edit)
        row.addWidget(QLabel("监听"))
        self.bind_edit = QLineEdit()
        row.addWidget(self.bind_edit)
        form.addLayout(row)
        row = QHBoxLayout()
        row.addWidget(QLabel("调试级别"))
        self.debug_cb = QComboBox()
        self.debug_cb.addItems(DEBUG_LEVELS)
        row.addWidget(self.debug_cb)
        row.addWidget(QLabel("日志文件"))
        self.log_edit = QLineEdit()
        row.addWidget(self.log_edit, 2)
        form.addLayout(row)
        bottom.addWidget(port_box, 3)

        prof_box = QGroupBox("配置预设")
        pv = QVBoxLayout(prof_box)
        self.profile_cb = QComboBox()
        pv.addWidget(self.profile_cb)
        row = QHBoxLayout()
        for text, fn in (("保存为预设", self._save_profile), ("加载", self._load_profile),
                         ("删除", self._delete_profile)):
            b = QPushButton(text)
            b.clicked.connect(fn)
            row.addWidget(b)
        pv.addLayout(row)
        pv.addStretch()
        bottom.addWidget(prof_box, 2)

        # wiring
        self.exe_edit.textChanged.connect(lambda: self._sync_str("openocd_path", self.exe_edit))
        self.scripts_edit.textChanged.connect(lambda: self._sync_str("scripts_dir", self.scripts_edit))
        for edit, key in ((self.gdb_edit, "gdb_port"), (self.tcl_edit, "tcl_port"),
                          (self.telnet_edit, "telnet_port")):
            edit.textChanged.connect(lambda t, k=key, e=edit: self._sync_int(k, e))
        self.bind_edit.textChanged.connect(lambda: self._sync_str("bind", self.bind_edit))
        self.log_edit.textChanged.connect(lambda: self._sync_str("log_file", self.log_edit))
        self.debug_cb.currentIndexChanged.connect(self._sync_ports)

        self.refresh_from_settings()
        self._loading = False
        self._rescan()
        if self.exe_edit.text().strip():
            self._query_version()

    # -- sync helpers
    def _sync_str(self, key, edit):
        if not self._loading:
            self.settings[key] = edit.text().strip()

    def _sync_int(self, key, edit):
        if self._loading:
            return
        t = edit.text().strip()
        if t.isdigit() and 0 < int(t) < 65536:
            self.settings[key] = int(t)

    def _sync_commands(self):
        if self._loading:
            return
        lines = [ln.strip() for ln in self.cmd_text.toPlainText().splitlines()]
        self.settings["extra_commands"] = [ln for ln in lines if ln]

    def _sync_ports(self):
        if not self._loading:
            self.settings["debug_level"] = self.debug_cb.currentIndex()

    # -- exe/scripts
    def _browse_exe(self):
        path, _ = QFileDialog.getOpenFileName(self, "选择 openocd 可执行文件")
        if path:
            self.exe_edit.setText(path)

    def _autodetect(self):
        cands = detector.find_openocd_candidates()
        if not cands:
            self.bridge.notify("未找到 openocd，请手动指定路径", error=True)
            return
        self.exe_edit.setText(cands[0])
        guess = detector.guess_scripts_dir(cands[0])
        if guess:
            self.scripts_edit.setText(guess)
        self._query_version()
        self._rescan()

    def _query_version(self):
        exe = self.exe_edit.text().strip()
        if not exe:
            return
        self.version_lbl.setText("版本: 检测中…")

        def worker():
            ver = detector.query_version(exe)
            self.bridge.post(lambda: self.version_lbl.setText(
                "版本: %s" % ver if ver else "版本: 无法获取"))
        threading.Thread(target=worker, daemon=True).start()

    def _browse_scripts(self):
        path = QFileDialog.getExistingDirectory(self, "选择 OpenOCD scripts 目录")
        if path:
            self.scripts_edit.setText(path)

    def _rescan(self):
        scripts_dir = self.scripts_edit.text().strip()

        def worker():
            result = detector.scan_config_scripts(scripts_dir)
            def apply():
                self._scripts = result
                self.scan_lbl.setText("interface %d · target %d · board %d" % (
                    len(result["interface"]), len(result["target"]), len(result["board"])))
                self._update_picker()
            self.bridge.post(apply)
        threading.Thread(target=worker, daemon=True).start()

    def _current_category(self):
        for key, label in CATEGORY_LABELS:
            if label == self.category_cb.currentText():
                return key
        return "interface"

    def _update_picker(self):
        items = self._scripts.get(self._current_category(), [])
        self.picker_cb.clear()
        self.picker_cb.addItems(items)
        self.picker_cb.setCompleter(QCompleter(items))

    # -- config list
    def _render_cfgs(self):
        self.cfg_list.clear()
        for cfg in self.settings["configs"]:
            self.cfg_list.addItem(cfg)

    def _add_cfg(self, relpath):
        cfgs = list(self.settings["configs"])
        cfgs.append(relpath)
        self.settings["configs"] = cfgs
        self._render_cfgs()

    def _add_picked(self):
        text = self.picker_cb.currentText().strip()
        if text:
            self._add_cfg(text)

    def _add_custom(self):
        path, _ = QFileDialog.getOpenFileName(self, "选择配置文件", "", "OpenOCD 配置 (*.cfg);;所有文件 (*)")
        if path:
            self._add_cfg(path)

    def _move(self, delta):
        row = self.cfg_list.currentRow()
        cfgs = list(self.settings["configs"])
        if row < 0 or not 0 <= row + delta < len(cfgs):
            return
        cfgs[row], cfgs[row + delta] = cfgs[row + delta], cfgs[row]
        self.settings["configs"] = cfgs
        self._render_cfgs()
        self.cfg_list.setCurrentRow(row + delta)

    def _remove(self):
        row = self.cfg_list.currentRow()
        if row >= 0:
            cfgs = list(self.settings["configs"])
            del cfgs[row]
            self.settings["configs"] = cfgs
            self._render_cfgs()

    # -- profiles
    def _refresh_profiles(self):
        self.profile_cb.clear()
        self.profile_cb.addItems(settings_store.list_profiles())

    def _save_profile(self):
        name, ok = QInputDialog.getText(self, "保存预设", "预设名称:")
        if not ok or not name.strip():
            return
        name = settings_store.save_profile(name.strip(), self.settings.profile_subset())
        self.profile_cb.setCurrentText(name)
        self._refresh_profiles()
        self.bridge.notify("预设『%s』已保存" % name)

    def _load_profile(self):
        name = self.profile_cb.currentText().strip()
        if not name:
            self.bridge.notify("请先选择一个预设", error=True)
            return
        subset = settings_store.load_profile(name)
        if not subset:
            self.bridge.notify("预设『%s』读取失败" % name, error=True)
            return
        self.settings.apply_profile(subset)
        self._loading = True
        self.refresh_from_settings()
        self._loading = False
        self._rescan()
        self._query_version()
        self.bridge.notify("已加载预设『%s』" % name)

    def _delete_profile(self):
        name = self.profile_cb.currentText().strip()
        if name and settings_store.delete_profile(name):
            self._refresh_profiles()

    def refresh_from_settings(self):
        s = self.settings
        self.exe_edit.setText(s["openocd_path"])
        self.scripts_edit.setText(s["scripts_dir"])
        self._render_cfgs()
        self.cmd_text.setPlainText("\n".join(s.get("extra_commands", [])))
        self.gdb_edit.setText(str(s["gdb_port"]))
        self.tcl_edit.setText(str(s["tcl_port"]))
        self.telnet_edit.setText(str(s["telnet_port"]))
        self.bind_edit.setText(s["bind"])
        self.debug_cb.setCurrentIndex(max(0, min(4, int(s["debug_level"]))))
        self.log_edit.setText(s["log_file"])
        self._refresh_profiles()


# ==========================================================================
class LogTab(QWidget):
    COLORS = {"error": "#c0392b", "warning": "#b9770e", "debug": "#8e8e8e", "user": "#1f6feb"}
    FILTERS = [("全部", None), ("信息及以上", {"info", "user", "warning", "error", "raw"}),
               ("警告+错误", {"warning", "error", "raw"}), ("仅错误", {"error", "raw"})]

    def __init__(self, main, bridge):
        super().__init__()
        self.bridge = bridge
        self._lines = []
        root = QVBoxLayout(self)
        row = QHBoxLayout()
        row.addWidget(QLabel("过滤:"))
        self.filter_cb = QComboBox()
        self.filter_cb.addItems([n for n, _ in self.FILTERS])
        self.filter_cb.currentIndexChanged.connect(self._rerender)
        row.addWidget(self.filter_cb)
        self.autoscroll = QCheckBox("自动滚动")
        self.autoscroll.setChecked(True)
        row.addWidget(self.autoscroll)
        row.addStretch()
        b = QPushButton("保存日志")
        b.clicked.connect(self._save)
        row.addWidget(b)
        b = QPushButton("清空")
        b.clicked.connect(lambda: (self._lines.clear(), self._rerender()))
        row.addWidget(b)
        root.addLayout(row)
        self.text = QPlainTextEdit()
        self.text.setReadOnly(True)
        self.text.setFont(mono())
        self.text.setMaximumBlockCount(20000)
        root.addWidget(self.text)

    def _allowed(self):
        for name, allowed in self.FILTERS:
            if name == self.filter_cb.currentText():
                return allowed
        return None

    def append_line(self, line):
        level = classify_log_line(line)
        self._lines.append((level, line))
        allowed = self._allowed()
        if allowed is not None and level not in allowed:
            return
        self._insert(level, line)

    def _insert(self, level, line):
        import html
        color = self.COLORS.get(level)
        if color:
            self.text.appendHtml('<span style="color:%s">%s</span>' % (color, html.escape(line)))
        else:
            self.text.appendPlainText(line)
        if self.autoscroll.isChecked():
            sb = self.text.verticalScrollBar()
            sb.setValue(sb.maximum())

    def _rerender(self):
        self.text.clear()
        allowed = self._allowed()
        for level, line in self._lines[-6000:]:
            if allowed is not None and level not in allowed:
                continue
            self._insert(level, line)

    def _save(self):
        path, _ = QFileDialog.getSaveFileName(self, "保存日志", "", "日志文件 (*.log);;所有文件 (*)")
        if path:
            try:
                with open(path, "w", encoding="utf-8") as f:
                    for _, ln in self._lines:
                        f.write(ln + "\n")
            except OSError as exc:
                self.bridge.notify("写入失败: %s" % exc, error=True)


# ==========================================================================
QUICK_COMMANDS = ["poll", "targets", "version", "halt", "resume",
                  "reset halt", "reset run", "reset init", "flash banks", "shutdown"]


class ConsoleTab(QWidget):
    def __init__(self, main, bridge):
        super().__init__()
        self.bridge = bridge
        self._history = []
        self._hist_idx = None
        root = QVBoxLayout(self)
        row = QHBoxLayout()
        row.addWidget(QLabel("快捷命令:"))
        for cmd in QUICK_COMMANDS:
            b = QPushButton(cmd)
            b.setMaximumWidth(90)
            b.clicked.connect(lambda _, c=cmd: self.send(c))
            row.addWidget(b)
        row.addStretch()
        root.addLayout(row)
        self.text = QPlainTextEdit()
        self.text.setReadOnly(True)
        self.text.setFont(mono())
        self.text.setMaximumBlockCount(10000)
        root.addWidget(self.text)
        row = QHBoxLayout()
        row.addWidget(QLabel("命令:"))
        self.entry = QLineEdit()
        self.entry.setFont(mono())
        self.entry.returnPressed.connect(self._submit)
        self.entry.installEventFilter(self)
        row.addWidget(self.entry, 1)
        b = QPushButton("发送")
        b.clicked.connect(self._submit)
        row.addWidget(b)
        root.addLayout(row)

    def eventFilter(self, obj, ev):
        if obj is self.entry:
            if ev.type() == ev.Type.KeyPress:
                if ev.key() == Qt.Key_Up:
                    self._hist(-1)
                    return True
                if ev.key() == Qt.Key_Down:
                    self._hist(1)
                    return True
        return super().eventFilter(obj, ev)

    def _hist(self, delta):
        if not self._history:
            return
        if self._hist_idx is None:
            self._hist_idx = len(self._history) - 1 if delta < 0 else 0
        else:
            self._hist_idx = max(0, min(len(self._history) - 1, self._hist_idx + delta))
        self.entry.setText(self._history[self._hist_idx])

    def _submit(self):
        cmd = self.entry.text().strip()
        if cmd:
            self._history.append(cmd)
            self._hist_idx = None
            self.entry.clear()
            self.text.appendHtml('<span style="color:#34d399">openocd&gt; %s</span>' % cmd)
            self.send(cmd)

    def send(self, cmd):
        self.bridge.session.call_async(
            cmd,
            on_ok=lambda res: self.bridge.post(lambda: self.text.appendPlainText(res or "(无输出)")),
            on_err=lambda exc: self.bridge.post(lambda: self.text.appendHtml(
                '<span style="color:#f87171">错误: %s</span>' % exc)),
            timeout=60.0)


# ==========================================================================
class TargetTab(QWidget):
    HEADERS = ["*", "目标名称", "类型", "端序", "TAP", "状态"]

    def __init__(self, main, bridge):
        super().__init__()
        self.main, self.bridge = main, bridge
        self._rows = []
        root = QVBoxLayout(self)
        row = QHBoxLayout()
        self.auto_cb = QCheckBox("自动轮询")
        self.auto_cb.setChecked(bool(bridge.settings.get("auto_poll", True)))
        self.auto_cb.stateChanged.connect(self._sync_poll)
        row.addWidget(self.auto_cb)
        row.addWidget(QLabel("间隔(ms):"))
        self.interval_spin = QSpinBox()
        self.interval_spin.setRange(200, 10000)
        self.interval_spin.setSingleStep(100)
        self.interval_spin.setValue(int(bridge.settings.get("poll_interval_ms", 1000)))
        self.interval_spin.valueChanged.connect(self._sync_poll)
        row.addWidget(self.interval_spin)
        b = QPushButton("刷新")
        b.clicked.connect(lambda: bridge.session.refresh_now())
        row.addWidget(b)
        row.addStretch()
        for text, fn in (("⏸ 暂停", lambda: self._action("halt")),
                         ("▶ 继续", lambda: self._action("resume")),
                         ("软复位暂停", lambda: self._action("soft_reset_halt"))):
            b = QPushButton(text)
            b.clicked.connect(fn)
            row.addWidget(b)
        row.addWidget(QLabel("复位:"))
        self.reset_cb = QComboBox()
        self.reset_cb.addItems(["halt", "run", "init"])
        row.addWidget(self.reset_cb)
        b = QPushButton("执行复位")
        b.clicked.connect(lambda: self._action("reset " + self.reset_cb.currentText()))
        row.addWidget(b)
        root.addLayout(row)

        self.table = QTableWidget(0, 6)
        self.table.setHorizontalHeaderLabels(self.HEADERS)
        self.table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        self.table.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeMode.Stretch)
        self.table.doubleClicked.connect(self._select_current)
        root.addWidget(self.table, 1)
        lbl = QLabel("双击行可将该目标设为当前目标")
        lbl.setStyleSheet("color:#6b7280")
        root.addWidget(lbl)
        self._sync_poll()

    def set_connected(self, connected):
        if connected:
            self.bridge.session.refresh_now()

    def _sync_poll(self):
        self.bridge.settings["auto_poll"] = self.auto_cb.isChecked()
        self.bridge.settings["poll_interval_ms"] = self.interval_spin.value()
        self.bridge.session.poll_enabled = self.auto_cb.isChecked()

    def update_rows(self, rows):
        self._rows = rows
        selected = next((r["name"] for r in rows if self._is_selected(r)), None)
        self.table.setRowCount(len(rows))
        for i, r in enumerate(rows):
            vals = ["●" if r["current"] else "", r["name"], r["type"],
                    r["endian"], r["tap"], r["state"]]
            for c, v in enumerate(vals):
                item = QTableWidgetItem(v)
                if r["current"]:
                    f = item.font()
                    f.setBold(True)
                    item.setFont(f)
                item.setFlags(item.flags() & ~Qt.ItemIsEditable)
                self.table.setItem(i, c, item)
            if r["name"] == selected:
                self.table.selectRow(i)

    def _is_selected(self, row):
        sel = self.table.selectedItems()
        return bool(sel) and self.table.item(sel[0].row(), 1).text() == row["name"]

    def _selected_row(self):
        sel = self.table.selectedItems()
        if sel:
            name = self.table.item(sel[0].row(), 1).text()
            for r in self._rows:
                if r["name"] == name:
                    return r
        return self._rows[0] if self._rows else None

    def _select_current(self):
        row = self._selected_row()
        if row and not row["current"]:
            name = row["name"]
            self.bridge.session.call_async(
                "targets %s" % name,
                on_ok=lambda _: self.bridge.post(self.bridge.session.refresh_now),
                on_err=lambda e: self.bridge.notify("切换目标失败: %s" % e, error=True))

    def _action(self, command):
        row = self._selected_row()
        if not row:
            self.bridge.notify("没有可操作的目标", error=True)
            return
        name, need_switch, session = row["name"], not row["current"], self.bridge.session

        def worker():
            try:
                if need_switch:
                    session.call("targets %s" % name, timeout=8.0)
                session.call(command, timeout=30.0)
            except Exception as exc:
                self.bridge.post(lambda e=exc: self.bridge.notify("命令失败: %s" % e, error=True))
                return
            self.bridge.post(session.refresh_now)
        threading.Thread(target=worker, daemon=True).start()


# ==========================================================================
class RegistersTab(QWidget):
    def __init__(self, main, bridge):
        super().__init__()
        self.bridge = bridge
        self._regs = []
        self._pending = False
        root = QVBoxLayout(self)
        row = QHBoxLayout()
        b = QPushButton("刷新")
        b.clicked.connect(self.refresh)
        row.addWidget(b)
        self.auto_cb = QCheckBox("暂停时自动刷新")
        self.auto_cb.setChecked(bool(bridge.settings.get("auto_refresh_regs", True)))
        self.auto_cb.stateChanged.connect(
            lambda: bridge.settings.__setitem__("auto_refresh_regs", self.auto_cb.isChecked()))
        row.addWidget(self.auto_cb)
        row.addWidget(QLabel("筛选:"))
        self.filter_edit = QLineEdit()
        self.filter_edit.setMaximumWidth(180)
        self.filter_edit.textChanged.connect(self._render)
        row.addWidget(self.filter_edit)
        row.addStretch()
        self.status_lbl = QLabel("")
        self.status_lbl.setStyleSheet("color:#4b5563")
        row.addWidget(self.status_lbl)
        root.addLayout(row)
        self.table = QTableWidget(0, 6)
        self.table.setHorizontalHeaderLabels(["#", "组", "名称", "位宽", "值", "标志"])
        self.table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)
        self.table.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeMode.Stretch)
        self.table.doubleClicked.connect(self._edit_value)
        root.addWidget(self.table, 1)
        # lightweight auto-refresh timer
        from PySide6.QtCore import QTimer
        self._timer = QTimer(self)
        self._timer.setInterval(1000)
        self._timer.timeout.connect(self._auto_tick)
        self._timer.start()

    def set_connected(self, connected):
        if connected:
            self.refresh()

    def _auto_tick(self):
        main = self.window()
        if (self.auto_cb.isChecked() and self.bridge.session.tcl.connected
                and getattr(main, "last_target_state", "") == "halted"
                and not self._pending):
            self.refresh()

    def refresh(self):
        if self._pending:
            return
        self._pending = True
        self.status_lbl.setText("读取中…")

        def on_ok(text):
            def apply():
                self._pending = False
                regs, err = parsers.parse_regs(text)
                if err:
                    self.status_lbl.setText(err)
                    return
                self._regs = regs
                self.status_lbl.setText("%d 个寄存器" % len(regs))
                self._render()
            self.bridge.post(apply)

        def on_err(exc):
            self.bridge.post(lambda: (setattr(self, "_pending", False),
                                      self.status_lbl.setText("读取失败: %s" % exc)))
        self.bridge.session.call_async("reg", on_ok=on_ok, on_err=on_err, timeout=20.0)

    def _render(self):
        needle = self.filter_edit.text().strip().lower()
        rows = [r for r in self._regs
                if not needle or needle in (r["name"] + " " + r["group"]).lower()]
        self.table.setRowCount(len(rows))
        for i, r in enumerate(rows):
            value = parsers.pad_hex_value(r["value"], r["size"]) if r["value"] else "—"
            vals = [str(r["num"]), r["group"], r["name"], "/%d" % r["size"],
                    value, "dirty" if r["dirty"] else ""]
            for c, v in enumerate(vals):
                item = QTableWidgetItem(v)
                if c == 4:
                    item.setFont(mono())
                if r["dirty"]:
                    item.setForeground(Qt.GlobalColor.darkYellow)
                self.table.setItem(i, c, item)
            self.table.item(i, 2).setData(Qt.UserRole, r)

    def _edit_value(self, index):
        item = self.table.item(index.row(), 2)
        reg = item.data(Qt.UserRole)
        if not reg:
            return
        current = parsers.pad_hex_value(reg["value"], reg["size"]) if reg["value"] else "0x0"
        text, ok = QInputDialog.getText(self, "修改寄存器",
                                        "新值（十六进制）— %s:" % reg["name"], text=current)
        if not ok:
            return
        value = parse_int(text, 16)
        if value is None:
            self.bridge.notify("请输入十六进制数值", error=True)
            return
        name = reg["name"]

        def worker():
            try:
                self.bridge.session.call("reg %s 0x%x" % (name, value), timeout=10.0)
            except Exception as exc:
                self.bridge.post(lambda e=exc: self.bridge.notify("写入寄存器失败: %s" % e, error=True))
                return
            self.bridge.post(self.refresh)
        threading.Thread(target=worker, daemon=True).start()


# ==========================================================================
WIDTHS = [("32 位 (mdw)", 4, "mdw", "mww"), ("16 位 (mdh)", 2, "mdh", "mwh"),
          ("8 位 (mdb)", 1, "mdb", "mwb"), ("64 位 (mdd)", 8, "mdd", "mwd")]
BYTES_PER_LINE = 32


class MemoryTab(QWidget):
    def __init__(self, main, bridge):
        super().__init__()
        self.bridge = bridge
        self._rows = []
        self._size = 4
        self._addr0 = 0
        self._pending = False
        root = QVBoxLayout(self)
        row = QHBoxLayout()
        row.addWidget(QLabel("地址:"))
        self.addr_edit = QLineEdit("0x08000000")
        self.addr_edit.setFont(mono())
        self.addr_edit.setMaximumWidth(140)
        row.addWidget(self.addr_edit)
        row.addWidget(QLabel("数量:"))
        self.count_spin = QSpinBox()
        self.count_spin.setRange(1, 1024)
        self.count_spin.setValue(64)
        row.addWidget(self.count_spin)
        row.addWidget(QLabel("宽度:"))
        self.width_cb = QComboBox()
        self.width_cb.addItems([w[0] for w in WIDTHS])
        self.width_cb.currentIndexChanged.connect(lambda _: self.read())
        row.addWidget(self.width_cb)
        b = QPushButton("读取")
        b.clicked.connect(lambda: self.read())
        row.addWidget(b)
        b = QPushButton("◀ 上一页")
        b.clicked.connect(lambda: self._page(-1))
        row.addWidget(b)
        b = QPushButton("下一页 ▶")
        b.clicked.connect(lambda: self._page(1))
        row.addWidget(b)
        row.addStretch()
        self.status_lbl = QLabel("")
        self.status_lbl.setStyleSheet("color:#4b5563")
        row.addWidget(self.status_lbl)
        root.addLayout(row)
        self.table = QTableWidget()
        self.table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.table.setFont(mono(9))
        self.table.doubleClicked.connect(self._edit_cell)
        root.addWidget(self.table, 1)
        lbl = QLabel("双击数值单元格可修改内存（目标需处于 halted 状态）")
        lbl.setStyleSheet("color:#6b7280")
        root.addWidget(lbl)

    def set_connected(self, connected):
        pass

    def _width_conf(self):
        for label, size, rcmd, wcmd in WIDTHS:
            if label == self.width_cb.currentText():
                return size, rcmd, wcmd
        return 4, "mdw", "mww"

    def read(self, addr=None):
        if self._pending:
            return
        if addr is None:
            addr = parse_int(self.addr_edit.text(), 16)
            if addr is None:
                self.bridge.notify("地址格式无效（应为十六进制，如 0x08000000）", error=True)
                return
        count = self.count_spin.value()
        size, rcmd, _ = self._width_conf()
        self._size = size
        self._addr0 = addr
        self._pending = True
        self.status_lbl.setText("读取中…")
        cmd = "%s 0x%x %d" % (rcmd, addr, count)

        def on_ok(text):
            def apply():
                self._pending = False
                rows = parsers.parse_md(text)
                if not rows:
                    self.status_lbl.setText("读取失败或无数据")
                    return
                self._rows = rows
                self.status_lbl.setText("%d 项" % sum(len(v) for _, v in rows))
                self._render()
            self.bridge.post(apply)

        def on_err(exc):
            self.bridge.post(lambda: (setattr(self, "_pending", False),
                                      self.status_lbl.setText("读取失败: %s" % exc)))
        self.bridge.session.call_async(cmd, on_ok=on_ok, on_err=on_err, timeout=20.0)

    def _page(self, direction):
        count = self.count_spin.value()
        size, _, _ = self._width_conf()
        self.addr_edit.setText("0x%08X" % (self._addr0 + direction * count * size))
        self.read()

    def _render(self):
        per_line = BYTES_PER_LINE // self._size
        self.table.clear()
        self.table.setRowCount(len(self._rows))
        self.table.setColumnCount(per_line + 2)
        headers = ["地址"] + ["%X" % (i * self._size) for i in range(per_line)] + ["ASCII"]
        self.table.setHorizontalHeaderLabels(headers)
        for r, (addr, values) in enumerate(self._rows):
            self.table.setItem(r, 0, QTableWidgetItem("0x%08X" % addr))
            for i in range(per_line):
                v = "%0*X" % (self._size * 2, values[i]) if i < len(values) else ""
                self.table.setItem(r, i + 1, QTableWidgetItem(v))
            raw = b"".join(v.to_bytes(self._size, "little") for v in values)
            ascii_str = "".join(chr(b) if 32 <= b < 127 else "." for b in raw)
            self.table.setItem(r, per_line + 1, QTableWidgetItem(ascii_str))
        self.table.resizeColumnsToContents()

    def _edit_cell(self, index):
        if index.column() < 1:
            return
        row_addr, value_idx = self._rows[index.row()][0], index.column() - 1
        values = self._rows[index.row()][1]
        if value_idx >= len(values):
            return
        cell_addr = row_addr + value_idx * self._size
        _, _, wcmd = self._width_conf()
        text, ok = QInputDialog.getText(
            self, "修改内存", "新值（十六进制）— 地址 0x%08X:" % cell_addr,
            text="0x%0*X" % (self._size * 2, values[value_idx]))
        if not ok:
            return
        value = parse_int(text, 16)
        if value is None or value >= (1 << (self._size * 8)):
            self.bridge.notify("数值无效或超出宽度", error=True)
            return
        cmd = "%s 0x%x 0x%x" % (wcmd, cell_addr, value)

        def worker():
            try:
                self.bridge.session.call(cmd, timeout=10.0)
            except Exception as exc:
                self.bridge.post(lambda e=exc: self.bridge.notify("写入内存失败: %s" % e, error=True))
                return
            self.bridge.post(lambda: self.read(self._addr0))
        threading.Thread(target=worker, daemon=True).start()


# ==========================================================================
class FlashTab(QWidget):
    def __init__(self, main, bridge):
        super().__init__()
        self.bridge = bridge
        self._banks = []
        self._busy = False
        root = QVBoxLayout(self)

        prog = QGroupBox("固件烧写 (program)")
        pv = QVBoxLayout(prog)
        row = QHBoxLayout()
        self.file_edit = QLineEdit()
        row.addWidget(self.file_edit, 1)
        b = QPushButton("浏览…")
        b.clicked.connect(self._browse_file)
        row.addWidget(b)
        pv.addLayout(row)
        row = QHBoxLayout()
        row.addWidget(QLabel("偏移地址(可选):"))
        self.offset_edit = QLineEdit()
        self.offset_edit.setMaximumWidth(130)
        row.addWidget(self.offset_edit)
        self.verify_cb = QCheckBox("烧写后校验 (verify)")
        self.verify_cb.setChecked(True)
        self.reset_cb = QCheckBox("烧写后复位 (reset)")
        self.reset_cb.setChecked(True)
        self.preverify_cb = QCheckBox("烧写前校验 (preverify)")
        row.addWidget(self.verify_cb)
        row.addWidget(self.reset_cb)
        row.addWidget(self.preverify_cb)
        row.addStretch()
        self.program_btn = QPushButton("⬇  烧写固件")
        self.program_btn.setStyleSheet("background:#2563eb;color:white;padding:6px 18px;font-weight:bold")
        self.program_btn.clicked.connect(self._program)
        row.addWidget(self.program_btn)
        self.prog_status = QLabel("")
        self.prog_status.setStyleSheet("color:#4b5563")
        row.addWidget(self.prog_status)
        pv.addLayout(row)
        root.addWidget(prog)

        banks = QGroupBox("Flash 存储体 (flash banks)")
        bv = QVBoxLayout(banks)
        row = QHBoxLayout()
        b = QPushButton("刷新")
        b.clicked.connect(self._refresh_banks)
        row.addWidget(b)
        row.addWidget(QLabel("信息输出:"))
        self.bank_edit = QLineEdit("0")
        self.bank_edit.setMaximumWidth(40)
        row.addWidget(self.bank_edit)
        b = QPushButton("信息 (flash info)")
        b.clicked.connect(self._bank_info)
        row.addWidget(b)
        row.addWidget(QLabel("扇区范围:"))
        self.first_edit = QLineEdit("0")
        self.first_edit.setMaximumWidth(40)
        row.addWidget(self.first_edit)
        row.addWidget(QLabel("-"))
        self.last_edit = QLineEdit("last")
        self.last_edit.setMaximumWidth(60)
        row.addWidget(self.last_edit)
        b = QPushButton("擦除扇区")
        b.clicked.connect(self._erase_sectors)
        row.addWidget(b)
        row.addStretch()
        bv.addLayout(row)
        self.bank_table = QTableWidget(0, 7)
        self.bank_table.setHorizontalHeaderLabels(["#", "名称", "驱动", "基址", "大小", "总线宽", "芯片宽"])
        self.bank_table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.bank_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        self.bank_table.setMaximumHeight(120)
        bv.addWidget(self.bank_table)
        root.addWidget(banks)

        self.out = QPlainTextEdit()
        self.out.setReadOnly(True)
        self.out.setFont(mono())
        root.addWidget(self.out, 1)

    def set_connected(self, connected):
        if connected:
            self._refresh_banks()

    def _write_out(self, text):
        self.out.setPlainText(text)

    def _browse_file(self):
        path, _ = QFileDialog.getOpenFileName(
            self, "选择固件镜像",
            "", "固件镜像 (*.bin *.hex *.elf *.axf *.out *.mot *.s19);;所有文件 (*)")
        if path:
            self.file_edit.setText(path)

    def _program(self):
        if self._busy:
            return
        path = self.file_edit.text().strip()
        if not path:
            self.bridge.notify("请先选择固件镜像文件", error=True)
            return
        try:
            path_bytes = tcl_core.path_to_rpc_bytes(path)
        except UnicodeEncodeError as exc:
            self.bridge.notify("固件路径无法发送给 OpenOCD（%s）。请移动到纯英文路径后重试。" % exc, error=True)
            return
        parts = [b"program {" + path_bytes + b"}"]
        if self.offset_edit.text().strip():
            parts.append(self.offset_edit.text().strip().encode("ascii"))
        if self.preverify_cb.isChecked():
            parts.append(b"preverify")
        if self.verify_cb.isChecked():
            parts.append(b"verify")
        if self.reset_cb.isChecked():
            parts.append(b"reset")
        cmd = b" ".join(parts)
        self._busy = True
        self.program_btn.setEnabled(False)
        self.program_btn.setText("烧写中…")
        self.prog_status.setText("执行中，日志输出在下方")
        self._write_out("")
        self.bridge.begin_log_capture()

        def finish(result, ok):
            def settle():
                text = "\n".join(self.bridge.end_log_capture())
                if result:
                    text = (text + "\n" if text else "") + result
                self._busy = False
                self.program_btn.setEnabled(True)
                self.program_btn.setText("⬇  烧写固件")
                self.prog_status.setText("完成" if ok else "失败")
                self._write_out(text or "(命令已执行，无日志输出)")
                self.bridge.session.refresh_now()
            self.bridge.post(settle)

        self.bridge.session.call_async(
            cmd,
            on_ok=lambda res: finish(res, True),
            on_err=lambda exc: finish(str(exc), False),
            timeout=300.0)

    def _refresh_banks(self):
        def on_ok(text):
            def apply():
                self._banks = parsers.parse_flash_banks(text)
                self.bank_table.setRowCount(len(self._banks))
                for i, b in enumerate(self._banks):
                    for c, v in enumerate((str(b["num"]), b["name"], b["driver"],
                                           b["base"], b["size"], b["buswidth"], b["chipwidth"])):
                        self.bank_table.setItem(i, c, QTableWidgetItem(v))
                if not self._banks:
                    self._write_out(text or "(无 flash bank)")
            self.bridge.post(apply)
        self.bridge.session.call_async("flash banks", on_ok=on_ok)

    def _bank_info(self):
        def on_ok(text):
            self.bridge.post(lambda: self._write_out(text or "(无输出)"))
        self.bridge.session.call_async("flash info %s" % (self.bank_edit.text() or "0"),
                                       on_ok=on_ok, timeout=30.0)

    def _erase_sectors(self):
        cmd = "flash erase_sector %s %s %s" % (
            self.bank_edit.text() or "0", self.first_edit.text() or "0",
            self.last_edit.text() or "last")
        self.bridge.begin_log_capture()

        def on_ok(_):
            def apply():
                self._write_out("\n".join(self.bridge.end_log_capture()) or "擦除命令已执行")
                self.bridge.notify("扇区擦除完成")
                self._bank_info()
            self.bridge.post(apply)
        self.bridge.session.call_async(cmd, on_ok=on_ok, timeout=120.0)


# ==========================================================================
class BreakpointsTab(QWidget):
    def __init__(self, main, bridge):
        super().__init__()
        self.bridge = bridge
        self._bp = []
        self._wp = []
        root = QVBoxLayout(self)

        bp_box = QGroupBox("断点 (bp / rbp)")
        bv = QVBoxLayout(bp_box)
        row = QHBoxLayout()
        self.bp_type_cb = QComboBox()
        self.bp_type_cb.addItems(["软件 (默认)", "硬件 (hw)"])
        row.addWidget(self.bp_type_cb)
        row.addWidget(QLabel("地址:"))
        self.bp_addr = QLineEdit()
        self.bp_addr.setFont(mono())
        self.bp_addr.setMaximumWidth(140)
        row.addWidget(self.bp_addr)
        row.addWidget(QLabel("长度:"))
        self.bp_len_cb = QComboBox()
        self.bp_len_cb.addItems(["1", "2", "4", "8"])
        self.bp_len_cb.setCurrentIndex(1)
        row.addWidget(self.bp_len_cb)
        b = QPushButton("添加断点")
        b.clicked.connect(self._add_bp)
        row.addWidget(b)
        b = QPushButton("删除选中")
        b.clicked.connect(lambda: self._remove(self.bp_table, "bp"))
        row.addWidget(b)
        b = QPushButton("全部删除")
        b.clicked.connect(lambda: self._remove_all("bp"))
        row.addWidget(b)
        b = QPushButton("刷新")
        b.clicked.connect(self.refresh)
        row.addWidget(b)
        row.addStretch()
        bv.addLayout(row)
        self.bp_table = QTableWidget(0, 4)
        self.bp_table.setHorizontalHeaderLabels(["类型", "地址", "长度", "备注"])
        self.bp_table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.bp_table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeMode.Stretch)
        self.bp_table.doubleClicked.connect(lambda i: self._remove(self.bp_table, "bp"))
        bv.addWidget(self.bp_table)
        root.addWidget(bp_box)

        wp_box = QGroupBox("观察点 (wp / rwp)")
        wv = QVBoxLayout(wp_box)
        row = QHBoxLayout()
        row.addWidget(QLabel("地址:"))
        self.wp_addr = QLineEdit()
        self.wp_addr.setFont(mono())
        self.wp_addr.setMaximumWidth(140)
        row.addWidget(self.wp_addr)
        row.addWidget(QLabel("长度:"))
        self.wp_len_cb = QComboBox()
        self.wp_len_cb.addItems(["1", "2", "4", "8"])
        self.wp_len_cb.setCurrentIndex(2)
        row.addWidget(self.wp_len_cb)
        row.addWidget(QLabel("访问:"))
        self.wp_access_cb = QComboBox()
        self.wp_access_cb.addItems(["读 (r)", "写 (w)", "读写 (a)"])
        self.wp_access_cb.setCurrentIndex(2)
        row.addWidget(self.wp_access_cb)
        row.addWidget(QLabel("值(可选):"))
        self.wp_value = QLineEdit()
        self.wp_value.setFont(mono())
        self.wp_value.setMaximumWidth(90)
        row.addWidget(self.wp_value)
        row.addWidget(QLabel("掩码(可选):"))
        self.wp_mask = QLineEdit()
        self.wp_mask.setFont(mono())
        self.wp_mask.setMaximumWidth(90)
        row.addWidget(self.wp_mask)
        b = QPushButton("添加观察点")
        b.clicked.connect(self._add_wp)
        row.addWidget(b)
        b = QPushButton("删除选中")
        b.clicked.connect(lambda: self._remove(self.wp_table, "wp"))
        row.addWidget(b)
        b = QPushButton("全部删除")
        b.clicked.connect(lambda: self._remove_all("wp"))
        row.addWidget(b)
        row.addStretch()
        wv.addLayout(row)
        self.wp_table = QTableWidget(0, 5)
        self.wp_table.setHorizontalHeaderLabels(["地址", "长度", "访问", "值", "掩码"])
        self.wp_table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.wp_table.doubleClicked.connect(lambda i: self._remove(self.wp_table, "wp"))
        wv.addWidget(self.wp_table)
        root.addWidget(wp_box)

    def set_connected(self, connected):
        if connected:
            self.refresh()

    def refresh(self):
        def bp_ok(text):
            def apply():
                self._bp = parsers.parse_breakpoints(text)
                self.bp_table.setRowCount(len(self._bp))
                for i, b in enumerate(self._bp):
                    extra = b["orig_instr"] or ("num=%s" % b["num"] if b["num"] else "")
                    if b["asid"]:
                        extra = "asid=%s %s" % (b["asid"], extra)
                    for c, v in enumerate((b["type"], b["addr"] or b["asid"], b["len"], extra)):
                        self.bp_table.setItem(i, c, QTableWidgetItem(v))
            self.bridge.post(apply)

        def wp_ok(text):
            def apply():
                self._wp = parsers.parse_watchpoints(text)
                self.wp_table.setRowCount(len(self._wp))
                for i, w in enumerate(self._wp):
                    for c, v in enumerate((w["addr"], w["len"], w["rw"], w["value"], w["mask"])):
                        self.wp_table.setItem(i, c, QTableWidgetItem(v))
            self.bridge.post(apply)
        self.bridge.session.call_async("bp", on_ok=bp_ok, timeout=15.0)
        self.bridge.session.call_async("wp", on_ok=wp_ok, timeout=15.0)

    def _run(self, cmd):
        self.bridge.session.call_async(
            cmd, on_ok=lambda _: None,
            on_err=lambda e: self.bridge.post(lambda: self.bridge.notify("命令失败: %s" % e, error=True)),
            timeout=15.0)

    def _add_bp(self):
        addr = parse_int(self.bp_addr.text(), 16)
        if addr is None:
            self.bridge.notify("断点地址无效（十六进制，如 0x08000198）", error=True)
            return
        cmd = "bp 0x%x %s" % (addr, self.bp_len_cb.currentText())
        if self.bp_type_cb.currentIndex() == 1:
            cmd += " hw"
        self._run(cmd)
        QTimer_later(self.refresh)

    def _add_wp(self):
        addr = parse_int(self.wp_addr.text(), 16)
        if addr is None:
            self.bridge.notify("观察点地址无效（十六进制，如 0x20000000）", error=True)
            return
        rw = ["r", "w", "a"][self.wp_access_cb.currentIndex()]
        cmd = "wp 0x%x %s %s" % (addr, self.wp_len_cb.currentText(), rw)
        value = parse_int(self.wp_value.text(), 16)
        if value is not None:
            cmd += " 0x%x" % value
            mask = parse_int(self.wp_mask.text(), 16)
            if mask is not None:
                cmd += " 0x%x" % mask
        self._run(cmd)
        QTimer_later(self.refresh)

    def _remove(self, table, kind):
        row = table.currentRow()
        if row < 0:
            self.bridge.notify("请先在列表中选择", error=True)
            return
        if kind == "bp":
            b = self._bp[row]
            target = b["addr"] or b["asid"]
            if target:
                self._run("rbp %s" % target)
        else:
            self._run("rwp %s" % self._wp[row]["addr"])
        QTimer_later(self.refresh)

    def _remove_all(self, kind):
        self._run("rbp all" if kind == "bp" else "rwp all")
        QTimer_later(self.refresh)


def QTimer_later(fn, ms=300):
    from PySide6.QtCore import QTimer
    QTimer.singleShot(ms, fn)


# ==========================================================================
class GdbTab(QWidget):
    def __init__(self, main, bridge):
        super().__init__()
        self.bridge = bridge
        s = bridge.settings
        root = QVBoxLayout(self)
        info = QGroupBox("GDB 服务器")
        iv = QVBoxLayout(info)
        self.info_lbl = QLabel("")
        iv.addWidget(self.info_lbl)
        root.addWidget(info)
        cfg = QGroupBox("外部 GDB 调试器")
        cv = QVBoxLayout(cfg)
        row = QHBoxLayout()
        row.addWidget(QLabel("GDB 程序:"))
        self.gdb_edit = QLineEdit(s.get("gdb_path", "arm-none-eabi-gdb"))
        row.addWidget(self.gdb_edit, 1)
        b = QPushButton("浏览…")
        b.clicked.connect(self._browse)
        row.addWidget(b)
        cv.addLayout(row)
        row = QHBoxLayout()
        row.addWidget(QLabel("GDB 参数:"))
        self.args_edit = QLineEdit(s.get("gdb_args", '-ex "target remote localhost:3333"'))
        row.addWidget(self.args_edit, 1)
        cv.addLayout(row)
        self.preview_lbl = QLabel("")
        self.preview_lbl.setStyleSheet("color:#1f6feb")
        cv.addWidget(self.preview_lbl)
        row = QHBoxLayout()
        b = QPushButton("复制命令行")
        b.clicked.connect(self._copy)
        row.addWidget(b)
        b = QPushButton("在新控制台启动 GDB")
        b.clicked.connect(self._launch)
        row.addWidget(b)
        row.addStretch()
        cv.addLayout(row)
        root.addWidget(cfg)
        root.addStretch()
        self.gdb_edit.textChanged.connect(self._sync)
        self.args_edit.textChanged.connect(self._sync)
        self._sync()

    def set_connected(self, connected):
        pass

    def _sync(self):
        s = self.bridge.settings
        s["gdb_path"] = self.gdb_edit.text().strip()
        s["gdb_args"] = self.args_edit.text().strip()
        self.preview_lbl.setText("%s %s" % (s["gdb_path"], s["gdb_args"]))
        host = "localhost"
        self.info_lbl.setText("连接地址: %s:%s  (target remote %s:%s)" % (
            host, s["gdb_port"], host, s["gdb_port"]))

    def _browse(self):
        path, _ = QFileDialog.getOpenFileName(self, "选择 GDB 可执行文件")
        if path:
            self.gdb_edit.setText(path)

    def _copy(self):
        from PySide6.QtWidgets import QApplication
        QApplication.clipboard().setText("%s %s" % (self.gdb_edit.text(), self.args_edit.text()))
        self.bridge.notify("命令行已复制")

    def _launch(self):
        gdb = self.gdb_edit.text().strip()
        if not gdb:
            self.bridge.notify("请先设置 GDB 程序路径", error=True)
            return
        args = []
        cur, inq = [], False
        for ch in self.args_edit.text():
            if ch == '"':
                inq = not inq
            elif ch.isspace() and not inq:
                if cur:
                    args.append("".join(cur))
                    cur = []
            else:
                cur.append(ch)
        if cur:
            args.append("".join(cur))
        try:
            flags = subprocess.CREATE_NEW_CONSOLE if sys.platform == "win32" else 0
            subprocess.Popen([gdb] + args, creationflags=flags)
            self.bridge.notify("已启动 GDB: %s" % gdb)
        except OSError as exc:
            self.bridge.notify("启动 GDB 失败: %s" % exc, error=True)
