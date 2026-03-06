import React, { useState, useEffect } from 'react';

// The tracking backend runs on port 8998
export default function ScreenTimePage() {
    const [screenTimeData, setScreenTimeData] = useState([]);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [connected, setConnected] = useState(false);
    const [view, setView] = useState('daily');

    const [bgApps, setBgApps] = useState([]);
    const [bgConnected, setBgConnected] = useState(false);

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

            ws.onerror = () => {
                ws.close();
            };
        }

        connect();

        return () => {
            clearTimeout(reconnectTimeout);
            if (ws) {
                ws.onclose = null;
                ws.close();
            }
        };
    }, []);

    // Connection to Background Apps Monitor (Port 8997)
    useEffect(() => {
        let ws;
        let reconnectTimeout;
        let backoff = 1000;

        function connect() {
            ws = new WebSocket('ws://127.0.0.1:8997');

            ws.onopen = () => {
                setBgConnected(true);
                backoff = 1000;
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.event === 'background_apps') {
                        setBgApps(data.apps || []);
                    }
                } catch (e) {
                    console.error('[BgApps] Error:', e);
                }
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
            if (ws) {
                ws.onclose = null;
                ws.close();
            }
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

    return (
        <div className="st-page">
            {/* Glassmorphism Header */}
            <div className="st-hero">
                <div className="st-hero-content">
                    <div className="st-hero-main">
                        <div className="st-total-circle">
                            <svg viewBox="0 0 100 100">
                                <circle className="st-circle-bg" cx="50" cy="50" r="45" />
                                <circle
                                    className="st-circle-progress"
                                    cx="50" cy="50" r="45"
                                    style={{ strokeDasharray: `283`, strokeDashoffset: `283` }} // Placeholder animation
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
                                        <span className="st-stat-value">{Object.keys(webActivityMap).length} active</span>
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
                        <h3><span>📊</span> Activity Timeline</h3>
                        <div className="st-view-toggle">
                            <button className={view === 'daily' ? 'active' : ''} onClick={() => setView('daily')}>Day</button>
                            <button className={view === 'weekly' ? 'active' : ''} onClick={() => setView('weekly')}>Week</button>
                        </div>
                    </div>
                    <div className="st-chart-wrapper">
                        <div className="st-bar-chart">
                            {Array.from({ length: 24 }).map((_, i) => {
                                const h = Math.random() * 70 + 5;
                                return (
                                    <div key={i} className="st-bar-group">
                                        <div className="st-bar-active" style={{ height: `${h}%` }}>
                                            <div className="st-bar-tooltip">{i}:00 - {Math.round(h)}m</div>
                                        </div>
                                        <span className="st-bar-label">{i % 6 === 0 ? `${i}h` : ''}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Most Used Apps Card */}
                <div className="st-card st-apps-card">
                    <div className="st-card-header">
                        <h3><span>🚀</span> Most Used Applications</h3>
                        <span className="st-card-subtitle">{sortedApps.length} processes detected</span>
                    </div>

                    <div className="st-app-rows">
                        {sortedApps.length === 0 && (
                            <div className="st-empty-state">
                                <span>⌛</span>
                                <p>No activity detected yet. Start using apps to see magic!</p>
                            </div>
                        )}
                        {sortedApps.map(([appName, time]) => {
                            let icon = '📱';
                            if (appName.includes('Chrome')) icon = '🟡';
                            else if (appName.includes('Edge')) icon = '🔵';
                            else if (appName.includes('Brave')) icon = '🦁';
                            else if (appName.includes('Firefox')) icon = '🦊';
                            else if (appName.includes('Code') || appName.includes('Vite')) icon = '⌨️';
                            else if (appName.includes('Terminal') || appName.includes('cmd') || appName.includes('PowerShell')) icon = '🐚';

                            const percent = Math.min(((time / totalSeconds) * 100).toFixed(1), 100);

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
                                        <div className="st-progress-bar" style={{ width: `${percent}%` }}></div>
                                    </div>

                                    {/* Web breakdown if applicable */}
                                    {webActivityMap[appName] && webActivityMap[appName].length > 0 && (
                                        <div className="st-web-breakdown">
                                            {webActivityMap[appName].sort((a, b) => b.time - a.time).slice(0, 3).map(siteRow => (
                                                <div key={siteRow.site} className="st-site-tag">
                                                    <span className="st-site-name">🌐 {siteRow.site}</span>
                                                    <span className="st-site-time">{formatTime(siteRow.time)}</span>
                                                </div>
                                            ))}
                                            {webActivityMap[appName].length > 3 && (
                                                <span className="st-more-sites">+{webActivityMap[appName].length - 3} more domains</span>
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
