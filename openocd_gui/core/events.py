"""Thread-safe event bus used to push data from worker threads to the UI."""

import queue

# Event kinds
LOG = "log"                  # payload: str  (one raw OpenOCD log line)
SERVER_STATE = "server_state"  # payload: (state, detail)   state: str
TCL_STATE = "tcl_state"      # payload: bool (connected)
TARGETS = "targets"          # payload: list of target row dicts
NOTIFY = "notify"            # payload: (is_error, message)

SERVER_STOPPED = "stopped"
SERVER_STARTING = "starting"
SERVER_RUNNING = "running"
SERVER_STOPPING = "stopping"
SERVER_FAILED = "failed"


class EventBus:
    """Producer: any thread. Consumer: the UI pump in the main thread."""

    def __init__(self):
        self._q = queue.Queue()

    def emit(self, kind, payload=None):
        self._q.put((kind, payload))

    def drain(self, limit=500):
        items = []
        for _ in range(limit):
            try:
                items.append(self._q.get_nowait())
            except queue.Empty:
                break
        return items
