import { useState, useEffect, useMemo, useCallback } from 'react'
import { useDetectedBrowsers, ALL_BROWSERS_META } from './browserDetection.js'

// ── Constants ──────────────────────────────────────────────────────────────────

const PERM_ICON = {
  camera: '📷',
  microphone: '🎤',
  geolocation: '📍',
  notifications: '🔔',
  'display-capture': '🖥️',
  'clipboard-read': '📋',
  'clipboard-write': '📋',
  'storage-access': '🔐',
}

const PERM_COLOR = {
  camera: '#f87171',
  microphone: '#fb923c',
  geolocation: '#facc15',
  notifications: '#34d399',
  'display-capture': '#60a5fa',
  'clipboard-read': '#a78bfa',
  'clipboard-write': '#c084fc',
  'storage-access': '#22d3ee',
}

const STATUS_COLOR = { allowed: '#4ade80', blocked: '#f87171', ask: '#fbbf24' }
const STATUS_ICON = { allowed: '✅', blocked: '🚫', ask: '❓' }

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchScan() {
  const res = await fetch('/api/scan/all')
  if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`)
  return res.json()
}

/** True for sites that are real external hostnames (not localhost/SensorGuard). */
function isExternalSite(site) {
  return !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(site);
}

function buildRows(data, detectedBrowsers) {
  const rows = []
  for (const browser of detectedBrowsers) {
    const bd = data?.[browser]
    if (!bd || bd.error) continue
    for (const [perm, entries] of Object.entries(bd)) {
      if (!Array.isArray(entries)) continue
      for (const e of entries) {
        if (!e.site || !e.status) continue
        if (!isExternalSite(e.site)) continue
        rows.push({ site: e.site, browser, permission: perm, status: e.status })
      }
    }
  }
  return rows
}

const OS_PERM_LABEL = {
  camera: 'Camera',
  microphone: 'Microphone',
  geolocation: 'Location',
}

const OS_PERM_ICON = {
  camera: '📷',
  microphone: '🎤',
  geolocation: '📍',
}

/**
 * Flatten data.os into rows: { app, permission, status }
 * Skip entries that only carry an error key.
 */
function buildOsRows(os) {
  if (!os) return []
  const rows = []
  for (const [perm, entries] of Object.entries(os)) {
    if (!Array.isArray(entries)) continue
    for (const e of entries) {
      if (!e.app || !e.status) continue
      rows.push({ app: e.app, permission: perm, status: e.status })
    }
  }
  return rows
}

// ── Small components ──────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const color = STATUS_COLOR[status] ?? '#64748b'
  const icon = STATUS_ICON[status] ?? '—'
  return (
    <span className="lm-badge" style={{ color, borderColor: color }}>
      {icon} {status}
    </span>
  )
}

function BrowserChip({ browser }) {
  const meta = ALL_BROWSERS_META[browser] || { icon: '🌐', label: browser }
  return <span className="sp-browser-chip">{meta.icon} {meta.label}</span>
}

function PermChip({ permission }) {
  const color = PERM_COLOR[permission] ?? '#475569'
  return (
    <span
      className="sp-perm-chip"
      style={{ borderColor: color, color }}
    >
      {PERM_ICON[permission] ?? '🔑'} {permission}
    </span>
  )
}

// ── Server-offline banner ─────────────────────────────────────────────────────

function ServerOffBanner({ error }) {
  return (
    <div className="lm-alert server-off-alert">
      <span className="lm-alert-icon">🔌</span>
      <div>
        <strong>Scanner server not reachable</strong>
        <p className="lm-alert-detail">
          Start the backend to read your real browser permissions:
          {' '}<code>npm run dev:all</code>
        </p>
        {error && <p className="lm-alert-err">Error: {error}</p>}
      </div>
    </div>
  )
}

// ── Browser error note ────────────────────────────────────────────────────────

function BrowserError({ icon, label, msg }) {
  return (
    <div className="sp-browser-err">
      <span>{icon} {label}</span>
      <p>{msg}</p>
    </div>
  )
}

// ── Permission summary bar ────────────────────────────────────────────────────

function PermSummaryBar({ rows }) {
  const counts = {}
  for (const r of rows) {
    if (!counts[r.permission]) counts[r.permission] = { allowed: 0, blocked: 0, ask: 0 }
    counts[r.permission][r.status] = (counts[r.permission][r.status] ?? 0) + 1
  }
  const perms = Object.keys(counts).sort()
  if (!perms.length) return null
  return (
    <div className="sp-summary-bar">
      {perms.map(p => (
        <div key={p} className="sp-summary-item">
          <span className="sp-summary-icon" style={{ color: PERM_COLOR[p] ?? '#94a3b8' }}>
            {PERM_ICON[p] ?? '🔑'}
          </span>
          <span className="sp-summary-perm">{p}</span>
          {counts[p].allowed > 0 && (
            <span className="sp-summary-count sp-count-allowed">{counts[p].allowed} ✅</span>
          )}
          {counts[p].blocked > 0 && (
            <span className="sp-summary-count sp-count-blocked">{counts[p].blocked} 🚫</span>
          )}
          {counts[p].ask > 0 && (
            <span className="sp-summary-count sp-count-ask">{counts[p].ask} ❓</span>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Main permissions table ────────────────────────────────────────────────────

function PermissionsTable({ rows }) {
  if (!rows.length) {
    return <p className="lm-empty">No permissions match the selected filters.</p>
  }
  return (
    <div className="lm-table-wrap">
      <table className="lm-table sp-table">
        <thead>
          <tr>
            <th>Website</th>
            <th>Browser</th>
            <th>Permission</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="lm-site sp-site">{r.site}</td>
              <td><BrowserChip browser={r.browser} /></td>
              <td><PermChip permission={r.permission} /></td>
              <td><StatusBadge status={r.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Desktop apps table ────────────────────────────────────────────────────────

function DesktopAppsSection({ os }) {
  const rows = buildOsRows(os)
  return (
    <div className="da-section">
      <h3 className="da-heading">
        <span>🖥️</span> Desktop App Permissions (OS)
      </h3>
      {os?.note && !rows.length ? (
        <p className="da-note">{os.note}</p>
      ) : rows.length === 0 ? (
        <p className="da-note">No desktop app permissions found on this system.</p>
      ) : (
        <div className="lm-table-wrap">
          <table className="lm-table da-table">
            <thead>
              <tr>
                <th>App</th>
                <th>Permission</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.app}-${r.permission}`}>
                  <td className="da-app-name">{r.app}</td>
                  <td>
                    <span className="da-perm-label">
                      <span aria-hidden="true">{OS_PERM_ICON[r.permission] ?? '🔑'}</span>
                      {' '}{OS_PERM_LABEL[r.permission] ?? r.permission}
                    </span>
                  </td>
                  <td><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SitePermissionsPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [lastScan, setLastScan] = useState(null)
  const [live, setLive] = useState(false)

  const detectedBrowsers = useDetectedBrowsers()

  // Filters
  const [search, setSearch] = useState('')
  const [activeBrowser, setActiveBrowser] = useState('all')
  const [activePermFilt, setActivePermFilt] = useState('all')
  const [activeStatus, setActiveStatus] = useState('all')

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
    }
  }, [])

  // Auto-scan on mount
  useEffect(() => {
    scan()
  }, [scan])

  // Websocket Live Connection
  useEffect(() => {
    let ws
    let reconnectTimeout
    let backoff = 500

    function connect() {
      ws = new WebSocket('ws://127.0.0.1:8998')

      ws.onopen = () => {
        setLive(true)
        backoff = 500
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.event === 'permissions_changed') {
            scan()
          }
        } catch (e) { }
      }

      ws.onclose = () => {
        setLive(false)
        reconnectTimeout = setTimeout(connect, backoff)
        backoff = Math.min(backoff * 2, 30000)
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
  }, [scan])

  const allRows = useMemo(() => buildRows(data, detectedBrowsers), [data, detectedBrowsers])

  // All distinct permission types found in actual data
  const allPerms = useMemo(
    () => [...new Set(allRows.map(r => r.permission))].sort(),
    [allRows],
  )

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return allRows.filter(r => {
      if (activeBrowser !== 'all' && r.browser !== activeBrowser) return false
      if (activePermFilt !== 'all' && r.permission !== activePermFilt) return false
      if (activeStatus !== 'all' && r.status !== activeStatus) return false
      if (q && !r.site.toLowerCase().includes(q) && !r.permission.toLowerCase().includes(q)) return false
      return true
    })
  }, [allRows, activeBrowser, activePermFilt, activeStatus, search])

  return (
    <div className="site-perms-page">
      {/* Header notice */}
      <div className="notice-banner">
        <span className="notice-icon">🌐</span>
        <div>
          <strong>Real Browser Permissions:</strong> This page reads your
          actual Chrome/Edge <code>Preferences</code> file and Firefox{' '}
          <code>permissions.sqlite</code> — showing every site you have
          explicitly allowed or blocked. Requires the backend:{' '}
          <code>npm run dev:all</code>
        </div>
      </div>

      {/* Server offline */}
      {error && !data && <ServerOffBanner error={error} />}

      {/* Loading */}
      {loading && !data && (
        <div className="lm-loading">
          <div className="lm-spinner" />
          <span>Reading browser permission databases…</span>
        </div>
      )}

      {/* Browser-level errors */}
      {data && detectedBrowsers.length > 0 && (
        <div className="sp-browser-errors">
          {detectedBrowsers.map(key => {
            const bd = data[key]
            if (!bd?.error) return null
            const meta = ALL_BROWSERS_META[key] || { icon: '🌐', label: key }

            let displayMsg = bd.error;
            if (displayMsg.includes('does not exist') || displayMsg.includes('not found')) {
              return null; // hide entirely if file hasn't been created yet
            } else {
              displayMsg = `Cannot read ${meta.label} preferences. Try running SensorGuard as administrator.`;
            }
            return (
              <BrowserError key={key} icon={meta.icon} label={meta.label} msg={displayMsg} />
            )
          })}
        </div>
      )}

      {/* Permission summary */}
      {data && <PermSummaryBar rows={allRows} />}

      {/* Filters */}
      {data && (
        <div className="site-filters">
          <input
            className="site-search"
            type="search"
            placeholder="🔍  Filter by site or permission…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className="filter-row">
            {/* Browser filter */}
            <div className="filter-group">
              <span className="filter-label">Browser</span>
              <div className="filter-chips">
                <button
                  className={`filter-chip${activeBrowser === 'all' ? ' active' : ''}`}
                  onClick={() => setActiveBrowser('all')}
                >All</button>
                {detectedBrowsers.map(b => {
                  const meta = ALL_BROWSERS_META[b] || { icon: '🌐', label: b }
                  return (
                    <button
                      key={b}
                      className={`filter-chip${activeBrowser === b ? ' active' : ''}`}
                      onClick={() => setActiveBrowser(b)}
                    >{meta.icon} {meta.label}</button>
                  )
                })}
              </div>
            </div>

            {/* Permission filter */}
            <div className="filter-group">
              <span className="filter-label">Permission</span>
              <div className="filter-chips">
                <button
                  className={`filter-chip${activePermFilt === 'all' ? ' active' : ''}`}
                  onClick={() => setActivePermFilt('all')}
                >All</button>
                {allPerms.map(p => (
                  <button
                    key={p}
                    className={`filter-chip perm-chip${activePermFilt === p ? ' active' : ''}`}
                    style={activePermFilt === p ? { borderColor: PERM_COLOR[p], color: PERM_COLOR[p] } : {}}
                    onClick={() => setActivePermFilt(activePermFilt === p ? 'all' : p)}
                  >{PERM_ICON[p] ?? '🔑'} {p}</button>
                ))}
              </div>
            </div>

            {/* Status filter */}
            <div className="filter-group">
              <span className="filter-label">Status</span>
              <div className="filter-chips">
                {['all', 'allowed', 'blocked', 'ask'].map(s => (
                  <button
                    key={s}
                    className={`filter-chip${activeStatus === s ? ' active' : ''}`}
                    onClick={() => setActiveStatus(s)}
                  >
                    {s === 'all' ? 'All'
                      : s === 'allowed' ? '✅ allowed'
                        : s === 'blocked' ? '🚫 blocked'
                          : '❓ ask'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Result count + refresh footer */}
      {data && (
        <div className="sp-results-meta">
          <span>
            Showing <strong>{filtered.length}</strong> of{' '}
            <strong>{allRows.length}</strong> permission entries
          </span>
          <div className="sp-meta-right">
            {lastScan && (
              <span>Last scan: <strong>{lastScan.toLocaleTimeString()}</strong></span>
            )}
            {!loading && (
              <span className="lm-live">
                {live ? <span style={{ color: '#4ade80' }}>● Live</span> : <span style={{ color: '#fbbf24' }}>Reconnecting...</span>}
              </span>
            )}
            <button
              className={`lm-refresh-btn${loading ? ' loading' : ''}`}
              onClick={scan}
              disabled={loading}
            >
              {loading ? '⟳ Scanning…' : '🔄 Scan Now'}
            </button>
          </div>
        </div>
      )}

      {/* Permissions table */}
      {data && <PermissionsTable rows={filtered} />}

      {/* No-data state */}
      {data && allRows.length === 0 && !loading && (
        <div className="site-empty">
          {detectedBrowsers.length === 0 ? (
            <>
              <span>📂</span>
              <p>No compatible browser profiles detected on this machine.</p>
            </>
          ) : (
            <>
              <span>ℹ️</span>
              <p>
                No explicit permissions found in detected browsers. All sites are using default settings.
              </p>
            </>
          )}
        </div>
      )}

      {/* Desktop app permissions from OS */}
      {data && <DesktopAppsSection os={data.os} />}
    </div>
  )
}
