import React, { useState, useEffect, useMemo } from 'react';

// The tracking backend runs on port 8998
export default function ScreenTimePage() {
    const [screenTimeData, setScreenTimeData] = useState([]);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [connected, setConnected] = useState(false);

    const [bgApps, setBgApps] = useState([]);
    const [bgConnected, setBgConnected] = useState(false);

    const [showAllDomainsFor, setShowAllDomainsFor] = useState({});
    const [showAllProcesses, setShowAllProcesses] = useState(false);

    // Provide deterministic colors based on app name
    const stringToColor = (str) => {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        const h = Math.abs(hash) % 360;
        return `hsl(${h}, 70%, 60%)`;
    };

    // Connection to Screen Time Tracker (Port 8998)
    useEffect(() => {
        let ws;
        let reconnectTimeout;
        let backoff = 500;

        function connect() {
            ws = new WebSocket('ws://127.0.0.1:8998');

            ws.onopen = () => {
                setConnected(true);
                backoff = 500;
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.event === 'screen_time') {
                        setScreenTimeData(data.data || []);
                        setLastUpdated(new Date());
                    }
                } catch (e) {
                    console.error('[ScreenTime] Error parsing message:', e);
                }
            };

            ws.onclose = () => {
                setConnected(false);
                reconnectTimeout = setTimeout(connect, backoff);
                backoff = Math.min(backoff * 2, 30000);
            };

            ws.onerror = () => ws.close();
        }

        connect();

        return () => {
            clearTimeout(reconnectTimeout);
            if (ws) { ws.onclose = null; ws.close(); }
        };
    }, []);

    // Connection to Background Apps Monitor (Port 8997)
    useEffect(() => {
        let ws;
        let reconnectTimeout;
        let backoff = 1000;

        function connect() {
            ws = new WebSocket('ws://127.0.0.1:8997');

            ws.onopen = () => { setBgConnected(true); backoff = 1000; };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.event === 'background_apps') setBgApps(data.apps || []);
                } catch (e) { }
            };

            ws.onclose = () => {
                setBgConnected(false);
                reconnectTimeout = setTimeout(connect, backoff);
                backoff = Math.min(backoff * 2, 30000);
            };

            ws.onerror = () => ws.close();
        }

        connect();

        return () => {
            clearTimeout(reconnectTimeout);
            if (ws) { ws.onclose = null; ws.close(); }
        };
    }, []);

    const totalSeconds = screenTimeData.reduce((acc, row) => acc + row.time, 0);

    function formatTime(totalSecs) {
        if (!totalSecs || totalSecs === 0) return '0m';
        const h = Math.floor(totalSecs / 3600);
        const m = Math.floor((totalSecs % 3600) / 60);
        if (h > 0) return `${h}h ${m}m`;
        return `${m}m`;
    }

    // Aggregate Top Apps vs Top Websites
    const topAppsMap = {};
    const webActivityMap = {};

    for (const row of screenTimeData) {
        if (row.app.includes('::')) {
            const parts = row.app.split('::');
            const parentApp = parts[0];
            const website = parts[1];

            topAppsMap[parentApp] = (topAppsMap[parentApp] || 0) + row.time;
            if (!webActivityMap[parentApp]) webActivityMap[parentApp] = [];
            webActivityMap[parentApp].push({ site: website, time: row.time });
        } else {
            topAppsMap[row.app] = (topAppsMap[row.app] || 0) + row.time;
        }
    }

    const sortedApps = Object.entries(topAppsMap).sort((a, b) => b[1] - a[1]);

    const displayedApps = showAllProcesses ? sortedApps : sortedApps.slice(0, 5);

    const toggleDomains = (appName) => {
        setShowAllDomainsFor(prev => ({ ...prev, [appName]: !prev[appName] }));
    };

    return (
        <div className="st-page">
            <div className="st-hero">
                <div className="st-hero-content">
                    <div className="st-hero-main">
                        <div className="st-total-circle">
                            <svg viewBox="0 0 100 100">
                                <circle className="st-circle-bg" cx="50" cy="50" r="45" />
                                <circle
                                    className="st-circle-progress"
                                    cx="50" cy="50" r="45"
                                    style={{ strokeDasharray: `283`, strokeDashoffset: `283` }}
                                />
                            </svg>
                            <div className="st-circle-text">
                                <h2>{formatTime(totalSeconds)}</h2>
                                <p>Today</p>
                            </div>
                        </div>
                        <div className="st-hero-info">
                            <div className="st-status-badge-wrap">
                                {connected ? (
                                    <span className="st-live-tag">● Live Monitoring</span>
                                ) : (
                                    <span className="st-reconnecting-tag">⚠ Reconnecting...</span>
                                )}
                            </div>
                            <h1>Screen Activity</h1>
                            <p className="st-subtitle">Visualizing your digital footprint in real-time.</p>

                            <div className="st-quick-stats">
                                <div className="st-stat-card">
                                    <span className="st-stat-icon">🔥</span>
                                    <div className="st-stat-details">
                                        <span className="st-stat-label">Top App</span>
                                        <span className="st-stat-value">{sortedApps[0]?.[0] || '—'}</span>
                                    </div>
                                </div>
                                <div className="st-stat-card">
                                    <span className="st-stat-icon">🌍</span>
                                    <div className="st-stat-details">
                                        <span className="st-stat-label">Websites</span>
                                        <span className="st-stat-value">{Object.keys(webActivityMap).length} active browsers</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="st-date-nav">
                        <button className="st-nav-btn">&larr;</button>
                        <div className="st-current-date">
                            <span>{new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</span>
                            <small>Today</small>
                        </div>
                        <button className="st-nav-btn" disabled>&rarr;</button>
                    </div>
                </div>
            </div>

            <div className="st-content-grid">
                {/* Visual Chart Card */}
                <div className="st-card st-chart-card">
                    <div className="st-card-header">
                        <h3><span>📊</span> Activity Distribution</h3>
                    </div>
                    <div className="st-chart-wrapper" style={{ display: 'flex', flexDirection: 'column', padding: '1rem', minHeight: '150px' }}>
                        {totalSeconds === 0 ? (
                            <div className="st-empty-state" style={{ margin: 'auto' }}>
                                <p>No data recorded yet.</p>
                            </div>
                        ) : (
                            <>
                                <div style={{ display: 'flex', width: '100%', height: '40px', borderRadius: '8px', overflow: 'hidden', backgroundColor: '#334155' }}>
                                    {sortedApps.map(([appName, time]) => {
                                        const percent = (time / totalSeconds) * 100;
                                        if (percent < 0.5) return null; // Too small to render cleanly
                                        return (
                                            <div
                                                key={appName}
                                                style={{ width: `${percent}%`, height: '100%', backgroundColor: stringToColor(appName), borderRight: '1px solid rgba(0,0,0,0.2)', position: 'relative' }}
                                                title={`${appName}: ${formatTime(time)} (${percent.toFixed(1)}%)`}
                                            />
                                        );
                                    })}
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginTop: '1.5rem', fontSize: '0.85rem' }}>
                                    {sortedApps.slice(0, 8).map(([appName, time]) => (
                                        <div key={appName} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                            <div style={{ width: '12px', height: '12px', borderRadius: '3px', backgroundColor: stringToColor(appName) }}></div>
                                            <span style={{ color: '#e2e8f0' }}>{appName}</span>
                                            <span style={{ color: '#94a3b8' }}>{Math.round((time / totalSeconds) * 100)}%</span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {/* Most Used Apps Card */}
                <div className="st-card st-apps-card">
                    <div className="st-card-header">
                        <h3><span>🚀</span> Most Used Applications</h3>
                        <button
                            onClick={() => setShowAllProcesses(!showAllProcesses)}
                            className="st-card-subtitle"
                            style={{ background: 'transparent', border: '1px solid #475569', borderRadius: '4px', color: '#94a3b8', padding: '0.2rem 0.5rem', cursor: 'pointer' }}
                        >
                            {showAllProcesses ? 'Show top 5 only' : `${sortedApps.length} processes detected`}
                        </button>
                    </div>

                    <div className="st-app-rows">
                        {sortedApps.length === 0 && (
                            <div className="st-empty-state">
                                <span>⌛</span>
                                <p>No activity detected yet. Start using apps to see magic!</p>
                            </div>
                        )}
                        {displayedApps.map(([appName, time]) => {
                            let icon = '📱';
                            if (appName.includes('Chrome')) icon = '🟡';
                            else if (appName.includes('Edge')) icon = '🔵';
                            else if (appName.includes('Brave')) icon = '🦁';
                            else if (appName.includes('Firefox')) icon = '🦊';
                            else if (appName.includes('Code') || appName.includes('Vite')) icon = '⌨️';
                            else if (appName.includes('Terminal') || appName.includes('cmd') || appName.includes('PowerShell')) icon = '🐚';

                            const percent = Math.min(((time / totalSeconds) * 100).toFixed(1), 100);
                            const domains = webActivityMap[appName]?.sort((a, b) => b.time - a.time) || [];
                            const isExpanded = showAllDomainsFor[appName];

                            return (
                                <div key={appName} className="st-app-item">
                                    <div className="st-app-header">
                                        <div className="st-app-meta">
                                            <span className="st-app-icon-bg">{icon}</span>
                                            <div>
                                                <div className="st-app-name-row">
                                                    <span className="st-app-title">{appName}</span>
                                                    {percent > 30 && <span className="st-heavy-badge">Heavy Use</span>}
                                                </div>
                                                <span className="st-app-duration">{formatTime(time)} • {percent}% of session</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="st-progress-container">
                                        <div className="st-progress-bar" style={{ width: `${percent}%`, backgroundColor: stringToColor(appName) }}></div>
                                    </div>

                                    {/* Web breakdown if applicable */}
                                    {domains.length > 0 && (
                                        <div className="st-web-breakdown">
                                            {(isExpanded ? domains : domains.slice(0, 3)).map(siteRow => (
                                                <div key={siteRow.site} className="st-site-tag">
                                                    <img src={`https://www.google.com/s2/favicons?domain=${siteRow.site.split('/')[0]}&sz=32`} style={{ width: 14, height: 14, marginRight: 4, verticalAlign: 'middle', borderRadius: '2px' }} alt="" />
                                                    <span className="st-site-name">{siteRow.site}</span>
                                                    <span className="st-site-time">{formatTime(siteRow.time)}</span>
                                                </div>
                                            ))}
                                            {domains.length > 3 && (
                                                <button
                                                    onClick={() => toggleDomains(appName)}
                                                    className="st-more-sites"
                                                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '4px' }}
                                                >
                                                    {isExpanded ? 'Show less' : `+${domains.length - 3} more domains`}
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Live Background Apps Panel */}
            <div className="st-live-apps-section">
                <div className="st-card">
                    <div className="st-card-header" style={{ marginBottom: '1rem' }}>
                        <h3>
                            <span>🖥️</span> Live Background Applications
                            {bgConnected ? (
                                <span className="st-live-dot-small" title="Live">●</span>
                            ) : (
                                <span className="st-disconnected-text">(Offline)</span>
                            )}
                        </h3>
                        <span className="st-card-subtitle">{bgApps.length} active windows</span>
                    </div>

                    <div className="st-bg-apps-grid">
                        {bgApps.length === 0 && bgConnected && (
                            <p className="st-muted-text">No active windows detected.</p>
                        )}
                        {bgApps.map((app, idx) => {
                            let icon = '📦';
                            const lowerApp = app.app.toLowerCase();
                            if (lowerApp.includes('chrome')) icon = '🟡';
                            else if (lowerApp.includes('edge')) icon = '🔵';
                            else if (lowerApp.includes('firefox')) icon = '🦊';
                            else if (lowerApp.includes('brave')) icon = '🦁';
                            else if (lowerApp.includes('code') || lowerApp.includes('studio')) icon = '⌨️';
                            else if (lowerApp.includes('terminal')) icon = '🐚';
                            else if (lowerApp.includes('explorer')) icon = '📁';
                            else if (lowerApp.includes('discord')) icon = '🎮';
                            else if (lowerApp.includes('whatsapp')) icon = '💬';

                            return (
                                <div key={idx} className="st-bg-app-card">
                                    <div className="st-bg-app-icon">{icon}</div>
                                    <div className="st-bg-app-info">
                                        <div className="st-bg-app-name">{app.app}</div>
                                        <div className="st-bg-app-title" title={app.title}>{app.title}</div>
                                    </div>
                                    <div className="st-bg-app-pid">PID: {app.pid}</div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            <footer className="st-footer">
                <div className="st-footer-content">
                    <span className="st-pulse-dot"></span>
                    <span>
                        {lastUpdated
                            ? `Last sync at ${lastUpdated.toLocaleTimeString()}`
                            : 'Synchronizing with SensorGuard Daemon...'}
                    </span>
                </div>
            </footer>
        </div>
    );
}
