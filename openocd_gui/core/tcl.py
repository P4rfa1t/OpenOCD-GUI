"""Client for OpenOCD's TCL RPC port.

Wire protocol (src/server/tcl_server.c): the client sends a command line
terminated by 0x1A (ctrl-z); the server replies with the command result
followed by 0x1A.  `shutdown`/`exit` reply with a bare terminator and close
the connection.  Async notifications are disabled unless the client opts in,
so a strict request/response framing is safe.
"""

import socket
import threading

TERM = b"\x1a"


class TclError(Exception):
    """OpenOCD reported an error for the command."""


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

        Raises ConnectionError / TimeoutError / OSError on transport problems.
        """
        with self._lock:
            sock = self._sock
            if sock is None:
                raise ConnectionError("TCL 尚未连接")
            sock.settimeout(timeout)
            try:
                sock.sendall(cmd.encode("utf-8") + TERM)
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
                raise TimeoutError("TCL 命令超时: %s" % cmd.split()[0])
            except (ConnectionError, OSError):
                self._close_locked()
                raise
            text = resp.decode("utf-8", "replace")
            if text.endswith("\n"):
                text = text[:-1]
            if text.endswith("\r"):
                text = text[:-1]
            return text
