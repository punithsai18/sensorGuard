# 🛡️ SensorGuard

**SensorGuard** is a professional-grade privacy and security monitoring suite for Windows. It provides a real-time defense dashboard to monitor hardware sensors, track application behavior, and mitigate "Multi-Sensor" attack patterns using integrated AI.

## 🚀 Key Features

-   **🧠 AI Risk Agent**: Real-time evaluation of sensor access events (Camera, Microphone, USB, Location, etc.) powered by OpenRouter (NVIDIA Nemotron).
-   **Live Sensor Dashboard**: Instant visibility into Battery, Network, Geolocation, Orientation, and Hardware status.
-   **Contextual Risk Scoring**: Intelligent scoring (LOW to CRITICAL) that understands the difference between Google Meet using your camera and an unknown background process doing it at 3 AM.
-   **Historical Timeline**: Auditable SQLite logs of every hardware event and sensor access.
-   **ML Training Logger**: Automatically saves AI assessments and system context to `data/training_data.db` for future offline model training (Phase 2).
-   **Browser Forensics**: Deep-scans Chrome, Edge, and Firefox database files to reveal site-specific permission history.
-   **Active Defense**: One-click "Kill Process" switch to terminate unauthorized applications immediately.
-   **Screen Time Tracking**: Detailed analytics on application usage and web domain focus.
-   **USB Security**: Real-time logging of hardware device connections and removals.

## 🛠️ Architecture

SensorGuard uses a high-performance hybrid architecture:
1.  **Frontend**: React + Vite (Real-time WebSocket data visualization).
2.  **Backend (Node.js)**: Express server for local forensics, registry scanning, and process management.
3.  **Monitors (Python)**: Low-level Win32 API monitoring services with an AI integration layer (`risk_agent.py`) for live threat classification.

## 📦 Installation & Setup

### Prerequisites
-   **Node.js** (v18+)
-   **Python 3.10+**
-   **OpenRouter API Key** (Get one at [openrouter.ai](https://openrouter.ai/))

### 1. Clone & Install
```bash
git clone https://github.com/your-repo/sensorGuard.git
cd sensorGuard
npm install
pip install -r requirements.txt
```

### 2. Environment Configuration
Create a `.env` file in the root directory:
```env
OPENROUTER_API_KEY=sk-or-v1-your-key-here
RISK_AGENT_MODEL=nvidia/nemotron-3-super-120b-a12b:free
RISK_AGENT_MAX_TOKENS=400
RISK_AGENT_TIMEOUT_SECONDS=10
TRAINING_DB_PATH=data/training_data.db
```

### 3. Start the Suite
Launch the frontend, backend, and all 5 Python services concurrently:
```bash
npm run dev:all
```

*Alternatively, start Python services manually:*
```bash
python sensorDetector.py
python background_apps_monitor.py
python screenTimeTracker.py
```

## 🧠 AI Assessment Methodology
The Risk Agent evaluates every sensor event by building a "Context Object" containing:
-   **Process Security**: Known legitimate app vs. unknown executable path.
-   **User Presence**: Foreground status and idle time (detects background "spyware" behavior).
-   **Time Context**: Detects anomalies like sensor access during sleeping hours.
-   **Browser Context**: Correlates sensor use with active web domains (e.g., Camera + Meet.google.com).

## 🛡️ Privacy Note
SensorGuard is designed with a "Local First" philosophy.
-   **Telemetry**: Sensor logs and screen time remain strictly on your local machine in SQLite.
-   **AI Processing**: Risk analysis is processed via OpenRouter's cloud API. Review your provider's privacy policy for sensitive context.
-   **No Background Uploads**: No data is sent to external servers other than necessary AI inference calls.

---
*Developed for Advanced Privacy Awareness.*