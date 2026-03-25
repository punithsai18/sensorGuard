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
                // Filter to only show USB related events
                const usbEvents = (data.events || []).filter(evt => 
                    evt.event_source && evt.event_source.toLowerCase() === 'usb'
                )
                setEvents(usbEvents)
            } catch (e) {
                setError(e.message)
            } finally {
                setLoading(false)
            }
        }
        loadEvents()
        const id = setInterval(loadEvents, 5000)
        return () => clearInterval(id)
    }, [])

    return (
        <div className="page-wrapper fade-in" style={{ maxWidth: '900px', margin: '0 auto' }}>
            <header className="page-header" style={{ marginBottom: '2rem' }}>
                <h1 className="display-title">Hardware Timeline</h1>
                <p className="subtitle">Real-time log of USB devices connected to this system.</p>
            </header>

            {error ? (
                <div className="info-panel" style={{ color: '#f87171' }}>
                    <strong>Error loading timeline:</strong> {error}
                </div>
            ) : loading ? (
                <div className="lm-loading">
                    <div className="lm-spinner" />
                    <span>Syncing hardware logs...</span>
                </div>
            ) : events.length === 0 ? (
                <div className="info-panel" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
                    <span style={{ fontSize: '3rem', opacity: 0.5 }}>🔌</span>
                    <h2 style={{ marginTop: '1rem', color: '#f8fafc' }}>No USB activity detected.</h2>
                    <p style={{ color: '#94a3b8', marginTop: '0.5rem' }}>
                        Connect a USB drive or peripheral to see it appear in this log.
                    </p>
                </div>
            ) : (
                <div className="timeline-container">
                    {events.map((evt, i) => {
                        const date = new Date(evt.timestamp)
                        const isDisconnect = evt.event_detail.toLowerCase().includes('stopped')
                        
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
                                    <div style={{ fontWeight: 'bold', color: '#f8fafc' }}>
                                        {date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                    </div>
                                    <div style={{ fontSize: '0.75rem' }}>
                                        {date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                    </div>
                                </div>

                                {/* Dot */}
                                <div style={{
                                    width: '12px',
                                    height: '12px',
                                    borderRadius: '50%',
                                    background: isDisconnect ? '#4b5563' : '#ffffff',
                                    marginTop: '0.6rem',
                                    boxShadow: isDisconnect ? 'none' : '0 0 10px rgba(255, 255, 255, 0.8)',
                                    zIndex: 1
                                }} />

                                {/* Content Card */}
                                <div className="info-panel glass-card" style={{
                                    flex: 1,
                                    padding: '1rem',
                                    margin: 0,
                                    borderLeft: `4px solid ${isDisconnect ? '#4b5563' : '#ffffff'}`,
                                    background: isDisconnect ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.05)'
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.25rem' }}>
                                        <span style={{ 
                                            fontSize: '0.7rem', 
                                            fontWeight: 'bold', 
                                            letterSpacing: '0.1em',
                                            color: isDisconnect ? '#64748b' : '#ffffff'
                                        }}>
                                            {isDisconnect ? '🔌 DISCONNECTED' : '📦 USB CONNECTED'}
                                        </span>
                                    </div>
                                    <h3 style={{ 
                                        fontSize: '1.2rem', 
                                        margin: '0', 
                                        color: isDisconnect ? '#94a3b8' : '#f8fafc',
                                        fontWeight: '600'
                                    }}>
                                        {isDisconnect ? 'Device Removed' : evt.event_detail}
                                    </h3>
                                    {!isDisconnect && (
                                        <p style={{ margin: '0.25rem 0 0 0', color: '#64748b', fontSize: '0.8rem' }}>
                                            Hardware Event logged via Win32 API
                                        </p>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
