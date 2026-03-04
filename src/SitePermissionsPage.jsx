import { useState, useEffect, useMemo, useCallback } from 'react'

// ── Constants ──────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL = 30 // seconds

const BROWSER_LABELS = [
  { key: 'chrome',  icon: '🟡', label: 'Chrome' },
  { key: 'edge',    icon: '🔵', label: 'Edge' },
  { key: 'firefox', icon: '🦊', label: 'Firefox' },
]

const PERM_ICON = {
  camera           : '📷',
  microphone       : '🎤',
  geolocation      : '📍',
  notifications    : '🔔',
  'display-capture': '🖥️',
  'clipboard-read' : '📋',
  'clipboard-write': '📋',
  'storage-access' : '🔐',
}

const PERM_COLOR = {
  camera           : '#f87171',
  microphone       : '#fb923c',
  geolocation      : '#facc15',
  notifications    : '#34d399',
  'display-capture': '#60a5fa',
  'clipboard-read' : '#a78bfa',
  'clipboard-write': '#c084fc',
  'storage-access' : '#22d3ee',
}

const STATUS_COLOR = { allowed: '#4ade80', blocked: '#f87171', ask: '#fbbf24' }
const STATUS_ICON  = { allowed: '✅', blocked: '🚫', ask: '❓' }

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

/**
 * Merge Chrome, Edge, and Firefox scanner results into a flat list of
 * { site, browser, permission, status } rows that can be filtered/sorted.
 */
function buildRows(data) {
  const rows = []
  for (const { key: browser } of BROWSER_LABELS) {
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
  camera     : 'Camera',
  microphone : 'Microphone',
  geolocation: 'Location',
}

const OS_PERM_ICON = {
  camera     : '📷',
  microphone : '🎤',
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
  const icon  = STATUS_ICON[status]  ?? '—'
  return (
    <span className="lm-badge" style={{ color, borderColor: color }}>
      {icon} {status}
    </span>
  )
}

function BrowserChip({ browser }) {
  const b = BROWSER_LABELS.find(x => x.key === browser)
  return b ? <span className="sp-browser-chip">{b.icon} {b.label}</span> : null
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
  const [data,      setData]      = useState(null)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState(null)
  const [lastScan,  setLastScan]  = useState(null)
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL)

  // Filters
  const [search,         setSearch]         = useState('')
  const [activeBrowser,  setActiveBrowser]  = useState('all')
  const [activePermFilt, setActivePermFilt] = useState('all')
  const [activeStatus,   setActiveStatus]   = useState('all')

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

  const allRows = useMemo(() => buildRows(data), [data])

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
      if (activeStatus   !== 'all' && r.status !== activeStatus)       return false
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
      {data && (
        <div className="sp-browser-errors">
          {BROWSER_LABELS.map(b => {
            const bd = data[b.key]
            if (!bd?.error) return null
            return (
              <BrowserError key={b.key} icon={b.icon} label={b.label} msg={bd.error} />
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
                {BROWSER_LABELS.map(b => (
                  <button
                    key={b.key}
                    className={`filter-chip${activeBrowser === b.key ? ' active' : ''}`}
                    onClick={() => setActiveBrowser(b.key)}
                  >{b.icon} {b.label}</button>
                ))}
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
              <span className="lm-countdown">
                Next in <strong>{countdown}s</strong>
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

      {/* No-data state when server is up but no permissions are recorded */}
      {data && allRows.length === 0 && !loading && (
        <div className="site-empty">
          <span>📂</span>
          <p>
            No browser permissions found. Open Chrome, Edge, or Firefox and
            grant camera/microphone access to a site, then click{' '}
            <strong>Scan Now</strong>.
          </p>
        </div>
      )}

      {/* Desktop app permissions from OS */}
      {data && <DesktopAppsSection os={data.os} />}
    </div>
  )
}
