"""Thread bridge: drains the core EventBus + UI callables on a QTimer in the
main thread — same proven model as the Tkinter front-end."""

import queue

from PySide6.QtCore import QObject, QTimer

from openocd_gui.core import events, settings as settings_store
from openocd_gui.core.events import EventBus
from openocd_gui.core.session import Session
from openocd_gui.core.settings import Settings


class Bridge(QObject):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.settings = Settings()
        self.bus = EventBus()
        self.session = Session(self.bus, self.settings)
        self.ui_queue = queue.Queue()
        self.handlers = {}  # event kind -> callable(payload)

        self.timer = QTimer(self)
        self.timer.setInterval(60)
        self.timer.timeout.connect(self._pump)
        self.timer.start()

    # -- API used by UI ------------------------------------------------------
    def on(self, kind, handler):
        self.handlers[kind] = handler

    def post(self, fn):
        """Run fn on the UI thread (safe from worker threads)."""
        self.ui_queue.put(fn)

    def notify(self, message, error=False):
        self.bus.emit(events.NOTIFY, (error, message))

    # -- pump ------------------------------------------------------------------
    def _pump(self):
        for kind, payload in self.bus.drain():
            handler = self.handlers.get(kind)
            if handler:
                handler(payload)
        while True:
            try:
                fn = self.ui_queue.get_nowait()
            except queue.Empty:
                break
            try:
                fn()
            except Exception:
                pass
