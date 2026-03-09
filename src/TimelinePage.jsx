import { useState, useEffect } from 'react'

function StatusBadge({ type }) {
    const colors = {
        HARDWARE: { bg: 'rgba(255, 255, 255, 0.1)', color: '#ffffff' },
        CAMERA: { bg: 'rgba(255, 255, 255, 0.2)', color: '#ffffff' },
        MICROPHONE: { bg: 'rgba(200, 200, 200, 0.15)', color: '#e2e8f0' },
        SYSTEM: { bg: 'rgba(100, 100, 100, 0.15)', color: '#94a3b8' },
        DEFAULT: { bg: 'rgba(255, 255, 255, 0.1)', color: '#f8fafc' },
    }
    const style = colors[type] || colors.DEFAULT

    return (
        <span style={{
            backgroundColor: style.bg,
            color: style.color,
            padding: '0.2rem 0.5rem',
            borderRadius: '4px',
            fontSize: '0.75rem',
            fontWeight: 'bold',
            letterSpacing: '0.05em'
        }}>
            {type}
        </span>
    )
}

export default function TimelinePage() {
    const [events, setEvents] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)

    useEffect(() => {
        async function loadEvents() {
            try {
                const res = await fetch('/api/timeline')
                if (!res.ok) throw new Error('Failed to load timeline events')
                const data = await res.json()
                setEvents(data.events || [])
            } catch (e) {
                setError(e.message)
            } finally {
                setLoading(false)
            }
        }
        loadEvents()
    }, [])

    return (
        <div className="page-wrapper fade-in" style={{ maxWidth: '900px', margin: '0 auto' }}>
            <header className="page-header" style={{ marginBottom: '2rem' }}>
                <h1 className="display-title">Privacy Timeline</h1>
                <p className="subtitle">Historical log of hardware insertions and deep sensor access.</p>
            </header>

            {error ? (
                <div className="info-panel" style={{ color: '#f87171' }}>
                    <strong>Error loading timeline:</strong> {error}
                </div>
            ) : loading ? (
                <div className="lm-loading">
                    <div className="lm-spinner" />
                    <span>Syncing logs from database...</span>
                </div>
            ) : events.length === 0 ? (
                <div className="info-panel" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
                    <span style={{ fontSize: '3rem', opacity: 0.5 }}>🕰️</span>
                    <h2 style={{ marginTop: '1rem', color: '#f8fafc' }}>Your timeline is empty.</h2>
                    <p style={{ color: '#94a3b8', marginTop: '0.5rem' }}>
                        SensorGuard has just started recording your privacy and hardware events.
                        Try plugging in a USB drive to see it appear here!
                    </p>
                </div>
            ) : (
                <div className="timeline-container">
                    {events.map((evt, i) => {
                        const date = new Date(evt.timestamp)
                        return (
                            <div key={i} style={{
                                display: 'flex',
                                gap: '1.5rem',
                                marginBottom: '1.5rem',
                                position: 'relative'
                            }}>
                                {/* Timeline Line */}
                                {i !== events.length - 1 && (
                                    <div style={{
                                        position: 'absolute',
                                        left: '42px',
                                        top: '40px',
                                        bottom: '-20px',
                                        width: '2px',
                                        background: 'linear-gradient(to bottom, rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0.1))'
                                    }} />
                                )}

                                {/* Time column */}
                                <div style={{
                                    minWidth: '85px',
                                    textAlign: 'right',
                                    color: '#94a3b8',
                                    fontSize: '0.85rem',
                                    paddingTop: '0.5rem'
                                }}>
                                    <div>{date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
                                    <div style={{ color: '#f8fafc', fontWeight: 'bold' }}>
                                        {date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                    </div>
                                </div>

                                {/* Dot */}
                                <div style={{
                                    width: '12px',
                                    height: '12px',
                                    borderRadius: '50%',
                                    background: '#ffffff',
                                    marginTop: '0.6rem',
                                    boxShadow: '0 0 10px rgba(255, 255, 255, 0.8)',
                                    zIndex: 1
                                }} />

                                {/* Content Card */}
                                <div className="info-panel glass-card" style={{
                                    flex: 1,
                                    padding: '1rem',
                                    margin: 0,
                                    borderLeft: '4px solid #ffffff'
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                                        <StatusBadge type={evt.event_type} />
                                        <span style={{ fontSize: '0.8rem', color: '#64748b' }}>#{evt.id}</span>
                                    </div>
                                    <h3 style={{ fontSize: '1.1rem', margin: '0 0 0.25rem 0', color: '#f8fafc' }}>
                                        {evt.event_source}
                                    </h3>
                                    <p style={{ margin: 0, color: '#cbd5e1', fontSize: '0.95rem' }}>
                                        {evt.event_detail}
                                    </p>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
