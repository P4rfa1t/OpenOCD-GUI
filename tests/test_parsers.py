"""Unit tests for openocd_gui.core.parsers and build_command.

All sample outputs below are taken from / verified against OpenOCD
0.12.0+dev source code (src/target/target.c, src/target/breakpoints.c,
src/flash/nor/tcl.c, src/server/tcl_server.c).
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from openocd_gui.core.parsers import (
    parse_targets, parse_regs, pad_hex_value, parse_md,
    parse_breakpoints, parse_watchpoints, parse_flash_banks,
    classify_log_line,
)
from openocd_gui.core.openocd import build_command

TARGETS_SAMPLE = """    TargetName         Type       Endian TapName            State
--  ------------------ ---------- ------ ------------------ ------------
 0* stm32f4x.cpu       cortex_m   little stm32f4x.cpu      halted
 1  cortex_a.cpu       cortex_a   little foo.tap           running
"""

REGS_SAMPLE = """===== core
(0) r0 (/32): 0x2000ff70
(1) r1 (/32): 0x0
(2) r2 (/32): 0x1 (dirty)
(3) xPSR (/32)
===== float
(19) fpscr (/32): 0x0
"""

MDW_SAMPLE = """0x08000000: 20001234 080001a2 00000000 00000000 00000000 00000000 00000000 00000000
0x08000020: deadbeef 12345678 00000000 00000000 00000000 00000000 00000000 00000000
"""

BP_SAMPLE = """Hardware breakpoint(IVA): addr=0x8000198, len=0x2, num=1
Software breakpoint(IVA): addr=0x8000300, len=0x2, orig_instr=0xd102
Context breakpoint: asid=0x00000001, len=0x2, num=2
"""

WP_SAMPLE = """address: 0x20000000, len: 0x00000004, r/w/a: w, value: 0x00000000, mask: 0x00000000
address: 0x20000010, len: 0x00000001, r/w/a: a, value: 0x000000ff, mask: 0x000000ff
"""

BANKS_SAMPLE = """#0 : stm32f4x.flash (stm32f4x) at 0x08000000, size 0x00100000, buswidth 4, chipwidth 0
#1 : stm32f4x.options (stm32f4x) at 0x1fffc000, size 0x00000010, buswidth 4, chipwidth 0
"""


class TestTargets(unittest.TestCase):
    def test_parse(self):
        rows = parse_targets(TARGETS_SAMPLE)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["name"], "stm32f4x.cpu")
        self.assertTrue(rows[0]["current"])
        self.assertEqual(rows[0]["state"], "halted")
        self.assertEqual(rows[0]["type"], "cortex_m")
        self.assertEqual(rows[0]["endian"], "little")
        self.assertFalse(rows[1]["current"])
        self.assertEqual(rows[1]["state"], "running")

    def test_empty(self):
        self.assertEqual(parse_targets(""), [])
        self.assertEqual(parse_targets("Target: bogus is unknown"), [])


class TestRegs(unittest.TestCase):
    def test_parse(self):
        regs, err = parse_regs(REGS_SAMPLE)
        self.assertEqual(err, "")
        self.assertEqual(len(regs), 5)
        self.assertEqual(regs[0]["name"], "r0")
        self.assertEqual(regs[0]["value"], "0x2000ff70")
        self.assertEqual(regs[0]["size"], 32)
        self.assertEqual(regs[0]["group"], "core")
        self.assertFalse(regs[0]["dirty"])
        self.assertTrue(regs[2]["dirty"])
        self.assertEqual(regs[3]["value"], "")  # invalid / no value
        self.assertEqual(regs[4]["group"], "float")

    def test_error(self):
        regs, err = parse_regs("Error: [stm32f4x.cpu] not examined")
        self.assertEqual(regs, [])
        self.assertIn("not examined", err)

    def test_pad_hex(self):
        self.assertEqual(pad_hex_value("0x21", 32), "0x00000021")
        self.assertEqual(pad_hex_value("0x61000000", 32), "0x61000000")
        self.assertEqual(pad_hex_value("", 32), "")


class TestMd(unittest.TestCase):
    def test_parse(self):
        rows = parse_md(MDW_SAMPLE)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0][0], 0x08000000)
        self.assertEqual(rows[0][1][0], 0x20001234)
        self.assertEqual(rows[1][0], 0x08000020)
        self.assertEqual(rows[1][1][0], 0xdeadbeef)
        self.assertEqual(len(rows[0][1]), 8)

    def test_empty(self):
        self.assertEqual(parse_md("some error text"), [])


class TestBreakpoints(unittest.TestCase):
    def test_parse(self):
        bps = parse_breakpoints(BP_SAMPLE)
        self.assertEqual(len(bps), 3)
        self.assertEqual(bps[0]["type"], "hardware")
        self.assertEqual(bps[0]["addr"], "0x8000198")
        self.assertEqual(bps[0]["len"], "0x2")
        self.assertEqual(bps[1]["type"], "software")
        self.assertEqual(bps[1]["orig_instr"], "0xd102")
        self.assertEqual(bps[2]["asid"], "0x00000001")
        self.assertEqual(bps[2]["addr"], "")


class TestWatchpoints(unittest.TestCase):
    def test_parse(self):
        wps = parse_watchpoints(WP_SAMPLE)
        self.assertEqual(len(wps), 2)
        self.assertEqual(wps[0]["addr"], "0x20000000")
        self.assertEqual(wps[0]["rw"], "w")
        self.assertEqual(wps[1]["rw"], "a")
        self.assertEqual(wps[1]["len"], "0x00000001")


class TestFlashBanks(unittest.TestCase):
    def test_parse(self):
        banks = parse_flash_banks(BANKS_SAMPLE)
        self.assertEqual(len(banks), 2)
        self.assertEqual(banks[0]["num"], 0)
        self.assertEqual(banks[0]["name"], "stm32f4x.flash")
        self.assertEqual(banks[0]["driver"], "stm32f4x")
        self.assertEqual(banks[0]["base"], "0x08000000")
        self.assertEqual(banks[0]["size"], "0x00100000")


class TestClassifyLog(unittest.TestCase):
    def test_levels(self):
        self.assertEqual(classify_log_line("Info : Listening on port 6666"), "info")
        self.assertEqual(classify_log_line("Error: libusb_open() failed"), "error")
        self.assertEqual(classify_log_line("Warning: blah"), "warning")
        self.assertEqual(classify_log_line("Debug: 46 107 target.c:..."), "debug")
        self.assertEqual(classify_log_line("Open On-Chip Debugger 0.12.0"), "raw")


class TestBuildCommand(unittest.TestCase):
    BASE = {
        "openocd_path": "/usr/bin/openocd",
        "scripts_dir": "/usr/share/openocd/scripts",
        "search_paths": [],
        "configs": ["interface/stlink.cfg", "target/stm32f4x.cfg"],
        "extra_commands": ["adapter speed 3000"],
        "debug_level": 0,
        "log_file": "",
        "bind": "127.0.0.1",
        "gdb_port": 3333,
        "tcl_port": 6666,
        "telnet_port": 4444,
    }

    def test_basic(self):
        args = build_command(self.BASE)
        self.assertEqual(args[0], "/usr/bin/openocd")
        self.assertIn("-s", args)
        self.assertEqual(args[args.index("-s") + 1], "/usr/share/openocd/scripts")
        # ports must be set before config files
        self.assertLess(args.index("gdb port 3333"), args.index("-f"))
        self.assertIn("-f", args)
        self.assertEqual(args[args.index("-f") + 1], "interface/stlink.cfg")
        self.assertIn("-c", args)
        self.assertIn("adapter speed 3000", args)
        self.assertNotIn("-d4", args)

    def test_debug_level_and_bind(self):
        cfg = dict(self.BASE, debug_level=4, bind="0.0.0.0")
        args = build_command(cfg)
        self.assertIn("-d4", args)
        self.assertIn("bindto 0.0.0.0", args)

    def test_default_bind_not_passed(self):
        args = build_command(self.BASE)
        self.assertNotIn("bindto 127.0.0.1", args)

    def test_missing_exe(self):
        cfg = dict(self.BASE, openocd_path="")
        with self.assertRaises(ValueError):
            build_command(cfg)


if __name__ == "__main__":
    unittest.main()
