"""Main window for the PySide6 port: toolbar, tabs, status bar."""

import threading
import webbrowser

from PySide6.QtCore import Qt
from PySide6.QtGui import QAction, QBrush, QColor
from PySide6.QtWidgets import (
    QLabel, QMainWindow, QMenu, QMenuBar, QTabWidget, QToolBar, QWidget,
)

from openocd_gui import __version__, __project_url__
from openocd_gui.core import events
from . import tabs
from .bridge import Bridge

STATE_COLORS = {
    events.SERVER_STOPPED: "#9ca3af",
    events.SERVER_STARTING: "#f59e0b",
    events.SERVER_RUNNING: "#10b981",
    events.SERVER_STOPPING: "#f59e0b",
    events.SERVER_FAILED: "#ef4444",
}
STATE_LABELS = {
    events.SERVER_STOPPED: "已停止",
    events.SERVER_STARTING: "启动中…",
    events.SERVER_RUNNING: "运行中",
    events.SERVER_STOPPING: "停止中…",
    events.SERVER_FAILED: "异常退出",
}


class MainWindow(QMainWindow):
    def __init__(self, argv=None):
        super().__init__()
        self.argv = list(argv or [])
        self.setWindowTitle("OpenOCD-GUI (PySide6)")
        self.resize(1120, 700)

        self.bridge = Bridge(self)
        self.bridge.on(events.LOG, self._on_log)
        self.bridge.on(events.SERVER_STATE, self._on_server_state)
        self.bridge.on(events.TCL_STATE, self._on_tcl_state)
        self.bridge.on(events.TARGETS, self._on_targets)
        self.bridge.on(events.NOTIFY, self._on_notify)

        self._build_toolbar()
        self._build_tabs()
        self._build_statusbar()
        self._build_menu()

    # ---------------------------------------------------------------- build
    def _build_toolbar(self):
        bar = QToolBar()
        bar.setMovable(False)
        self.addToolBar(bar)
        self.act_start = QAction("▶  启动", self)
        self.act_start.triggered.connect(self.start_server)
        self.act_stop = QAction("■  停止", self)
        self.act_stop.triggered.connect(self.stop_server)
        self.act_stop.setEnabled(False)
        bar.addAction(self.act_start)
        bar.addAction(self.act_stop)
        self.lbl_state = QLabel("已停止")
        self.lbl_tcl = QLabel("TCL: 未连接")
        self.lbl_tcl.setStyleSheet("color:#6b7280; margin-left:14px;")
        self.lbl_target = QLabel("目标: —")
        self.lbl_target.setStyleSheet("color:#6b7280; margin-left:14px;")
        bar.addWidget(self.lbl_state)
        bar.addWidget(self.lbl_tcl)
        bar.addWidget(self.lbl_target)

    def _build_tabs(self):
        self.notebook = QTabWidget()
        self.setCentralWidget(self.notebook)
        self.tab_config = tabs.ConfigTab(self, self.bridge)
        self.tab_log = tabs.LogTab(self, self.bridge)
        self.tab_console = tabs.ConsoleTab(self, self.bridge)
        self.tab_target = tabs.TargetTab(self, self.bridge)
        self.tab_regs = tabs.RegistersTab(self, self.bridge)
        self.tab_mem = tabs.MemoryTab(self, self.bridge)
        self.tab_flash = tabs.FlashTab(self, self.bridge)
        self.tab_bp = tabs.BreakpointsTab(self, self.bridge)
        self.tab_gdb = tabs.GdbTab(self, self.bridge)
        self._conn_tabs = [
            self.tab_console, self.tab_target, self.tab_regs,
            self.tab_mem, self.tab_flash, self.tab_bp,
        ]
        for i, (tab, title) in enumerate([
            (self.tab_config, "配置"), (self.tab_log, "日志"),
            (self.tab_console, "控制台"), (self.tab_target, "目标"),
            (self.tab_regs, "寄存器"), (self.tab_mem, "内存"),
            (self.tab_flash, "烧写"), (self.tab_bp, "断点/观察点"),
            (self.tab_gdb, "GDB"),
        ]):
            self.notebook.addTab(tab, title)
        self._set_conn_tabs(False)

    def _set_conn_tabs(self, enabled):
        for tab in self._conn_tabs:
            i = self.notebook.indexOf(tab)
            self.notebook.setTabEnabled(i, enabled)
        for tab in (self.tab_target, self.tab_regs, self.tab_mem,
                    self.tab_flash, self.tab_bp):
            tab.set_connected(enabled)

    def _build_statusbar(self):
        sb = self.statusBar()
        self.lbl_ports = QLabel("")
        self.lbl_msg = QLabel("")
        sb.addWidget(self.lbl_ports)
        sb.addPermanentWidget(self.lbl_msg)

    def _build_menu(self):
        m = self.menuBar().addMenu("帮助")
        a_docs = QAction("OpenOCD 文档", self)
        a_docs.triggered.connect(lambda: webbrowser.open("http://openocd.org/doc/html/index.html"))
        a_about = QAction("关于", self)
        a_about.triggered.connect(self._about)
        m.addAction(a_docs)
        m.addAction(a_about)

    def _about(self):
        from PySide6.QtWidgets import QMessageBox
        QMessageBox.about(self, "关于", "OpenOCD-GUI v%s (PySide6 port)\n\n%s" % (__version__, __project_url__))

    # ---------------------------------------------------------------- events
    def _on_log(self, line):
        self.tab_log.append_line(line)

    def _on_server_state(self, payload):
        state, _detail = payload
        color = STATE_COLORS.get(state, "#9ca3af")
        self.lbl_state.setText(STATE_LABELS.get(state, state))
        self.lbl_state.setStyleSheet("color:%s; font-weight:bold; margin-left:14px;" % color)
        self.act_start.setEnabled(state in (events.SERVER_STOPPED, events.SERVER_FAILED))
        self.act_stop.setEnabled(state in (events.SERVER_STARTING, events.SERVER_RUNNING))
        self.lbl_ports.setText("GDB %s · TCL %s · Telnet %s" % (
            self.bridge.settings["gdb_port"], self.bridge.settings["tcl_port"],
            self.bridge.settings["telnet_port"]))

    def _on_tcl_state(self, connected):
        self.lbl_tcl.setText("TCL: 已连接" if connected else "TCL: 未连接")
        self.lbl_tcl.setStyleSheet("color:%s; margin-left:14px;" % ("#059669" if connected else "#6b7280"))
        self._set_conn_tabs(connected)
        if connected:
            self.bridge.session.refresh_now()

    def _on_targets(self, rows):
        current = next((r for r in rows if r["current"]), rows[0] if rows else None)
        if current:
            self.last_target_state = current["state"]
            self.lbl_target.setText("目标: %s" % current["state"])
        self.tab_target.update_rows(rows)

    def _on_notify(self, payload):
        is_error, message = payload
        self.lbl_msg.setText(message)
        if is_error:
            from PySide6.QtWidgets import QMessageBox
            QMessageBox.critical(self, "OpenOCD-GUI", message)

    # ---------------------------------------------------------------- actions
    def start_server(self):
        self.bridge.settings.save()
        try:
            self.bridge.session.start()
        except ValueError as exc:
            self.bridge.notify(str(exc), error=True)
            self.notebook.setCurrentWidget(self.tab_config)
        except (RuntimeError, OSError) as exc:
            self.bridge.notify("启动失败: %s" % exc, error=True)

    def stop_server(self):
        self.act_stop.setEnabled(False)
        threading.Thread(target=self._stop_worker, daemon=True).start()

    def _stop_worker(self):
        try:
            self.bridge.session.stop()
        except Exception:
            pass
