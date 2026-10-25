"""Locate the OpenOCD executable, its version, scripts dir and config scripts."""

import os
import re
import subprocess
import sys
from pathlib import Path

VERSION_RE = re.compile(r"Open On-Chip Debugger\s+(\S+)")

# Directories probed relative to the openocd executable for the scripts tree.
_SCRIPTS_REL = [
    "../share/openocd/scripts",   # official Windows / Linux install layout
    "../openocd/scripts",         # xPack layout
    "../scripts",
    "scripts",
    "../share/scripts",
]


def _creationflags():
    if sys.platform == "win32":
        return subprocess.CREATE_NO_WINDOW
    return 0


def find_openocd_candidates():
    """Return a de-duplicated list of existing openocd executables."""
    candidates = []

    def add(path):
        if path:
            path = os.path.normpath(os.path.abspath(path))
            if os.path.isfile(path) and path not in candidates:
                candidates.append(path)

    for name in ("openocd", "openocd.exe"):
        found = None
        try:
            import shutil
            found = shutil.which(name)
        except Exception:
            pass
        add(found)

    if sys.platform == "win32":
        pf = os.environ.get("ProgramFiles", r"C:\Program Files")
        pf86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
        local = os.environ.get("LOCALAPPDATA", "")
        home = os.environ.get("USERPROFILE", "")
        pats = [
            os.path.join(pf, "openocd", "bin", "openocd.exe"),
            os.path.join(pf, "OpenOCD", "bin", "openocd.exe"),
            os.path.join(pf86, "openocd", "bin", "openocd.exe"),
            r"C:\OpenOCD\bin\openocd.exe",
            r"C:\msys64\usr\bin\openocd.exe",
            r"C:\ProgramData\chocolatey\bin\openocd.exe",
        ]
        for base in (pf, pf86, local, home):
            if base:
                pats += [
                    os.path.join(base, "openocd*", "bin", "openocd.exe"),
                    os.path.join(base, "OpenOCD*", "bin", "openocd.exe"),
                    os.path.join(base, "xpack-openocd-*", "bin", "openocd.exe"),
                ]
        import glob
        for pat in pats:
            for hit in glob.glob(pat):
                add(hit)
    else:
        pats = [
            "/usr/bin/openocd", "/usr/local/bin/openocd",
            "/opt/openocd/bin/openocd",
        ]
        for p in pats:
            add(p)

    return candidates


def query_version(exe_path, timeout=5.0):
    """Return the version string of an openocd executable, or '' on failure."""
    try:
        proc = subprocess.run(
            [exe_path, "--version"], capture_output=True, timeout=timeout,
            creationflags=_creationflags(),
        )
        text = (proc.stdout or b"") + (proc.stderr or b"")
        text = text.decode("utf-8", "replace")
        m = VERSION_RE.search(text)
        if m:
            return m.group(1)
        first = text.strip().splitlines()
        return first[0] if first else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def guess_scripts_dir(exe_path):
    """Guess the OpenOCD scripts directory from the executable location."""
    if not exe_path:
        return ""
    exe = Path(exe_path).resolve().parent
    for rel in _SCRIPTS_REL:
        cand = (exe / rel).resolve()
        if cand.is_dir() and ((cand / "interface").is_dir() or (cand / "target").is_dir()):
            return str(cand)
    if sys.platform != "win32":
        for p in ("/usr/share/openocd/scripts", "/usr/local/share/openocd/scripts"):
            if os.path.isdir(os.path.join(p, "interface")):
                return p
    return ""


def scan_config_scripts(scripts_dir):
    """Scan a scripts dir; return {'interface': [...], 'target': [...], 'board': [...]}.

    Entries are script-relative POSIX paths (e.g. 'interface/stlink.cfg').
    """
    result = {"interface": [], "target": [], "board": []}
    if not scripts_dir or not os.path.isdir(scripts_dir):
        return result
    root = Path(scripts_dir)
    for category in result:
        basedir = root / category
        if not basedir.is_dir():
            continue
        files = []
        for dirpath, dirnames, filenames in os.walk(basedir):
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            for fn in sorted(filenames):
                if fn.endswith(".cfg"):
                    full = Path(dirpath) / fn
                    files.append(full.relative_to(root).as_posix())
        result[category] = sorted(files)
    return result
