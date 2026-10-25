#!/usr/bin/env python3
"""OpenOCD-GUI — PySide6 port. Run: python ports/pyside6/run_qt.py"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PySide6.QtWidgets import QApplication
from openocd_gui_qt.mainwindow import MainWindow


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    app = QApplication(argv)
    app.setApplicationName("OpenOCD-GUI (PySide6)")
    win = MainWindow(argv)
    win.show()
    if "--smoke" in argv:
        from PySide6.QtCore import QTimer
        QTimer.singleShot(1800, app.quit)
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
