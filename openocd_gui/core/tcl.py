"""Client for OpenOCD's TCL RPC port.

Wire protocol (src/server/tcl_server.c): the client sends a command line
terminated by 0x1A (ctrl-z); the server replies with the command result
followed by 0x1A.  `shutdown`/`exit` reply with a bare terminator and close
the connection.  Async notifications are disabled unless the client opts in,
so a strict request/response framing is safe.
"""

import ctypes
import socket
import sys
import threading

TERM = b"\x1a"


class TclError(Exception):
    """OpenOCD reported an error for the command."""


def windows_short_path(path):
    """8.3 short path via GetShortPathNameW, or None if unavailable."""
    try:
        buf = ctypes.create_unicode_buffer(1024)
        n = ctypes.windll.kernel32.GetShortPathNameW(path, buf, 1024)
        if 0 < n < 1024:
            return buf.value
    except Exception:
        pass
    return None


def path_to_rpc_bytes(path):
    """Encode a filesystem path for embedding in a TCL RPC command.

    Jim Tcl on Windows opens files with fopen(), which interprets the bytes
    in the system ANSI codepage (GBK on zh-CN).  Sending UTF-8 bytes for a
    non-ASCII path therefore fails with "can't open file".  Try, in order:
    plain ASCII, the ANSI codepage, the Windows 8.3 short path.

    Raises UnicodeEncodeError when the path can never reach OpenOCD intact.
    """
    p = path.replace("\\", "/")
    if p.isascii():
        return p.encode("ascii")
    if sys.platform == "win32":
        try:
            return p.encode("mbcs")  # system ANSI codepage
        except UnicodeEncodeError:
            pass
        short = windows_short_path(path)
        if short and short.isascii():
            return short.replace("\\", "/").encode("ascii")
        raise UnicodeEncodeError(
            "mbcs", p, 0, len(p),
            "路径含系统代码页无法表示的字符，且无 8.3 短路径可用")
    return p.encode("utf-8")


class TclClient:
    def __init__(self):
        self._sock = None
        self._lock = threading.Lock()

    @property
    def connected(self):
        return self._sock is not None

    def connect(self, host, port, timeout=3.0):
        with self._lock:
            self._close_locked()
            sock = socket.create_connection((host, port), timeout=timeout)
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            self._sock = sock

    def close(self):
        with self._lock:
            self._close_locked()

    def _close_locked(self):
        if self._sock is not None:
            try:
                self._sock.close()
            except OSError:
                pass
            self._sock = None

    def call(self, cmd, timeout=10.0):
        """Send one command, return the result text.

        `cmd` is normally str (sent UTF-8); bytes are sent verbatim, which
        lets callers embed ANSI-codepage-encoded file paths on Windows.

        Raises ConnectionError / TimeoutError / OSError on transport problems.
        """
        data = bytes(cmd) if isinstance(cmd, (bytes, bytearray)) else cmd.encode("utf-8")
        with self._lock:
            sock = self._sock
            if sock is None:
                raise ConnectionError("TCL 尚未连接")
            sock.settimeout(timeout)
            try:
                sock.sendall(data + TERM)
                buf = bytearray()
                while True:
                    chunk = sock.recv(65536)
                    if not chunk:
                        raise ConnectionError("OpenOCD 关闭了 TCL 连接")
                    buf += chunk
                    idx = buf.find(TERM)
                    if idx != -1:
                        resp = bytes(buf[:idx])
                        break
            except socket.timeout:
                head = data.split(None, 1)[0]
                raise TimeoutError("TCL 命令超时: %s" % head.decode("ascii", "replace"))
            except (ConnectionError, OSError):
                self._close_locked()
                raise
            text = resp.decode("utf-8", "replace")
            if text.endswith("\n"):
                text = text[:-1]
            if text.endswith("\r"):
                text = text[:-1]
            return text
