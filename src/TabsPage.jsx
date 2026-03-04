import { useState, useEffect, useMemo, useCallback } from 'react'

// How often to re-poll the backend for browser tab data (ms).
const BROWSER_TABS_POLL_MS = 30_000

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
  granted: '#4ade80',
  denied: '#f87171',
  prompt: '#fbbf24',
  unsupported: '#64748b',
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

/**
 * Fetches open-tab data from the Node backend (/api/tabs).
 * The backend reads Chrome/Edge/Firefox history SQLite databases to produce
 * a list of recently-visited URLs (the best approximation of open tabs that
 * is possible without a browser extension).
 */
function useBrowserTabs() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/tabs')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setData(await r.json())
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, BROWSER_TABS_POLL_MS)
    return () => clearInterval(id)
  }, [load])

  return { data, loading, error, reload: load }
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
          list.map((d) => ({
            kind    : d.kind,
            label   : d.label || `${d.kind} (${(d.deviceId || '').slice(0, 8) || 'unknown'}…)`,
            deviceId: d.deviceId,
            groupId : d.groupId,
          })),
        )
      }).catch((e) => {
        setEnumError(e.message)
        setDevices([])
      })

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
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

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
  if (!s) return '#64748b'
  if (s === 'activated') return '#4ade80'
  if (s === 'activating' || s === 'installing') return '#fbbf24'
  if (s === 'installed') return '#60a5fa'
  return '#94a3b8'
}

const BROWSER_META = [
  { key: 'chrome',  icon: '🟡', label: 'Chrome'  },
  { key: 'edge',    icon: '🔵', label: 'Edge'     },
  { key: 'firefox', icon: '🦊', label: 'Firefox'  },
]

/**
 * Shows real browser tabs read from the local history databases via the
 * Node backend. Falls back to a "server not running" notice gracefully.
 */
function BrowserTabsPanel({ data, loading, error, onReload }) {
  const [activeBrowser, setActiveBrowser] = useState('chrome')

  const browserData = BROWSER_META.map(({ key, icon, label }) => {
    const entry = data?.[key]
    return { key, icon, label, tabs: entry?.tabs ?? [], err: entry?.error ?? null }
  })

  const active = browserData.find((b) => b.key === activeBrowser)

  function formatTime(iso) {
    if (!iso) return null
    try { return new Date(iso).toLocaleTimeString() } catch { return null }
  }

  function hostname(url) {
    try { return new URL(url).hostname } catch { return url }
  }

  return (
    <section className="info-panel bt-panel">
      <h2 className="panel-title">
        <span>🌐</span> Open Browser Tabs
        {loading && <span className="bt-spinner">⟳</span>}
        <button className="bt-reload-btn" onClick={onReload} title="Refresh tab list">🔄</button>
      </h2>

      {/* Server offline notice */}
      {error && !data && (
        <div className="bt-server-off">
          <span>🔌</span>
          <div>
            <strong>Backend not reachable</strong>
            <p>
              Start the server to read real tab data:{' '}
              <code>npm run dev:server</code>
            </p>
            <p className="bt-err-detail">{error}</p>
          </div>
        </div>
      )}

      {/* Browser selector tabs */}
      {data && (
        <div className="bt-browser-tabs">
          {browserData.map(({ key, icon, label, tabs }) => (
            <button
              key={key}
              className={`bt-browser-tab${activeBrowser === key ? ' active' : ''}`}
              onClick={() => setActiveBrowser(key)}
            >
              {icon} {label}
              <span className="bt-count">{tabs.length}</span>
            </button>
          ))}
        </div>
      )}

      {/* Tab list for active browser */}
      {data && active && (
        <div className="bt-tab-list">
          {active.err ? (
            <div className="bt-browser-err">
              <span>📂</span>
              <div>
                <strong>Browser data unavailable</strong>
                <p>{active.err}</p>
                <p className="bt-hint">
                  Make sure {active.label} has been opened at least once.
                </p>
              </div>
            </div>
          ) : active.tabs.length === 0 ? (
            <p className="info-msg">No recent tab history found for {active.label}.</p>
          ) : (
            active.tabs.map((tab, i) => (
              <div key={i} className="bt-tab-entry">
                <div className="bt-tab-top">
                  <span className="bt-favicon">
                    <img
                      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname(tab.url))}&sz=16`}
                      alt=""
                      width={16}
                      height={16}
                      onError={(e) => { e.currentTarget.style.display = 'none' }}
                    />
                  </span>
                  <span className="bt-tab-title">{tab.title || hostname(tab.url)}</span>
                  {tab.visitedAt && (
                    <span className="bt-visited">{formatTime(tab.visitedAt)}</span>
                  )}
                </div>
                <div className="bt-tab-url">{tab.url}</div>
              </div>
            ))
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
  const camera    = data?.camera
  const mic       = data?.microphone
  const os        = data?.os

  const camProcs  = camera?.processes    ?? []
  const micProcs  = mic?.processes       ?? []
  const osCamera  = os?.camera           ?? []
  const osMic     = os?.microphone       ?? []
  const osGeo     = os?.geolocation      ?? []

  const anyActive = camera?.active || mic?.active || osCamera.length > 0 || osMic.length > 0

  function ProcRow({ icon, proc }) {
    const label = proc.process || proc.app || String(proc)
    const sub   = proc.device || proc.pid ? `${proc.device ?? ''}${proc.pid ? ` (PID ${proc.pid})` : ''}` : null
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
    const color = entry.status === 'allowed' ? '#4ade80' : '#f87171'
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
  videoinput  : { icon: '📷', label: 'Camera',     color: '#f87171' },
  audioinput  : { icon: '🎤', label: 'Microphone', color: '#fb923c' },
  audiooutput : { icon: '🔊', label: 'Speaker',    color: '#60a5fa' },
}

function MediaDevicesPanel({ devices, enumError }) {
  const grouped = {}
  for (const d of (devices ?? [])) {
    if (!grouped[d.kind]) grouped[d.kind] = []
    grouped[d.kind].push(d)
  }
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
  const note      = data?.note
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
  const { data: browserTabsData, loading: browserTabsLoading, error: browserTabsError, reload: reloadTabs } = useBrowserTabs()
  const { data: bgAppsData, loading: bgAppsLoading, error: bgAppsError, reload: reloadBgApps } = useOsBackgroundApps()
  const { data: processesData, loading: processesLoading, error: processesError, reload: reloadProcesses } = useRunningProcesses()

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
          history is read from Chrome/Edge/Firefox local SQLite databases by the
          Node backend. OS-level background apps (processes actively using the
          camera or microphone) are detected via <code>/proc</code> on Linux,
          the CapabilityAccessManager registry on Windows, or{' '}
          <code>lsof</code> on macOS.
        </div>
      </div>

      <div className="tabs-grid">
        {/* Real browser tabs from the Node backend */}
        <BrowserTabsPanel
          data={browserTabsData}
          loading={browserTabsLoading}
          error={browserTabsError}
          onReload={reloadTabs}
        />

        {/* Active Background Apps from OS (camera/mic processes + Windows permissions) */}
        <OsBackgroundAppsPanel
          data={bgAppsData}
          loading={bgAppsLoading}
          error={bgAppsError}
          onReload={reloadBgApps}
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
