#!/usr/bin/env python3
"""Double-click launcher for Windows (runs with pythonw, no console window)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from openocd_gui.app import main

if __name__ == "__main__":
    main(sys.argv[1:])
