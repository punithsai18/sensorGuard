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

import os
from dotenv import load_dotenv

# Load environment variables explicitly from the project root
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"), override=True)

# AI Risk Agent imports
try:
    from backend.context_builder import build_sensor_context
    from backend.risk_agent import assess_risk
    from backend.training_logger import init_training_db, log_assessment
    AI_RISK_AVAILABLE = True
except ImportError as _e:
    AI_RISK_AVAILABLE = False
    logging.getLogger("SensorDetector").warning(f"AI Risk Agent not available: {_e}")

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
LATEST_RISK_ASSESSMENTS = {}  # key = sensor_type, value = assessment dict

# Track per-sensor activation times and first-seen-today
_sensor_activation_times = {}  # sensor_type -> timestamp of first activation
_last_risk_assessment_time = {}  # sensor_type -> last assessment timestamp
_seen_today = set()  # set of (process_name, sensor_type) seen today
_last_day = None  # track day rollover
RISK_REASSESS_INTERVAL = 60  # re-assess every 60s for active sensors


def _get_idle_seconds() -> int:
    """Return how many seconds the user has been idle (no keyboard/mouse)."""
    if not IS_WINDOWS:
        return 0
    try:
        class LASTINPUTINFO(ctypes.Structure):
            _fields_ = [("cbSize", ctypes.c_uint), ("dwTime", ctypes.c_uint)]
        lii = LASTINPUTINFO()
        lii.cbSize = ctypes.sizeof(LASTINPUTINFO)
        if user32.GetLastInputInfo(ctypes.byref(lii)):
            millis = kernel32.GetTickCount() - lii.dwTime
            return max(0, millis // 1000)
    except Exception:
        pass
    return 0


def _extract_process_name(info_str: str) -> str:
    """Extract a process/app name from the sensor info string."""
    # info is like "Active: chrome.exe, msedge.exe" or "Just accessed by code.exe"
    if not info_str or info_str == "—":
        return "unknown_process"
    info = info_str
    if info.startswith("Active: "):
        info = info[len("Active: "):]
    if info.startswith("Just accessed by "):
        info = info[len("Just accessed by "):]
    if info.startswith("Detected: "):
        info = info[len("Detected: "):]
    if info.startswith("Possible hooks: "):
        info = info[len("Possible hooks: "):]
    # Return the first process name (comma-separated)
    first = info.split(",")[0].strip()
    return first if first else "unknown_process"


def _get_active_sensor_list() -> list[str]:
    """Return list of currently active sensor types."""
    return [
        k for k, v in LATEST_SENSORS.items()
        if v.get("status") not in ("IDLE", None)
    ]


def _get_sensor_duration(sensor_type: str) -> int:
    """Return how many seconds this sensor has been active."""
    start = _sensor_activation_times.get(sensor_type)
    if start is None:
        return 0
    return max(0, int(time.time() - start))


def _is_first_seen_today(process_name: str, sensor_type: str) -> bool:
    """Check if this process+sensor combo has been seen today."""
    global _last_day, _seen_today
    import datetime
    today = datetime.date.today()
    if _last_day != today:
        _seen_today.clear()
        _last_day = today
    key = (process_name.lower(), sensor_type)
    if key not in _seen_today:
        _seen_today.add(key)
        return True
    return False


async def _run_risk_assessment(sensor_type: str, sensor_info: dict):
    """Run AI risk assessment for a sensor event in a background thread."""
    if not AI_RISK_AVAILABLE:
        return
    try:
        process_name = _extract_process_name(sensor_info.get("info", ""))
        active_sensors = _get_active_sensor_list()
        idle_seconds = _get_idle_seconds()

        context = await asyncio.to_thread(
            build_sensor_context,
            sensor_type=sensor_type,
            process_name=process_name,
            exe_path=None,
            website=None,
            active_sensors=active_sensors,
            user_idle_seconds=idle_seconds,
            access_duration_seconds=_get_sensor_duration(sensor_type),
            first_seen_today=_is_first_seen_today(process_name, sensor_type),
        )

        assessment = await asyncio.to_thread(assess_risk, context)
        await asyncio.to_thread(log_assessment, assessment)

        # Store latest assessment
        LATEST_RISK_ASSESSMENTS[sensor_type] = assessment

        # Broadcast to all connected clients
        msg = json.dumps({
            "event": "risk_assessment",
            "sensor": sensor_type,
            "process": process_name,
            "risk_level": assessment.get("risk_level"),
            "risk_score": assessment.get("risk_score"),
            "likelihood": assessment.get("likelihood"),
            "impact": assessment.get("impact"),
            "confidence": assessment.get("confidence"),
            "reasoning": assessment.get("reasoning"),
            "mitre_technique": assessment.get("mitre_technique"),
            "recommended_action": assessment.get("recommended_action"),
            "is_false_positive": assessment.get("is_false_positive"),
            "is_fallback": assessment.get("_fallback", False),
            "timestamp": context.get("timestamp"),
        })

        for ws in list(clients):
            try:
                await ws.send(msg)
            except Exception:
                pass

        logger.info(
            f"AI Risk: {sensor_type} → {assessment.get('risk_level')} "
            f"(score: {assessment.get('risk_score')}) "
            f"process: {process_name}"
        )

    except Exception as e:
        logger.error(f"Risk assessment error for {sensor_type}: {e}")

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
            old_volatile_status = LATEST_SENSORS.get(k, {}).get("status", "IDLE")
            if current[k]["status"] != "IDLE":
                LATEST_SENSORS[k] = current[k]
                LATEST_SENSORS[k]["_expire"] = time.time() + 5
                # AI risk assessment for volatile sensors
                if old_volatile_status == "IDLE" or k not in LATEST_RISK_ASSESSMENTS:
                    if k not in _sensor_activation_times:
                        _sensor_activation_times[k] = time.time()
                    asyncio.create_task(_run_risk_assessment(k, current[k]))
                    _last_risk_assessment_time[k] = time.time()
            else:
                if "_expire" in LATEST_SENSORS[k]:
                    if time.time() > LATEST_SENSORS[k]["_expire"]:
                        LATEST_SENSORS[k] = {"status": "IDLE", "info": "—"}
                        _sensor_activation_times.pop(k, None)
                        _last_risk_assessment_time.pop(k, None)
                        LATEST_RISK_ASSESSMENTS.pop(k, None)
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
                    # Track activation time
                    if k not in _sensor_activation_times:
                        _sensor_activation_times[k] = time.time()
                    # Trigger AI risk assessment when sensor becomes active
                    if old_status == "IDLE" or k not in LATEST_RISK_ASSESSMENTS:
                        asyncio.create_task(_run_risk_assessment(k, current[k]))
                        _last_risk_assessment_time[k] = time.time()
                elif old_status != "IDLE":
                    asyncio.create_task(asyncio.to_thread(log_event, event_type, k.capitalize(), f"Access stopped"))
                    # Clear activation time
                    _sensor_activation_times.pop(k, None)
                    _last_risk_assessment_time.pop(k, None)
                    # Clear risk assessment on idle
                    LATEST_RISK_ASSESSMENTS.pop(k, None)
            else:
                # Sensor still active — periodic re-assessment
                if new_status != "IDLE" and k in _sensor_activation_times:
                    last_assess = _last_risk_assessment_time.get(k, 0)
                    if time.time() - last_assess > RISK_REASSESS_INTERVAL:
                        asyncio.create_task(_run_risk_assessment(k, current[k]))
                        _last_risk_assessment_time[k] = time.time()

            LATEST_SENSORS[k] = current[k]
                
        if not clients: continue
        
        msg = json.dumps({
            "event": "sensors_update",
            "sensors": LATEST_SENSORS,
            "risk_assessments": {
                k: {
                    "risk_level": v.get("risk_level"),
                    "risk_score": v.get("risk_score"),
                    "likelihood": v.get("likelihood"),
                    "impact": v.get("impact"),
                    "confidence": v.get("confidence"),
                    "reasoning": v.get("reasoning"),
                    "mitre_technique": v.get("mitre_technique"),
                    "recommended_action": v.get("recommended_action"),
                    "is_false_positive": v.get("is_false_positive"),
                    "is_fallback": v.get("_fallback", False),
                    "process": v.get("_context", {}).get("process_name"),
                    "timestamp": v.get("_timestamp"),
                }
                for k, v in LATEST_RISK_ASSESSMENTS.items()
            },
        })
        for ws in list(clients):
            try:
                await ws.send(msg)
            except websockets.exceptions.ConnectionClosed:
                pass


async def register(websocket):
    clients.add(websocket)
    try:
        # Send cache immediately so handshake completes instantly
        await websocket.send(json.dumps({
            "event": "sensors_update",
            "sensors": LATEST_SENSORS,
            "risk_assessments": {
                k: {
                    "risk_level": v.get("risk_level"),
                    "risk_score": v.get("risk_score"),
                    "likelihood": v.get("likelihood"),
                    "impact": v.get("impact"),
                    "confidence": v.get("confidence"),
                    "reasoning": v.get("reasoning"),
                    "mitre_technique": v.get("mitre_technique"),
                    "recommended_action": v.get("recommended_action"),
                    "is_false_positive": v.get("is_false_positive"),
                    "is_fallback": v.get("_fallback", False),
                    "process": v.get("_context", {}).get("process_name"),
                    "timestamp": v.get("_timestamp"),
                }
                for k, v in LATEST_RISK_ASSESSMENTS.items()
            },
        }))
        await websocket.wait_closed()
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        if websocket in clients:
            clients.remove(websocket)

async def main():
    # Initialize training database on startup
    if AI_RISK_AVAILABLE:
        key = os.getenv("OPENROUTER_API_KEY")
        model = os.getenv("RISK_AGENT_MODEL")
        print(f"\n[AI Risk Agent] Startup Status:")
        print(f"  - Key Found: {'YES' if key else 'NO (Check .env)'}")
        if key: print(f"  - Key starts with: {key[:14]}...")
        print(f"  - Model: {model}")
        print(f"  - AI Risk Agent imports: OK\n")
        
        try:
            await asyncio.to_thread(init_training_db)
            logger.info("AI Risk Agent initialized — training DB ready")
        except Exception as e:
            logger.error(f"Failed to init training DB: {e}")

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
