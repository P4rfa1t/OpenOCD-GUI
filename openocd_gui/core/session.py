"""Session: orchestrates the OpenOCD process, the TCL RPC connection and
background target polling."""

import threading
import time

from . import events, parsers
from .openocd import OpenOcdProcess, build_command
from .tcl import TclClient

TCL_HOST = "127.0.0.1"


class Session:
    def __init__(self, bus, settings):
        self.bus = bus
        self.settings = settings
        self.proc = OpenOcdProcess(bus)
        self.tcl = TclClient()
        self.last_targets = []
        self.poll_enabled = True
        self._stop_evt = threading.Event()
        self._supervisor_thread = None

    # -- lifecycle ------------------------------------------------------------
    @property
    def running(self):
        return self.proc.state in (events.SERVER_STARTING, events.SERVER_RUNNING)

    def start(self):
        if self.proc.alive:
            raise RuntimeError("OpenOCD 已在运行")
        args = build_command(self.settings)  # raises ValueError when path missing
        self._stop_evt.clear()
        self.poll_enabled = bool(self.settings.get("auto_poll", True))
        self.proc.start(args)
        self._supervisor_thread = threading.Thread(
            target=self._supervise, daemon=True)
        self._supervisor_thread.start()

    def stop(self):
        self._stop_evt.set()
        # Graceful shutdown first; fall back to terminating the process.
        try:
            self.tcl.call("shutdown", timeout=2.0)
        except Exception:
            pass
        self.tcl.close()
        self.bus.emit(events.TCL_STATE, False)
        if self.proc.alive:
            self.proc.stop()
        # Give the watcher thread a moment to report the final state.
        deadline = time.time() + 1.5
        while self.proc.alive and time.time() < deadline:
            time.sleep(0.05)
        if self.proc.alive:
            self.proc._set_state(events.SERVER_STOPPED, "已强制停止")

    # -- command API ------------------------------------------------------------
    def call(self, cmd, timeout=15.0):
        return self.tcl.call(cmd, timeout)

    def call_async(self, cmd, on_ok=None, on_err=None, timeout=30.0):
        def worker():
            try:
                result = self.call(cmd, timeout=timeout)
                if on_ok:
                    on_ok(result)
            except Exception as exc:  # noqa: BLE001 - forwarded to caller
                if on_err:
                    on_err(exc)
        threading.Thread(target=worker, daemon=True).start()

    # -- supervisor ------------------------------------------------------------
    def _supervise(self):
        """Keep the TCL connection alive while the process runs."""
        port = self.settings.get("tcl_port", 6666)
        while not self._stop_evt.is_set() and self.proc.alive:
            try:
                self.tcl.connect(TCL_HOST, port, timeout=2.0)
                self.bus.emit(events.TCL_STATE, True)
                self._poll_loop()
                self.tcl.close()
            except (ConnectionError, OSError, TimeoutError):
                self.tcl.close()
            finally:
                self.bus.emit(events.TCL_STATE, False)
            if self._stop_evt.is_set() or not self.proc.alive:
                break
            self._stop_evt.wait(0.4)
        self.tcl.close()

    def _poll_loop(self):
        """Periodically refresh `targets` until the connection is lost."""
        self._poll_once()  # immediate first poll
        while not self._stop_evt.is_set() and self.proc.alive:
            try:
                interval = max(150, int(self.settings.get("poll_interval_ms", 1000))) / 1000.0
            except (TypeError, ValueError):
                interval = 1.0
            if self._stop_evt.wait(interval):
                return
            if not self.poll_enabled:
                continue
            if not self._poll_once():
                return

    def _poll_once(self):
        try:
            text = self.tcl.call("targets", timeout=5.0)
        except (ConnectionError, TimeoutError, OSError):
            return False
        rows = parsers.parse_targets(text)
        if rows:
            self.last_targets = rows
            self.bus.emit(events.TARGETS, rows)
        return True

    def refresh_now(self):
        """One-shot target refresh in the background (thread-safe)."""
        threading.Thread(target=self._poll_once_guarded, daemon=True).start()

    def _poll_once_guarded(self):
        try:
            self._poll_once()
        except Exception:
            pass
