import { useState, useEffect } from 'react'
import './App.css'
import TabsPage from './TabsPage.jsx'
import SitePermissionsPage from './SitePermissionsPage.jsx'
import LiveMonitorPage from './LiveMonitorPage.jsx'

// --- Hooks ---

function useBattery() {
  const [battery, setBattery] = useState(null)
  const [error, setError] = useState(() =>
    !navigator.getBattery ? 'Battery API not supported in this browser' : null
  )

  useEffect(() => {
    if (!navigator.getBattery) return
    let bm = null
    const update = (b) =>
      setBattery({
        level: Math.round(b.level * 100),
        charging: b.charging,
        chargingTime: b.chargingTime,
        dischargingTime: b.dischargingTime,
      })
    const onChange = () => { if (bm) update(bm) }
    navigator.getBattery().then((b) => {
      bm = b
      update(b)
      b.addEventListener('levelchange', onChange)
      b.addEventListener('chargingchange', onChange)
      b.addEventListener('chargingtimechange', onChange)
      b.addEventListener('dischargingtimechange', onChange)
    }).catch((err) => setError(err.message))
    return () => {
      if (bm) {
        bm.removeEventListener('levelchange', onChange)
        bm.removeEventListener('chargingchange', onChange)
        bm.removeEventListener('chargingtimechange', onChange)
        bm.removeEventListener('dischargingtimechange', onChange)
      }
    }
  }, [])

  return { battery, error }
}

function useNetwork() {
  const read = () => {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection
    return {
      online: navigator.onLine,
      type: conn?.type ?? null,
      effectiveType: conn?.effectiveType ?? null,
      downlink: conn?.downlink ?? null,
      rtt: conn?.rtt ?? null,
      saveData: conn?.saveData ?? null,
    }
  }
  const [network, setNetwork] = useState(read)

  useEffect(() => {
    const update = () => setNetwork(read())
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection
    conn?.addEventListener('change', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
      conn?.removeEventListener('change', update)
    }
  }, [])

  return network
}

function useGeolocation() {
  const [location, setLocation] = useState(null)
  const [error, setError] = useState(() =>
    !navigator.geolocation ? 'Geolocation not supported' : null
  )

  useEffect(() => {
    if (!navigator.geolocation) return
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setLocation({
          latitude: pos.coords.latitude.toFixed(6),
          longitude: pos.coords.longitude.toFixed(6),
          accuracy: pos.coords.accuracy.toFixed(1),
          altitude: pos.coords.altitude != null ? pos.coords.altitude.toFixed(1) : null,
          speed: pos.coords.speed != null ? pos.coords.speed.toFixed(2) : null,
        })
        setError(null)
      },
      (err) => setError(err.message),
      { enableHighAccuracy: true },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])

  return { location, error }
}

function useDeviceOrientation() {
  const [orientation, setOrientation] = useState(null)
  const error = typeof DeviceOrientationEvent === 'undefined' ? 'Device Orientation not supported' : null

  useEffect(() => {
    if (typeof DeviceOrientationEvent === 'undefined') return
    const handler = (e) => {
      if (e.alpha == null && e.beta == null && e.gamma == null) return
      setOrientation({
        alpha: e.alpha != null ? e.alpha.toFixed(2) : 'N/A',
        beta: e.beta != null ? e.beta.toFixed(2) : 'N/A',
        gamma: e.gamma != null ? e.gamma.toFixed(2) : 'N/A',
      })
    }
    window.addEventListener('deviceorientation', handler)
    return () => window.removeEventListener('deviceorientation', handler)
  }, [])

  return { orientation, error }
}

function useDeviceMotion() {
  const [motion, setMotion] = useState(null)
  const error = typeof DeviceMotionEvent === 'undefined' ? 'Device Motion not supported' : null

  useEffect(() => {
    if (typeof DeviceMotionEvent === 'undefined') return
    const handler = (e) => {
      const fmt = (v) => (v != null ? v.toFixed(3) : '0.000')
      setMotion({
        accG: e.accelerationIncludingGravity
          ? { x: fmt(e.accelerationIncludingGravity.x), y: fmt(e.accelerationIncludingGravity.y), z: fmt(e.accelerationIncludingGravity.z) }
          : null,
        acc: e.acceleration
          ? { x: fmt(e.acceleration.x), y: fmt(e.acceleration.y), z: fmt(e.acceleration.z) }
          : null,
        interval: e.interval,
      })
    }
    window.addEventListener('devicemotion', handler)
    return () => window.removeEventListener('devicemotion', handler)
  }, [])

  return { motion, error }
}

function useClock() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return time
}

// --- Helpers ---

function formatDuration(seconds) {
  if (!isFinite(seconds) || seconds <= 0) return 'N/A'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${m}m`
}

function getScreenInfo() {
  return {
    width: screen.width,
    height: screen.height,
    availWidth: screen.availWidth,
    availHeight: screen.availHeight,
    colorDepth: screen.colorDepth,
    pixelRatio: window.devicePixelRatio,
    orientation: screen.orientation?.type ?? 'unknown',
  }
}

function getMemoryInfo() {
  const mem = performance.memory
  if (!mem) return null
  return {
    used: (mem.usedJSHeapSize / 1048576).toFixed(1),
    total: (mem.totalJSHeapSize / 1048576).toFixed(1),
    limit: (mem.jsHeapSizeLimit / 1048576).toFixed(1),
  }
}

// --- UI Components ---

function SensorCard({ title, icon, status, children }) {
  return (
    <div className={`sensor-card ${status}`}>
      <div className="sensor-card-header">
        <span className="sensor-icon">{icon}</span>
        <h3>{title}</h3>
        <span className={`status-badge ${status}`}>
          {status === 'active' ? '● LIVE' : status === 'error' ? '✕ ERROR' : '— N/A'}
        </span>
      </div>
      <div className="sensor-card-body">{children}</div>
    </div>
  )
}

function DataRow({ label, value, unit }) {
  return (
    <div className="data-row">
      <span className="data-label">{label}</span>
      <span className="data-value">
        {value}
        {unit ? <span className="data-unit"> {unit}</span> : null}
      </span>
    </div>
  )
}

function BatteryBar({ level, charging }) {
  const color = level > 20 ? '#4ade80' : '#f87171'
  return (
    <div className="battery-bar-container">
      <div className="battery-bar-outer">
        <div className="battery-bar-inner" style={{ width: `${level}%`, background: color }} />
      </div>
      <span className="battery-level-text">
        {level}%{charging ? ' ⚡ Charging' : ''}
      </span>
    </div>
  )
}

// --- App ---

function App() {
  const [page, setPage] = useState('dashboard')
  const { battery, error: batteryError } = useBattery()
  const network = useNetwork()
  const { location, error: geoError } = useGeolocation()
  const { orientation, error: orientError } = useDeviceOrientation()
  const { motion, error: motionError } = useDeviceMotion()
  const time = useClock()
  const [screenInfo, setScreenInfo] = useState(getScreenInfo)
  const [memInfo, setMemInfo] = useState(getMemoryInfo)

  useEffect(() => {
    const update = () => setScreenInfo(getScreenInfo())
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])

  useEffect(() => {
    const id = setInterval(() => setMemInfo(getMemoryInfo()), 2000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <div className="header-logo">
            <span className="shield-icon">🛡️</span>
            <div>
              <h1>SensorGuard</h1>
              <p className="header-subtitle">Real-Time Laptop Sensor Dashboard</p>
            </div>
          </div>
          <div className="header-time">
            <div className="time-display">{time.toLocaleTimeString()}</div>
            <div className="date-display">{time.toLocaleDateString()}</div>
          </div>
        </div>
        <nav className="app-nav">
          <button
            className={`nav-tab${page === 'dashboard' ? ' active' : ''}`}
            onClick={() => setPage('dashboard')}
          >
            📊 Sensor Dashboard
          </button>
          <button
            className={`nav-tab${page === 'tabs' ? ' active' : ''}`}
            onClick={() => setPage('tabs')}
          >
            🗂️ Tabs &amp; Permissions
          </button>
          <button
            className={`nav-tab${page === 'site-permissions' ? ' active' : ''}`}
            onClick={() => setPage('site-permissions')}
          >
            🌐 Site Permissions
          </button>
          <button
            className={`nav-tab${page === 'live-monitor' ? ' active' : ''}`}
            onClick={() => setPage('live-monitor')}
          >
            🔴 Live Monitor
          </button>
        </nav>
      </header>

      {page === 'tabs' ? (
        <TabsPage />
      ) : page === 'site-permissions' ? (
        <SitePermissionsPage />
      ) : page === 'live-monitor' ? (
        <LiveMonitorPage />
      ) : (
        <main className="sensor-grid">
        {/* Battery */}
        <SensorCard
          title="Battery"
          icon="🔋"
          status={batteryError ? 'error' : battery ? 'active' : 'inactive'}
        >
          {batteryError ? (
            <p className="error-msg">{batteryError}</p>
          ) : battery ? (
            <>
              <BatteryBar level={battery.level} charging={battery.charging} />
              <DataRow label="Status" value={battery.charging ? 'Charging' : 'Discharging'} />
              <DataRow label="Level" value={battery.level} unit="%" />
              <DataRow label="Charging Time" value={formatDuration(battery.chargingTime)} />
              <DataRow label="Remaining Time" value={formatDuration(battery.dischargingTime)} />
            </>
          ) : (
            <p className="loading-msg">Initializing battery sensor…</p>
          )}
        </SensorCard>

        {/* Network */}
        <SensorCard title="Network" icon="📡" status="active">
          <DataRow label="Status" value={network.online ? '🟢 Online' : '🔴 Offline'} />
          <DataRow label="Type" value={network.type ?? 'N/A'} />
          <DataRow label="Effective Type" value={network.effectiveType ?? 'N/A'} />
          {network.downlink != null && <DataRow label="Downlink" value={network.downlink} unit="Mbps" />}
          {network.rtt != null && <DataRow label="RTT" value={network.rtt} unit="ms" />}
          {network.saveData != null && <DataRow label="Data Saver" value={network.saveData ? 'On' : 'Off'} />}
          {network.type === null && <p className="info-msg">Extended Connection API not available in this browser</p>}
        </SensorCard>

        {/* Geolocation */}
        <SensorCard
          title="Geolocation"
          icon="📍"
          status={geoError ? 'error' : location ? 'active' : 'inactive'}
        >
          {geoError ? (
            <p className="error-msg">{geoError}</p>
          ) : location ? (
            <>
              <DataRow label="Latitude" value={location.latitude} unit="°" />
              <DataRow label="Longitude" value={location.longitude} unit="°" />
              <DataRow label="Accuracy" value={location.accuracy} unit="m" />
              <DataRow label="Altitude" value={location.altitude ?? 'N/A'} unit={location.altitude ? 'm' : ''} />
              <DataRow label="Speed" value={location.speed ?? 'N/A'} unit={location.speed ? 'm/s' : ''} />
            </>
          ) : (
            <p className="loading-msg">Requesting location permission…</p>
          )}
        </SensorCard>

        {/* Orientation / Gyroscope */}
        <SensorCard
          title="Orientation / Gyroscope"
          icon="🔄"
          status={orientError ? 'error' : orientation ? 'active' : 'inactive'}
        >
          {orientError ? (
            <p className="error-msg">{orientError}</p>
          ) : orientation ? (
            <>
              <DataRow label="Alpha (Z-axis / compass)" value={orientation.alpha} unit="°" />
              <DataRow label="Beta (X-axis / tilt front-back)" value={orientation.beta} unit="°" />
              <DataRow label="Gamma (Y-axis / tilt left-right)" value={orientation.gamma} unit="°" />
            </>
          ) : (
            <p className="loading-msg">Waiting for orientation data…</p>
          )}
        </SensorCard>

        {/* Motion / Accelerometer */}
        <SensorCard
          title="Motion / Accelerometer"
          icon="📲"
          status={motionError ? 'error' : motion ? 'active' : 'inactive'}
        >
          {motionError ? (
            <p className="error-msg">{motionError}</p>
          ) : motion ? (
            <>
              {motion.accG && (
                <>
                  <p className="section-label">Accel. incl. gravity (m/s²)</p>
                  <DataRow label="X" value={motion.accG.x} unit="m/s²" />
                  <DataRow label="Y" value={motion.accG.y} unit="m/s²" />
                  <DataRow label="Z" value={motion.accG.z} unit="m/s²" />
                </>
              )}
              {motion.acc && (
                <>
                  <p className="section-label">Linear acceleration (m/s²)</p>
                  <DataRow label="X" value={motion.acc.x} unit="m/s²" />
                  <DataRow label="Y" value={motion.acc.y} unit="m/s²" />
                  <DataRow label="Z" value={motion.acc.z} unit="m/s²" />
                </>
              )}
              {motion.interval != null && (
                <DataRow label="Interval" value={motion.interval.toFixed(0)} unit="ms" />
              )}
            </>
          ) : (
            <p className="loading-msg">Waiting for motion data…</p>
          )}
        </SensorCard>

        {/* Display / Screen */}
        <SensorCard title="Display / Screen" icon="🖥️" status="active">
          <DataRow label="Resolution" value={`${screenInfo.width} × ${screenInfo.height}`} />
          <DataRow label="Available" value={`${screenInfo.availWidth} × ${screenInfo.availHeight}`} />
          <DataRow label="Color Depth" value={screenInfo.colorDepth} unit="bit" />
          <DataRow label="Pixel Ratio" value={screenInfo.pixelRatio} unit="x" />
          <DataRow label="Orientation" value={screenInfo.orientation} />
        </SensorCard>

        {/* Memory */}
        <SensorCard title="Memory (JS Heap)" icon="💾" status={memInfo ? 'active' : 'inactive'}>
          {memInfo ? (
            <>
              <DataRow label="Used" value={memInfo.used} unit="MB" />
              <DataRow label="Allocated" value={memInfo.total} unit="MB" />
              <DataRow label="Limit" value={memInfo.limit} unit="MB" />
            </>
          ) : (
            <p className="info-msg">Memory API not available (Chrome-only, non-incognito)</p>
          )}
        </SensorCard>

        {/* System Info */}
        <SensorCard title="System Info" icon="💻" status="active">
          <DataRow label="Platform" value={navigator.platform || 'N/A'} />
          <DataRow label="Language" value={navigator.language} />
          <DataRow label="CPU Cores" value={navigator.hardwareConcurrency ?? 'N/A'} />
          <DataRow label="Max Touch Points" value={navigator.maxTouchPoints} />
          <DataRow label="Cookies Enabled" value={navigator.cookieEnabled ? 'Yes' : 'No'} />
          <div className="ua-box">
            <span className="data-label">User Agent</span>
            <span className="ua-text">{navigator.userAgent}</span>
          </div>
        </SensorCard>
      </main>
      )}

      <footer className="app-footer">
        SensorGuard — Real-time browser sensor monitoring
      </footer>
    </div>
  )
}

export default App
