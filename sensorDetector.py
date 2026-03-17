import asyncio
import json
import logging
import psutil
import time
import websockets
from websockets.http11 import Response
from websockets.datastructures import Headers
from port_utils import kill_port_holder

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
LATEST_SENSORS = {k: {"status": "IDLE", "info": "—"} for k in ["location", "clipboard", "screen_capture", "keyboard", "network", "usb", "camera", "microphone"]}

# Deferred imports and setup

def run_powershell(script):
    import subprocess
    try:
        output = subprocess.check_output(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], encoding='utf8', timeout=4)
        return output
    except Exception:
        return ""

def get_location_access():
    if not IS_WINDOWS: return {"status": "IDLE", "info": "—"}
    ps = r"""
    $base = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\location';
    $active = @();
    if (Test-Path $base) {
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
    }
    $active | Select-Object -Unique
    """
    output = run_powershell(ps)
    procs = [p.strip() for p in output.strip().split('\n') if p.strip()]
    if procs:
        return {"status": "ACTIVE", "info": f"Active: {', '.join(procs)}"}
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
    """Detect USB devices via PowerShell to avoid COM/WMI threading issues."""
    if not IS_WINDOWS:
        return {"status": "IDLE", "info": "—"}
    try:
        ps = r"""
        $skip = 'hub|controller|composite|root|extensible'
        Get-WmiObject Win32_PnPEntity | Where-Object { $_.DeviceID -like 'USB\*' -and $_.Caption -notmatch $skip } |
          Select-Object -ExpandProperty Caption -Unique | Sort-Object
        """
        output = run_powershell(ps)
        devs = [d.strip() for d in output.strip().split('\n') if d.strip()]
        if devs:
            return {"status": "ACTIVE", "info": ", ".join(devs)}
    except Exception as e:
        logger.error(f"USB detection error: {e}")

    return {"status": "IDLE", "info": "—"}

def check_camera():
    if not IS_WINDOWS: return {"status": "IDLE", "info": "—"}
    ps = r"""
    $base = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam';
    $active = @();
    if (Test-Path $base) {
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
    }
    $active | Select-Object -Unique
    """
    output = run_powershell(ps)
    procs = [p.strip() for p in output.strip().split('\n') if p.strip()]
    if procs:
        return {"status": "ACTIVE", "info": f"Active: {', '.join(procs)}"}
    return {"status": "IDLE", "info": "—"}

def check_microphone():
    if not IS_WINDOWS: return {"status": "IDLE", "info": "—"}
    ps = r"""
    $base = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone';
    $active = @();
    if (Test-Path $base) {
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
    }
    $active | Select-Object -Unique
    """
    output = run_powershell(ps)
    procs = [p.strip() for p in output.strip().split('\n') if p.strip()]
    if procs:
        return {"status": "ACTIVE", "info": f"Active: {', '.join(procs)}"}
    return {"status": "IDLE", "info": "—"}


async def gather_sensors():
    # Run all synchronous checks in threads concurrently
    tasks = [
        asyncio.to_thread(get_location_access),
        asyncio.to_thread(check_clipboard),
        asyncio.to_thread(check_screen_capture),
        asyncio.to_thread(check_keyboard_hooks),
        asyncio.to_thread(check_network),
        asyncio.to_thread(check_usb),
        asyncio.to_thread(check_camera),
        asyncio.to_thread(check_microphone)
    ]
    results = await asyncio.gather(*tasks)
    return {
        "location": results[0],
        "clipboard": results[1],
        "screen_capture": results[2],
        "keyboard": results[3],
        "network": results[4],
        "usb": results[5],
        "camera": results[6],
        "microphone": results[7]
    }

last_clipboard_seq = 0
if IS_WINDOWS:
    try:
        last_clipboard_seq = user32.GetClipboardSequenceNumber()
    except: pass

async def broadcast_loop():
    global LATEST_SENSORS
    # Initial gather to populate cache
    try:
        LATEST_SENSORS = await gather_sensors()
    except Exception as e:
        logger.error(f"Initial gather_sensors failed: {e}")
    
    while True:
        await asyncio.sleep(2)
        
        try:
            # We stagger the checks slightly to avoid massive CPU spikes from multiple PowerShell calls
            # However, gather_sensors is already concurrent. We'll stick to one clean update per loop.
            current = await gather_sensors()
        except Exception as e:
            logger.error(f"Error gathering sensors: {e}")
            continue
        
        # Merge logic for volatile states like clipboard
        for k in ["clipboard", "keyboard"]:
            if current[k]["status"] != "IDLE":
                LATEST_SENSORS[k] = current[k]
                LATEST_SENSORS[k]["_expire"] = time.time() + 5
            else:
                if "_expire" in LATEST_SENSORS[k]:
                    if time.time() > LATEST_SENSORS[k]["_expire"]:
                        LATEST_SENSORS[k] = {"status": "IDLE", "info": "—"}
                else:
                    LATEST_SENSORS[k] = {"status": "IDLE", "info": "—"}
            
            if current[k]["status"] != "IDLE":
                if k == "clipboard":
                    asyncio.create_task(asyncio.to_thread(log_event, "HARDWARE", "Clipboard", current[k]["info"]))
                elif k == "keyboard":
                    asyncio.create_task(asyncio.to_thread(log_event, "HARDWARE", "Keyboard", current[k]["info"]))

        # Update the rest directly and check for timeline events
        for k in ["location", "screen_capture", "network", "usb", "camera", "microphone"]:
            old_status = LATEST_SENSORS.get(k, {}).get("status", "IDLE")
            new_status = current.get(k, {}).get("status", "IDLE")
            old_info = LATEST_SENSORS.get(k, {}).get("info", "")
            new_info = current.get(k, {}).get("info", "")
            
            if old_status != new_status or (new_status != "IDLE" and old_info != new_info):
                event_type = "HARDWARE"
                if k in ["camera", "microphone"]: event_type = k.upper()
                if k == "location": event_type = "SYSTEM"
                
                if new_status != "IDLE":
                    asyncio.create_task(asyncio.to_thread(log_event, event_type, k.capitalize(), new_info))
                elif old_status != "IDLE":
                    asyncio.create_task(asyncio.to_thread(log_event, event_type, k.capitalize(), f"Access stopped"))

            LATEST_SENSORS[k] = current[k]
                
        if not clients: continue
        
        msg = json.dumps({"event": "sensors_update", "sensors": LATEST_SENSORS})
        for ws in list(clients):
            try:
                await ws.send(msg)
            except websockets.exceptions.ConnectionClosed:
                pass


async def register(websocket):
    clients.add(websocket)
    try:
        # Send cache immediately so handshake completes instantly
        await websocket.send(json.dumps({"event": "sensors_update", "sensors": LATEST_SENSORS}))
        await websocket.wait_closed()
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        if websocket in clients:
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

    await asyncio.to_thread(kill_port_holder, 8996)
    async with websockets.serve(register, "127.0.0.1", 8996, process_request=process_request):
        logger.info("Advanced Sensors Detector running on ws://127.0.0.1:8996")
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())
