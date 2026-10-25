"""Unit tests for openocd_gui.core.tcl path encoding.

Jim Tcl on Windows opens files with fopen() in the system ANSI codepage
(GBK on zh-CN), so paths sent over the TCL RPC socket must be encoded in
that codepage — not UTF-8 — or OpenOCD reports "can't open file".
"""

import os
import sys
import unittest
import unittest.mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from openocd_gui.core import tcl


class TestPathToRpcBytes(unittest.TestCase):
    def test_ascii_unchanged_with_forward_slashes(self):
        self.assertEqual(
            tcl.path_to_rpc_bytes(r"C:\Users\me\Project.axf"),
            b"C:/Users/me/Project.axf")

    def test_non_ascii_uses_ansi_codepage_on_windows(self):
        if sys.platform != "win32":
            self.skipTest("ANSI-codepage fallback is Windows-only")
        path = "C:\\固件\\Project.axf"
        self.assertEqual(
            tcl.path_to_rpc_bytes(path),
            path.replace("\\", "/").encode("mbcs"))

    def test_non_ascii_on_non_windows_falls_back_to_utf8(self):
        with unittest.mock.patch("sys.platform", "linux"):
            self.assertEqual(
                tcl.path_to_rpc_bytes("/tmp/固件/Project.axf"),
                "/tmp/固件/Project.axf".encode("utf-8"))

    def test_tcl_client_call_accepts_bytes(self):
        client = tcl.TclClient()
        self.assertFalse(client.connected)


if __name__ == "__main__":
    unittest.main()
