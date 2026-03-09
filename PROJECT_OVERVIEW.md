# SensorGuard: Advanced Privacy Monitoring System

## Overview
**SensorGuard** is a comprehensive privacy and security monitoring application designed for Windows environments. It provides users with real-time visibility into how their system's sensors and hardware are being accessed by various applications. By combining low-level system monitoring with a modern React-based dashboard, SensorGuard empowers users to take control of their digital privacy.

## Core Methodology: The "Historical Timeline"
The defining feature of SensorGuard is its **Historical Timeline Logging** system. Unlike traditional monitors that only show current activity, SensorGuard persists every significant privacy event into a local SQLite database for auditing.

### Why this method?
1.  **Immutable Auditing**: Real-time flashes of "Camera Active" are easy to miss. A persisted timeline allows for retrospective analysis of system activity.
2.  **Pattern Recognition**: By storing timestamps and source processes, users can identify if a specific background app is "polling" sensitive data at suspicious intervals.
3.  **Cross-Vector Correlation**: Logging hardware events (USB) alongside software sensor access (Camera/Mic) provides a holistic security posture.

### How it works
-   **Data Collection**: Python backends (`sensorDetector.py`, `background_apps_monitor.py`) leverage the **Win32 API** (via `ctypes`), **Registry Polling**, and **Process Utilities** (`psutil`).
-   **Data Sources**:
    -   **Registry Monitoring**: Polls `CapabilityAccessManager` keys to detect OS-level Camera/Mic/Location usage.
    -   **Browser Forensics**: Directly reads Chrome/Edge `Preferences` JSON files and Firefox `permissions.sqlite` to track site-specific permissions.
    -   **WMI (Windows Management Instrumentation)**: Used for real-time USB hardware event detection.
-   **Persistence**: Events are dispatched to `timeline_logger.py` and stored in `screen_time.db` with high precision.
-   **Real-time Visualization**: A React frontend connects to these monitors via **WebSockets**, providing a highly responsive dashboard for both live events and historical data.

## Communication Infrastructure: WebSockets

### What are WebSockets?
WebSockets are a modern communication protocol that provides **full-duplex** (two-way) communication channels over a single, long-lived TCP connection. 

*   **HTTP (Traditional)**: The client (browser) must send a request to the server to get data. The server cannot "speak" unless spoken to.
*   **WebSockets (Modern)**: Once a connection is established, the server can "push" data to the browser at any time without waiting for a request. This is critical for real-time applications like chat, gaming, and security monitors.

### How WebSockets Power SensorGuard
In this project, WebSockets are the "nervous system" that connects our low-level system monitors to the user interface:

1.  **Python Monitoring Servers**: The scripts `sensorDetector.py` and `background_apps_monitor.py` initialize persistent WebSocket servers on local ports (e.g., `8996` and `8997`).
2.  **Immediate Dispatch**: Instead of making the React frontend poll the system every second, the Python backend waits for an event (like a USB insertion). The moment it detects a change, it **broadcasts** a JSON message through the WebSocket.
3.  **Low Latency**: This methodology ensures that the latency between a "Privacy Breach" (like an app accessing your clipboard) and its appearance on the dashboard is near-zero (sub-millisecond).
4.  **Reduced Overhead**: Because the connection stays open, there is no need to repeatedly negotiate headers and handshakes, saving system resources and battery life.

## Key Features & Usefulness
-   **Multi-Sensor Attack Detection**: SensorGuard can detect "Attack Patterns," such as an unknown process accessing the clipboard or installing keyboard hooks while the camera or microphone is active.
-   **Active "Kill Process" Switch**: When a process is flagged for suspicious sensor access, users can immediately terminate it directly from the dashboard using the integrated process management layer.
-   **Hardware Event Intelligence**: Instant logging of USB devices helps prevent "Rubber Ducky" attacks or unauthorized data exfiltration attempts.
-   **Accountability**: Every event identifies the specific Process ID (PID) and executable name, preventing "silent" background access.

## Recommendations for Future Enhancements
1.  **AI-Driven Anomaly Detection**: Implement a lightweight local model to baselining normal sensor usage and automatically flag statistically significant deviations.
2.  **Kernel-Mode Filtering**: Transition from user-mode polling to a kernel-mode driver for true real-time blocking of sensor access before it reaches the application layer.
3.  **Encrypted Log Integrity**: Use authenticated encryption (like AES-GCM) to protect the local SQLite database, ensuring it cannot be modified by persistent threats.
4.  **Network Destination Deep-Dive**: Integrate packet inspection or eBPF-style monitoring to show exactly where data is being sent when a network connection is established.
5.  **Global Kill-Switch**: A hardware-level software override that can "mute" all sensors project-wide with a single click.
