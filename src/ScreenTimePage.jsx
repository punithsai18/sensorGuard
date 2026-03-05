import React, { useState, useEffect } from 'react';

// The tracking backend runs on port 8998
export default function ScreenTimePage() {
    const [screenTimeData, setScreenTimeData] = useState([]);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [connected, setConnected] = useState(false);
    const [view, setView] = useState('daily');

    useEffect(() => {
        let ws;
        let reconnectTimeout;
        let backoff = 500;

        function connect() {
            ws = new WebSocket('ws://localhost:8998');

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
            {/* Header Info */}
            <div className="st-header">
                <div className="st-date-selector">
                    <button>&lt; Yesterday</button>
                    <button className="st-today">Today ▾</button>
                    <button style={{ opacity: 0.5 }}>Tomorrow &gt;</button>
                </div>
                <div className="st-total">
                    <h1>{formatTime(totalSeconds)}</h1>
                    <p>Total Screen Time Today</p>
                    {connected ? (
                        <span className="st-updated-live">● Live</span>
                    ) : (
                        <span className="st-disconnected">Reconnecting...</span>
                    )}
                </div>
            </div>

            {/* Basic Mock Chart */}
            <div className="st-chart-container">
                <div className="st-chart-tabs">
                    <button className={view === 'daily' ? 'active' : ''} onClick={() => setView('daily')}>Daily</button>
                    <button className={view === 'weekly' ? 'active' : ''} onClick={() => setView('weekly')}>Weekly</button>
                </div>
                <div className="st-bar-chart">
                    {/* Dummy bars for UI presentation */}
                    {Array.from({ length: 24 }).map((_, i) => (
                        <div key={i} className="st-bar" style={{ height: `${Math.random() * 80 + 10}%` }}></div>
                    ))}
                </div>
                <div className="st-chart-labels">
                    <span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span>
                </div>
            </div>

            {/* App List */}
            <div className="st-app-list">
                <h3>Most Used Apps</h3>
                {sortedApps.length === 0 && <p className="lm-empty">No screen time data recorded for today.</p>}
                {sortedApps.map(([appName, time]) => {
                    let icon = '📱';
                    if (appName.includes('Chrome')) icon = '🟡';
                    else if (appName.includes('Edge')) icon = '🔵';
                    else if (appName.includes('Brave')) icon = '🦁';
                    else if (appName.includes('Firefox')) icon = '🦊';
                    else if (appName.includes('Code') || appName.includes('Vite')) icon = '⌨️';

                    const percent = Math.min(((time / totalSeconds) * 100).toFixed(1), 100);

                    return (
                        <div key={appName} className="st-app-row">
                            <div className="st-app-main">
                                <span className="st-app-icon">{icon}</span>
                                <div className="st-app-info">
                                    <span className="st-app-name">{appName}</span>
                                    <span className="st-app-limit-btn">Set limit</span>
                                </div>
                                <span className="st-app-time">{formatTime(time)}</span>
                            </div>
                            <div className="st-app-bar-wrap">
                                <div className="st-app-bar" style={{ width: `${percent}%` }}></div>
                            </div>

                            {/* Top Websites Sub-section */}
                            {webActivityMap[appName] && webActivityMap[appName].length > 0 && (
                                <div className="st-sites-list">
                                    {webActivityMap[appName].sort((a, b) => b.time - a.time).slice(0, 5).map(siteRow => (
                                        <div key={siteRow.site} className="st-site-row">
                                            <span>🌐 {siteRow.site}</span>
                                            <span>{formatTime(siteRow.time)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Footer Info */}
            <p className="st-footer-update">
                {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Waiting for real-time tracking daemon...'}
            </p>
        </div>
    );
}
