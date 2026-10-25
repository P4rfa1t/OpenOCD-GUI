"""Parsers for OpenOCD command output (formats verified against 0.12.0+dev source)."""

import re

# --------------------------------------------------------------------------
# targets  (src/target/target.c handle_targets_command)
#   " 0* stm32f4x.cpu       cortex_m   little stm32f4x.cpu      halted"
# --------------------------------------------------------------------------
_TARGETS_ROW = re.compile(
    r"^\s*(\d+)(.)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+?)\s*$")


def parse_targets(text):
    rows = []
    for line in text.splitlines():
        m = _TARGETS_ROW.match(line)
        if not m:
            continue
        rows.append({
            "id": int(m.group(1)),
            "current": m.group(2) == "*",
            "name": m.group(3),
            "type": m.group(4),
            "endian": m.group(5),
            "tap": m.group(6),
            "state": m.group(7),
        })
    return rows


# --------------------------------------------------------------------------
# reg  (handle_reg_command, no args)
#   "===== core"
#   "(0) r0 (/32): 0x21"
#   "(1) r1 (/32): 0x0 (dirty)"
#   "(2) xPSR (/32)"
# --------------------------------------------------------------------------
_REG_GROUP = re.compile(r"^=+\s*(.*?)\s*$")
_REG_ROW = re.compile(
    r"^\((\d+)\)\s+(\S+)\s+\(/(\d+)\)\s*(?::\s*(\S+))?\s*(\(dirty\))?\s*$")


def parse_regs(text):
    """Return (regs, error). regs: list of dicts."""
    regs = []
    group = ""
    for line in text.splitlines():
        line = line.rstrip()
        if not line:
            continue
        if line.lstrip().startswith("Error"):
            return [], line.strip()
        if line.startswith("="):
            m = _REG_GROUP.match(line)
            group = m.group(1).strip("= \t") if m else ""
            continue
        m = _REG_ROW.match(line)
        if m:
            regs.append({
                "num": int(m.group(1)),
                "group": group,
                "name": m.group(2),
                "size": int(m.group(3)),
                "value": m.group(4) or "",
                "dirty": bool(m.group(5)),
            })
    if not regs and text.strip():
        return [], text.strip().splitlines()[0]
    return regs, ""


def pad_hex_value(value, size_bits):
    """OpenOCD prints register values without leading zeros; pad for display."""
    if not value:
        return ""
    try:
        digits = max(1, size_bits // 4)
        return "0x" + value[2:].lower().rjust(digits, "0")
    except Exception:
        return value


# --------------------------------------------------------------------------
# mdw / mdh / mdb / mdd  (target_handle_md_output)
#   "0x08000000: 20001234 080001a2 ..."
# --------------------------------------------------------------------------
_MD_LINE = re.compile(r"^(0x[0-9a-fA-F]+):\s*(.*)$")


def parse_md(text):
    """Return list of (addr:int, [value:int, ...]) rows."""
    rows = []
    for line in text.splitlines():
        m = _MD_LINE.match(line.strip())
        if not m:
            continue
        try:
            addr = int(m.group(1), 16)
            values = [int(v, 16) for v in m.group(2).split()]
        except ValueError:
            continue
        if values:
            rows.append((addr, values))
    return rows


# --------------------------------------------------------------------------
# bp  (handle_bp_command_list)
#   "Hardware breakpoint(IVA): addr=0x8000198, len=0x2, num=1"
#   "Software breakpoint(IVA): addr=0x8000198, len=0x2, orig_instr=0xd102"
#   "Context breakpoint: asid=0x00000001, len=0x2, num=2"
# --------------------------------------------------------------------------
_BP_ROW = re.compile(
    r"^(Software|Hardware|Context|Hybrid)\s+breakpoint(?:\(IVA\))?\s*:\s*(.*)$",
    re.IGNORECASE)
_KV = re.compile(r"(\w+)=('(?:[^']*)'|(?:[^,]*))")


def parse_breakpoints(text):
    out = []
    for line in text.splitlines():
        m = _BP_ROW.match(line.strip())
        if not m:
            continue
        btype = m.group(1).lower()
        props = dict(_KV.findall(m.group(2)))
        out.append({
            "type": btype,
            "addr": props.get("addr", ""),
            "asid": props.get("asid", ""),
            "len": props.get("len", ""),
            "num": props.get("num", ""),
            "orig_instr": props.get("orig_instr", ""),
            "raw": line.strip(),
        })
    return out


# --------------------------------------------------------------------------
# wp  (handle_wp_command with no args)
#   "address: 0x20000000, len: 0x00000004, r/w/a: w, value: 0x00000000, mask: 0x00000000"
# --------------------------------------------------------------------------
_WP_ROW = re.compile(
    r"^address:\s*(0x[0-9a-fA-F]+),\s*len:\s*(0x[0-9a-fA-F]+),\s*"
    r"r/w/a:\s*(\S+?),\s*value:\s*(0x[0-9a-fA-F]+),\s*mask:\s*(0x[0-9a-fA-F]+)")


def parse_watchpoints(text):
    out = []
    for line in text.splitlines():
        m = _WP_ROW.match(line.strip())
        if m:
            out.append({
                "addr": m.group(1),
                "len": m.group(2),
                "rw": m.group(3),
                "value": m.group(4),
                "mask": m.group(5),
            })
    return out


# --------------------------------------------------------------------------
# flash banks  (handle_flash_banks_command)
#   "#0 : stm32f4x.flash (stm32f4x) at 0x08000000, size 0x00100000, buswidth 4, chipwidth 0"
# --------------------------------------------------------------------------
_BANK_ROW = re.compile(
    r"^#(\d+)\s*:\s*(\S+)\s+\((\S+)\)\s+at\s+(0x[0-9a-fA-F]+),\s*"
    r"size\s+(0x[0-9a-fA-F]+),\s*buswidth\s+(\d+),\s*chipwidth\s+(\d+)")


def parse_flash_banks(text):
    out = []
    for line in text.splitlines():
        m = _BANK_ROW.match(line.strip())
        if m:
            out.append({
                "num": int(m.group(1)),
                "name": m.group(2),
                "driver": m.group(3),
                "base": m.group(4),
                "size": m.group(5),
                "buswidth": m.group(6),
                "chipwidth": m.group(7),
            })
    return out


# --------------------------------------------------------------------------
# Log line classification:  "Info : ...", "Error: ...", "Debug: 12 3 file:..."
# --------------------------------------------------------------------------
_LOG_LEVEL = re.compile(r"^\s*(Debug|Info|User|Error|Warning)\s*:", re.IGNORECASE)


def classify_log_line(line):
    m = _LOG_LEVEL.match(line)
    if not m:
        return "raw"
    return m.group(1).lower()
