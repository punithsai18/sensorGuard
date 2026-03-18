import asyncio
import json
import logging
import os
import glob
import time
from datetime import datetime
import sqlite3
import psutil
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import websockets
from websockets.http11 import Response
from websockets.datastructures import Headers
from port_utils import kill_port_holder

try:
    from timeline_logger import log_event
except ImportError:
    def log_event(*args, **kwargs): pass

try:
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32
    IS_WINDOWS = True
except Exception:
    IS_WINDOWS = False

# Ensure websockets and its exceptions are available
try:
    import websockets
    from websockets.exceptions import ConnectionClosed
except ImportError:
    try:
        from websockets import ConnectionClosed
    except ImportError:
        ConnectionClosed = Exception

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ScreenTimeTracker")

DB_PATH = os.path.join(os.path.dirname(__file__), "screen_time.db")

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    # Check if we need to migrate
    cursor.execute("PRAGMA table_info(screen_time_sessions)")
    columns = [c[1] for c in cursor.fetchall()]
    
    # If the old schema is detected (it has 'total_seconds' but not 'timestamp')
    if columns and "total_seconds" in columns and "timestamp" not in columns:
        logger.info("Detected old Screen Time schema. Migrating to session-based format...")
        try:
            cursor.execute("DROP TABLE screen_time_sessions")
            conn.commit()
        except Exception as e:
            logger.error(f"Migration error: {e}")

    conn.execute("""
        CREATE TABLE IF NOT EXISTS screen_time_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            app_name TEXT,
            duration_seconds INTEGER,
            exe_path TEXT
        )
    """)
    # Migration: Add exe_path if it doesn't exist
    try:
        cursor.execute("PRAGMA table_info(screen_time_sessions)")
        cols = [c[1] for c in cursor.fetchall()]
        if "exe_path" not in cols:
            cursor.execute("ALTER TABLE screen_time_sessions ADD COLUMN exe_path TEXT")
            conn.commit()
            logger.info("Migrated screen_time_sessions to include exe_path column.")
    except Exception as e:
        logger.error(f"Migration error (exe_path): {e}")

    conn.execute("""
        CREATE TABLE IF NOT EXISTS timeline_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            event_type TEXT,
            event_source TEXT,
            event_detail TEXT
        )
    """)
    conn.commit()
    conn.close()

init_db()

# BROWSER CONFIGURATIONS FOR WATCHDOG
BROWSER_PREFS = {
    "Chrome": [
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\User Data\Default\Preferences"),
        os.path.expanduser(r"~/Library/Application Support/Google/Chrome/Default/Preferences"),
        os.path.expanduser(r"~/.config/google-chrome/Default/Preferences")
    ],
    "Edge": [
        os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\Edge\User Data\Default\Preferences"),
        os.path.expanduser(r"~/Library/Application Support/Microsoft Edge/Default/Preferences"),
        os.path.expanduser(r"~/.config/microsoft-edge/Default/Preferences")
    ],
    "Brave": [
        os.path.expandvars(r"%LOCALAPPDATA%\BraveSoftware\Brave-Browser\User Data\Default\Preferences"),
        os.path.expanduser(r"~/Library/Application Support/BraveSoftware/Brave-Browser/Default/Preferences"),
        os.path.expanduser(r"~/.config/BraveSoftware/Brave-Browser/Default/Preferences")
    ],
    "Opera": [
        os.path.expandvars(r"%APPDATA%\Opera Software\Opera Stable\Preferences"),
        os.path.expanduser(r"~/Library/Application Support/com.operasoftware.Opera/Preferences"),
        os.path.expanduser(r"~/.config/opera/Preferences")
    ],
    "Vivaldi": [
        os.path.expandvars(r"%LOCALAPPDATA%\Vivaldi\User Data\Default\Preferences"),
        os.path.expanduser(r"~/Library/Application Support/Vivaldi/Default/Preferences"),
        os.path.expanduser(r"~/.config/vivaldi/Default/Preferences")
    ]
}

clients = set()
last_db_write = time.time()
last_active_app = None
LATEST_DATA = {"event": "screen_time", "date": datetime.now().strftime("%Y-%m-%d"), "data": []}


# WATCHDOG FOR PREFERENCES
class PrefsFileHandler(FileSystemEventHandler):
    def __init__(self, browser_name, file_path, loop):
        self.browser_name = browser_name
        self.file_path = os.path.normpath(file_path)
        self.loop = loop

    def on_modified(self, event):
        if not event.is_directory and os.path.normpath(event.src_path) == self.file_path:
            asyncio.run_coroutine_threadsafe(self.notify_clients(), self.loop)
            
    async def notify_clients(self):
        msg = json.dumps({"event": "permissions_changed", "browser": self.browser_name})
        for ws in list(clients):
            try: await ws.send(msg)
            except: pass

def start_prefs_watchers(loop, observer):
    watched_dirs = set()
    for name, paths in BROWSER_PREFS.items():
        for p in paths:
            matches = glob.glob(p)
            for m in matches:
                if os.path.exists(m):
                    dir_to_watch = os.path.dirname(m)
                    if dir_to_watch not in watched_dirs:
                        handler = PrefsFileHandler(name, m, loop)
                        observer.schedule(handler, dir_to_watch, recursive=False)
                        watched_dirs.add(dir_to_watch)
                        logger.info(f"Watching {name} prefs at {m}")

def get_idle_time_windows():
    if not IS_WINDOWS:
        return 0
    try:
        class LASTINPUTINFO(ctypes.Structure):
            _fields_ = [("cbSize", ctypes.c_uint), ("dwTime", ctypes.c_uint)]
        lii = LASTINPUTINFO()
        lii.cbSize = ctypes.sizeof(LASTINPUTINFO)
        user32.GetLastInputInfo(ctypes.byref(lii))
        millis = kernel32.GetTickCount() - lii.dwTime
        return millis / 1000.0
    except:
        return 0

def get_active_window_info():
    if not IS_WINDOWS:
        # Dummy fallback for non-windows
        return "Unknown OS", "Unknown Window", 0, None
    
    try:
        hwnd = user32.GetForegroundWindow()
        if not hwnd: return None, None, 0
        
        pid = ctypes.c_ulong()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        
        length = user32.GetWindowTextLengthW(hwnd)
        buff = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buff, length + 1)
        title = buff.value
        
        try:
            p = psutil.Process(pid.value)
            name = p.name()
            exe_path = p.exe()
        except:
            name = "Unknown"
            exe_path = None
        return name, title, pid.value, exe_path
    except:
        return None, None, 0, None

def clean_app_name(name, title):
    if not name: return "Unknown"
    lower_name = name.lower()
    
    if 'chrome' in lower_name: return 'Google Chrome'
    if 'msedge' in lower_name: return 'Microsoft Edge'
    if 'firefox' in lower_name: return 'Firefox'
    if 'brave' in lower_name: return 'Brave Browser'
    if 'opera' in lower_name: return 'Opera'
    if 'explorer' in lower_name: return 'File Explorer'
    if 'code' in lower_name: return 'VS Code'
    if 'discord' in lower_name: return 'Discord'
    if 'whatsapp' in lower_name: return 'WhatsApp'
    if 'terminal' in lower_name or 'cmd' in lower_name or 'powershell' in lower_name: return 'Terminal'
    
    return name.replace('.exe', '')

def get_website_from_title(app_name, title):
    if not title: return None
    if app_name in ['Google Chrome', 'Microsoft Edge', 'Brave', 'Firefox', 'Opera']:
        parts = title.rsplit(' - ', 1)
        if len(parts) > 1:
            site = parts[0]
            # remove notifications count like (1) 
            import re
            site = re.sub(r'^\(\d+\)\s*', '', site)
            return site
    return None

screen_time_buffer = {}  # Key: (ts_minute, record_name, exe_path), Value: seconds

def flush_screen_time_buffer_sync():
    global screen_time_buffer
    if not screen_time_buffer:
        return
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        # Create a copy to avoid mutation during threading
        current_items = list(screen_time_buffer.items())
        for (ts, record_name, exe_path), seconds in current_items:
            cursor.execute("""
                INSERT INTO screen_time_sessions (timestamp, app_name, duration_seconds, exe_path)
                VALUES (?, ?, ?, ?)
            """, (ts, record_name, seconds, exe_path))
        conn.commit()
        conn.close()
        
        # Clear the items we just wrote
        for key, _ in current_items:
            if key in screen_time_buffer:
                del screen_time_buffer[key]
    except Exception as e:
        logger.error(f"Error storing screen time: {e}")

async def screen_time_loop():
    global last_db_write, last_active_app, LATEST_DATA
    while True:
        await asyncio.sleep(1)
        # Use to_thread for the blocking OS calls
        idle_time = await asyncio.to_thread(get_idle_time_windows) if IS_WINDOWS else 0
        if idle_time > 60:
            if last_active_app:
                # User went idle
                asyncio.create_task(asyncio.to_thread(log_event, "SYSTEM", "User State", "User is now idle"))
                last_active_app = None
            continue  # User is idle, don't count
            
        res = await asyncio.to_thread(get_active_window_info)
        if not res or not res[0]: continue
        app_exe, title, pid, exe_path = res
        
        app_name = clean_app_name(app_exe, title)
        website = get_website_from_title(app_name, title)
        
        record_name = app_name
        if website:
            record_name = f"{app_name}::{website}"
            
        # Log focus change to timeline
        current_focus = record_name if not website else f"{app_name} ({website})"
        if current_focus != last_active_app:
            asyncio.create_task(asyncio.to_thread(log_event, "APP", app_name, f"Focused on: {title or app_name}"))
            last_active_app = current_focus

        # Use a timestamp rounded to the minute for the buffer key
        now = datetime.now()
        ts_minute = now.strftime("%Y-%m-%d %H:%M:00")
        
        key = (ts_minute, record_name, exe_path)
        screen_time_buffer[key] = screen_time_buffer.get(key, 0) + 1
        
        # Write to database periodically
        if time.time() - last_db_write >= 15:
            await asyncio.to_thread(flush_screen_time_buffer_sync)
            # Update cache after flush
            today, data = await asyncio.to_thread(get_screen_time_data_sync)
            LATEST_DATA = {"event": "screen_time", "date": today, "data": data}
            last_db_write = time.time()

def get_screen_time_data_sync():
    conn = sqlite3.connect(DB_PATH)
    today = datetime.now().strftime("%Y-%m-%d")
    # Aggregate by app_name for the real-time daily view
    query = """
        SELECT app_name, SUM(duration_seconds), MAX(timestamp), exe_path
        FROM screen_time_sessions 
        WHERE date(timestamp) = ? 
        GROUP BY app_name 
        ORDER BY SUM(duration_seconds) DESC
    """
    rows = conn.execute(query, (today,)).fetchall()
    data = [{"app": r[0], "time": r[1], "last_seen": r[2], "exe_path": r[3]} for r in rows]
    
    # PART 3: ADD ICONS TO RESPONSE
    # (Since this is Python, we can call it directly)
    try:
        from backend.icon_extractor import get_app_icon
        for entry in data:
            entry["icon"] = get_app_icon(entry["app"], entry["exe_path"])
    except ImportError:
        pass
        
    conn.close()
    return today, data

async def push_screen_time():
    global LATEST_DATA
    # Initial load of cache
    today, data = await asyncio.to_thread(get_screen_time_data_sync)
    LATEST_DATA = {"event": "screen_time", "date": today, "data": data}
    
    while True:
        await asyncio.sleep(60)
        await asyncio.to_thread(flush_screen_time_buffer_sync)
        today, data = await asyncio.to_thread(get_screen_time_data_sync)
        LATEST_DATA = {"event": "screen_time", "date": today, "data": data}
        
        msg = json.dumps(LATEST_DATA)
        for ws in list(clients):
            try: await ws.send(msg)
            except: pass

async def register(websocket):
    clients.add(websocket)
    try:
        await websocket.send(json.dumps(LATEST_DATA))
        await websocket.wait_closed()
    except ConnectionClosed:
        pass
    except Exception:
        pass
    finally:
        if websocket in clients:
            clients.remove(websocket)

async def main():
    observer = Observer()
    loop = asyncio.get_running_loop()
    start_prefs_watchers(loop, observer)
    observer.start()
    
    asyncio.create_task(screen_time_loop())
    asyncio.create_task(push_screen_time())
    
    async def process_request(connection, request):
        if request.headers.get("Upgrade", "").lower() != "websocket":
            return Response(
                200, 
                "OK", 
                Headers([("Content-Type", "text/html"), ("Connection", "close")]),
                b"<html><body><h1>SensorGuard ScreenTime Tracker</h1><p>This port is for WebSocket connections only.</p></body></html>"
            )
        return None

    await asyncio.to_thread(kill_port_holder, 8998)
    async with websockets.serve(register, "127.0.0.1", 8998, process_request=process_request):
        logger.info("Screen Time Tracker running on ws://127.0.0.1:8998")
        await asyncio.Future()



if __name__ == "__main__":
    asyncio.run(main())
