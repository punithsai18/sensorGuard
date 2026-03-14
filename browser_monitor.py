import asyncio
import json
import logging
import os
import glob
import sqlite3
import shutil
import tempfile
import psutil
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import websockets
from websockets.http11 import Response
from websockets.datastructures import Headers

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("BrowserMonitor")

# 1. BROWSER_PROFILES dictionary mapping browser name to list of possible history db paths
BROWSER_PROFILES = {
    "Chrome": [
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\User Data\Default\History"),
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\User Data\Profile*\History"),
        os.path.expanduser(r"~/Library/Application Support/Google/Chrome/Default/History"),
        os.path.expanduser(r"~/Library/Application Support/Google/Chrome/Profile*/History"),
        os.path.expanduser(r"~/.config/google-chrome/Default/History"),
        os.path.expanduser(r"~/.config/google-chrome/Profile*/History")
    ],
    "Edge": [
        os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\Edge\User Data\Default\History"),
        os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\Edge\User Data\Profile*\History"),
        os.path.expanduser(r"~/Library/Application Support/Microsoft Edge/Default/History"),
        os.path.expanduser(r"~/Library/Application Support/Microsoft Edge/Profile*/History"),
        os.path.expanduser(r"~/.config/microsoft-edge/Default/History"),
        os.path.expanduser(r"~/.config/microsoft-edge/Profile*/History")
    ],
    "Firefox": [
        os.path.expandvars(r"%APPDATA%\Mozilla\Firefox\Profiles\*.default*\places.sqlite"),
        os.path.expandvars(r"%APPDATA%\Mozilla\Firefox\Profiles\*.default-release*\places.sqlite"),
        os.path.expanduser(r"~/Library/Application Support/Firefox/Profiles/*.default*/places.sqlite"),
        os.path.expanduser(r"~/.mozilla/firefox/*.default*/places.sqlite")
    ],
    "Brave": [
        os.path.expandvars(r"%LOCALAPPDATA%\BraveSoftware\Brave-Browser\User Data\Default\History"),
        os.path.expandvars(r"%LOCALAPPDATA%\BraveSoftware\Brave-Browser\User Data\Profile*\History"),
        os.path.expanduser(r"~/Library/Application Support/BraveSoftware/Brave-Browser/Default/History"),
        os.path.expanduser(r"~/.config/BraveSoftware/Brave-Browser/Default/History")
    ],
    "Opera": [
        os.path.expandvars(r"%APPDATA%\Opera Software\Opera Stable\History"),
        os.path.expanduser(r"~/Library/Application Support/com.operasoftware.Opera/History"),
        os.path.expanduser(r"~/.config/opera/History")
    ],
    "Vivaldi": [
        os.path.expandvars(r"%LOCALAPPDATA%\Vivaldi\User Data\Default\History"),
        os.path.expanduser(r"~/Library/Application Support/Vivaldi/Default/History"),
        os.path.expanduser(r"~/.config/vivaldi/Default/History")
    ],
    "Arc": [
        os.path.expandvars(r"%LOCALAPPDATA%\Packages\TheBrowserCompany*\LocalCache\Local\Arc\User Data\Default\History"),
        os.path.expanduser(r"~/Library/Application Support/Arc/User Data\Default\History")
    ]
}

DETECTED_BROWSERS = {}

def scan_browsers():
    detected = {}
    for name, patterns in BROWSER_PROFILES.items():
        matches = []
        for p in patterns:
            matches.extend(glob.glob(p))
            
        # If multiple profiles exist, pick the one with the most recent modification time
        best_match = None
        best_mtime = 0
        for m in matches:
            if os.path.exists(m):
                try:
                    mtime = os.path.getmtime(m)
                    if mtime > best_mtime:
                        best_mtime = mtime
                        best_match = m
                except:
                    pass
        
        if best_match:
            detected[name] = best_match
            
    return detected

def query_history(browser_name, db_path):
    if not os.path.exists(db_path):
        return []
        
    tmp = None
    conn = None
    try:
        fd, tmp = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        shutil.copy2(db_path, tmp)
        
        conn = sqlite3.connect(f"file:{tmp}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        
        if browser_name == "Firefox":
            rows = conn.execute("""
                SELECT url, title, last_visit_date 
                FROM moz_places 
                WHERE hidden=0 AND last_visit_date IS NOT NULL 
                  AND url NOT LIKE 'place:%' AND url NOT LIKE 'about:%'
                ORDER BY last_visit_date DESC LIMIT 30
            """).fetchall()
            
            formatted = []
            for r in rows:
                raw_time = r['last_visit_date']
                visited_at = None
                if raw_time:
                    try: visited_at = (raw_time / 1000)
                    except: pass
                formatted.append({
                    "url": r['url'],
                    "title": r['title'],
                    "visitedAt": visited_at
                })
        else:
            rows = conn.execute("""
                SELECT url, title, last_visit_time 
                FROM urls 
                WHERE hidden=0 
                ORDER BY last_visit_time DESC LIMIT 30
            """).fetchall()
            
            CHROME_EPOCH_OFFSET_MS = 11644473600000
            formatted = []
            for r in rows:
                raw_time = r['last_visit_time']
                visited_at = None
                if raw_time:
                    try: visited_at = (raw_time / 1000) - CHROME_EPOCH_OFFSET_MS
                    except: pass
                
                url = r['url']
                if url.startswith(('chrome:', 'edge:', 'about:', 'data:', 'blob:', 'chrome-extension:')):
                    continue
                if 'localhost' in url or '127.0.0.1' in url:
                    continue
                formatted.append({
                    "url": url,
                    "title": r['title'],
                    "visitedAt": visited_at
                })
        return formatted
    except Exception as e:
        logger.error(f"Error querying {browser_name} DB: {e}")
        raise e
    finally:
        if conn:
            try: conn.close()
            except: pass
        if tmp and os.path.exists(tmp):
            for _ in range(3):
                try: 
                    os.remove(tmp)
                    break
                except: 
                    import time
                    time.sleep(0.1)

class HistoryFileHandler(FileSystemEventHandler):
    def __init__(self, browser_name, file_path, loop, publish_callback):
        self.browser_name = browser_name
        self.file_path = os.path.normpath(file_path)
        self.loop = loop
        self.publish_callback = publish_callback

    def on_modified(self, event):
        if not event.is_directory and os.path.normpath(event.src_path) == self.file_path:
            asyncio.run_coroutine_threadsafe(self.publish_callback(self.browser_name), self.loop)

observer = Observer()
browser_handlers = {}
clients = set()

async def push_detected_browsers_to_client(ws):
    data = {"event": "detected_browsers", "browsers": list(DETECTED_BROWSERS.keys())}
    try: await ws.send(json.dumps(data))
    except: pass

async def push_detected_browsers():
    if not clients: return
    data = {"event": "detected_browsers", "browsers": list(DETECTED_BROWSERS.keys())}
    msg = json.dumps(data)
    for ws in list(clients):
        try: await ws.send(msg)
        except: pass

async def push_browser_data(browser_name, target_clients=None):
    if target_clients is None:
        target_clients = clients
    if not target_clients: return
    
    db_path = DETECTED_BROWSERS.get(browser_name)
    if not db_path:
        tabs = []
        error = f"{browser_name} not detected. Open {browser_name} at least once to enable monitoring."
        status = "info"
    else:
        try:
            tabs = query_history(browser_name, db_path)
            if not tabs:
                error = f"No recent tabs found in {browser_name}."
                status = "info"
            else:
                error = None
                status = "ok"
        except Exception as e:
            error = f"Cannot read {browser_name} history. Try running SensorGuard as administrator."
            status = "error"
            tabs = []
            logger.error(f"Cannot read db for {browser_name}: {e}")
            
    msg = json.dumps({
        "event": "tab_update",
        "browser": browser_name,
        "tabs": tabs,
        "error": error,
        "status": status
    })
    
    for ws in list(target_clients):
        try: await ws.send(msg)
        except: pass

async def process_event(browser_name):
    await asyncio.sleep(0.1)
    await push_browser_data(browser_name)

def update_watchers(loop):
    global DETECTED_BROWSERS, browser_handlers
    new_detected = scan_browsers()
    changed = False
    
    for name, path in new_detected.items():
        if name not in DETECTED_BROWSERS:
            DETECTED_BROWSERS[name] = path
            changed = True
            dir_to_watch = os.path.dirname(path)
            handler = HistoryFileHandler(name, path, loop, process_event)
            watch = observer.schedule(handler, dir_to_watch, recursive=False)
            browser_handlers[name] = watch
            logger.info(f"Started watching {name} at {path}")
            
    if changed:
        asyncio.run_coroutine_threadsafe(push_detected_browsers(), loop)
        for name in DETECTED_BROWSERS:
            asyncio.run_coroutine_threadsafe(push_browser_data(name), loop)

async def periodic_scan():
    loop = asyncio.get_running_loop()
    update_watchers(loop)
    while True:
        await asyncio.sleep(60)
        update_watchers(loop)

async def check_new_processes():
    loop = asyncio.get_running_loop()
    seen_pids = set()
    browsers = ['chrome', 'edge', 'firefox', 'brave', 'opera', 'vivaldi', 'arc']
    while True:
        try:
            for p in psutil.process_iter(['name']):
                if p.pid not in seen_pids:
                    seen_pids.add(p.pid)
                    name = (p.info['name'] or '').lower()
                    if any(b in name for b in browsers):
                        update_watchers(loop)
        except Exception:
            pass
        await asyncio.sleep(5)

async def register(websocket):
    clients.add(websocket)
    try:
        await push_detected_browsers_to_client(websocket)
        for browser in DETECTED_BROWSERS:
            await push_browser_data(browser, {websocket})
        await websocket.wait_closed()
    finally:
        clients.remove(websocket)

async def main():
    observer.start()
    loop = asyncio.get_running_loop()
    asyncio.create_task(periodic_scan())
    asyncio.create_task(check_new_processes())
    
    async def process_request(connection, request):
        """Provide a friendly message for non-WebSocket (HTTP) requests."""
        if request.headers.get("Upgrade", "").lower() != "websocket":
            return Response(
                200, 
                "OK", 
                Headers([("Content-Type", "text/html"), ("Connection", "close")]),
                b"<html><body><h1>SensorGuard WebSocket Server</h1><p>This port is for WebSocket connections only. Please use the SensorGuard UI to view data.</p></body></html>"
            )
        return None

    # Use 127.0.0.1 to match what the frontend is now calling
    async with websockets.serve(register, "127.0.0.1", 8999, process_request=process_request):
        logger.info("Browser Monitor WebSocket active on ws://127.0.0.1:8999/browser-monitor")
        await asyncio.Future()




if __name__ == "__main__":
    asyncio.run(main())
