"""
SensorGuard — Python Services Orchestrator
==========================================
Run this file to start all SensorGuard Python WebSocket services at once:

    python start_services.py

Services started:
  sensorDetector.py       → ws://127.0.0.1:8996  (Advanced sensor detection)
  background_apps_monitor.py → ws://127.0.0.1:8997  (Background window titles)
  screenTimeTracker.py    → ws://127.0.0.1:8998  (Screen-time tracking)
  browser_monitor.py      → ws://127.0.0.1:8999  (Browser detection & history)

Each service is restarted automatically if it exits unexpectedly.
Press Ctrl+C to stop all services.
"""

import os
import sys
import signal
import subprocess
import threading
import time

# ---------------------------------------------------------------------------
# Service definitions: (display label, script filename, port for logging)
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

SERVICES = [
    {"label": "SensorDetector",    "script": "sensorDetector.py",          "port": 8996},
    {"label": "BackgroundApps",    "script": "background_apps_monitor.py", "port": 8997},
    {"label": "ScreenTimeTracker", "script": "screenTimeTracker.py",        "port": 8998},
    {"label": "BrowserMonitor",    "script": "browser_monitor.py",          "port": 8999},
]

# ANSI color codes for terminal labels (cycles through the list)
_COLORS = ["\033[36m", "\033[33m", "\033[35m", "\033[34m"]  # cyan, yellow, magenta, blue
_RESET   = "\033[0m"
_BOLD    = "\033[1m"
_RED     = "\033[31m"
_GREEN   = "\033[32m"

# Minimum seconds to wait before restarting a crashed service
RESTART_DELAY = 3

# Global flag — set to True when Ctrl+C is received so restart loops can exit
_shutdown = threading.Event()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _colour(idx: int) -> str:
    return _COLORS[idx % len(_COLORS)]


def _tag(label: str, colour: str) -> str:
    return f"{_BOLD}{colour}[{label}]{_RESET} "


def _pipe_output(stream, prefix: str) -> None:
    """Read lines from *stream* and print them with *prefix*."""
    try:
        for line in iter(stream.readline, b""):
            if _shutdown.is_set():
                break
            text = line.decode("utf-8", errors="replace").rstrip()
            if text:
                print(f"{prefix}{text}", flush=True)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Process management
# ---------------------------------------------------------------------------

_processes: list[subprocess.Popen] = []
_processes_lock = threading.Lock()


def _launch(service: dict, colour: str) -> subprocess.Popen:
    """Start the service script as a subprocess and return the Popen object."""
    script_path = os.path.join(BASE_DIR, service["script"])
    cmd = [sys.executable, script_path]

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,   # merge stderr into stdout
        cwd=BASE_DIR,
    )

    prefix = _tag(service["label"], colour)

    # Pipe stdout/stderr in a background thread so we don't block
    t = threading.Thread(
        target=_pipe_output,
        args=(proc.stdout, prefix),
        daemon=True,
    )
    t.start()

    return proc


def _supervise(service: dict, colour: str) -> None:
    """
    Supervision loop for a single service.
    Starts the process, waits for it to finish, then restarts unless
    the global shutdown flag is set.
    """
    label = service["label"]
    prefix = _tag(label, colour)
    first_start = True

    while not _shutdown.is_set():
        if not first_start:
            print(
                f"{prefix}{_RED}exited — restarting in {RESTART_DELAY}s…{_RESET}",
                flush=True,
            )
            # Wait, but wake up early if shutdown is requested
            _shutdown.wait(timeout=RESTART_DELAY)
            if _shutdown.is_set():
                break

        first_start = False
        print(
            f"{prefix}{_GREEN}Starting {service['script']} (port {service['port']})…{_RESET}",
            flush=True,
        )

        try:
            proc = _launch(service, colour)
        except FileNotFoundError:
            print(
                f"{prefix}{_RED}ERROR: {service['script']} not found at {BASE_DIR}{_RESET}",
                flush=True,
            )
            _shutdown.wait(timeout=RESTART_DELAY)
            continue

        with _processes_lock:
            _processes.append(proc)

        proc.wait()  # block until this service exits

        with _processes_lock:
            if proc in _processes:
                _processes.remove(proc)

        if proc.returncode == 0:
            # Clean exit — don't restart
            print(f"{prefix}stopped cleanly.", flush=True)
            break


def _stop_all() -> None:
    """Terminate all running child processes."""
    _shutdown.set()
    with _processes_lock:
        procs = list(_processes)

    for proc in procs:
        if proc.poll() is None:
            try:
                proc.terminate()
            except Exception:
                pass

    # Give them a moment to exit, then force-kill stragglers
    deadline = time.time() + 5
    for proc in procs:
        remaining = max(0, deadline - time.time())
        try:
            proc.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            try:
                proc.kill()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Signal handling
# ---------------------------------------------------------------------------

def _handle_signal(signum, frame):
    """
    Handler for SIGINT (Ctrl+C) and SIGTERM.
    The *signum* and *frame* arguments are required by Python's signal.signal()
    interface even though they are not used here.
    """
    print(f"\n{_BOLD}[Orchestrator]{_RESET} Shutting down all services…", flush=True)
    _stop_all()


signal.signal(signal.SIGINT,  _handle_signal)
signal.signal(signal.SIGTERM, _handle_signal)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    print(
        f"\n{_BOLD}{'=' * 60}\n"
        f"  SensorGuard Python Services Orchestrator\n"
        f"{'=' * 60}{_RESET}\n",
        flush=True,
    )

    threads = []
    for idx, service in enumerate(SERVICES):
        colour = _colour(idx)
        t = threading.Thread(
            target=_supervise,
            args=(service, colour),
            daemon=True,
            name=f"supervisor-{service['label']}",
        )
        t.start()
        threads.append(t)

    print(
        f"{_BOLD}[Orchestrator]{_RESET} All {len(SERVICES)} services started. "
        f"Press {_BOLD}Ctrl+C{_RESET} to stop.\n",
        flush=True,
    )

    # Keep the main thread alive until all supervisors finish
    try:
        while any(t.is_alive() for t in threads):
            time.sleep(0.5)
    except KeyboardInterrupt:
        _handle_signal(signal.SIGINT, None)

    # Wait for supervisor threads to notice shutdown
    for t in threads:
        t.join(timeout=8)

    print(f"{_BOLD}[Orchestrator]{_RESET} All services stopped.", flush=True)


if __name__ == "__main__":
    main()
