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

    const [dailyGoalMinutes, setDailyGoalMinutes] = useState(120); // 2 hours default
    const [isEditingGoal, setIsEditingGoal] = useState(false);

    // PART 2 & 3 & 4: REST CHART STATE
    const [viewMode, setViewMode] = useState('1D');
    const [chartData, setChartData] = useState([]);
    const [chartSummary, setChartSummary] = useState([]);
    const [tooltip, setTooltip] = useState(null);
    const [showResetConfirm, setShowResetConfirm] = useState(false);

    const appColorsFixed = {
        'Google Chrome': '#4285F4',
        'VS Code': '#007ACC',
        'File Explorer': '#FFA500',
        'Other': '#888888'
    };

    const top5Names = useMemo(() => {
        return chartSummary.slice(0, 5).map(s => s.name);
    }, [chartSummary]);

    const getChartAppColor = (appName) => {
        if (appColorsFixed[appName]) return appColorsFixed[appName];
        if (!top5Names.includes(appName)) return '#888888';
        const dynamicColors = ['#10b981', '#8b5cf6', '#f43f5e', '#0ea5e9', '#f59e0b'];
        let assigned = 0;
        for (const name of top5Names) {
            if (name === appName) break;
            if (!appColorsFixed[name]) assigned++;
        }
        return dynamicColors[assigned % dynamicColors.length];
    };

    const localDateStr = (dateObj) => {
        const y = dateObj.getFullYear();
        const m = String(dateObj.getMonth() + 1).padStart(2, '0');
        const d = String(dateObj.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    useEffect(() => {
        const fetchChartData = async () => {
            try {
                let url;
                if (viewMode === '1D') {
                    url = `http://localhost:3005/api/screentime`;
                } else {
                    const daysCount = viewMode === '3D' ? 3 : 7;
                    url = `http://localhost:3005/api/screentime/history?days=${daysCount}`;
                }

                const res = await fetch(url);
                const json = await res.json();
                
                if (viewMode === '1D') {
                    setChartData(json.hours || []);
                } else {
                    setChartData(json.days || []);
                }
                setChartSummary(json.summary || []);
            } catch (err) {
                console.error("Failed to load chart data", err);
            }
        };

        fetchChartData();
        const interval = setInterval(fetchChartData, 15000); // Higher resolution live updates
        return () => clearInterval(interval);
    }, [viewMode]);

    const W = 800;   
    const H = 200;   
    const PADDING = 25;

    const maxY = Math.max(30, ...chartData.map(d => Math.ceil((d.total_seconds || 0) / 60))); 

    const numCols = viewMode === '1D' ? 24 : (viewMode === '3D' ? 3 : 7);
    const colWidth = (W - PADDING * 2) / numCols;
    const gap = viewMode === '1D' ? 2 : Math.min(colWidth * 0.2, 40);
    const barW = Math.max(1, colWidth - gap);

    const labels = useMemo(() => {
        if (viewMode === '1D') {
            return Array.from({ length: 24 }, (_, i) => {
                const hourNum = i % 12 || 12;
                const ampm = i < 12 ? 'am' : 'pm';
                return {
                    index: i,
                    label: i % 4 === 0 ? `${hourNum}${ampm}` : '',
                    fullLabel: `${hourNum}:00 ${ampm}`,
                    data: chartData[i]
                };
            });
        }
        
        const daysCount = viewMode === '3D' ? 3 : 7;
        const todayAtMidnight = new Date();
        return Array.from({ length: daysCount }, (_, i) => {
            const diffIdx = daysCount - 1 - i;
            const d = new Date(todayAtMidnight.getTime() - diffIdx * 24 * 60 * 60 * 1000);
            const dateStr = localDateStr(d);
            return {
                index: i,
                label: diffIdx === 0 ? 'Today' : d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' }),
                fullLabel: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                data: chartData.find(cd => cd.date === dateStr)
            };
        });
    }, [viewMode, chartData]);

    const renderBars = () => {
        return labels.map((col, i) => {
            const x = PADDING + i * colWidth + gap / 2;
            if (!col.data || !col.data.apps || col.data.apps.length === 0) {
                return (
                    <rect key={`empty-${i}`} x={x} y={H - PADDING - 2} width={barW} height={2} fill="#334155" />
                );
            }

            let yOffset = 0;
            const appsInCol = col.data.apps;
            const grouped = [];
            let otherSecs = 0;

            for (const a of appsInCol) {
                if (top5Names.includes(a.name) || appColorsFixed[a.name]) {
                    grouped.push(a);
                } else {
                    otherSecs += a.seconds;
                }
            }
            if (otherSecs > 0) {
                grouped.push({ name: 'Other', seconds: otherSecs });
            }

            return (
                <g key={`col-${i}`}>
                    {grouped.map((app, j) => {
                        const mins = app.seconds / 60;
                        const hBar = Math.max(2, (mins / Math.max(maxY, 1)) * (H - PADDING * 2));
                        const yBar = H - PADDING - yOffset - hBar;
                        yOffset += hBar;
                        return (
                            <rect 
                                key={`part-${i}-${j}`} 
                                x={x} y={yBar} width={barW} height={hBar} 
                                fill={getChartAppColor(app.name)} 
                                onMouseEnter={(e) => setTooltip({
                                    x: e.clientX,
                                    y: e.clientY - 20,
                                    content: `${app.name} — ${Math.floor(app.seconds / 60)}m ${app.seconds % 60}s (${col.fullLabel})`
                                })}
                                onMouseMove={(e) => setTooltip({
                                    x: e.clientX,
                                    y: e.clientY - 20,
                                    content: `${app.name} — ${Math.floor(app.seconds / 60)}m ${app.seconds % 60}s (${col.fullLabel})`
                                })}
                                onMouseLeave={() => setTooltip(null)}
                            />
                        );
                    })}
                </g>
            );
        });
    };

    const exportToCSV = () => {
        const headers = ["Application", "Time Used (seconds)", "Last Seen"];
        const rows = screenTimeData.map(row => `${row.app},${row.time},${row.last_seen || ''}`);
        const csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n" + rows.join("\n");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `screentime_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const stringToColor = (str) => {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        const l = 20 + (Math.abs(hash) % 50);
        return `hsl(0, 0%, ${l}%)`;
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
                        <div className="st-total-circle" style={{ borderColor: totalSeconds > dailyGoalMinutes * 60 ? '#ffffff' : '' }}>
                            <svg viewBox="0 0 100 100">
                                <circle className="st-circle-bg" cx="50" cy="50" r="45" />
                                <circle
                                    className="st-circle-progress"
                                    cx="50" cy="50" r="45"
                                    style={{
                                        strokeDasharray: `283`,
                                        strokeDashoffset: Math.max(0, 283 - (283 * Math.min(1, totalSeconds / (dailyGoalMinutes * 60 || 1)))),
                                        stroke: totalSeconds > dailyGoalMinutes * 60 ? '#ffffff' : '#64748b'
                                    }}
                                />
                            </svg>
                            <div className="st-circle-text">
                                <h2 style={{ color: totalSeconds > dailyGoalMinutes * 60 ? '#ffffff' : '' }}>{formatTime(totalSeconds)}</h2>
                                <p>Today</p>
                            </div>
                        </div>
                        <div className="st-hero-info">
                            <div className="st-status-badge-wrap" style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                {connected ? (
                                    <span className="st-live-tag" style={{ background: 'rgba(255, 255, 255, 0.1)', color: '#ffffff', padding: '4px 8px', borderRadius: '4px', fontSize: '12px' }}>● Live Monitoring</span>
                                ) : (
                                    <span className="st-reconnecting-tag" style={{ background: 'rgba(255, 255, 255, 0.05)', color: '#94a3b8', padding: '4px 8px', borderRadius: '4px', fontSize: '12px' }}>⚠ Reconnecting...</span>
                                )}
                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                    <button 
                                        onClick={exportToCSV} 
                                        style={{ background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.2)', padding: '4px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}
                                    >
                                        Export to CSV
                                    </button>
                                    
                                    {!showResetConfirm ? (
                                        <button 
                                            onClick={() => setShowResetConfirm(true)}
                                            style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#fee2e2', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '4px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}
                                        >
                                            Reset History
                                        </button>
                                    ) : (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(239, 68, 68, 0.1)', padding: '2px 8px', borderRadius: '6px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                                            <span style={{ fontSize: '10px', color: '#fca5a5', fontWeight: 'bold' }}>Sure?</span>
                                            <button 
                                                onClick={async () => {
                                                    try {
                                                        await fetch('http://localhost:3005/api/screentime/reset', { method: 'POST' });
                                                        setChartData([]);
                                                        setChartSummary([]);
                                                        setScreenTimeData([]);
                                                        setShowResetConfirm(false);
                                                    } catch(e) { console.error(e); }
                                                }}
                                                style={{ background: '#ef4444', color: 'white', border: 'none', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold', cursor: 'pointer' }}
                                            >
                                                YES
                                            </button>
                                            <button 
                                                onClick={() => setShowResetConfirm(false)}
                                                style={{ background: '#475569', color: 'white', border: 'none', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold', cursor: 'pointer' }}
                                            >
                                                NO
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <h1>Screen Activity</h1>

                            {totalSeconds > dailyGoalMinutes * 60 ? (
                                <p className="st-subtitle" style={{ color: '#ffffff', fontWeight: 'bold' }}>⚠️ You have exceeded your daily screen time goal!</p>
                            ) : (
                                <p className="st-subtitle">Visualizing your digital footprint in real-time.</p>
                            )}

                            <div className="st-quick-stats" style={{ display: 'flex', gap: '1rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                                <div className="st-stat-card" style={{ background: 'rgba(0,0,0,0.2)', padding: '0.5rem 1rem', borderRadius: '8px' }}>
                                    <div className="st-stat-details">
                                        <span className="st-stat-label" style={{ fontSize: '12px', color: '#94a3b8' }}>Top App</span>
                                        <span className="st-stat-value">{sortedApps[0]?.[0] || '—'}</span>
                                    </div>
                                </div>
                                <div className="st-stat-card" style={{ background: 'rgba(0,0,0,0.2)', padding: '0.5rem 1rem', borderRadius: '8px' }}>
                                    <div className="st-stat-details">
                                        <span className="st-stat-label" style={{ fontSize: '12px', color: '#94a3b8' }}>Daily Goal</span>
                                        {isEditingGoal ? (
                                            <input
                                                type="number"
                                                value={dailyGoalMinutes}
                                                onChange={(e) => setDailyGoalMinutes(Number(e.target.value))}
                                                onBlur={() => setIsEditingGoal(false)}
                                                autoFocus
                                                style={{ background: 'transparent', color: 'white', border: '1px solid #ffffff', width: '60px' }}
                                            />
                                        ) : (
                                            <span className="st-stat-value" onClick={() => setIsEditingGoal(true)} style={{ cursor: 'pointer', borderBottom: '1px dashed #64748b' }}>
                                                {Math.floor(dailyGoalMinutes / 60)}h {dailyGoalMinutes % 60}m
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="st-stat-card" style={{ background: 'rgba(0,0,0,0.2)', padding: '0.5rem 1rem', borderRadius: '8px' }}>
                                    <div className="st-stat-details">
                                        <span className="st-stat-label" style={{ fontSize: '12px', color: '#94a3b8' }}>Websites</span>
                                        <span className="st-stat-value">{Object.keys(webActivityMap).length} active browsers</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="st-date-nav">
                        <div className="st-view-toggle" style={{ display: 'flex', gap: '4px', background: 'rgba(0,0,0,0.3)', padding: '4px', borderRadius: '6px' }}>
                            <button 
                                onClick={() => setViewMode('1D')}
                                style={{ padding: '6px 16px', background: viewMode === '1D' ? '#475569' : 'transparent', color: viewMode === '1D' ? 'white' : '#94a3b8', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>
                                1D
                            </button>
                            <button 
                                onClick={() => setViewMode('3D')}
                                style={{ padding: '6px 16px', background: viewMode === '3D' ? '#475569' : 'transparent', color: viewMode === '3D' ? 'white' : '#94a3b8', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>
                                3D
                            </button>
                            <button 
                                onClick={() => setViewMode('7D')}
                                style={{ padding: '6px 16px', background: viewMode === '7D' ? '#475569' : 'transparent', color: viewMode === '7D' ? 'white' : '#94a3b8', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>
                                7D
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="st-content-grid">
                <div className="st-card st-chart-card">
                    <div className="st-card-header">
                        <h3><span>📊</span> Activity Timeline</h3>
                        <p style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                            {viewMode === '1D' ? 'Hourly breakdown of application usage today' : `Daily usage over the last ${viewMode === '3D' ? '3' : '7'} days`}
                        </p>
                    </div>
                    <div className="st-chart-wrapper" style={{ padding: '1rem', position: 'relative' }}>
                        <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
                            {/* Y axis steps */}
                            {[0, 0.5, 1].map(pct => {
                                const yLine = H - PADDING - pct * (H - PADDING * 2);
                                return (
                                    <g key={`y-${pct}`}>
                                        <line x1={PADDING} y1={yLine} x2={W - PADDING} y2={yLine} stroke="#334155" strokeDasharray="4 4" />
                                        <text x={PADDING - 5} y={yLine + 4} fill="#64748b" fontSize="10" textAnchor="end">{Math.round(pct * maxY)}m</text>
                                    </g>
                                );
                            })}
                            
                            {/* Bars */}
                            {renderBars()}

                            {/* X axis labels */}
                            {labels.map((col, i) => col.label ? (
                                <text key={`x-${i}`} x={PADDING + i * colWidth + gap / 2 + barW / 2} y={H - 2} fill="#64748b" fontSize="10" textAnchor="middle">
                                    {col.label}
                                </text>
                            ) : null)}
                        </svg>

                        {tooltip && (
                            <div style={{ position: 'fixed', left: tooltip.x, top: tooltip.y, transform: 'translate(-50%, -100%)', background: '#1e293b', padding: '6px 10px', borderRadius: '4px', fontSize: '12px', color: 'white', pointerEvents: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', zIndex: 9999 }}>
                                {tooltip.content}
                            </div>
                        )}

                        {/* Chart Legend */}
                        <div className="st-chart-legend" style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginTop: '1.5rem', fontSize: '0.85rem' }}>
                            {top5Names.map(name => {
                                const sumData = chartSummary.find(s => s.name === name);
                                if (!sumData) return null;
                                const h = Math.floor(sumData.total_seconds / 3600);
                                const m = Math.floor((sumData.total_seconds % 3600) / 60);
                                return (
                                    <div key={name} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                        <div style={{ width: '12px', height: '12px', borderRadius: '3px', backgroundColor: getChartAppColor(name) }}></div>
                                        <span style={{ color: '#e2e8f0', fontWeight: 'bold' }}>{name}</span>
                                        <span style={{ color: '#94a3b8' }}>{h}h {m}m ({sumData.percentage}%)</span>
                                    </div>
                                );
                            })}
                            
                            {chartSummary.filter(s => !top5Names.includes(s.name)).length > 0 && (() => {
                                const otherSum = chartSummary.filter(s => !top5Names.includes(s.name)).reduce((acc, s) => acc + s.total_seconds, 0);
                                const otherPct = chartSummary.filter(s => !top5Names.includes(s.name)).reduce((acc, s) => acc + s.percentage, 0);
                                const h = Math.floor(otherSum / 3600);
                                const m = Math.floor((otherSum % 3600) / 60);
                                return (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                        <div style={{ width: '12px', height: '12px', borderRadius: '3px', backgroundColor: '#888888' }}></div>
                                        <span style={{ color: '#e2e8f0', fontWeight: 'bold' }}>Other</span>
                                        <span style={{ color: '#94a3b8' }}>{h}h {m}m ({otherPct}%)</span>
                                    </div>
                                );
                            })()}
                        </div>
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
