import asyncio
import json
import logging
import psutil
import time
import websockets
from websockets.http11 import Response
from websockets.datastructures import Headers

try:
    from timeline_logger import log_event
except ImportError:
    def log_event(*args): pass

try:
    import ctypes
    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32
    IS_WINDOWS = True
except Exception:
    IS_WINDOWS = False

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("SensorDetector")

clients = set()

# WMI connection for USB (import deferred as it's Windows only and might fail)
try:
    import wmi
    wmi_obj = wmi.WMI()
except Exception:
    wmi_obj = None

last_clipboard_seq = 0
if IS_WINDOWS:
    last_clipboard_seq = user32.GetClipboardSequenceNumber()

def get_location_access():
    if not IS_WINDOWS: return {"status": "IDLE", "info": "—"}
    # Simplified approach for Location: check the registry like camera/mic
    import subprocess
    ps = r"""
    $base = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\location';
    $active = @();
    Get-ChildItem $base -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.PSChildName -eq 'NonPackaged') {
            Get-ChildItem $_.PsPath -ErrorAction SilentlyContinue | ForEach-Object {
                $v = Get-ItemProperty $_.PsPath -ErrorAction SilentlyContinue;
                if ($v.LastUsedTimeStart -and $v.LastUsedTimeStart -ne 0 -and $v.LastUsedTimeStop -eq 0) {
                    $active += ($_.PSChildName).Replace('#','\\')
                }
            }
        } else {
            $v = Get-ItemProperty $_.PsPath -ErrorAction SilentlyContinue;
            if ($v.LastUsedTimeStart -and $v.LastUsedTimeStart -ne 0 -and $v.LastUsedTimeStop -eq 0) {
                $active += $_.PSChildName
            }
        }
    };
    $active | Select-Object -Unique
    """
    try:
        output = subprocess.check_output(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], encoding='utf8', timeout=5)
        procs = [p.strip() for p in output.strip().split('\n') if p.strip()]
        if procs:
            return {"status": "ACTIVE", "info": f"Active: {', '.join(procs)}"}
        return {"status": "IDLE", "info": "—"}
    except Exception:
        pass
    return {"status": "IDLE", "info": "—"}


def check_clipboard():
    global last_clipboard_seq
    if not IS_WINDOWS: return {"status": "IDLE", "info": "—"}
    
    current_seq = user32.GetClipboardSequenceNumber()
    if current_seq != last_clipboard_seq and current_seq != 0:
        last_clipboard_seq = current_seq
        # Best effort to guess who touched it based on foreground window
        hwnd = user32.GetForegroundWindow()
        pid = ctypes.c_ulong()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        try:
            p = psutil.Process(pid.value)
            name = p.name()
        except:
            name = "unknown_proc.exe"
        return {"status": "ACCESSED", "info": f"Just accessed by {name}"}
    return {"status": "IDLE", "info": "—"}

def check_screen_capture():
    if not IS_WINDOWS: return {"status": "IDLE", "info": "—"}
    # Check for known screen capture tools running
    known_capture = ['obs64.exe', 'obs32.exe', 'bdcam.exe', 'SnippingTool.exe', 'ScreenClippingHost.exe']
    running_capture = []
    
    for proc in psutil.process_iter(['name']):
        try:
            if proc.info['name'] in known_capture:
                running_capture.append(proc.info['name'])
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
            
    if running_capture:
        return {"status": "ACTIVE", "info": f"Detected: {', '.join(set(running_capture))}"}
    return {"status": "IDLE", "info": "—"}

def check_keyboard_hooks():
    if not IS_WINDOWS: return {"status": "IDLE", "info": "—"}
    # Lightweight heuristic: check for common automation/remapping tools that use hooks
    suspicious = ['AutoHotkey.exe', 'SharpKeys.exe', 'KeyCastOW.exe', 'PowerToys.KeyboardManager.exe']
    running = []
    for proc in psutil.process_iter(['name']):
        try:
            if proc.info['name'] in suspicious:
                running.append(proc.info['name'])
        except: pass
    
    if running:
        return {"status": "DETECTED", "info": f"Possible hooks: {', '.join(set(running))}"}
    return {"status": "IDLE", "info": "—"}

def check_network():
    # Show active heavy outbound connections
    count = 0
    try:
        conns = psutil.net_connections(kind='inet')
        for c in conns:
            if c.status == 'ESTABLISHED': count += 1
    except:
        pass
    
    if count > 0:
        return {"status": "ACTIVE", "info": f"{count} established connections"}
    return {"status": "IDLE", "info": "—"}

def check_usb():
    if wmi_obj is None: return {"status": "IDLE", "info": "—"}
    # For a real-time looping script without WMI async events, we just grab current disk count
    try:
        disks = wmi_obj.Win32_DiskDrive(InterfaceType="USB")
        if len(disks) > 0:
             return {"status": "ACTIVE", "info": f"Detected {len(disks)} USB drive(s)"}
    except:
        pass
        
    return {"status": "IDLE", "info": "—"}

def check_camera():
    if not IS_WINDOWS: return {"status": "IDLE", "info": "—"}
    import subprocess
    ps = r"""
    $base = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam';
    $active = @();
    Get-ChildItem $base -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.PSChildName -eq 'NonPackaged') {
            Get-ChildItem $_.PsPath -ErrorAction SilentlyContinue | ForEach-Object {
                $v = Get-ItemProperty $_.PsPath -ErrorAction SilentlyContinue;
                if ($v.LastUsedTimeStart -and $v.LastUsedTimeStart -ne 0 -and $v.LastUsedTimeStop -eq 0) {
                    $active += ($_.PSChildName).Replace('#','\\')
                }
            }
        } else {
            $v = Get-ItemProperty $_.PsPath -ErrorAction SilentlyContinue;
            if ($v.LastUsedTimeStart -and $v.LastUsedTimeStart -ne 0 -and $v.LastUsedTimeStop -eq 0) {
                $active += $_.PSChildName
            }
        }
    };
    $active | Select-Object -Unique
    """
    try:
        output = subprocess.check_output(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], encoding='utf8', timeout=5)
        procs = [p.strip() for p in output.strip().split('\n') if p.strip()]
        if procs:
            return {"status": "ACTIVE", "info": f"Active: {', '.join(procs)}"}
    except: pass
    return {"status": "IDLE", "info": "—"}

def check_microphone():
    if not IS_WINDOWS: return {"status": "IDLE", "info": "—"}
    import subprocess
    ps = r"""
    $base = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone';
    $active = @();
    Get-ChildItem $base -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.PSChildName -eq 'NonPackaged') {
            Get-ChildItem $_.PsPath -ErrorAction SilentlyContinue | ForEach-Object {
                $v = Get-ItemProperty $_.PsPath -ErrorAction SilentlyContinue;
                if ($v.LastUsedTimeStart -and $v.LastUsedTimeStart -ne 0 -and $v.LastUsedTimeStop -eq 0) {
                    $active += ($_.PSChildName).Replace('#','\\')
                }
            }
        } else {
            $v = Get-ItemProperty $_.PsPath -ErrorAction SilentlyContinue;
            if ($v.LastUsedTimeStart -and $v.LastUsedTimeStart -ne 0 -and $v.LastUsedTimeStop -eq 0) {
                $active += $_.PSChildName
            }
        }
    };
    $active | Select-Object -Unique
    """
    try:
        output = subprocess.check_output(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], encoding='utf8', timeout=5)
        procs = [p.strip() for p in output.strip().split('\n') if p.strip()]
        if procs:
            return {"status": "ACTIVE", "info": f"Active: {', '.join(procs)}"}
    except: pass
    return {"status": "IDLE", "info": "—"}


def gather_sensors():
    return {
        "location": get_location_access(),
        "clipboard": check_clipboard(),
        "screen_capture": check_screen_capture(),
        "keyboard": check_keyboard_hooks(),
        "network": check_network(),
        "usb": check_usb(),
        "camera": check_camera(),
        "microphone": check_microphone()
    }

async def broadcast_loop():
    # Cache the accessed states so they don't immediately disappear
    try:
        cached = gather_sensors()
    except Exception as e:
        logger.error(f"Initial gather_sensors failed: {e}")
        cached = {k: {"status": "IDLE", "info": "—"} for k in ["location", "clipboard", "screen_capture", "keyboard", "network", "usb", "camera", "microphone"]}
    
    while True:
        await asyncio.sleep(2)
        if not clients: continue
        
        try:
            current = gather_sensors()
        except Exception as e:
            logger.error(f"Error gathering sensors: {e}")
            continue
        
        # Merge logic for volatile states like clipboard accessed so it flashes for a few seconds
        for k in ["clipboard", "keyboard"]:
            if current[k]["status"] != "IDLE":
                cached[k] = current[k]
                cached[k]["_expire"] = time.time() + 5 # keep for 5 seconds
            else:
                if "_expire" in cached[k]:
                    if time.time() > cached[k]["_expire"]:
                        cached[k] = {"status": "IDLE", "info": "—"}
                else:
                    cached[k] = {"status": "IDLE", "info": "—"}
            
            # Log volatile states to timeline when they happen
            if current[k]["status"] != "IDLE":
                if k == "clipboard":
                    log_event("HARDWARE", "Clipboard", current[k]["info"])
                elif k == "keyboard":
                    log_event("HARDWARE", "Keyboard", current[k]["info"])

        # update the rest directly
        for k in ["location", "screen_capture", "network", "usb", "camera", "microphone"]:
            
            # Special check for sensor activation events for timeline logging
            old_status = cached.get(k, {}).get("status", "IDLE")
            new_status = current.get(k, {}).get("status", "IDLE")
            old_info = cached.get(k, {}).get("info", "")
            new_info = current.get(k, {}).get("info", "")
            
            if old_status != new_status or (new_status != "IDLE" and old_info != new_info):
                event_type = "HARDWARE"
                if k in ["camera", "microphone"]: event_type = k.upper()
                if k == "location": event_type = "SYSTEM"
                
                # Log activation/change to timeline
                if new_status != "IDLE":
                    log_event(event_type, k.capitalize(), new_info)
                elif old_status != "IDLE":
                    log_event(event_type, k.capitalize(), f"Access stopped")

            cached[k] = current[k]
                
        msg = json.dumps({"event": "sensors_update", "sensors": cached})
        for ws in list(clients):
            try:
                await ws.send(msg)
            except websockets.exceptions.ConnectionClosed:
                pass


async def register(websocket):
    clients.add(websocket)
    try:
        await websocket.send(json.dumps({"event": "sensors_update", "sensors": gather_sensors()}))
        await websocket.wait_closed()
    finally:
        clients.remove(websocket)

async def main():
    asyncio.create_task(broadcast_loop())
    
    async def process_request(connection, request):
        if request.headers.get("Upgrade", "").lower() != "websocket":
            return Response(
                200, 
                "OK", 
                Headers([("Content-Type", "text/html"), ("Connection", "close")]),
                b"<html><body><h1>SensorGuard Advanced Sensors Detector</h1><p>WS only.</p></body></html>"
            )
        return None

    async with websockets.serve(register, "127.0.0.1", 8996, process_request=process_request):
        logger.info("Advanced Sensors Detector running on ws://127.0.0.1:8996")
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())
