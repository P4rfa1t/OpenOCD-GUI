"""Settings + connection profile persistence (JSON files under ~/.openocd_gui)."""

import json
import os
from pathlib import Path

APP_DIR = Path.home() / ".openocd_gui"
PROFILES_DIR = APP_DIR / "profiles"
SETTINGS_FILE = APP_DIR / "settings.json"

DEFAULTS = {
    # OpenOCD executable and scripts
    "openocd_path": "",
    "scripts_dir": "",
    "search_paths": [],          # extra -s directories
    # Startup configuration
    "configs": [],               # ordered list of cfg files (script-relative or absolute)
    "extra_commands": [],        # extra -c commands, executed after configs
    "debug_level": 0,            # 0 = default (no -d flag), 1..4 = -d<n>
    "log_file": "",              # optional -l log redirect
    # Server ports / bind address
    "bind": "127.0.0.1",
    "gdb_port": 3333,
    "tcl_port": 6666,
    "telnet_port": 4444,
    # External GDB launcher
    "gdb_path": "arm-none-eabi-gdb",
    "gdb_args": '-ex "target remote localhost:3333"',
    # Polling
    "auto_poll": True,
    "poll_interval_ms": 1000,
    "auto_refresh_regs": True,
    # Misc
    "window_geometry": "",
}

# Keys stored inside a named profile (everything except window layout).
PROFILE_KEYS = [
    "openocd_path", "scripts_dir", "search_paths", "configs", "extra_commands",
    "debug_level", "log_file", "bind", "gdb_port", "tcl_port", "telnet_port",
    "gdb_path", "gdb_args",
]


class Settings:
    """Dict-like wrapper with load/save."""

    def __init__(self):
        self.data = dict(DEFAULTS)
        self.load()

    # -- dict interface ----------------------------------------------------
    def __getitem__(self, key):
        return self.data[key]

    def __setitem__(self, key, value):
        if key not in DEFAULTS:
            raise KeyError("unknown setting: %s" % key)
        self.data[key] = value

    def get(self, key, default=None):
        return self.data.get(key, default)

    # -- persistence -------------------------------------------------------
    def load(self):
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                stored = json.load(f)
            for k in DEFAULTS:
                if k in stored:
                    self.data[k] = stored[k]
        except (OSError, ValueError):
            pass

    def save(self):
        try:
            APP_DIR.mkdir(parents=True, exist_ok=True)
            with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
                json.dump(self.data, f, ensure_ascii=False, indent=2)
        except OSError:
            pass

    def profile_subset(self):
        return {k: self.data[k] for k in PROFILE_KEYS}

    def apply_profile(self, subset):
        for k in PROFILE_KEYS:
            if k in subset:
                self.data[k] = subset[k]


def _safe_name(name):
    return "".join(c for c in name if c not in '\\/:*?"<>|').strip()


def list_profiles():
    try:
        return sorted(p.stem for p in PROFILES_DIR.glob("*.json"))
    except OSError:
        return []


def save_profile(name, subset):
    name = _safe_name(name)
    if not name:
        raise ValueError("empty profile name")
    PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    path = PROFILES_DIR / (name + ".json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(subset, f, ensure_ascii=False, indent=2)
    return name


def load_profile(name):
    path = PROFILES_DIR / (_safe_name(name) + ".json")
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def delete_profile(name):
    path = PROFILES_DIR / (_safe_name(name) + ".json")
    try:
        path.unlink(missing_ok=True)
        return True
    except OSError:
        return False
