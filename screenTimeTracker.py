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

try:
    import ctypes
    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32
    IS_WINDOWS = True
except Exception:
    IS_WINDOWS = False

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ScreenTimeTracker")

DB_PATH = os.path.join(os.path.dirname(__file__), "screen_time.db")

def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS screen_time_sessions (
            date TEXT,
            app_name TEXT,
            total_seconds INTEGER DEFAULT 0,
            last_seen TEXT,
            PRIMARY KEY (date, app_name)
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
        return "Unknown OS", "Unknown Window", 0
    
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
        except:
            name = "Unknown"
        return name, title, pid.value
    except:
        return None, None, 0

def clean_app_name(name, title):
    if not name: return "Unknown"
    lower_name = name.lower()
    if 'chrome' in lower_name: return 'Google Chrome'
    if 'msedge' in lower_name: return 'Microsoft Edge'
    if 'firefox' in lower_name: return 'Firefox'
    if 'brave' in lower_name: return 'Brave'
    if 'opera' in lower_name: return 'Opera'
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

async def screen_time_loop():
    while True:
        await asyncio.sleep(1)
        idle_time = get_idle_time_windows() if IS_WINDOWS else 0
        if idle_time > 60:
            continue  # User is idle, don't count
            
        app_exe, title, pid = get_active_window_info()
        if not app_exe: continue
        
        app_name = clean_app_name(app_exe, title)
        website = get_website_from_title(app_name, title)
        
        # We store website tracking under the app_name artificially for simplicity:
        # e.g., 'Google Chrome::youtube.com'
        record_name = app_name
        if website:
            record_name = f"{app_name}::{website}"
            
        today = datetime.now().strftime("%Y-%m-%d")
        now_str = datetime.now().isoformat()
        
        conn = sqlite3.connect(DB_PATH)
        conn.execute("""
            INSERT INTO screen_time_sessions (date, app_name, total_seconds, last_seen)
            VALUES (?, ?, 1, ?)
            ON CONFLICT(date, app_name) DO UPDATE SET 
                total_seconds = total_seconds + 1,
                last_seen = ?
        """, (today, record_name, now_str, now_str))
        conn.commit()
        conn.close()

async def push_screen_time():
    while True:
        await asyncio.sleep(60)
        conn = sqlite3.connect(DB_PATH)
        today = datetime.now().strftime("%Y-%m-%d")
        rows = conn.execute("SELECT app_name, total_seconds, last_seen FROM screen_time_sessions WHERE date = ? ORDER BY total_seconds DESC", (today,)).fetchall()
        
        data = []
        for r in rows:
            data.append({"app": r[0], "time": r[1], "last_seen": r[2]})
            
        conn.close()
        
        msg = json.dumps({"event": "screen_time", "date": today, "data": data})
        for ws in list(clients):
            try: await ws.send(msg)
            except: pass

async def register(websocket):
    clients.add(websocket)
    try:
        # Push initial screen time
        conn = sqlite3.connect(DB_PATH)
        today = datetime.now().strftime("%Y-%m-%d")
        rows = conn.execute("SELECT app_name, total_seconds, last_seen FROM screen_time_sessions WHERE date = ? ORDER BY total_seconds DESC", (today,)).fetchall()
        data = [{"app": r[0], "time": r[1], "last_seen": r[2]} for r in rows]
        conn.close()
        await websocket.send(json.dumps({"event": "screen_time", "date": today, "data": data}))
        
        await websocket.wait_closed()
    finally:
        clients.remove(websocket)

async def main():
    observer = Observer()
    loop = asyncio.get_running_loop()
    start_prefs_watchers(loop, observer)
    observer.start()
    
    asyncio.create_task(screen_time_loop())
    asyncio.create_task(push_screen_time())
    
    async with websockets.serve(register, "localhost", 8998):
        logger.info("Screen Time Tracker running on ws://localhost:8998")
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())
