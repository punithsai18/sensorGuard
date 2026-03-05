import { useState, useEffect, useCallback } from 'react'
import { useDetectedBrowsers, ALL_BROWSERS_META } from './browserDetection.js'

// ── Constants ──────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL = 15 // seconds between auto-scans

const PERM_TABS = ['camera', 'microphone', 'geolocation', 'notifications']

const PERM_ICON = {
  camera: '📷',
  microphone: '🎤',
  geolocation: '📍',
  notifications: '🔔',
  'clipboard-read': '📋',
  'clipboard-write': '📋',
}

const STATUS_COLOR = { allowed: '#4ade80', blocked: '#f87171', ask: '#fbbf24' }
const STATUS_ICON = { allowed: '✅', blocked: '🚫', ask: '❓' }

// Prefix used when displaying Linux audio device paths
const SND_DEV_PREFIX = '/dev/snd/'

// ── Data fetching ──────────────────────────────────────────────────────────────

async function fetchScan() {
  const res = await fetch('/api/scan/all')
  if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`)
  return res.json()
}

// ── Small presentational components ───────────────────────────────────────────

function StatusBadge({ status }) {
  const color = STATUS_COLOR[status] ?? '#64748b'
  const icon = STATUS_ICON[status] ?? '—'
  return (
    <span className="lm-badge" style={{ color, borderColor: color }}>
      {icon} {status}
    </span>
  )
}

/** Camera-active alert banner shown when camera.active === true */
function CameraAlert({ camera }) {
  if (!camera || !camera.active) return null
  const procs = camera.processes ?? []
  return (
    <div className="lm-alert camera-alert">
      <span className="lm-alert-icon">⚠️</span>
      <div>
        <strong>Camera Active Right Now</strong>
        {procs.length > 0 && (
          <div className="lm-alert-procs">
            {procs.map((p, i) => (
              <span key={i} className="lm-proc-badge">
                {p.process}{p.device ? ` (${p.device})` : ''}{p.pid ? ` pid:${p.pid}` : ''}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Microphone-active alert banner */
function MicAlert({ microphone }) {
  if (!microphone || !microphone.active) return null
  const procs = microphone.processes ?? []
  return (
    <div className="lm-alert mic-alert">
      <span className="lm-alert-icon">🎤</span>
      <div>
        <strong>Microphone Active Right Now</strong>
        {procs.length > 0 && (
          <div className="lm-alert-procs">
            {procs.map((p, i) => (
              <span key={i} className="lm-proc-badge mic-proc-badge">
                {p.process}{p.device ? ` (${p.device})` : ''}{p.pid ? ` pid:${p.pid}` : ''}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Device Status Summary — the top "status board" showing camera and mic
 * side-by-side with process name, time detected, and allowed websites.
 */
function DeviceStatusSummary({ camera, microphone, browserData, scanTime }) {
  const camActive = camera?.active ?? false
  const micActive = microphone?.active ?? false

  function procList(devData) {
    return (devData?.processes ?? []).map(p => p.process).filter(Boolean)
  }

  /** Gather sites from all browsers that have the given permission allowed. */
  function allowedSites(permission) {
    const sites = new Set()
    for (const bd of Object.values(browserData)) {
      for (const entry of bd?.[permission] ?? []) {
        if (entry.status === 'allowed' && entry.site) sites.add(entry.site)
      }
    }
    return [...sites].slice(0, 5) // show up to 5
  }

  const camProcs = procList(camera)
  const micProcs = procList(microphone)
  const camSites = allowedSites('camera')
  const micSites = allowedSites('microphone')

  const timeStr = scanTime
    ? scanTime.toLocaleTimeString()
    : '—'

  return (
    <div className="ds-summary">
      {/* Camera card */}
      <div className={`ds-card ${camActive ? 'ds-active' : 'ds-idle'}`}>
        <div className="ds-card-header">
          <span className="ds-icon">📷</span>
          <span className="ds-label">Camera</span>
          <span className={`ds-status-badge ${camActive ? 'ds-status-active' : 'ds-status-idle'}`}>
            {camActive ? '● ACTIVE' : '○ IDLE'}
          </span>
        </div>
        <div className="ds-card-body">
          <div className="ds-row">
            <span className="ds-key">Process</span>
            <span className="ds-val">
              {camProcs.length > 0 ? camProcs.join(', ') : '—'}
            </span>
          </div>
          <div className="ds-row">
            <span className="ds-key">Allowed for</span>
            <span className="ds-val ds-sites">
              {camSites.length > 0
                ? camSites.map((s, i) => (
                  <span key={i} className="ds-site-chip">{s}</span>
                ))
                : <span className="ds-none">no sites recorded</span>}
            </span>
          </div>
          <div className="ds-row">
            <span className="ds-key">Scan time</span>
            <span className="ds-val ds-time">{timeStr}</span>
          </div>
        </div>
      </div>

      {/* Microphone card */}
      <div className={`ds-card ds-card-mic ${micActive ? 'ds-active' : 'ds-idle'}`}>
        <div className="ds-card-header">
          <span className="ds-icon">🎤</span>
          <span className="ds-label">Microphone</span>
          <span className={`ds-status-badge ${micActive ? 'ds-status-mic-active' : 'ds-status-idle'}`}>
            {micActive ? '● ACTIVE' : '○ IDLE'}
          </span>
        </div>
        <div className="ds-card-body">
          <div className="ds-row">
            <span className="ds-key">Process</span>
            <span className="ds-val">
              {micProcs.length > 0 ? micProcs.join(', ') : '—'}
            </span>
          </div>
          <div className="ds-row">
            <span className="ds-key">Allowed for</span>
            <span className="ds-val ds-sites">
              {micSites.length > 0
                ? micSites.map((s, i) => (
                  <span key={i} className="ds-site-chip">{s}</span>
                ))
                : <span className="ds-none">no sites recorded</span>}
            </span>
          </div>
          <div className="ds-row">
            <span className="ds-key">Scan time</span>
            <span className="ds-val ds-time">{timeStr}</span>
          </div>
        </div>
      </div>

      {/* Combined device table */}
      <div className="ds-table-wrap">
        <table className="ds-table">
          <thead>
            <tr>
              <th>Device</th>
              <th>Status</th>
              <th>App / Process</th>
              <th>Websites with access</th>
            </tr>
          </thead>
          <tbody>
            <tr className={camActive ? 'ds-tr-active' : ''}>
              <td>📷 Camera</td>
              <td>
                <span className={`ds-tbl-status ${camActive ? 'ds-status-active' : 'ds-status-idle'}`}>
                  {camActive ? '● ACTIVE' : '○ IDLE'}
                </span>
              </td>
              <td className="ds-proc-col">
                {camProcs.length > 0 ? camProcs.join(', ') : '—'}
              </td>
              <td className="ds-sites-col">
                {camSites.length > 0 ? camSites.join(', ') : '—'}
              </td>
            </tr>
            <tr className={micActive ? 'ds-tr-mic-active' : ''}>
              <td>🎤 Microphone</td>
              <td>
                <span className={`ds-tbl-status ${micActive ? 'ds-status-mic-active' : 'ds-status-idle'}`}>
                  {micActive ? '● ACTIVE' : '○ IDLE'}
                </span>
              </td>
              <td className="ds-proc-col">
                {micProcs.length > 0 ? micProcs.join(', ') : '—'}
              </td>
              <td className="ds-sites-col">
                {micSites.length > 0 ? micSites.join(', ') : '—'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** "Server not running" notice */
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

/** Per-browser permission table for one permission type */
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

      {/* Browser tabs */}
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

      {/* Permission type tabs */}
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

      {/* Content */}
      <div className="lm-panel-body">
        {hasError ? (
          <div className="lm-browser-error">
            <span>📂</span>
            <div>
              <strong>Profile not found or inaccessible</strong>
              <p>{bData.error}</p>
              <p className="lm-hint">
                Make sure the browser is installed and has been opened at least once.
                On Windows the Preferences file lives at<br />
                <code>%LOCALAPPDATA%\Google\Chrome\User Data\Default\Preferences</code>
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

/** Windows OS app permissions panel */
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
            <p className="lm-hint">
              Registry path on Windows:<br />
              <code>HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam</code>
            </p>
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

/** Camera detection detail panel */
function CameraDetailPanel({ camera }) {
  const active = camera?.active ?? false
  const processes = camera?.processes ?? []
  const devices = camera?.videoDevices ?? []
  const note = camera?.note
  const error = camera?.error

  return (
    <section className="info-panel lm-panel">
      <h2 className="panel-title">
        <span>📷</span> Active Camera Detection
        <span className={`lm-status-dot ${active ? 'dot-active' : 'dot-idle'}`} />
        <span style={{ fontSize: '0.75rem', color: active ? '#4ade80' : '#64748b' }}>
          {active ? 'IN USE' : 'IDLE'}
        </span>
      </h2>
      <div className="lm-panel-body">
        {error && <p className="lm-empty" style={{ color: '#f87171' }}>{error}</p>}
        {note && <p className="lm-hint" style={{ padding: '0.5rem 0' }}>{note}</p>}

        {devices.length > 0 && (
          <div className="info-row">
            <span className="info-label">Video Devices</span>
            <span className="info-value">{devices.map(d => `/dev/${d}`).join(', ')}</span>
          </div>
        )}

        {processes.length === 0 && !error && !note && (
          <p className="lm-empty">Camera is idle — no active processes detected.</p>
        )}

        {processes.length > 0 && (
          <div className="lm-table-wrap" style={{ marginTop: '0.5rem' }}>
            <table className="lm-table">
              <thead>
                <tr>
                  <th>Process</th>
                  {processes.some(p => p.device) && <th>Device</th>}
                  {processes.some(p => p.pid) && <th>PID</th>}
                </tr>
              </thead>
              <tbody>
                {processes.map((p, i) => (
                  <tr key={i}>
                    <td className="lm-site" style={{ color: '#f87171' }}>🔴 {p.process}</td>
                    {processes.some(pr => pr.device) && <td>{p.device ? `/dev/${p.device}` : '—'}</td>}
                    {processes.some(pr => pr.pid) && <td style={{ color: '#64748b' }}>{p.pid ?? '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

/** Microphone detection detail panel */
function MicDetailPanel({ microphone }) {
  const active = microphone?.active ?? false
  const processes = microphone?.processes ?? []
  const devices = microphone?.audioDevices ?? []
  const note = microphone?.note
  const error = microphone?.error

  return (
    <section className="info-panel lm-panel">
      <h2 className="panel-title">
        <span>🎤</span> Active Microphone Detection
        <span className={`lm-status-dot ${active ? 'dot-mic-active' : 'dot-idle'}`} />
        <span style={{ fontSize: '0.75rem', color: active ? '#fb923c' : '#64748b' }}>
          {active ? 'IN USE' : 'IDLE'}
        </span>
      </h2>
      <div className="lm-panel-body">
        {error && <p className="lm-empty" style={{ color: '#f87171' }}>{error}</p>}
        {note && <p className="lm-hint" style={{ padding: '0.5rem 0' }}>{note}</p>}

        {devices.length > 0 && (
          <div className="info-row">
            <span className="info-label">Audio Devices</span>
            <span className="info-value">{devices.map(d => `${SND_DEV_PREFIX}${d}`).join(', ')}</span>
          </div>
        )}

        {processes.length === 0 && !error && !note && (
          <p className="lm-empty">Microphone is idle — no active processes detected.</p>
        )}

        {processes.length > 0 && (
          <div className="lm-table-wrap" style={{ marginTop: '0.5rem' }}>
            <table className="lm-table">
              <thead>
                <tr>
                  <th>Process</th>
                  {processes.some(p => p.device) && <th>Device</th>}
                  {processes.some(p => p.pid) && <th>PID</th>}
                </tr>
              </thead>
              <tbody>
                {processes.map((p, i) => (
                  <tr key={i}>
                    <td className="lm-site" style={{ color: '#fb923c' }}>🟠 {p.process}</td>
                    {processes.some(pr => pr.device) && <td>{p.device ? `${SND_DEV_PREFIX}${p.device}` : '—'}</td>}
                    {processes.some(pr => pr.pid) && <td style={{ color: '#64748b' }}>{p.pid ?? '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

/** All running background apps panel */
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

/** Scan footer with last-scan time, countdown, and refresh button */
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

  // Auto-scan on mount then every REFRESH_INTERVAL seconds
  useEffect(() => {
    scan()
    const id = setInterval(scan, REFRESH_INTERVAL * 1000)
    return () => clearInterval(id)
  }, [scan])

  // Countdown ticker
  useEffect(() => {
    if (loading) return
    const id = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000)
    return () => clearInterval(id)
  }, [loading])

  const detectedBrowsers = useDetectedBrowsers()

  const browserData = {};
  if (data) {
    for (const b of detectedBrowsers) {
      browserData[b] = data[b] || {};
    }
  }

  return (
    <div className="lm-page">
      {/* Top notice */}
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

      {/* Server offline */}
      {error && !data && <ServerOffBanner error={error} />}

      {/* Camera active alert */}
      {data?.camera && <CameraAlert camera={data.camera} />}

      {/* Microphone active alert */}
      {data?.microphone && <MicAlert microphone={data.microphone} />}

      {/* Loading skeleton */}
      {loading && !data && (
        <div className="lm-loading">
          <div className="lm-spinner" />
          <span>Scanning browser profiles and system permissions…</span>
        </div>
      )}

      {/* Device Status Summary — shown as soon as first scan completes */}
      {data && (
        <DeviceStatusSummary
          camera={data.camera}
          microphone={data.microphone}
          browserData={browserData}
          scanTime={lastScan}
        />
      )}

      {/* Main content */}
      {data && (
        <div className="lm-grid">
          <BrowserPanel browserData={browserData} detectedBrowsers={detectedBrowsers} />
          <OSAppsPanel os={data.os} />
          <CameraDetailPanel camera={data.camera} />
          <MicDetailPanel microphone={data.microphone} />
          <BackgroundAppsPanel processes={data.processes} />
        </div>
      )}

      {/* Footer */}
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
