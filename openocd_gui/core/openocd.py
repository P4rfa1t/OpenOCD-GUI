"""OpenOCD subprocess management and command line construction."""

import os
import re
import subprocess
import sys
import threading

from . import events
from .events import EventBus

LISTEN_RE = re.compile(r"Listening on port \d+ for")
INIT_FAILED_RE = re.compile(r"OpenOCD init failed")


def build_command(settings):
    """Build the openocd argv list from a Settings mapping.

    Raises ValueError when no executable is configured.
    """
    exe = (settings["openocd_path"] or "").strip()
    if not exe:
        raise ValueError("未设置 OpenOCD 可执行文件路径")

    args = [exe]
    scripts_dir = (settings["scripts_dir"] or "").strip()
    if scripts_dir:
        args += ["-s", scripts_dir]
    for sp in settings.get("search_paths", []):
        if sp and sp.strip():
            args += ["-s", sp.strip()]

    try:
        level = int(settings.get("debug_level", 0))
    except (TypeError, ValueError):
        level = 0
    if level > 0:
        args.append("-d%d" % level)

    log_file = (settings.get("log_file") or "").strip()
    if log_file:
        args += ["-l", log_file]

    # Ports/bind first so they always take effect regardless of the configs.
    # Hierarchical syntax (OpenOCD >= 0.12); the old gdb_port/tcl_port/telnet_port
    # spellings are deprecated in 0.12+ and print warnings on every start.
    bind = (settings.get("bind") or "").strip()
    if bind and bind not in ("127.0.0.1", "localhost"):
        args += ["-c", "bindto %s" % bind]
    for name in ("gdb", "tcl", "telnet"):
        args += ["-c", "%s port %s" % (name, settings.get(name + "_port", ""))]

    for cfg in settings.get("configs", []):
        if cfg and cfg.strip():
            args += ["-f", cfg.strip()]
    for cmd in settings.get("extra_commands", []):
        if cmd and cmd.strip():
            args += ["-c", cmd.strip()]
    return args


class OpenOcdProcess:
    """Spawn/stop the openocd process and forward its output as LOG events."""

    def __init__(self, bus):
        self.bus = bus
        self._proc = None
        self._state = events.SERVER_STOPPED
        self._lock = threading.Lock()

    # -- state ---------------------------------------------------------------
    @property
    def state(self):
        return self._state

    def _set_state(self, state, detail=""):
        self._state = state
        self.bus.emit(events.SERVER_STATE, (state, detail))

    @property
    def alive(self):
        with self._lock:
            return self._proc is not None and self._proc.poll() is None

    # -- lifecycle -----------------------------------------------------------
    def start(self, args):
        with self._lock:
            if self._proc is not None and self._proc.poll() is None:
                raise RuntimeError("OpenOCD 已在运行")
            creationflags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
            cwd = os.path.dirname(os.path.abspath(args[0])) or None
            try:
                self._proc = subprocess.Popen(
                    args,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    cwd=cwd,
                    creationflags=creationflags,
                )
            except OSError as exc:
                self._proc = None
                self._set_state(events.SERVER_FAILED, "无法启动 OpenOCD: %s" % exc)
                raise
            proc = self._proc
        self._set_state(events.SERVER_STARTING, " ".join(args))
        threading.Thread(target=self._reader, args=(proc,), daemon=True).start()
        threading.Thread(target=self._watcher, args=(proc,), daemon=True).start()

    def stop(self, grace=4.0):
        """Hard stop. Prefer Session.stop() which tries a graceful shutdown first."""
        with self._lock:
            proc = self._proc
        if proc is None or proc.poll() is not None:
            return
        self._set_state(events.SERVER_STOPPING)
        try:
            proc.terminate()
            proc.wait(timeout=grace)
        except subprocess.TimeoutExpired:
            try:
                proc.kill()
                proc.wait(timeout=2.0)
            except Exception:
                pass
        except OSError:
            pass

    # -- worker threads --------------------------------------------------------
    def _reader(self, proc):
        try:
            for raw in proc.stdout:
                line = raw.decode("utf-8", "replace").rstrip("\r\n")
                if not line:
                    continue
                self.bus.emit(events.LOG, line)
                if self._state == events.SERVER_STARTING and LISTEN_RE.search(line):
                    self._set_state(events.SERVER_RUNNING)
                elif INIT_FAILED_RE.search(line):
                    # The process exits by itself after init failure; the watcher
                    # reports the final state. Only note it here.
                    pass
        except (OSError, ValueError):
            pass
        finally:
            try:
                proc.stdout.close()
            except OSError:
                pass

    def _watcher(self, proc):
        rc = proc.wait()
        with self._lock:
            if self._proc is proc:
                self._proc = None
        if self._state in (events.SERVER_STOPPING, events.SERVER_STOPPED):
            self._set_state(events.SERVER_STOPPED, "退出码 %s" % rc)
        else:
            self._set_state(
                events.SERVER_FAILED if rc not in (0, None) else events.SERVER_STOPPED,
                "退出码 %s" % rc,
            )
