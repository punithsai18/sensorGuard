"""
Shared port utilities for SensorGuard Python services.

Provides robust port cleanup before binding WebSocket servers.
"""

import logging
import socket
import time

import psutil

logger = logging.getLogger(__name__)


def kill_port_holder(port: int) -> None:
    """
    Kill any process currently listening on *port*, then wait until
    the port is actually free (up to ~5 seconds total).

    Safe to call even if nothing occupies the port.
    """
    killed = False
    try:
        for conn in psutil.net_connections(kind='inet'):
            if (conn.laddr
                    and conn.laddr.port == port
                    and conn.status == 'LISTEN'):
                try:
                    proc = psutil.Process(conn.pid)
                    name = proc.name()
                    logger.warning(
                        "Killing stale process %s (PID %d) on port %d",
                        name, conn.pid, port,
                    )
                    proc.kill()
                    proc.wait(timeout=5)
                    killed = True
                except (psutil.NoSuchProcess, psutil.AccessDenied,
                        psutil.TimeoutExpired):
                    pass
    except Exception as exc:
        logger.warning("Could not enumerate connections for port %d: %s",
                       port, exc)

    # After killing, the OS may still hold the socket in TIME_WAIT.
    # Poll until the port is genuinely free.
    if killed:
        _wait_for_port_free(port, timeout=5)


def _wait_for_port_free(port: int, timeout: float = 5) -> None:
    """Block until *port* can be bound on 127.0.0.1, or *timeout* elapses."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                s.bind(("127.0.0.1", port))
                # Successfully bound → port is free
                return
        except OSError:
            time.sleep(0.3)
    logger.warning("Port %d still occupied after %.1fs — proceeding anyway",
                   port, timeout)
