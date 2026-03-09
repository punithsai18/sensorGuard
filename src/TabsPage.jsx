import { useState, useEffect, useMemo, useCallback } from 'react'
import { useDetectedBrowsers, ALL_BROWSERS_META } from './browserDetection.js'

// How often to re-poll the backend for browser tab data (ms).
const BROWSER_TABS_POLL_MS = 5_000

// How often to refresh the running-processes list (ms).
const PROCESSES_POLL_MS = 15_000

// All permission names supported by the Permissions API in modern browsers.
const PERMISSION_NAMES = [
  'accelerometer',
  'ambient-light-sensor',
  'background-fetch',
  'background-sync',
  'bluetooth',
  'camera',
  'captured-surface-control',
  'clipboard-read',
  'clipboard-write',
  'display-capture',
  'fullscreen',
  'geolocation',
  'gyroscope',
  'idle-detection',
  'local-fonts',
  'magnetometer',
  'microphone',
  'midi',
  'nfc',
  'notifications',
  'payment-handler',
  'periodic-background-sync',
  'persistent-storage',
  'push',
  'screen-wake-lock',
  'speaker-selection',
  'storage-access',
  'top-level-storage-access',
  'window-management',
]

const STATUS_COLOR = {
  granted: '#ffffff',
  denied: '#4b5563',
  prompt: '#94a3b8',
  unsupported: '#334155',
}

const STATUS_ICON = {
  granted: '✅',
  denied: '🚫',
  prompt: '❓',
  unsupported: '—',
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

/**
 * Discovers other same-origin tabs via BroadcastChannel ping/pong.
 * Each tab broadcasts a ping on mount, responds to pings with a pong,
 * and announces itself on visibility change and before unload.
 */
/**
 * Lists all Service Workers registered for this origin.
 * Service Workers are the browser's "background apps" — they run
 * network requests, push notifications, and background sync.
 */
function useServiceWorkers() {
  const [workers, setWorkers] = useState(() =>
    navigator.serviceWorker ? null : [],
  )

  useEffect(() => {
    if (!navigator.serviceWorker) return

    const load = () =>
      navigator.serviceWorker.getRegistrations().then((regs) =>
        setWorkers(
          regs.map((r) => ({
            scope: r.scope,
            active: r.active?.state ?? null,
            waiting: r.waiting?.state ?? null,
            installing: r.installing?.state ?? null,
            updateViaCache: r.updateViaCache,
          })),
        ),
      )

    load()
    const id = setInterval(load, 3000)
    return () => clearInterval(id)
  }, [])

  return workers
}

/**
 * Queries the Web Locks API to show all held and pending resource locks.
 * Locks are often held by background tasks (service workers, shared workers).
 */
function useWebLocks() {
  const [locks, setLocks] = useState(null)

  useEffect(() => {
    if (!navigator.locks?.query) return

    const load = () =>
      navigator.locks.query().then((snapshot) =>
        setLocks({
          held: snapshot.held ?? [],
          pending: snapshot.pending ?? [],
        }),
      )

    load()
    const id = setInterval(load, 2000)
    return () => clearInterval(id)
  }, [])

  return locks
}

function usePermissions() {
  const [permissions, setPermissions] = useState(() =>
    PERMISSION_NAMES.map((name) => ({ name, state: 'unsupported' })),
  )

  useEffect(() => {
    if (!navigator.permissions) return

    let alive = true
    const statusObjects = []
    const results = PERMISSION_NAMES.map((name) => ({ name, state: 'unsupported' }))

    PERMISSION_NAMES.forEach((name, idx) => {
      const descriptor = name === 'push' ? { name, userVisibleOnly: true } : { name }

      navigator.permissions
        .query(descriptor)
        .then((status) => {
          if (!alive) return
          results[idx] = { name, state: status.state }
          setPermissions([...results])
          const onChange = () => {
            if (!alive) return
            results[idx] = { name, state: status.state }
            setPermissions([...results])
          }
          status.addEventListener('change', onChange)
          statusObjects.push({ status, onChange })
        })
        .catch(() => {
          // Permission name not recognised — leave as 'unsupported'
        })
    })

    return () => {
      alive = false
      for (const { status, onChange } of statusObjects) {
        status.removeEventListener('change', onChange)
      }
    }
  }, [])

  return permissions
}

function useBrowserMonitor() {
  const detectedBrowsers = useDetectedBrowsers()
  const [browserData, setBrowserData] = useState({})
  const [connected, setConnected] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)

  useEffect(() => {
    let ws
    let reconnectTimeout
    let backoff = 500

    function connect() {
      ws = new WebSocket('ws://127.0.0.1:8999/browser-monitor')

      ws.onopen = () => {
        setConnected(true)
        setReconnecting(false)
        backoff = 500
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.event === 'tab_update') {
            const bKey = data.browser.toLowerCase();
            setBrowserData(prev => ({
              ...prev,
              [bKey]: {
                tabs: data.tabs,
                status: data.status,
                error: data.error
              }
            }))
          }
        } catch (e) {
          console.error('[BrowserMonitor] Error parsing message:', e)
        }
      }

      ws.onclose = () => {
        setConnected(false)
        setReconnecting(true)
        reconnectTimeout = setTimeout(connect, backoff)
        backoff = Math.min(backoff * 2, 30_000)
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()

    return () => {
      clearTimeout(reconnectTimeout)
      if (ws) {
        ws.onclose = null
        ws.close()
      }
    }
  }, [])

  return { connected, reconnecting, detectedBrowsers, browserData }
}

/**
 * Fetches active OS-level background app data from the Node backend.
 * Reports processes actively using the camera or microphone,
 * and on Windows the CapabilityAccessManager app permission list.
 */
function useOsBackgroundApps() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/scan/all')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const json = await r.json()
      setData({ camera: json.camera, microphone: json.microphone, os: json.os })
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 15_000)
    return () => clearInterval(id)
  }, [load])

  return { data, loading, error, reload: load }
}

/**
 * Lists all media input/output devices via navigator.mediaDevices.enumerateDevices().
 * Refreshes when the device list changes (devicechange event).
 * Returns null while the initial query is in flight.
 */
function useMediaDevices() {
  const [devices, setDevices] = useState(null)
  const [enumError, setEnumError] = useState(null)

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return

    const load = () =>
      navigator.mediaDevices.enumerateDevices().then((list) => {
        setEnumError(null)
        setDevices(
          list.map((d, i) => {
            let fallback = 'Unknown Device';
            if (d.kind === 'videoinput') fallback = 'Camera';
            if (d.kind === 'audioinput') fallback = 'Microphone';
            if (d.kind === 'audiooutput') fallback = 'Speaker';
            return {
              kind: d.kind,
              label: d.label || `${fallback} ${i + 1}`,
              deviceId: d.deviceId,
              groupId: d.groupId,
            };
          })
        );
      }).catch((e) => {
        setEnumError(e.message);
        setDevices([]);
      });

    load()
    navigator.mediaDevices.addEventListener('devicechange', load)
    return () => navigator.mediaDevices.removeEventListener('devicechange', load)
  }, [])

  return { devices, enumError }
}

/**
 * Polls the backend /api/scan/all for the running-processes list.
 */
function useRunningProcesses() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/scan/all')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const json = await r.json()
      setData(json.processes ?? null)
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, PROCESSES_POLL_MS)
    return () => clearInterval(id)
  }, [load])

  return { data, loading, error, reload: load }
}

/**
 * Fetches the browser permission databases (Chrome / Edge / Firefox) from the
 * backend so we can annotate each history tab with its stored site permissions.
 */
function useBrowserPermissions() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/scan/all')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const json = await r.json()
      setData({
        chrome: json.chrome ?? {},
        edge: json.edge ?? {},
        firefox: json.firefox ?? {},
      })
    } catch (err) {
      // Non-critical: permissions just won't appear next to tabs
      console.warn('[SensorGuard] Could not load browser permissions:', err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, BROWSER_TABS_POLL_MS)
    return () => clearInterval(id)
  }, [load])

  return { data, loading }
}

function PermissionRow({ name, state }) {
  const color = STATUS_COLOR[state] ?? STATUS_COLOR.unsupported
  const icon = STATUS_ICON[state] ?? '—'
  return (
    <div className="perm-row">
      <span className="perm-name">{name}</span>
      <span className="perm-state" style={{ color }}>
        {icon} <span>{state}</span>
      </span>
    </div>
  )
}

function swStateColor(s) {
  if (!s) return '#334155'
  if (s === 'activated') return '#ffffff'
  if (s === 'activating' || s === 'installing') return '#e2e8f0'
  if (s === 'installed') return '#cbd5e1'
  return '#94a3b8'
}



const PERM_CHIP_ICON = {
  camera: '📷',
  microphone: '🎤',
  geolocation: '📍',
  notifications: '🔔',
  'clipboard-read': '📋',
  'clipboard-write': '📋',
}

/**
 * Utility to map a browser's permission database into a hostname -> perms lookup object.
 * Format: { "example.com": { "camera": "allowed", "microphone": "blocked" } }
 */
function buildPermLookup(data) {
  const lookup = {}
  if (!data) return lookup

  // The scanner returns permission entries as arrays under keys like 'camera', 'microphone', etc.
  const permissionNames = ['camera', 'microphone', 'geolocation', 'notifications']

  for (const pName of permissionNames) {
    const list = data[pName] || []
    for (const entry of list) {
      if (!entry.site) continue
      if (!lookup[entry.site]) lookup[entry.site] = {}
      lookup[entry.site][pName] = entry.status
    }
  }
  return lookup
}

/**
 * Shows real browser tabs read from the local history databases via the
 * Python WebSocket backend.
 */
function BrowserTabsPanel({ browserPermissions }) {
  const { connected, reconnecting, detectedBrowsers, browserData } = useBrowserMonitor()
  const [activeBrowser, setActiveBrowser] = useState('')

  useEffect(() => {
    if (detectedBrowsers.length > 0 && !activeBrowser) {
      setActiveBrowser(detectedBrowsers[0])
    } else if (detectedBrowsers.length > 0 && !detectedBrowsers.includes(activeBrowser)) {
      setActiveBrowser(detectedBrowsers[0])
    }
  }, [detectedBrowsers, activeBrowser])

  const active = activeBrowser ? browserData[activeBrowser] : null

  // Build a hostname → { permName: status } lookup for the active browser
  const permLookupKey = activeBrowser ? activeBrowser.toLowerCase() : ''
  const permLookup = useMemo(
    () => buildPermLookup(browserPermissions?.[permLookupKey]),
    [browserPermissions, permLookupKey],
  )

  function formatTime(ms) {
    if (!ms) return null
    try { return new Date(ms).toLocaleTimeString() } catch { return null }
  }

  function hostname(url) {
    try { return new URL(url).hostname } catch { return url }
  }

  return (
    <section className="info-panel bt-panel">
      <h2 className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span>🌐</span> Open Browser Tabs
        {connected ? (
          <span title="Live" style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#ffffff', display: 'inline-block', boxShadow: '0 0 5px #ffffff' }}></span>
        ) : reconnecting ? (
          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Reconnecting...</span>
        ) : null}
      </h2>

      {/* Browser selector tabs (only show detected ones) */}
      {detectedBrowsers.length > 0 ? (
        <div className="bt-browser-tabs">
          {detectedBrowsers.map((browserName) => {
            const meta = ALL_BROWSERS_META[browserName] || { icon: '🌐', label: browserName }
            const tabsCount = browserData[browserName]?.tabs?.length || 0
            return (
              <button
                key={browserName}
                className={`bt-browser-tab${activeBrowser === browserName ? ' active' : ''}`}
                onClick={() => setActiveBrowser(browserName)}
              >
                {meta.icon} {meta.label}
                <span className="bt-count">{tabsCount}</span>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="bt-tab-list">
          <p className="info-msg">No browsers detected tracking history.</p>
        </div>
      )}

      {/* Tab list for active browser */}
      {active && (
        <div className="bt-tab-list">
          {active.status === 'info' || active.status === 'error' ? (
            <div className="bt-browser-err">
              <span>{active.status === 'info' ? 'ℹ️' : '⚠️'}</span>
              <div>
                <strong>{active.status === 'info' ? 'Browser info' : 'Browser data error'}</strong>
                <p>{active.error}</p>
              </div>
            </div>
          ) : active.tabs?.length === 0 ? (
            <p className="info-msg">No recent tab history found for {activeBrowser}.</p>
          ) : (
            active.tabs?.map((tab, i) => {
              const host = hostname(tab.url)
              const perms = permLookup[host] ?? {}
              const permEntries = Object.entries(perms)
              return (
                <div key={i} className="bt-tab-entry">
                  <div className="bt-tab-top">
                    <span className="bt-favicon">
                      <img
                        src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=16`}
                        alt=""
                        width={16}
                        height={16}
                        onError={(e) => { e.currentTarget.style.display = 'none' }}
                      />
                    </span>
                    <span className="bt-tab-title">{tab.title || host}</span>
                    {tab.visitedAt && (
                      <span className="bt-visited">{formatTime(tab.visitedAt)}</span>
                    )}
                  </div>
                  <div className="bt-tab-url">{tab.url}</div>
                  {permEntries.length > 0 && (
                    <div className="bt-tab-perms">
                      {permEntries.map(([perm, status]) => (
                        <span key={perm} className={`bt-perm-chip bt-perm-${status}`}>
                          {PERM_CHIP_ICON[perm] ?? '🔐'} {perm}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}
    </section>
  )
}

/**
 * Shows active OS-level background processes:
 * - processes currently using the camera or microphone
 * - on Windows: CapabilityAccessManager app permission list
 */
function OsBackgroundAppsPanel({ data, loading, error, onReload }) {
  const camera = data?.camera
  const mic = data?.microphone
  const os = data?.os

  const camProcs = camera?.processes ?? []
  const micProcs = mic?.processes ?? []
  const osCamera = os?.camera ?? []
  const osMic = os?.microphone ?? []
  const osGeo = os?.geolocation ?? []

  const anyActive = camera?.active || mic?.active || osCamera.length > 0 || osMic.length > 0

  function ProcRow({ icon, proc }) {
    const label = proc.process || proc.app || String(proc)
    const sub = proc.device || proc.pid ? `${proc.device ?? ''}${proc.pid ? ` (PID ${proc.pid})` : ''}` : null
    return (
      <div className="bg-proc-row">
        <span className="bg-proc-icon">{icon}</span>
        <div className="bg-proc-info">
          <span className="bg-proc-name">{label}</span>
          {sub && <span className="bg-proc-sub">{sub}</span>}
        </div>
      </div>
    )
  }

  function OsPermRow({ entry }) {
    const color = entry.status === 'allowed' ? '#ffffff' : '#4b5563'
    return (
      <div className="bg-proc-row">
        <span className="bg-proc-name">{entry.app || entry.error}</span>
        <span style={{ color, fontSize: '0.75rem', marginLeft: 'auto' }}>{entry.status}</span>
      </div>
    )
  }

  return (
    <section className="info-panel bg-apps-panel">
      <h2 className="panel-title">
        <span>🖥️</span> Active Background Apps
        {loading && <span className="bt-spinner">⟳</span>}
        <button className="bt-reload-btn" onClick={onReload} title="Refresh">🔄</button>
      </h2>

      {error && !data && (
        <div className="bt-server-off">
          <span>🔌</span>
          <div>
            <strong>Backend not reachable</strong>
            <p>Start the server: <code>npm run dev:server</code></p>
            <p className="bt-err-detail">{error}</p>
          </div>
        </div>
      )}

      {data && (
        <>
          {/* Camera */}
          <div className="bg-section">
            <div className="bg-section-header">
              <span>📷 Camera</span>
              <span className={`bg-status-badge ${camera?.active ? 'active' : 'idle'}`}>
                {camera?.active ? '● IN USE' : '○ idle'}
              </span>
            </div>
            {camera?.note && <p className="bg-note">{camera.note}</p>}
            {camera?.error && <p className="bg-note error">{camera.error}</p>}
            {camProcs.length > 0 ? (
              camProcs.map((p, i) => <ProcRow key={i} icon="📷" proc={p} />)
            ) : (
              !camera?.note && !camera?.error &&
              <p className="bg-empty">No processes currently using the camera.</p>
            )}
          </div>

          {/* Microphone */}
          <div className="bg-section">
            <div className="bg-section-header">
              <span>🎤 Microphone</span>
              <span className={`bg-status-badge ${mic?.active ? 'active' : 'idle'}`}>
                {mic?.active ? '● IN USE' : '○ idle'}
              </span>
            </div>
            {mic?.note && <p className="bg-note">{mic.note}</p>}
            {mic?.error && <p className="bg-note error">{mic.error}</p>}
            {micProcs.length > 0 ? (
              micProcs.map((p, i) => <ProcRow key={i} icon="🎤" proc={p} />)
            ) : (
              !mic?.note && !mic?.error &&
              <p className="bg-empty">No processes currently using the microphone.</p>
            )}
          </div>

          {/* Windows OS app permissions */}
          {os && !os.note && (
            <>
              {osCamera.length > 0 && (
                <div className="bg-section">
                  <div className="bg-section-header"><span>📷 Camera — App Permissions (OS)</span></div>
                  {osCamera.map((e, i) => <OsPermRow key={i} entry={e} />)}
                </div>
              )}
              {osMic.length > 0 && (
                <div className="bg-section">
                  <div className="bg-section-header"><span>🎤 Microphone — App Permissions (OS)</span></div>
                  {osMic.map((e, i) => <OsPermRow key={i} entry={e} />)}
                </div>
              )}
              {osGeo.length > 0 && (
                <div className="bg-section">
                  <div className="bg-section-header"><span>📍 Location — App Permissions (OS)</span></div>
                  {osGeo.map((e, i) => <OsPermRow key={i} entry={e} />)}
                </div>
              )}
            </>
          )}
          {os?.note && <p className="bg-note">{os.note}</p>}

          {!anyActive && !camera?.note && !mic?.note && (
            <p className="bg-all-clear">✅ No background apps are currently using camera or microphone.</p>
          )}
        </>
      )}
    </section>
  )
}

// ── Media Devices Panel ───────────────────────────────────────────────────────

const DEVICE_KIND_META = {
  videoinput: { icon: '📷', label: 'Camera', color: '#ffffff' },
  audioinput: { icon: '🎤', label: 'Microphone', color: '#e2e8f0' },
  audiooutput: { icon: '🔊', label: 'Speaker', color: '#94a3b8' },
}

function MediaDevicesPanel({ devices, enumError }) {
  const [requesting, setRequesting] = useState(false)

  const grouped = {}
  let hasHiddenNames = false;
  for (const d of (devices ?? [])) {
    if (!grouped[d.kind]) grouped[d.kind] = []
    grouped[d.kind].push(d)
    if (d.label.startsWith('Camera') || d.label.startsWith('Microphone') || d.label.startsWith('Speaker') || d.label.startsWith('Unknown')) {
      hasHiddenNames = true;
    }
  }

  const requestPermissions = async () => {
    try {
      setRequesting(true);
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      stream.getTracks().forEach(track => track.stop()); // Stop immediately
      // The devicechange event should naturally re-trigger the load() in useMediaDevices
    } catch (e) {
      console.error("Failed to get permissions for device names:", e);
    } finally {
      setRequesting(false);
    }
  };
  const kinds = Object.keys(DEVICE_KIND_META)

  return (
    <section className="info-panel md-panel">
      <h2 className="panel-title">
        <span aria-hidden="true">🎛️</span>
        <span> Connected Media Devices</span>
        {devices === null && <span className="bt-spinner">⟳</span>}
        {devices !== null && (
          <span className="panel-count">{devices.length}</span>
        )}
      </h2>

      {!navigator.mediaDevices?.enumerateDevices && (
        <p className="info-msg">Media Devices API not available in this browser.</p>
      )}

      {enumError && (
        <p className="info-msg" style={{ color: '#f87171' }}>Could not enumerate devices: {enumError}</p>
      )}

      {devices !== null && !enumError && devices.length === 0 && (
        <p className="info-msg">No media devices detected.</p>
      )}

      {hasHiddenNames && (
        <div style={{ padding: '0.5rem 1.25rem' }}>
          <button
            onClick={requestPermissions}
            disabled={requesting}
            style={{ backgroundColor: 'rgba(59, 130, 246, 0.15)', fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
          >
            {requesting ? 'Requesting...' : '👁️ Reveal Real Device Names (Requires Permission)'}
          </button>
        </div>
      )}

      {devices !== null && devices.length > 0 && (
        <div className="md-device-list">
          {kinds.map((kind) => {
            const list = grouped[kind] ?? []
            const meta = DEVICE_KIND_META[kind]
            return (
              <div key={kind} className="md-kind-group">
                <div
                  className="md-kind-header"
                  style={{ color: meta.color }}
                  aria-label={`${meta.label} — ${list.length} device${list.length !== 1 ? 's' : ''}`}
                >
                  <span aria-hidden="true">{meta.icon}</span>
                  {' '}{meta.label}
                  <span className="md-kind-count">{list.length}</span>
                </div>
                {list.length === 0 ? (
                  <p className="md-empty">None detected</p>
                ) : (
                  list.map((d, i) => (
                    <div key={d.deviceId || i} className="md-device-row">
                      <span className="md-device-label">{d.label}</span>
                    </div>
                  ))
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

// ── Running Processes Panel ───────────────────────────────────────────────────

function RunningAppsPanel({ data, loading, error, onReload }) {
  const [search, setSearch] = useState('')

  const processes = useMemo(() => data?.processes ?? [], [data])
  const note = data?.note
  const procError = data?.error

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return processes
    return processes.filter((p) => (p.name ?? '').toLowerCase().includes(q))
  }, [processes, search])

  return (
    <section className="info-panel rp-panel">
      <h2 className="panel-title">
        <span>⚡</span> Running Desktop Apps
        {loading && <span className="bt-spinner">⟳</span>}
        <button className="bt-reload-btn" onClick={onReload} title="Refresh">🔄</button>
        {!loading && processes.length > 0 && (
          <span className="panel-count">{processes.length}</span>
        )}
      </h2>

      {error && !data && (
        <div className="bt-server-off">
          <span>🔌</span>
          <div>
            <strong>Backend not reachable</strong>
            <p>Start the server: <code>npm run dev:server</code></p>
            <p className="bt-err-detail">{error}</p>
          </div>
        </div>
      )}

      {note && <p className="info-msg">{note}</p>}
      {procError && <p className="info-msg" style={{ color: '#f87171' }}>{procError}</p>}

      {data && !note && !procError && (
        <>
          <input
            className="rp-search"
            type="search"
            placeholder="🔍 Filter processes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {filtered.length === 0 ? (
            <p className="info-msg">No processes match your filter.</p>
          ) : (
            <div className="lm-table-wrap">
              <table className="lm-table rp-table">
                <thead>
                  <tr>
                    <th>Process</th>
                    <th>PID</th>
                    {processes.some((p) => p.cpu) && <th>CPU</th>}
                    {processes.some((p) => p.mem) && <th>Memory</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => (
                    <tr key={`${p.pid}-${p.name}`}>
                      <td className="rp-proc-name">{p.name}</td>
                      <td className="rp-pid">{p.pid ?? '—'}</td>
                      {processes.some((q) => q.cpu) && (
                        <td className="rp-cpu">{p.cpu ?? '—'}</td>
                      )}
                      {processes.some((q) => q.mem) && (
                        <td className="rp-mem">{p.mem ?? '—'}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}

// ── Page component ─────────────────────────────────────────────────────────────

export default function TabsPage() {
  const permissions = usePermissions()
  const serviceWorkers = useServiceWorkers()
  const webLocks = useWebLocks()
  const { devices: mediaDevices, enumError: mediaDevicesError } = useMediaDevices()
  const { data: bgAppsData, loading: bgAppsLoading, error: bgAppsError, reload: reloadBgApps } = useOsBackgroundApps()
  const { data: processesData, loading: processesLoading, error: processesError, reload: reloadProcesses } = useRunningProcesses()
  const { data: browserPermissions } = useBrowserPermissions()

  const counts = useMemo(
    () =>
      permissions.reduce(
        (acc, p) => {
          acc[p.state] = (acc[p.state] ?? 0) + 1
          return acc
        },
        { granted: 0, denied: 0, prompt: 0, unsupported: 0 },
      ),
    [permissions],
  )

  return (
    <div className="tabs-page">
      {/* Notice banner */}
      <div className="notice-banner">
        <span className="notice-icon">ℹ️</span>
        <div>
          <strong>Browser tabs &amp; active background apps:</strong> Browser
          history is read from local SQLite databases via real-time WebSocket connection to the Python backend. OS-level background apps (processes actively using the
          camera or microphone) are detected via <code>/proc</code> on Linux,
          the CapabilityAccessManager registry on Windows, or{' '}
          <code>lsof</code> on macOS.
        </div>
      </div>

      <div className="tabs-grid">
        {/* Real browser tabs from the WebSocket backend */}
        <BrowserTabsPanel
          browserPermissions={browserPermissions}
        />


        {/* Service Workers (background apps) */}
        <section className="info-panel">
          <h2 className="panel-title">
            <span>⚙️</span> Background Apps (Service Workers)
            <span className="panel-count">{serviceWorkers ? serviceWorkers.length : '…'}</span>
          </h2>
          {serviceWorkers === null && (
            <p className="info-msg">Querying service workers…</p>
          )}
          {serviceWorkers && serviceWorkers.length === 0 && (
            <p className="info-msg">
              No service workers registered for this origin. Service workers
              enable offline caching, push notifications, and background sync.
            </p>
          )}
          {serviceWorkers && serviceWorkers.length > 0 && (
            <div className="sw-list">
              {serviceWorkers.map((sw, i) => (
                <div key={i} className="sw-entry">
                  <div className="sw-scope">{sw.scope}</div>
                  <div className="sw-states">
                    {sw.active != null && (
                      <span className="sw-state" style={{ color: swStateColor(sw.active) }}>
                        ● active: {sw.active}
                      </span>
                    )}
                    {sw.waiting != null && (
                      <span className="sw-state" style={{ color: swStateColor(sw.waiting) }}>
                        ⏳ waiting: {sw.waiting}
                      </span>
                    )}
                    {sw.installing != null && (
                      <span className="sw-state" style={{ color: swStateColor(sw.installing) }}>
                        ↓ installing: {sw.installing}
                      </span>
                    )}
                  </div>
                  <div className="sw-meta">Update cache: {sw.updateViaCache}</div>
                </div>
              ))}
            </div>
          )}
          {!navigator.serviceWorker && (
            <p className="info-msg">Service Worker API not available in this browser.</p>
          )}
        </section>

        {/* Web Locks */}
        {webLocks !== null && (
          <section className="info-panel">
            <h2 className="panel-title">
              <span>🔒</span> Web Locks (background resources)
            </h2>
            {webLocks.held.length === 0 && webLocks.pending.length === 0 ? (
              <p className="info-msg">No locks currently held or pending.</p>
            ) : (
              <>
                {webLocks.held.length > 0 && (
                  <>
                    <p className="section-label-sm">Held</p>
                    {webLocks.held.map((l, i) => (
                      <div key={i} className="info-row">
                        <span className="info-label">{l.name}</span>
                        <span className="info-value" style={{ color: '#4ade80' }}>{l.mode}</span>
                      </div>
                    ))}
                  </>
                )}
                {webLocks.pending.length > 0 && (
                  <>
                    <p className="section-label-sm">Pending</p>
                    {webLocks.pending.map((l, i) => (
                      <div key={i} className="info-row">
                        <span className="info-label">{l.name}</span>
                        <span className="info-value" style={{ color: '#fbbf24' }}>{l.mode}</span>
                      </div>
                    ))}
                  </>
                )}
              </>
            )}
          </section>
        )}

        {/* Permissions */}
        <section className="info-panel perms-panel">
          <h2 className="panel-title">
            <span>🔐</span> Origin Permissions
          </h2>
          <div className="perm-summary">
            <span className="perm-stat granted">✅ {counts.granted} granted</span>
            <span className="perm-stat denied">🚫 {counts.denied} denied</span>
            <span className="perm-stat prompt">❓ {counts.prompt} prompt</span>
            <span className="perm-stat unsupported">— {counts.unsupported} unsupported</span>
          </div>
          {!navigator.permissions && (
            <p className="info-msg">Permissions API not available in this browser.</p>
          )}
          <div className="perm-list">
            {permissions.map((p) => (
              <PermissionRow key={p.name} name={p.name} state={p.state} />
            ))}
          </div>
        </section>

        {/* Connected Media Devices */}
        <MediaDevicesPanel devices={mediaDevices} enumError={mediaDevicesError} />

        {/* Running Desktop Apps (from OS) */}
        <RunningAppsPanel
          data={processesData}
          loading={processesLoading}
          error={processesError}
          onReload={reloadProcesses}
        />
      </div>
    </div>
  )
}
