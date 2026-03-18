"""
SensorGuard — Context Builder
==============================
Assembles a rich context object from every available signal at the
moment of sensor detection.  This context is sent to the AI risk
agent and later stored in the training database.
"""

import psutil
import win32gui
import win32process
from datetime import datetime


KNOWN_LEGITIMATE_PROCESSES = [
    "chrome.exe", "msedge.exe", "brave.exe", "firefox.exe",
    "zoom.exe", "ms-teams.exe", "slack.exe", "discord.exe",
    "skype.exe", "webex.exe", "explorer.exe", "obs64.exe",
    "vlc.exe", "spotify.exe", "code.exe", "notepad.exe",
]


def build_sensor_context(
    sensor_type: str,
    process_name: str,
    exe_path: str | None,
    website: str | None,
    active_sensors: list[str],
    user_idle_seconds: int,
    access_duration_seconds: int,
    first_seen_today: bool,
) -> dict:
    """Build a rich context dict describing a sensor access event."""
    now = datetime.now()
    is_foreground = check_if_foreground(process_name)
    process_known = process_name.lower() in [
        p.lower() for p in KNOWN_LEGITIMATE_PROCESSES
    ]

    return {
        "sensor_type": sensor_type,
        "process_name": process_name,
        "exe_path": exe_path,
        "website": website,
        "is_known_process": process_known,
        "is_foreground": is_foreground,
        "user_idle_seconds": user_idle_seconds,
        "simultaneous_sensors": active_sensors,
        "simultaneous_sensor_count": len(active_sensors),
        "access_duration_seconds": access_duration_seconds,
        "first_seen_today": first_seen_today,
        "hour_of_day": now.hour,
        "day_of_week": now.strftime("%A"),
        "is_business_hours": 8 <= now.hour <= 20,
        "timestamp": now.isoformat(),
        "is_background_access": (
            not is_foreground and user_idle_seconds > 30
        ),
        "is_multi_sensor_event": len(active_sensors) > 1,
        "is_suspicious_time": now.hour < 6 or now.hour > 23,
    }


def check_if_foreground(process_name: str) -> bool:
    """Check whether *process_name* owns the current foreground window."""
    try:
        hwnd = win32gui.GetForegroundWindow()
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        proc = psutil.Process(pid)
        return proc.name().lower() == process_name.lower()
    except Exception:
        return False
