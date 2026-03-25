import asyncio
import json
import logging
import psutil
import websockets
from websockets.http11 import Response
from websockets.datastructures import Headers
from port_utils import kill_port_holder

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
    # If using an older version or if ConnectionClosed is moved
    try:
        from websockets import ConnectionClosed
    except ImportError:
        ConnectionClosed = Exception # Fallback

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("BackgroundAppsMonitor")


clients = set()

def get_running_apps():
    if not IS_WINDOWS:
        return [{"app": "Not Windows", "title": "OS not supported for window enumeration", "pid": 0}]
    
    apps = []
    
    def enum_windows_proc(hwnd, lParam):
        if user32.IsWindowVisible(hwnd) and user32.GetWindowTextLengthW(hwnd) > 0:
            length = user32.GetWindowTextLengthW(hwnd)
            buff = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buff, length + 1)
            title = buff.value
            
            # Filter out basic OS components that are essentially invisible background hosts
            if title == 'Program Manager' or title == 'Settings' or title == 'Windows Input Experience':
                return True
                
            pid = ctypes.c_ulong()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            
            try:
                p = psutil.Process(pid.value)
                name = p.name()
                
                # Format application name
                app_name = clean_app_name(name, title)
                exe_path = p.exe()
                
                # Extract icon
                icon = None
                try:
                    from backend.icon_extractor import get_app_icon
                    icon = get_app_icon(app_name, exe_path)
                except:
                    pass

                apps.append({
                    "app": app_name,
                    "title": title,
                    "pid": pid.value,
                    "icon": icon
                })
            except Exception:
                pass
                
        return True

    # Callback for EnumWindows
    # BOOL CALLBACK EnumWindowsProc(HWND hwnd, LPARAM lParam);
    # In ctypes terms: c_bool(HWND, LPARAM)
    WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows(WNDENUMPROC(enum_windows_proc), 0)
    
    # Deduplicate by title to avoid multiple handles showing up from the same instance
    unique_apps = []
    seen_titles = set()
    for app in apps:
        if app["title"] not in seen_titles:
            seen_titles.add(app["title"])
            unique_apps.append(app)

    return unique_apps

def clean_app_name(exe_name, title):
    if not exe_name: return "Unknown"
    lower_name = exe_name.lower()
    
    # General known mappings
    if 'chrome' in lower_name: return 'Google Chrome'
    if 'msedge' in lower_name: return 'Microsoft Edge'
    if 'firefox' in lower_name: return 'Firefox'
    if 'brave' in lower_name: return 'Brave Browser'
    if 'opera' in lower_name: return 'Opera'
    if 'explorer' in lower_name: return 'File Explorer'
    if 'code' in lower_name: return 'VS Code'
    if 'discord' in lower_name: return 'Discord'
    if 'whatsapp' in lower_name: return 'WhatsApp'
    if 'spotify' in lower_name: return 'Spotify'
    if 'slack' in lower_name: return 'Slack'
    if 'teams' in lower_name: return 'Microsoft Teams'
    if 'cmd' in lower_name or 'powershell' in lower_name or 'terminal' in lower_name: return 'Terminal'
    if 'devenv' in lower_name: return 'Visual Studio'
    if 'idea' in lower_name or 'studio64' in lower_name: return 'IntelliJ / Android Studio'

    # fallback
    return exe_name.replace('.exe', '')

async def broadcast_apps_loop():
    while True:
        await asyncio.sleep(4)
        if not clients:
            continue
            
        try:
            apps = await asyncio.to_thread(get_running_apps)
            msg = json.dumps({"event": "background_apps", "apps": apps})
        except Exception as e:
            logger.error(f"Error getting background apps: {e}")
            continue
        
        for ws in list(clients):
            try:
                await ws.send(msg)
            except ConnectionClosed:
                pass
            except Exception:
                pass

async def register(websocket):
    clients.add(websocket)
    try:
        # Push initial data immediately
        apps = await asyncio.to_thread(get_running_apps)
        await websocket.send(json.dumps({"event": "background_apps", "apps": apps}))
        await websocket.wait_closed()
    except ConnectionClosed:
        pass
    except Exception:
        pass
    finally:
        if websocket in clients:
            clients.remove(websocket)

async def main():
    asyncio.create_task(broadcast_apps_loop())
    
    async def process_request(connection, request):
        if request.headers.get("Upgrade", "").lower() != "websocket":
            return Response(
                200, 
                "OK", 
                Headers([("Content-Type", "text/html"), ("Connection", "close")]),
                b"<html><body><h1>SensorGuard Background Apps Monitor</h1><p>WS only.</p></body></html>"
            )
        return None

    await asyncio.to_thread(kill_port_holder, 8997)
    # Host on 8997
    async with websockets.serve(register, "127.0.0.1", 8997, process_request=process_request):
        logger.info("Background Apps Monitor running on ws://127.0.0.1:8997")
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())
