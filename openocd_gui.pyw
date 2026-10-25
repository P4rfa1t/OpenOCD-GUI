#!/usr/bin/env python3
"""Double-click launcher for Windows (runs with pythonw, no console window)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# If a console interpreter was used to run this .pyw (e.g. a broken file
# association pointing at python.exe), hide that console window. Use run.py
# when you deliberately want a console for debugging output.
if sys.platform == "win32" and sys.executable.lower().endswith("python.exe"):
    try:
        import ctypes
        hwnd = ctypes.windll.kernel32.GetConsoleWindow()
        if hwnd:
            ctypes.windll.user32.ShowWindow(hwnd, 0)  # SW_HIDE
    except Exception:
        pass

from openocd_gui.app import main

if __name__ == "__main__":
    main(sys.argv[1:])
