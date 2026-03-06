import { useState, useEffect, useCallback, useMemo } from 'react'
import { useDetectedBrowsers, ALL_BROWSERS_META } from './browserDetection.js'

// ── Constants ──────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL = 15 // seconds between auto-scans

const PERM_TABS = ['camera', 'microphone', 'geolocation', 'notifications']
const PERM_ICON = {
  camera: '📷', microphone: '🎤', geolocation: '📍', notifications: '🔔',
  'clipboard-read': '📋', 'clipboard-write': '📋',
}

const STATUS_COLOR = { allowed: '#4ade80', blocked: '#f87171', ask: '#fbbf24' }
const STATUS_ICON = { allowed: '✅', blocked: '🚫', ask: '❓' }

const SND_DEV_PREFIX = '/dev/snd/'

const KNOWN_APPS = {
  "Teams.exe": { name: "Microsoft Teams", icon: "Teams" },
  "Zoom.exe": { name: "Zoom", icon: "Zoom" },
  "obs64.exe": { name: "OBS Studio", icon: "OBS" },
  "discord.exe": { name: "Discord", icon: "Discord" },
  "skype.exe": { name: "Skype", icon: "Skype" },
  "chrome.exe": { name: "Google Chrome", icon: "Chrome", isBrowser: true },
  "msedge.exe": { name: "Microsoft Edge", icon: "Edge", isBrowser: true },
  "brave.exe": { name: "Brave Browser", icon: "Brave", isBrowser: true },
  "firefox.exe": { name: "Firefox", icon: "Firefox", isBrowser: true },
  "opera.exe": { name: "Opera", icon: "Opera", isBrowser: true },
  "Safari": { name: "Safari", icon: "Safari", isBrowser: true }
}

// ── Data fetching ──────────────────────────────────────────────────────────────

async function fetchScan() {
  const res = await fetch('/api/scan/all')
  if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`)
  return res.json()
}

function useAdvancedSensors() {
  const [sensors, setSensors] = useState(null);
  useEffect(() => {
    let ws;
    let reconnectTimeout;
    function connect() {
      ws = new WebSocket('ws://127.0.0.1:8996');
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.event === 'sensors_update') setSensors(data.sensors);
        } catch (e) { }
      };
      ws.onclose = () => { reconnectTimeout = setTimeout(connect, 2000); };
    }
    connect();
    return () => { clearTimeout(reconnectTimeout); if (ws) { ws.onclose = null; ws.close(); } };
  }, []);
  return sensors;
}

function useBackgroundWindowTitles() {
  const [apps, setApps] = useState([]);
  useEffect(() => {
    let ws;
    let reconnectTimeout;
    function connect() {
      ws = new WebSocket('ws://127.0.0.1:8997');
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.event === 'background_apps') setApps(data.apps);
        } catch (e) { }
      };
      ws.onclose = () => { reconnectTimeout = setTimeout(connect, 2000); };
    }
    connect();
    return () => { clearTimeout(reconnectTimeout); if (ws) { ws.onclose = null; ws.close(); } };
  }, []);
  return apps;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getProcessDetails(procExe, bgApps, browserData) {
  const exeName = procExe.toLowerCase();

  // Try to match from known apps
  const matchedKey = Object.keys(KNOWN_APPS).find(k => k.toLowerCase() === exeName);
  const known = matchedKey ? KNOWN_APPS[matchedKey] : null;

  let displayName = known ? known.name : procExe;
  let activeTitle = "";
  let activeDomain = "";
  let duration = "Unknown";

  // Try to attach window title via background_apps
  // This is generic window title parsing fallback (Option 2)
  const windowApp = bgApps.find(a =>
    a.app.toLowerCase().includes(exeName.replace('.exe', '')) ||
    (known && a.app.toLowerCase().includes(known.name.toLowerCase()))
  );

  if (windowApp && windowApp.title) {
    activeTitle = windowApp.title;
    if (known && known.isBrowser) {
      // Extract domain from title (e.g. "Meet - abc - Google Chrome")
      const parts = activeTitle.rsplit ? activeTitle.rsplit(' - ', 1) : activeTitle.split(' - ');
      if (parts.length > 1) {
        let possibleDomain = parts[0];
        possibleDomain = possibleDomain.replace(/^\(\d+\)\s*/, '');
        activeDomain = possibleDomain;
      }
    }
  }

  // Fallback 3: Cross reference allowed sites if it's a browser and no domain extracted yet
  let allowedSites = [];
  if (known && known.isBrowser) {
    const browserKey = Object.keys(browserData).find(k => known.name.toLowerCase().includes(k.toLowerCase()));
    if (browserKey && browserData[browserKey]) {
      for (const type of ['camera', 'microphone']) {
        for (const entry of browserData[browserKey][type] || []) {
          if (entry.status === 'allowed' && entry.site) {
            allowedSites.push(entry.site);
          }
        }
      }
    }
    allowedSites = [...new Set(allowedSites)];
    if (!activeDomain && allowedSites.length > 0) {
      activeDomain = "Likely: " + allowedSites[0];
      activeTitle = "Unknown Tab";
    }
  }

  return {
    displayName,
    exe: procExe,
    isBrowser: known?.isBrowser || false,
    activeDomain,
    activeTitle,
    allowedSites
  };
}

// ── Components ────────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const color = STATUS_COLOR[status] ?? '#64748b'
  const icon = STATUS_ICON[status] ?? '—'
  return (
    <span className="lm-badge" style={{ color, borderColor: color }}>
      {icon} {status}
    </span>
  )
}

function MultiSensorAttackAlert({ cameraActive, micActive, sensors }) {
  const isAttack = useMemo(() => {
    if (!cameraActive && !micActive) return false;
    if (!sensors) return false;
    const clipAccess = sensors.clipboard?.status === 'ACCESSED';
    const hookDetect = sensors.keyboard?.status === 'DETECTED';
    return clipAccess || hookDetect;
  }, [cameraActive, micActive, sensors]);

  if (!isAttack) return null;

  return (
    <div className="lm-alert" style={{ background: '#fef2f2', borderColor: '#f87171', color: '#991b1b', marginBottom: '1rem' }}>
      <span className="lm-alert-icon">🚨</span>
      <div>
        <strong style={{ fontSize: '1.2rem', color: '#b91c1c' }}>MULTI-SENSOR ATTACK ALERT</strong>
        <p style={{ marginTop: '0.25rem', opacity: 0.9 }}>
          Camera/Microphone is actively running while an unknown process simultaneously accessed the Clipboard or installed a Global Keyboard Hook.
        </p>
      </div>
    </div>
  );
}

function SensorStatusPanel({ camera, microphone, browserData, bgApps, advancedSensors }) {
  const camActive = camera?.active ?? false
  const micActive = microphone?.active ?? false

  const camProcs = (camera?.processes ?? []).map(p => p.process).filter(Boolean);
  const micProcs = (microphone?.processes ?? []).map(p => p.process).filter(Boolean);

  const renderCamMicDetail = (procs) => {
    if (procs.length === 0) return { process: '—', info: '' };
    const det = getProcessDetails(procs[0], bgApps, browserData);
    if (det.isBrowser) {
      return {
        process: `${det.displayName} → ${det.activeDomain || 'Unknown'}`,
        info: det.activeTitle ? `Tab: "${det.activeTitle}"` : ''
      };
    } else {
      return {
        process: `${det.displayName} (${det.exe})`,
        info: det.activeTitle ? `Window: "${det.activeTitle}"` : ''
      };
    }
  };

  const camDet = renderCamMicDetail(camProcs);
  const micDet = renderCamMicDetail(micProcs);

  const sClip = advancedSensors?.clipboard || { status: 'IDLE', info: '—' };
  const sLoc = advancedSensors?.location || { status: 'IDLE', info: '—' };
  const sScreen = advancedSensors?.screen_capture || { status: 'IDLE', info: '—' };
  const sKey = advancedSensors?.keyboard || { status: 'IDLE', info: '—' };
  const sNet = advancedSensors?.network || { status: 'IDLE', info: '—' };
  const sUsb = advancedSensors?.usb || { status: 'IDLE', info: '—' };

  return (
    <section className="info-panel lm-panel" style={{ marginBottom: '1rem' }}>
      <h2 className="panel-title" style={{ borderBottom: '1px solid #334155' }}><span>🛡️</span> SENSOR STATUS PANEL</h2>
      <div className="ds-table-wrap" style={{ marginTop: '0' }}>
        <table className="ds-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', background: '#1e293b', borderBottom: '2px solid #334155' }}>
              <th style={{ padding: '0.75rem' }}>SENSOR</th>
              <th style={{ padding: '0.75rem' }}>STATUS</th>
              <th style={{ padding: '0.75rem' }}>PROCESS DETAIL</th>
              <th style={{ padding: '0.75rem' }}>RISK</th>
            </tr>
          </thead>
          <tbody>
            {/* Camera */}
            <tr style={{ borderBottom: '1px solid #334155', background: camActive ? 'rgba(74, 222, 128, 0.05)' : '' }}>
              <td style={{ padding: '0.75rem' }}>📷 Camera</td>
              <td style={{ padding: '0.75rem' }}>
                <span style={{ color: camActive ? '#4ade80' : '#64748b', fontWeight: 'bold' }}>
                  {camActive ? '● ACTIVE' : '○ IDLE'}
                </span>
              </td>
              <td style={{ padding: '0.75rem' }}>
                <div>{camActive ? camDet.process : '—'}</div>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{camActive ? camDet.info : ''}</div>
              </td>
              <td style={{ padding: '0.75rem' }}>
                <span style={{ color: camActive ? '#4ade80' : '#64748b' }}>{camActive ? 'NORMAL' : '—'}</span>
              </td>
            </tr>

            {/* Microphone */}
            <tr style={{ borderBottom: '1px solid #334155', background: micActive ? 'rgba(251, 146, 60, 0.05)' : '' }}>
              <td style={{ padding: '0.75rem' }}>🎙 Microphone</td>
              <td style={{ padding: '0.75rem' }}>
                <span style={{ color: micActive ? '#fb923c' : '#64748b', fontWeight: 'bold' }}>
                  {micActive ? '● ACTIVE' : '○ IDLE'}
                </span>
              </td>
              <td style={{ padding: '0.75rem' }}>
                <div>{micActive ? micDet.process : '—'}</div>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{micActive ? micDet.info : ''}</div>
              </td>
              <td style={{ padding: '0.75rem' }}>
                <span style={{ color: micActive ? '#4ade80' : '#64748b' }}>{micActive ? 'NORMAL' : '—'}</span>
              </td>
            </tr>

            {/* Location */}
            <tr style={{ borderBottom: '1px solid #334155' }}>
              <td style={{ padding: '0.75rem' }}>📍 Location</td>
              <td style={{ padding: '0.75rem' }}>
                <span style={{ color: sLoc.status === 'ACTIVE' ? '#60a5fa' : '#64748b', fontWeight: 'bold' }}>
                  {sLoc.status === 'ACTIVE' ? '● ACTIVE' : '○ IDLE'}
                </span>
              </td>
              <td style={{ padding: '0.75rem', color: '#94a3b8' }}>{sLoc.info}</td>
              <td style={{ padding: '0.75rem' }}>
                <span style={{ color: sLoc.status === 'ACTIVE' ? '#60a5fa' : '#64748b' }}>
                  {sLoc.status === 'ACTIVE' ? 'LOW' : '—'}
                </span>
              </td>
            </tr>

            {/* Clipboard */}
            <tr style={{ borderBottom: '1px solid #334155', background: sClip.status !== 'IDLE' ? 'rgba(251, 191, 36, 0.05)' : '' }}>
              <td style={{ padding: '0.75rem' }}>📋 Clipboard</td>
              <td style={{ padding: '0.75rem' }}>
                <span style={{ color: sClip.status !== 'IDLE' ? '#fbbf24' : '#64748b', fontWeight: 'bold' }}>
                  {sClip.status !== 'IDLE' ? '⚠ ACCESSED' : '○ IDLE'}
                </span>
              </td>
              <td style={{ padding: '0.75rem', color: '#94a3b8' }}>{sClip.info}</td>
              <td style={{ padding: '0.75rem' }}>
                <span style={{ color: sClip.status !== 'IDLE' ? '#fbbf24' : '#64748b' }}>
                  {sClip.status !== 'IDLE' ? 'HIGH' : '—'}
                </span>
              </td>
            </tr>

            {/* Screen Capture */}
            <tr style={{ borderBottom: '1px solid #334155' }}>
              <td style={{ padding: '0.75rem' }}>🖥 Screen Cap</td>
              <td style={{ padding: '0.75rem' }}>
                <span style={{ color: sScreen.status !== 'IDLE' ? '#fbbf24' : '#64748b', fontWeight: 'bold' }}>
                  {sScreen.status !== 'IDLE' ? '● ACTIVE' : '○ IDLE'}
                </span>
              </td>
              <td style={{ padding: '0.75rem', color: '#94a3b8' }}>{sScreen.info}</td>
              <td style={{ padding: '0.75rem' }}>
                <span style={{ color: sScreen.status !== 'IDLE' ? '#fbbf24' : '#64748b' }}>
                  {sScreen.status !== 'IDLE' ? 'HIGH' : '—'}
                </span>
              </td>
            </tr>

            {/* Keyboard Hook */}
            <tr style={{ borderBottom: '1px solid #334155', background: sKey.status !== 'IDLE' ? 'rgba(248, 113, 113, 0.05)' : '' }}>
              <td style={{ padding: '0.75rem' }}>⌨ Keyboard Hook</td>
              <td style={{ padding: '0.75rem' }}>
                <span style={{ color: sKey.status !== 'IDLE' ? '#f87171' : '#64748b', fontWeight: 'bold' }}>
                  {sKey.status !== 'IDLE' ? '🚨 DETECTED' : '○ IDLE'}
                </span>
              </td>
              <td style={{ padding: '0.75rem', color: '#94a3b8' }}>{sKey.info}</td>
              <td style={{ padding: '0.75rem' }}>
                <span style={{ color: sKey.status !== 'IDLE' ? '#f87171' : '#64748b', fontWeight: 'bold' }}>
                  {sKey.status !== 'IDLE' ? 'CRITICAL' : '—'}
                </span>
              </td>
            </tr>

            {/* Network */}
            <tr style={{ borderBottom: '1px solid #334155' }}>
              <td style={{ padding: '0.75rem' }}>🌐 Network</td>
              <td style={{ padding: '0.75rem' }}>
                <span style={{ color: sNet.status !== 'IDLE' ? '#4ade80' : '#64748b', fontWeight: 'bold' }}>
                  {sNet.status !== 'IDLE' ? '● ACTIVE' : '○ IDLE'}
                </span>
              </td>
              <td style={{ padding: '0.75rem', color: '#94a3b8' }}>{sNet.info}</td>
              <td style={{ padding: '0.75rem' }}>
                <span style={{ color: sNet.status !== 'IDLE' ? '#4ade80' : '#64748b' }}>
                  {sNet.status !== 'IDLE' ? 'NORMAL' : '—'}
                </span>
              </td>
            </tr>

            {/* USB */}
            <tr style={{ borderBottom: 'none' }}>
              <td style={{ padding: '0.75rem' }}>🔌 USB</td>
              <td style={{ padding: '0.75rem' }}>
                <span style={{ color: sUsb.status !== 'IDLE' ? '#60a5fa' : '#64748b', fontWeight: 'bold' }}>
                  {sUsb.status !== 'IDLE' ? '● ACTIVE' : '○ IDLE'}
                </span>
              </td>
              <td style={{ padding: '0.75rem', color: '#94a3b8' }}>{sUsb.info}</td>
              <td style={{ padding: '0.75rem' }}>
                <span style={{ color: sUsb.status !== 'IDLE' ? '#60a5fa' : '#64748b' }}>
                  {sUsb.status !== 'IDLE' ? 'LOW' : '—'}
                </span>
              </td>
            </tr>

          </tbody>
        </table>
      </div>
    </section>
  )
}

function ServerOffBanner({ error }) {
  return (
    <div className="lm-alert server-off-alert">
      <span className="lm-alert-icon">🔌</span>
      <div>
        <strong>Scanner server not reachable</strong>
        <p className="lm-alert-detail">
          The backend server must be running to read real browser data.
          Start it with: <code>npm run dev:server</code> (or <code>npm run dev:all</code>
          to run both Vite and the server together).
        </p>
        {error && <p className="lm-alert-err">Error: {error}</p>}
      </div>
    </div>
  )
}

function PermTable({ entries }) {
  if (!entries || entries.length === 0) {
    return <p className="lm-empty">No recorded permissions for this type.</p>
  }
  return (
    <div className="lm-table-wrap">
      <table className="lm-table">
        <thead>
          <tr>
            <th>Website</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={i}>
              <td className="lm-site">{e.site}</td>
              <td><StatusBadge status={e.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BrowserPanel({ browserData, detectedBrowsers }) {
  const [activeBrowser, setActiveBrowser] = useState(detectedBrowsers[0] || 'chrome')
  const [activePerm, setActivePerm] = useState('camera')

  useEffect(() => {
    if (detectedBrowsers.length > 0 && !detectedBrowsers.includes(activeBrowser)) {
      setActiveBrowser(detectedBrowsers[0]);
    }
  }, [detectedBrowsers, activeBrowser]);

  const bData = browserData[activeBrowser]
  const hasError = bData?.error

  return (
    <section className="info-panel lm-panel">
      <h2 className="panel-title"><span>🌐</span> Browser Permissions (Live)</h2>
      <div className="lm-tabs browser-tabs">
        {detectedBrowsers.map(b => {
          const meta = ALL_BROWSERS_META[b] || { icon: '🌐', label: b }
          return (
            <button
              key={b}
              className={`lm-tab${activeBrowser === b ? ' active' : ''}`}
              onClick={() => setActiveBrowser(b)}
            >
              {meta.icon} {meta.label}
            </button>
          )
        })}
      </div>
      <div className="lm-tabs perm-tabs">
        {PERM_TABS.map(p => {
          const count = (!hasError && bData?.[p]?.length) || 0
          return (
            <button
              key={p}
              className={`lm-tab perm-tab${activePerm === p ? ' active' : ''}`}
              onClick={() => setActivePerm(p)}
            >
              {PERM_ICON[p]} {p}
              {count > 0 && <span className="lm-count">{count}</span>}
            </button>
          )
        })}
      </div>
      <div className="lm-panel-body">
        {hasError ? (
          <div className="lm-browser-error">
            <span>📂</span>
            <div>
              <strong>Profile not found or inaccessible</strong>
              <p>{bData.error}</p>
              <p className="lm-hint">
                Make sure the browser is installed and has been opened at least once.
              </p>
            </div>
          </div>
        ) : (
          <PermTable entries={bData?.[activePerm]} />
        )}
      </div>
    </section>
  )
}

function OSAppsPanel({ os: osData }) {
  const [activePerm, setActivePerm] = useState('camera')

  const note = osData?.note
  const perms = ['camera', 'microphone', 'geolocation']
  const entries = osData?.[activePerm] ?? []
  const hasError = Array.isArray(entries) && entries[0]?.error

  return (
    <section className="info-panel lm-panel">
      <h2 className="panel-title"><span>🪟</span> Windows App Permissions (Registry)</h2>
      {note ? (
        <div className="lm-os-note">
          <span>ℹ️</span>
          <div>
            <strong>Not running on Windows</strong>
            <p>{note}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="lm-tabs perm-tabs">
            {perms.map(p => (
              <button
                key={p}
                className={`lm-tab perm-tab${activePerm === p ? ' active' : ''}`}
                onClick={() => setActivePerm(p)}
              >
                {PERM_ICON[p]} {p}
              </button>
            ))}
          </div>
          <div className="lm-panel-body">
            {hasError ? (
              <p className="lm-empty" style={{ color: '#f87171' }}>
                Registry read error: {entries[0].error}
              </p>
            ) : entries.length === 0 ? (
              <p className="lm-empty">No app permissions recorded.</p>
            ) : (
              <div className="lm-table-wrap">
                <table className="lm-table">
                  <thead>
                    <tr><th>Application</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {entries.map((e, i) => (
                      <tr key={i}>
                        <td className="lm-site">{e.app}</td>
                        <td><StatusBadge status={e.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}

function BackgroundAppsPanel({ processes: procData }) {
  const [search, setSearch] = useState('')

  const list = procData?.processes ?? []
  const note = procData?.note
  const error = procData?.error

  const query = search.trim().toLowerCase()
  const filtered = query
    ? list.filter(p => p.name.toLowerCase().includes(query))
    : list

  const hasCpu = list.some(p => p.cpu != null)
  const hasMem = list.some(p => p.mem != null)

  return (
    <section className="info-panel lm-panel">
      <h2 className="panel-title"><span>📋</span> Background Apps (Running Processes)</h2>
      {note && (
        <div className="lm-os-note">
          <span>ℹ️</span>
          <div><p>{note}</p></div>
        </div>
      )}
      {error && (
        <p className="lm-empty" style={{ color: '#f87171' }}>Error: {error}</p>
      )}
      {!note && !error && (
        <>
          <div style={{ padding: '0.5rem 0 0.75rem' }}>
            <input
              type="text"
              className="lm-search"
              placeholder="Filter by app name…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="lm-panel-body">
            {filtered.length === 0 ? (
              <p className="lm-empty">No running processes found.</p>
            ) : (
              <div className="lm-table-wrap">
                <table className="lm-table">
                  <thead>
                    <tr>
                      <th>App / Process</th>
                      <th>PID</th>
                      {hasCpu && <th>CPU</th>}
                      {hasMem && <th>Memory</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((p, i) => (
                      <tr key={p.pid != null ? `${p.pid}-${p.name}` : i}>
                        <td className="lm-site">🖥️ {p.name}</td>
                        <td style={{ color: '#64748b' }}>{p.pid ?? '—'}</td>
                        {hasCpu && <td>{p.cpu ?? '—'}</td>}
                        {hasMem && <td>{p.mem ?? '—'}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p className="lm-hint" style={{ marginTop: '0.5rem' }}>
            Showing {filtered.length} of {list.length} running processes
          </p>
        </>
      )}
    </section>
  )
}

function ScanFooter({ lastScan, countdown, loading, onRefresh }) {
  return (
    <div className="lm-footer">
      <div className="lm-footer-info">
        {lastScan && (
          <span>Last scan: <strong>{lastScan.toLocaleTimeString()}</strong></span>
        )}
        {!loading && (
          <span className="lm-countdown">Next scan in <strong>{countdown}s</strong></span>
        )}
        {loading && <span className="lm-scanning">⟳ Scanning…</span>}
      </div>
      <button
        className={`lm-refresh-btn${loading ? ' loading' : ''}`}
        onClick={onRefresh}
        disabled={loading}
      >
        {loading ? '⟳ Scanning…' : '🔄 Scan Now'}
      </button>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function LiveMonitorPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [lastScan, setLastScan] = useState(null)
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL)

  const advancedSensors = useAdvancedSensors()
  const bgApps = useBackgroundWindowTitles()
  const detectedBrowsers = useDetectedBrowsers()

  const scan = useCallback(async () => {
    setLoading(true)
    try {
      const json = await fetchScan()
      setData(json)
      setLastScan(new Date())
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
      setCountdown(REFRESH_INTERVAL)
    }
  }, [])

  useEffect(() => {
    scan()
    const id = setInterval(scan, REFRESH_INTERVAL * 1000)
    return () => clearInterval(id)
  }, [scan])

  useEffect(() => {
    if (loading) return
    const id = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000)
    return () => clearInterval(id)
  }, [loading])

  const browserData = {};
  if (data) {
    for (const b of detectedBrowsers) {
      browserData[b] = data[b] || {};
    }
  }

  return (
    <div className="lm-page">
      <div className="notice-banner">
        <span className="notice-icon">🔴</span>
        <div>
          <strong>Live Permission Monitor:</strong> This tool reads your actual browser
          permission databases in real time — Chrome/Edge{' '}
          <code>Preferences</code> JSON and Firefox{' '}
          <code>permissions.sqlite</code>. On Windows it also reads the{' '}
          <code>CapabilityAccessManager</code> registry.
          Start the backend: <code>npm run dev:all</code>
        </div>
      </div>

      {error && !data && <ServerOffBanner error={error} />}

      {/* Multi-Sensor Attack Alert Banner */}
      {data && (
        <MultiSensorAttackAlert
          cameraActive={data?.camera?.active}
          micActive={data?.microphone?.active}
          sensors={advancedSensors}
        />
      )}

      {loading && !data && (
        <div className="lm-loading">
          <div className="lm-spinner" />
          <span>Scanning browser profiles and system permissions…</span>
        </div>
      )}

      {/* Primary Sensor Status Panel (Replacing DeviceStatusSummary) */}
      {data && (
        <SensorStatusPanel
          camera={data.camera}
          microphone={data.microphone}
          browserData={browserData}
          bgApps={bgApps}
          advancedSensors={advancedSensors}
        />
      )}

      {/* Main content grid */}
      {data && (
        <div className="lm-grid">
          <BrowserPanel browserData={browserData} detectedBrowsers={detectedBrowsers} />
          <OSAppsPanel os={data.os} />
          <BackgroundAppsPanel processes={data.processes} />
        </div>
      )}

      {(data || loading) && (
        <ScanFooter
          lastScan={lastScan}
          countdown={countdown}
          loading={loading}
          onRefresh={scan}
        />
      )}
    </div>
  )
}
