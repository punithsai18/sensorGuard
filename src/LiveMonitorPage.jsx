import { useState, useEffect, useCallback, useMemo } from 'react'
import { useDetectedBrowsers, ALL_BROWSERS_META } from './browserDetection.js'
import {
  SENSOR_RISK_WEIGHTS,
  RISK_THRESHOLDS,
  getRiskRating,
  computeOverallRisk,
  getRiskAlertMessage,
} from './riskMatrix.js'

// ── Constants ──────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL = 3 // seconds between auto-scans

const PERM_TABS = ['camera', 'microphone', 'geolocation', 'notifications']
const PERM_ICON = {
  camera: '📷', microphone: '🎤', geolocation: '📍', notifications: '🔔',
  'clipboard-read': '📋', 'clipboard-write': '📋',
}

const STATUS_COLOR = { allowed: '#ffffff', blocked: '#4b5563', ask: '#9ca3af' }
const STATUS_ICON = { allowed: '✅', blocked: '🚫', ask: '❓' }

const SND_DEV_PREFIX = '/dev/snd/'

const KNOWN_APPS = {
  "Teams.exe": { name: "Microsoft Teams", icon: "Teams" },
  "Zoom.exe": { name: "Zoom", icon: "Zoom" },
  "obs64.exe": { name: "OBS Studio", icon: "OBS" },
  "discord.exe": { name: "Discord", icon: "Discord" },
  "skype.exe": { name: "Skype", icon: "Skype" },
  "chrome.exe": { name: "Google Chrome", icon: "Chrome", isBrowser: true },
  "msedge.exe": { name: "Microsoft Edge", icon: "Edge", isBrowser: true },
  "brave.exe": { name: "Brave Browser", icon: "Brave", isBrowser: true },
  "firefox.exe": { name: "Firefox", icon: "Firefox", isBrowser: true },
  "opera.exe": { name: "Opera", icon: "Opera", isBrowser: true },
  "Safari": { name: "Safari", icon: "Safari", isBrowser: true }
}

// ── Data fetching ──────────────────────────────────────────────────────────────

async function fetchScan() {
  const res = await fetch('/api/scan/all')
  if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`)
  return res.json()
}

function useAdvancedSensors() {
  const [sensors, setSensors] = useState(null);
  const [riskAssessments, setRiskAssessments] = useState({});
  useEffect(() => {
    let ws;
    let reconnectTimeout;
    function connect() {
      ws = new WebSocket('ws://127.0.0.1:8996');
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.event === 'sensors_update') {
            setSensors(data.sensors);
            if (data.risk_assessments) {
              setRiskAssessments(prev => ({ ...prev, ...data.risk_assessments }));
            }
          }
          // Handle standalone risk_assessment events
          if (data.event === 'risk_assessment') {
            setRiskAssessments(prev => ({
              ...prev,
              [data.sensor]: {
                risk_level: data.risk_level,
                risk_score: data.risk_score,
                likelihood: data.likelihood,
                impact: data.impact,
                confidence: data.confidence,
                reasoning: data.reasoning,
                mitre_technique: data.mitre_technique,
                recommended_action: data.recommended_action,
                is_false_positive: data.is_false_positive,
                is_fallback: data.is_fallback,
                process: data.process,
                timestamp: data.timestamp,
              }
            }));
          }
        } catch (e) { }
      };
      ws.onclose = () => { reconnectTimeout = setTimeout(connect, 2000); };
    }
    connect();
    return () => { clearTimeout(reconnectTimeout); if (ws) { ws.onclose = null; ws.close(); } };
  }, []);
  return { sensors, riskAssessments };
}

function useBackgroundWindowTitles() {
  const [apps, setApps] = useState([]);
  useEffect(() => {
    let ws;
    let reconnectTimeout;
    function connect() {
      ws = new WebSocket('ws://127.0.0.1:8997');
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.event === 'background_apps') setApps(data.apps);
        } catch (e) { }
      };
      ws.onclose = () => { reconnectTimeout = setTimeout(connect, 2000); };
    }
    connect();
    return () => { clearTimeout(reconnectTimeout); if (ws) { ws.onclose = null; ws.close(); } };
  }, []);
  return apps;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getProcessDetails(procExe, bgApps, browserData) {
  const exeName = procExe.toLowerCase();

  // Try to match from known apps
  const matchedKey = Object.keys(KNOWN_APPS).find(k => k.toLowerCase() === exeName);
  const known = matchedKey ? KNOWN_APPS[matchedKey] : null;

  let displayName = known ? known.name : procExe;
  let activeTitle = "";
  let activeDomain = "";
  let duration = "Unknown";

  // Try to attach window title via background_apps
  // This is generic window title parsing fallback (Option 2)
  const windowApp = bgApps.find(a =>
    a.app.toLowerCase().includes(exeName.replace('.exe', '')) ||
    (known && a.app.toLowerCase().includes(known.name.toLowerCase()))
  );

  if (windowApp && windowApp.title) {
    activeTitle = windowApp.title;
    if (known && known.isBrowser) {
      // Extract domain from title (e.g., "Meet - abc - Google Chrome" -> "Meet - abc")
      const parts = activeTitle.split(' - ');
      if (parts.length > 1) {
        // Find the index of the browser name and take everything before it
        const browserIdx = parts.findIndex(p => p.toLowerCase() === known.name.toLowerCase() || p.toLowerCase().includes(known.name.toLowerCase()));

        let possibleDomain = '';
        if (browserIdx > 0) {
          possibleDomain = parts.slice(0, browserIdx).join(' - ');
        } else {
          possibleDomain = parts[0];
        }

        // Remove notification counts like "(1) " or "(99+) "
        possibleDomain = possibleDomain.replace(/^\(\d+\+?\)\s*/, '');
        activeDomain = possibleDomain;
      }
    }
  }

  // Fallback 3: Cross reference allowed sites if it's a browser and no domain extracted yet
  let allowedSites = [];
  if (known && known.isBrowser) {
    const browserKey = Object.keys(browserData).find(k => known.name.toLowerCase().includes(k.toLowerCase()));
    if (browserKey && browserData[browserKey]) {
      for (const type of ['camera', 'microphone']) {
        for (const entry of browserData[browserKey][type] || []) {
          if (entry.status === 'allowed' && entry.site) {
            allowedSites.push(entry.site);
          }
        }
      }
    }
    allowedSites = [...new Set(allowedSites)];
    if (!activeDomain && allowedSites.length > 0) {
      activeDomain = "Likely: " + allowedSites[0];
      activeTitle = "Unknown Tab";
    }
  }

  return {
    displayName,
    exe: procExe,
    isBrowser: known?.isBrowser || false,
    activeDomain,
    activeTitle,
    allowedSites
  };
}

// ── Components ────────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const color = STATUS_COLOR[status] ?? '#64748b'
  const icon = STATUS_ICON[status] ?? '—'
  return (
    <span className="lm-badge" style={{ color, borderColor: color }}>
      {icon} {status}
    </span>
  )
}

function MultiSensorAttackAlert({ cameraActive, micActive, sensors }) {
  const isAttack = useMemo(() => {
    if (!cameraActive && !micActive) return false;
    if (!sensors) return false;
    const clipAccess = sensors.clipboard?.status === 'ACCESSED';
    const hookDetect = sensors.keyboard?.status === 'DETECTED';
    return clipAccess || hookDetect;
  }, [cameraActive, micActive, sensors]);

  if (!isAttack) return null;

  return (
    <div className="lm-alert" style={{ background: '#111111', borderColor: '#ffffff', color: '#ffffff', marginBottom: '1rem' }}>
      <span className="lm-alert-icon">🚨</span>
      <div>
        <strong style={{ fontSize: '1.2rem', color: '#ffffff' }}>MULTI-SENSOR ATTACK ALERT</strong>
        <p style={{ marginTop: '0.25rem', opacity: 0.9 }}>
          Camera/Microphone is actively running while an unknown process simultaneously accessed the Clipboard or installed a Global Keyboard Hook.
        </p>
      </div>
    </div>
  );
}

function SensorStatusPanel({ camera, microphone, browserData, bgApps, advancedSensors, risk, aiRisk }) {
  const [killingProc, setKillingProc] = useState(null);

  const camActive = camera?.active ?? false
  const micActive = microphone?.active ?? false

  const camProcs = (camera?.processes ?? []).map(p => p.process).filter(Boolean);
  const micProcs = (microphone?.processes ?? []).map(p => p.process).filter(Boolean);

  const handleKill = async (pid, name) => {
    if (!pid || !window.confirm(`Are you sure you want to force-quit ${name} (PID: ${pid})?`)) return;
    setKillingProc(pid);
    try {
      const res = await fetch('/api/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pid })
      });
      if (!res.ok) {
        const err = await res.json();
        alert(`Failed to kill process: ${err.error}`);
      }
    } catch (e) {
      alert(`Error: ${e.message}`);
    } finally {
      setTimeout(() => setKillingProc(null), 1000);
    }
  };

  const renderCamMicDetail = (procs) => {
    if (procs.length === 0) return { process: '—', info: '', pid: null };
    const det = getProcessDetails(procs[0], bgApps, browserData);

    // Find the actual PID from background apps if it exists
    let pid = null;
    const bgMatch = bgApps.find(a =>
      a.app.toLowerCase().includes(procs[0].toLowerCase().replace('.exe', ''))
    );
    if (bgMatch) pid = bgMatch.pid;

    if (det.isBrowser) {
      return {
        process: `${det.displayName} → ${det.activeDomain || 'Unknown'}`,
        info: det.activeTitle ? `Tab: "${det.activeTitle}"` : '',
        pid,
        displayName: det.displayName
      };
    } else {
      return {
        process: `${det.displayName} (${det.exe})`,
        info: det.activeTitle ? `Window: "${det.activeTitle}"` : '',
        pid,
        displayName: det.displayName
      };
    }
  };

  const camDet = renderCamMicDetail(camProcs);
  const micDet = renderCamMicDetail(micProcs);

  const sClip = advancedSensors?.clipboard || { status: 'IDLE', info: '—' };
  const sLoc = advancedSensors?.location || { status: 'IDLE', info: '—' };
  const sScreen = advancedSensors?.screen_capture || { status: 'IDLE', info: '—' };
  const sKey = advancedSensors?.keyboard || { status: 'IDLE', info: '—' };
  const sNet = advancedSensors?.network || { status: 'IDLE', info: '—' };
  const sUsb = advancedSensors?.usb || { status: 'IDLE', info: '—' };

  return (
    <section className="info-panel lm-panel" style={{ marginBottom: '1rem' }}>
      <h2 className="panel-title" style={{ borderBottom: '1px solid #333333' }}><span>🛡️</span> SENSOR STATUS PANEL</h2>
      <div className="ds-table-wrap" style={{ marginTop: '0' }}>
        <table className="ds-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', background: '#111111', borderBottom: '2px solid #333333' }}>
              <th style={{ padding: '0.75rem' }}>SENSOR</th>
              <th style={{ padding: '0.75rem' }}>STATUS</th>
              <th style={{ padding: '0.75rem' }}>PROCESS DETAIL</th>
              <th style={{ padding: '0.75rem' }}>RISK</th>
            </tr>
          </thead>
          <tbody>
            {/* Camera */}
            <tr style={{ borderBottom: '1px solid #333333', background: camActive ? 'rgba(255, 255, 255, 0.05)' : '' }}>
              <td style={{ padding: '0.75rem' }}>📷 Camera</td>
              <td style={{ padding: '0.75rem' }}>
                <span style={{ color: camActive ? '#ffffff' : '#64748b', fontWeight: 'bold' }}>
                  {camActive ? '● ACTIVE' : '○ IDLE'}
                </span>
              </td>
              <td style={{ padding: '0.75rem' }}>
                <div>{camActive ? camDet.process : '—'}</div>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{camActive ? camDet.info : ''}</div>
              </td>
            <td style={{ padding: '0.75rem' }}>
                {(() => {
                  const ai = aiRisk?.camera;
                  if (camActive && ai) {
                    const color = ai.risk_level === 'CRITICAL' ? '#dc2626' : ai.risk_level === 'HIGH' ? '#ef4444' : ai.risk_level === 'MEDIUM' ? '#f59e0b' : '#4ade80';
                    return (
                      <>
                        <span style={{ color, fontWeight: 'bold' }}>{ai.risk_level}</span>
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.78rem', color: '#64748b' }}>(score: {ai.risk_score})</span>
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.65rem', padding: '0.1rem 0.4rem', background: 'rgba(139, 92, 246, 0.15)', color: '#a78bfa', borderRadius: '4px', border: '1px solid rgba(139, 92, 246, 0.3)' }}>AI Agent</span>
                        {ai.reasoning && <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.25rem' }}>{ai.reasoning}</div>}
                        {ai.mitre_technique && <div style={{ fontSize: '0.65rem', color: '#64748b', marginTop: '0.15rem' }}>{ai.mitre_technique}</div>}
                      </>
                    );
                  }
                  return (
                    <>
                      <span style={{ color: camActive ? '#4ade80' : '#64748b' }}>{camActive ? 'NORMAL' : '—'}</span>
                      {camActive && <span style={{ marginLeft: '0.5rem', fontSize: '0.78rem', color: '#64748b' }}>(score: {risk.scores.camera})</span>}
                    </>
                  );
                })()}
                {camActive && camDet.pid && (
                  <button
                    disabled={killingProc === camDet.pid}
                    onClick={() => handleKill(camDet.pid, camDet.displayName)}
                    style={{ marginLeft: '1rem', background: 'rgba(239, 68, 68, 0.2)', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.4)', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', cursor: 'pointer' }}>
                    {killingProc === camDet.pid ? 'Killing...' : '🛑 KILL'}
                  </button>
                )}
              </td>
            </tr>

            {/* Microphone */}
            <tr style={{ borderBottom: '1px solid #333333', background: micActive ? 'rgba(255, 255, 255, 0.05)' : '' }}>
              <td style={{ padding: '0.75rem' }}>🎙 Microphone</td>
              <td style={{ padding: '0.75rem' }}>
                <span style={{ color: micActive ? '#e2e8f0' : '#64748b', fontWeight: 'bold' }}>
                  {micActive ? '● ACTIVE' : '○ IDLE'}
                </span>
              </td>
              <td style={{ padding: '0.75rem' }}>
                <div>{micActive ? micDet.process : '—'}</div>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{micActive ? micDet.info : ''}</div>
              </td>
              <td style={{ padding: '0.75rem' }}>
                {(() => {
                  const ai = aiRisk?.microphone;
                  if (micActive && ai) {
                    const color = ai.risk_level === 'CRITICAL' ? '#dc2626' : ai.risk_level === 'HIGH' ? '#ef4444' : ai.risk_level === 'MEDIUM' ? '#f59e0b' : '#4ade80';
                    return (
                      <>
                        <span style={{ color, fontWeight: 'bold' }}>{ai.risk_level}</span>
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.78rem', color: '#64748b' }}>(score: {ai.risk_score})</span>
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.65rem', padding: '0.1rem 0.4rem', background: 'rgba(139, 92, 246, 0.15)', color: '#a78bfa', borderRadius: '4px', border: '1px solid rgba(139, 92, 246, 0.3)' }}>AI Agent</span>
                        {ai.reasoning && <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.25rem' }}>{ai.reasoning}</div>}
                        {ai.mitre_technique && <div style={{ fontSize: '0.65rem', color: '#64748b', marginTop: '0.15rem' }}>{ai.mitre_technique}</div>}
                      </>
                    );
                  }
                  return (
                    <>
                      <span style={{ color: micActive ? '#4ade80' : '#64748b' }}>{micActive ? 'NORMAL' : '—'}</span>
                      {micActive && <span style={{ marginLeft: '0.5rem', fontSize: '0.78rem', color: '#64748b' }}>(score: {risk.scores.microphone})</span>}
                    </>
                  );
                })()}
                {micActive && micDet.pid && (
                  <button
                    disabled={killingProc === micDet.pid}
                    onClick={() => handleKill(micDet.pid, micDet.displayName)}
                    style={{ marginLeft: '1rem', background: 'rgba(239, 68, 68, 0.2)', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.4)', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', cursor: 'pointer' }}>
                    {killingProc === micDet.pid ? 'Killing...' : '🛑 KILL'}
                  </button>
                )}
              </td>
            </tr>

            {/* Location */}
            <tr style={{ borderBottom: '1px solid #334155' }}>
              <td style={{ padding: '0.75rem' }}>📍 Location</td>
              <td style={{ padding: '0.75rem' }}>
                <span style={{ color: sLoc.status === 'ACTIVE' ? '#60a5fa' : '#64748b', fontWeight: 'bold' }}>
                  {sLoc.status === 'ACTIVE' ? '● ACTIVE' : '○ IDLE'}
                </span>
              </td>
              <td style={{ padding: '0.75rem', color: '#94a3b8' }}>{sLoc.info}</td>
              <td style={{ padding: '0.75rem' }}>
                {(() => {
                  const ai = aiRisk?.location;
                  const isActive = sLoc.status === 'ACTIVE';
                  if (isActive && ai) {
                    const color = ai.risk_level === 'CRITICAL' ? '#dc2626' : ai.risk_level === 'HIGH' ? '#ef4444' : ai.risk_level === 'MEDIUM' ? '#f59e0b' : '#4ade80';
                    return (
                      <>
                        <span style={{ color, fontWeight: 'bold' }}>{ai.risk_level}</span>
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.78rem', color: '#64748b' }}>(score: {ai.risk_score})</span>
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.65rem', padding: '0.1rem 0.4rem', background: 'rgba(139, 92, 246, 0.15)', color: '#a78bfa', borderRadius: '4px', border: '1px solid rgba(139, 92, 246, 0.3)' }}>AI Agent</span>
                      </>
                    );
                  }
                  return (
                    <>
                      <span style={{ color: isActive ? '#60a5fa' : '#64748b' }}>{isActive ? 'LOW' : '—'}</span>
                      {isActive && <span style={{ marginLeft: '0.5rem', fontSize: '0.78rem', color: '#64748b' }}>(score: {risk.scores.location})</span>}
                    </>
                  );
                })()}
              </td>
            </tr>

            {/* Clipboard */}
            <tr style={{ borderBottom: '1px solid #333333', background: sClip.status !== 'IDLE' ? 'rgba(255, 255, 255, 0.05)' : '' }}>
              <td style={{ padding: '0.75rem' }}>📋 Clipboard</td>
              <td style={{ padding: '0.75rem' }}>
                <span style={{ color: sClip.status !== 'IDLE' ? '#ffffff' : '#64748b', fontWeight: 'bold' }}>
                  {sClip.status !== 'IDLE' ? '⚠ ACCESSED' : '○ IDLE'}
                </span>
              </td>
              <td style={{ padding: '0.75rem', color: '#94a3b8' }}>{sClip.info}</td>
              <td style={{ padding: '0.75rem' }}>
                {(() => {
                  const ai = aiRisk?.clipboard;
                  const isActive = sClip.status !== 'IDLE';
                  if (isActive && ai) {
                    const color = ai.risk_level === 'CRITICAL' ? '#dc2626' : ai.risk_level === 'HIGH' ? '#ef4444' : ai.risk_level === 'MEDIUM' ? '#f59e0b' : '#4ade80';
                    return (
                      <>
                        <span style={{ color, fontWeight: 'bold' }}>{ai.risk_level}</span>
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.78rem', color: '#64748b' }}>(score: {ai.risk_score})</span>
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.65rem', padding: '0.1rem 0.4rem', background: 'rgba(139, 92, 246, 0.15)', color: '#a78bfa', borderRadius: '4px', border: '1px solid rgba(139, 92, 246, 0.3)' }}>AI Agent</span>
                        {ai.reasoning && <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.25rem' }}>{ai.reasoning}</div>}
                      </>
                    );
                  }
                  return (
                    <>
                      <span style={{ color: isActive ? '#ffffff' : '#64748b' }}>{isActive ? 'HIGH' : '—'}</span>
                      {isActive && <span style={{ marginLeft: '0.5rem', fontSize: '0.78rem', color: '#64748b' }}>(score: {risk.scores.clipboard})</span>}
                    </>
                  );
                })()}
              </td>
            </tr>

            {/* Screen Capture */}
            <tr style={{ borderBottom: '1px solid #333333' }}>
              <td style={{ padding: '0.75rem' }}>🖥 Screen Cap</td>
              <td style={{ padding: '0.75rem' }}>
                <span style={{ color: sScreen.status !== 'IDLE' ? '#ffffff' : '#64748b', fontWeight: 'bold' }}>
                  {sScreen.status !== 'IDLE' ? '● ACTIVE' : '○ IDLE'}
                </span>
              </td>
              <td style={{ padding: '0.75rem', color: '#94a3b8' }}>{sScreen.info}</td>
              <td style={{ padding: '0.75rem' }}>
                {(() => {
                  const ai = aiRisk?.screen_capture;
                  const isActive = sScreen.status !== 'IDLE';
                  if (isActive && ai) {
                    const color = ai.risk_level === 'CRITICAL' ? '#dc2626' : ai.risk_level === 'HIGH' ? '#ef4444' : ai.risk_level === 'MEDIUM' ? '#f59e0b' : '#4ade80';
                    return (
                      <>
                        <span style={{ color, fontWeight: 'bold' }}>{ai.risk_level}</span>
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.78rem', color: '#64748b' }}>(score: {ai.risk_score})</span>
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.65rem', padding: '0.1rem 0.4rem', background: 'rgba(139, 92, 246, 0.15)', color: '#a78bfa', borderRadius: '4px', border: '1px solid rgba(139, 92, 246, 0.3)' }}>AI Agent</span>
                      </>
                    );
                  }
                  return (
                    <>
                      <span style={{ color: isActive ? '#ffffff' : '#64748b' }}>{isActive ? 'HIGH' : '—'}</span>
                      {isActive && <span style={{ marginLeft: '0.5rem', fontSize: '0.78rem', color: '#64748b' }}>(score: {risk.scores.screen_capture})</span>}
                    </>
                  );
                })()}
              </td>
            </tr>

            {/* Keyboard Hook */}
            <tr style={{ borderBottom: '1px solid #333333', background: sKey.status !== 'IDLE' ? 'rgba(255, 255, 255, 0.1)' : '' }}>
              <td style={{ padding: '0.75rem' }}>⌨ Keyboard Hook</td>
              <td style={{ padding: '0.75rem' }}>
                <span style={{ color: sKey.status !== 'IDLE' ? '#ffffff' : '#64748b', fontWeight: 'bold' }}>
                  {sKey.status !== 'IDLE' ? '🚨 DETECTED' : '○ IDLE'}
                </span>
              </td>
              <td style={{ padding: '0.75rem', color: '#94a3b8' }}>{sKey.info}</td>
              <td style={{ padding: '0.75rem' }}>
                {(() => {
                  const ai = aiRisk?.keyboard;
                  const isActive = sKey.status !== 'IDLE';
                  if (isActive && ai) {
                    const color = ai.risk_level === 'CRITICAL' ? '#dc2626' : ai.risk_level === 'HIGH' ? '#ef4444' : ai.risk_level === 'MEDIUM' ? '#f59e0b' : '#4ade80';
                    return (
                      <>
                        <span style={{ color, fontWeight: 'bold' }}>{ai.risk_level}</span>
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.78rem', color: '#64748b' }}>(score: {ai.risk_score})</span>
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.65rem', padding: '0.1rem 0.4rem', background: 'rgba(139, 92, 246, 0.15)', color: '#a78bfa', borderRadius: '4px', border: '1px solid rgba(139, 92, 246, 0.3)' }}>AI Agent</span>
                        {ai.reasoning && <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.25rem' }}>{ai.reasoning}</div>}
                      </>
                    );
                  }
                  return (
                    <>
                      <span style={{ color: isActive ? '#ffffff' : '#64748b', fontWeight: 'bold' }}>{isActive ? 'CRITICAL' : '—'}</span>
                      {isActive && <span style={{ marginLeft: '0.5rem', fontSize: '0.78rem', color: '#64748b' }}>(score: {risk.scores.keyboard})</span>}
                    </>
                  );
                })()}
              </td>
            </tr>

            <tr style={{ borderBottom: '1px solid #333333' }}>
              <td style={{ padding: '0.75rem' }}>🌐 Network</td>
              <td style={{ padding: '0.75rem' }}>
                <span style={{ color: sNet.status !== 'IDLE' ? '#ffffff' : '#64748b', fontWeight: 'bold' }}>
                  {sNet.status !== 'IDLE' ? '● ACTIVE' : '○ IDLE'}
                </span>
              </td>
              <td style={{ padding: '0.75rem', color: '#94a3b8' }}>{sNet.info}</td>
              <td style={{ padding: '0.75rem' }}>
                {(() => {
                  const ai = aiRisk?.network;
                  const isActive = sNet.status !== 'IDLE';
                  if (isActive && ai) {
                    const color = ai.risk_level === 'CRITICAL' ? '#dc2626' : ai.risk_level === 'HIGH' ? '#ef4444' : ai.risk_level === 'MEDIUM' ? '#f59e0b' : '#4ade80';
                    return (
                      <>
                        <span style={{ color, fontWeight: 'bold' }}>{ai.risk_level}</span>
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.78rem', color: '#64748b' }}>(score: {ai.risk_score})</span>
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.65rem', padding: '0.1rem 0.4rem', background: 'rgba(139, 92, 246, 0.15)', color: '#a78bfa', borderRadius: '4px', border: '1px solid rgba(139, 92, 246, 0.3)' }}>AI Agent</span>
                      </>
                    );
                  }
                  return (
                    <>
                      <span style={{ color: isActive ? '#ffffff' : '#64748b' }}>{isActive ? 'NORMAL' : '—'}</span>
                      {isActive && <span style={{ marginLeft: '0.5rem', fontSize: '0.78rem', color: '#64748b' }}>(score: {risk.scores.network})</span>}
                    </>
                  );
                })()}
              </td>
            </tr>

            {/* USB */}
            <tr style={{ borderBottom: 'none' }}>
              <td style={{ padding: '0.75rem' }}>🔌 USB</td>
              <td style={{ padding: '0.75rem' }}>
                <span style={{ color: sUsb.status !== 'IDLE' ? '#ffffff' : '#64748b', fontWeight: 'bold' }}>
                  {sUsb.status !== 'IDLE' ? '● ACTIVE' : '○ IDLE'}
                </span>
              </td>
              <td style={{ padding: '0.75rem', color: '#94a3b8' }}>{sUsb.info}</td>
              <td style={{ padding: '0.75rem' }}>
                {(() => {
                  const ai = aiRisk?.usb;
                  const isActive = sUsb.status !== 'IDLE';
                  if (isActive && ai) {
                    const color = ai.risk_level === 'CRITICAL' ? '#dc2626' : ai.risk_level === 'HIGH' ? '#ef4444' : ai.risk_level === 'MEDIUM' ? '#f59e0b' : '#4ade80';
                    return (
                      <>
                        <span style={{ color, fontWeight: 'bold' }}>{ai.risk_level}</span>
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.78rem', color: '#64748b' }}>(score: {ai.risk_score})</span>
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.65rem', padding: '0.1rem 0.4rem', background: 'rgba(139, 92, 246, 0.15)', color: '#a78bfa', borderRadius: '4px', border: '1px solid rgba(139, 92, 246, 0.3)' }}>AI Agent</span>
                      </>
                    );
                  }
                  return (
                    <>
                      <span style={{ color: isActive ? '#ffffff' : '#64748b' }}>{isActive ? 'LOW' : '—'}</span>
                      {isActive && <span style={{ marginLeft: '0.5rem', fontSize: '0.78rem', color: '#64748b' }}>(score: {risk.scores.usb})</span>}
                    </>
                  );
                })()}
              </td>
            </tr>

          </tbody>
        </table>
      </div>
    </section>
  )
}

// ── Risk Score Components ─────────────────────────────────────────────────────

function RiskBadge({ rating }) {
  const meta = RISK_THRESHOLDS[rating] ?? RISK_THRESHOLDS.LOW
  return (
    <span
      className="lm-risk-badge"
      style={{ background: meta.bg, color: meta.color, border: `1px solid ${meta.color}` }}
    >
      {meta.icon} {meta.label}
    </span>
  )
}

function RiskRatingAlert({ risk }) {
  const msg = getRiskAlertMessage(risk.rating, risk.activeHighRiskSensors)
  if (!msg) return null
  const cls = `lm-risk-alert lm-risk-alert-${risk.rating.toLowerCase()}`
  const icon = risk.rating === 'HIGH' ? '🔴' : '🟡'
  return (
    <div className={cls}>
      <span className="lm-alert-icon">{icon}</span>
      <div>
        <strong>{msg.title}</strong>
        <p style={{ marginTop: '0.25rem', opacity: 0.9 }}>{msg.detail}</p>
      </div>
    </div>
  )
}

function RiskScorePanel({ risk, aiRisk }) {
  const { scores, isActive, maxScore, totalScore, rating, activeHighRiskSensors } = risk
  const ratingMeta = RISK_THRESHOLDS[rating] ?? RISK_THRESHOLDS.LOW

  // Compute effective AI max score
  const aiEntries = Object.entries(aiRisk || {});
  const aiMaxScore = aiEntries.length > 0
    ? Math.max(...aiEntries.map(([, a]) => a.risk_score || 0))
    : null;
  const aiMaxRating = aiMaxScore ? getRiskRating(aiMaxScore) : null;
  const aiMaxMeta = aiMaxRating ? (RISK_THRESHOLDS[aiMaxRating] ?? RISK_THRESHOLDS.LOW) : null;

  return (
    <section className="info-panel lm-panel" style={{ marginBottom: '1rem' }}>
      <h2 className="panel-title" style={{ borderBottom: '1px solid #333333' }}>
        <span>📊</span> RISK SCORE MATRIX
        {aiEntries.length > 0 && (
          <span style={{ marginLeft: '0.75rem', fontSize: '0.65rem', padding: '0.15rem 0.5rem', background: 'rgba(139, 92, 246, 0.15)', color: '#a78bfa', borderRadius: '4px', border: '1px solid rgba(139, 92, 246, 0.3)', verticalAlign: 'middle' }}>AI-POWERED</span>
        )}
      </h2>

      <div className="ds-table-wrap" style={{ marginTop: '0' }}>
        <table className="ds-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', background: '#111111', borderBottom: '2px solid #333333' }}>
              <th style={{ padding: '0.75rem' }}>SENSOR</th>
              <th style={{ padding: '0.75rem', textAlign: 'center' }}>LIKELIHOOD (1–5)</th>
              <th style={{ padding: '0.75rem', textAlign: 'center' }}>IMPACT (1–5)</th>
              <th style={{ padding: '0.75rem', textAlign: 'center' }}>SCORE (/25)</th>
              <th style={{ padding: '0.75rem' }}>RATING</th>
              <th style={{ padding: '0.75rem', color: '#64748b', fontWeight: 400, fontSize: '0.75rem' }}>DESCRIPTION</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(SENSOR_RISK_WEIGHTS).map(([key, meta]) => {
              const active  = isActive[key]
              const ai      = aiRisk?.[key]
              // Use AI scores when available
              const score   = (active && ai?.risk_score) ? ai.risk_score : scores[key]
              const lk      = (active && ai?.likelihood) ? ai.likelihood : (active ? meta.likelihood : 1)
              const imp     = (active && ai?.impact) ? ai.impact : (active ? meta.impact : 1)
              const r       = (active && ai?.risk_level) ? ai.risk_level : getRiskRating(score)
              const rMeta   = RISK_THRESHOLDS[r] ?? RISK_THRESHOLDS.LOW
              const barPct  = Math.round((score / 25) * 100)
              const desc    = (active && ai?.reasoning) ? ai.reasoning : meta.description
              return (
                <tr
                  key={key}
                  style={{
                    borderBottom: '1px solid #1e293b',
                    background: active && r !== 'LOW' ? `${rMeta.bg}` : '',
                    opacity: active ? 1 : 0.55,
                  }}
                >
                  <td style={{ padding: '0.65rem 0.75rem', fontWeight: 500 }}>
                    {meta.icon} {meta.label}
                    {!active && <span style={{ marginLeft: '0.4rem', color: '#475569', fontSize: '0.72rem' }}>IDLE</span>}
                    {active && ai && <span style={{ marginLeft: '0.4rem', fontSize: '0.6rem', padding: '0.05rem 0.3rem', background: 'rgba(139, 92, 246, 0.12)', color: '#a78bfa', borderRadius: '3px' }}>AI</span>}
                  </td>
                  <td style={{ padding: '0.65rem 0.75rem', textAlign: 'center', color: '#94a3b8' }}>
                    {lk}
                  </td>
                  <td style={{ padding: '0.65rem 0.75rem', textAlign: 'center', color: '#94a3b8' }}>
                    {imp}
                  </td>
                  <td style={{ padding: '0.65rem 0.75rem', textAlign: 'center' }}>
                    <div className="lm-score-bar-wrap" style={{ justifyContent: 'center' }}>
                      <span style={{ fontWeight: 700, color: active ? rMeta.color : '#475569', minWidth: '1.5rem' }}>
                        {score}
                      </span>
                      <div className="lm-score-bar">
                        <div
                          className="lm-score-bar-fill"
                          style={{ width: `${barPct}%`, background: active ? rMeta.color : '#334155' }}
                        />
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '0.65rem 0.75rem' }}>
                    {active
                      ? <RiskBadge rating={r} />
                      : <span style={{ color: '#475569', fontSize: '0.78rem' }}>—</span>
                    }
                  </td>
                  <td style={{ padding: '0.65rem 0.75rem', fontSize: '0.75rem', color: '#64748b' }}>
                    {desc}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Overall risk summary bar */}
      <div className="lm-risk-overall">
        <div>
          <div className="lm-risk-score-big" style={{ color: (aiMaxMeta || ratingMeta).color }}>
            {aiMaxScore ?? maxScore}<span style={{ fontSize: '1rem', color: '#64748b' }}>/25</span>
          </div>
          <div className="lm-risk-score-label">{aiMaxScore != null ? 'AI Max Risk Score' : 'Max Risk Score'}</div>
        </div>
        <div>
          <div style={{ marginBottom: '0.3rem' }}>Overall Rating: <RiskBadge rating={aiMaxRating || rating} /></div>
          <div className="lm-risk-score-label">Active sensor total: {totalScore} pts</div>
        </div>
        <div className="lm-risk-summary">
          <p>
            {activeHighRiskSensors.length > 0
              ? `High/medium-risk sensors active: ${activeHighRiskSensors.join(', ')}.`
              : 'No elevated-risk sensors currently active.'}
          </p>
        </div>
      </div>

      {/* AI Risk Assessments Detail */}
      {aiEntries.length > 0 && (
        <div style={{ borderTop: '1px solid #1e293b', padding: '1rem 0.75rem 0.5rem' }}>
          <h3 style={{ fontSize: '0.82rem', color: '#a78bfa', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.9rem' }}>🤖</span> AI Risk Assessments
            <span style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', background: 'rgba(139, 92, 246, 0.15)', color: '#a78bfa', borderRadius: '4px', border: '1px solid rgba(139, 92, 246, 0.3)' }}>Powered by NVIDIA Model</span>
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {aiEntries.map(([sensor, assessment]) => {
              const color = assessment.risk_level === 'CRITICAL' ? '#dc2626' : assessment.risk_level === 'HIGH' ? '#ef4444' : assessment.risk_level === 'MEDIUM' ? '#f59e0b' : '#4ade80';
              const sensorMeta = SENSOR_RISK_WEIGHTS[sensor];
              const timeDiff = assessment.timestamp ? Math.round((Date.now() - new Date(assessment.timestamp).getTime()) / 1000) : null;
              return (
                <div key={sensor} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid #1e293b', borderRadius: '8px', padding: '0.6rem 0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                    <span>{sensorMeta?.icon || '🔹'}</span>
                    <span style={{ fontWeight: 600, fontSize: '0.82rem' }}>{sensorMeta?.label || sensor}</span>
                    <span style={{ color, fontWeight: 'bold', fontSize: '0.78rem', marginLeft: 'auto' }}>{assessment.risk_level}</span>
                    <span style={{ fontSize: '0.72rem', color: '#64748b' }}>score: {assessment.risk_score}/25</span>
                  </div>
                  {assessment.process && (
                    <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginBottom: '0.2rem' }}>
                      Process: <span style={{ color: '#e2e8f0' }}>{assessment.process}</span>
                    </div>
                  )}
                  {assessment.reasoning && (
                    <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginBottom: '0.2rem' }}>
                      {assessment.reasoning}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.65rem', color: '#64748b', marginTop: '0.2rem' }}>
                    {assessment.mitre_technique && (
                      <span style={{ padding: '0.1rem 0.35rem', background: 'rgba(239, 68, 68, 0.1)', color: '#fca5a5', borderRadius: '3px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                        {assessment.mitre_technique}
                      </span>
                    )}
                    {assessment.confidence != null && (
                      <span>Confidence: {Math.round(assessment.confidence * 100)}%</span>
                    )}
                    {assessment.is_fallback && (
                      <span style={{ color: '#f59e0b' }}>⚠ Fallback (API unavailable)</span>
                    )}
                    {timeDiff != null && (
                      <span style={{ marginLeft: 'auto' }}>Assessed {timeDiff < 60 ? `${timeDiff}s` : `${Math.round(timeDiff / 60)}m`} ago</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  )
}

function ServerOffBanner({ error }) {
  return (
    <div className="lm-alert server-off-alert">
      <span className="lm-alert-icon">🔌</span>
      <div>
        <strong>Scanner server not reachable</strong>
        <p className="lm-alert-detail">
          The backend server must be running to read real browser data.
          Start it with: <code>npm run dev:server</code> (or <code>npm run dev:all</code>
          to run both Vite and the server together).
        </p>
        {error && <p className="lm-alert-err">Error: {error}</p>}
      </div>
    </div>
  )
}

function PermTable({ entries }) {
  if (!entries || entries.length === 0) {
    return <p className="lm-empty">No recorded permissions for this type.</p>
  }
  return (
    <div className="lm-table-wrap">
      <table className="lm-table">
        <thead>
          <tr>
            <th>Website</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={i}>
              <td className="lm-site">{e.site}</td>
              <td><StatusBadge status={e.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BrowserPanel({ browserData, detectedBrowsers }) {
  const [activeBrowser, setActiveBrowser] = useState(detectedBrowsers[0] || 'chrome')
  const [activePerm, setActivePerm] = useState('camera')

  useEffect(() => {
    if (detectedBrowsers.length > 0 && !detectedBrowsers.includes(activeBrowser)) {
      setActiveBrowser(detectedBrowsers[0]);
    }
  }, [detectedBrowsers, activeBrowser]);

  const bData = browserData[activeBrowser]
  const hasError = bData?.error

  return (
    <section className="info-panel lm-panel">
      <h2 className="panel-title"><span>🌐</span> Browser Permissions (Live)</h2>
      <div className="lm-tabs browser-tabs">
        {detectedBrowsers.map(b => {
          const meta = ALL_BROWSERS_META[b] || { icon: '🌐', label: b }
          return (
            <button
              key={b}
              className={`lm-tab${activeBrowser === b ? ' active' : ''}`}
              onClick={() => setActiveBrowser(b)}
            >
              {meta.icon} {meta.label}
            </button>
          )
        })}
      </div>
      <div className="lm-tabs perm-tabs">
        {PERM_TABS.map(p => {
          const count = (!hasError && bData?.[p]?.length) || 0
          return (
            <button
              key={p}
              className={`lm-tab perm-tab${activePerm === p ? ' active' : ''}`}
              onClick={() => setActivePerm(p)}
            >
              {PERM_ICON[p]} {p}
              {count > 0 && <span className="lm-count">{count}</span>}
            </button>
          )
        })}
      </div>
      <div className="lm-panel-body">
        {hasError ? (
          <div className="lm-browser-error">
            <span>📂</span>
            <div>
              <strong>Profile not found or inaccessible</strong>
              <p>{bData.error}</p>
              <p className="lm-hint">
                Make sure the browser is installed and has been opened at least once.
              </p>
            </div>
          </div>
        ) : (
          <PermTable entries={bData?.[activePerm]} />
        )}
      </div>
    </section>
  )
}

function OSAppsPanel({ os: osData }) {
  const [activePerm, setActivePerm] = useState('camera')

  const note = osData?.note
  const perms = ['camera', 'microphone', 'geolocation']
  const entries = osData?.[activePerm] ?? []
  const hasError = Array.isArray(entries) && entries[0]?.error

  return (
    <section className="info-panel lm-panel">
      <h2 className="panel-title"><span>🪟</span> Windows App Permissions (Registry)</h2>
      {note ? (
        <div className="lm-os-note">
          <span>ℹ️</span>
          <div>
            <strong>Not running on Windows</strong>
            <p>{note}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="lm-tabs perm-tabs">
            {perms.map(p => (
              <button
                key={p}
                className={`lm-tab perm-tab${activePerm === p ? ' active' : ''}`}
                onClick={() => setActivePerm(p)}
              >
                {PERM_ICON[p]} {p}
              </button>
            ))}
          </div>
          <div className="lm-panel-body">
            {hasError ? (
              <p className="lm-empty" style={{ color: '#f87171' }}>
                Registry read error: {entries[0].error}
              </p>
            ) : entries.length === 0 ? (
              <p className="lm-empty">No app permissions recorded.</p>
            ) : (
              <div className="lm-table-wrap">
                <table className="lm-table">
                  <thead>
                    <tr><th>Application</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {entries.map((e, i) => (
                      <tr key={i}>
                        <td className="lm-site">{e.app}</td>
                        <td><StatusBadge status={e.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}

function BackgroundAppsPanel({ processes: procData }) {
  const [search, setSearch] = useState('')

  const list = procData?.processes ?? []
  const note = procData?.note
  const error = procData?.error

  const query = search.trim().toLowerCase()
  const filtered = query
    ? list.filter(p => p.name.toLowerCase().includes(query))
    : list

  const hasCpu = list.some(p => p.cpu != null)
  const hasMem = list.some(p => p.mem != null)

  return (
    <section className="info-panel lm-panel">
      <h2 className="panel-title"><span>📋</span> Background Apps (Running Processes)</h2>
      {note && (
        <div className="lm-os-note">
          <span>ℹ️</span>
          <div><p>{note}</p></div>
        </div>
      )}
      {error && (
        <p className="lm-empty" style={{ color: '#f87171' }}>Error: {error}</p>
      )}
      {!note && !error && (
        <>
          <div style={{ padding: '0.5rem 0 0.75rem' }}>
            <input
              type="text"
              className="lm-search"
              placeholder="Filter by app name…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="lm-panel-body">
            {filtered.length === 0 ? (
              <p className="lm-empty">No running processes found.</p>
            ) : (
              <div className="lm-table-wrap">
                <table className="lm-table">
                  <thead>
                    <tr>
                      <th>App / Process</th>
                      <th>PID</th>
                      {hasCpu && <th>CPU</th>}
                      {hasMem && <th>Memory</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((p, i) => (
                      <tr key={p.pid != null ? `${p.pid}-${p.name}` : i}>
                        <td className="lm-site">🖥️ {p.name}</td>
                        <td style={{ color: '#64748b' }}>{p.pid ?? '—'}</td>
                        {hasCpu && <td>{p.cpu ?? '—'}</td>}
                        {hasMem && <td>{p.mem ?? '—'}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p className="lm-hint" style={{ marginTop: '0.5rem' }}>
            Showing {filtered.length} of {list.length} running processes
          </p>
        </>
      )}
    </section>
  )
}

function ScanFooter({ lastScan, countdown, loading, onRefresh, onExport }) {
  return (
    <div className="lm-footer">
      <div className="lm-footer-info">
        {lastScan && (
          <span>Last scan: <strong>{lastScan.toLocaleTimeString()}</strong></span>
        )}
        {!loading && (
          <span className="lm-countdown">Next scan in <strong>{countdown}s</strong></span>
        )}
        {loading && <span className="lm-scanning">⟳ Scanning…</span>}
      </div>
      <div style={{ display: 'flex', gap: '1rem' }}>
        <button
          className="lm-refresh-btn"
          onClick={onExport}
          disabled={loading}
          style={{ backgroundColor: 'rgba(59, 130, 246, 0.2)' }}
        >
          📥 Export Report
        </button>
        <button
          className={`lm-refresh-btn${loading ? ' loading' : ''}`}
          onClick={onRefresh}
          disabled={loading}
        >
          {loading ? '⟳ Scanning…' : '🔄 Scan Now'}
        </button>
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function LiveMonitorPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [lastScan, setLastScan] = useState(null)
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL)

  const { sensors: advancedSensors, riskAssessments: aiRisk } = useAdvancedSensors()
  const bgApps = useBackgroundWindowTitles()
  const detectedBrowsers = useDetectedBrowsers()

  const risk = useMemo(
    () => computeOverallRisk(data?.camera?.active, data?.microphone?.active, advancedSensors),
    [data, advancedSensors]
  )

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

  useEffect(() => {
    scan()
    const id = setInterval(scan, REFRESH_INTERVAL * 1000)
    return () => clearInterval(id)
  }, [scan])

  useEffect(() => {
    if (loading) return
    const id = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000)
    return () => clearInterval(id)
  }, [loading])

  const exportToCSV = useCallback(() => {
    if (!data) return;
    const rows = [];
    rows.push(["Topic", "Status/Count", "Detail", "Risk Score", "Risk Rating"]);

    // Overall risk
    rows.push(["Overall Risk", risk.rating, `Max score: ${risk.maxScore}/25  Active total: ${risk.totalScore}`, risk.maxScore, risk.rating]);

    // Per-sensor risk
    for (const [key, meta] of Object.entries(SENSOR_RISK_WEIGHTS)) {
      const active = risk.isActive[key];
      const score  = risk.scores[key];
      rows.push([meta.label, active ? "Active" : "Idle", meta.description, score, getRiskRating(score)]);
    }

    rows.push([]); // blank separator

    // Quick Sensors
    const cameraActive = data.camera?.active ?? false;
    const micActive    = data.microphone?.active ?? false;
    rows.push(["Camera", cameraActive ? "Active" : "Idle", "", risk.scores.camera, getRiskRating(risk.scores.camera)]);
    rows.push(["Microphone", micActive ? "Active" : "Idle", "", risk.scores.microphone, getRiskRating(risk.scores.microphone)]);

    // Background processes
    if (data.processes?.processes) {
      data.processes.processes.forEach(p => {
        rows.push(["Process", p.name, `PID: ${p.pid} CPU: ${p.cpu || ''}`, "", ""]);
      });
    }

    const csvContent = "data:text/csv;charset=utf-8," + rows.map(e => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `LiveSensorReport_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [data, risk]);

  const browserData = {};
  if (data) {
    for (const b of detectedBrowsers) {
      browserData[b] = data[b] || {};
    }
  }

  return (
    <div className="lm-page">
      <div className="notice-banner">
        <span className="notice-icon">🔴</span>
        <div>
          <strong>Live Permission Monitor:</strong> This tool reads your actual browser
          permission databases in real time — Chrome/Edge{' '}
          <code>Preferences</code> JSON and Firefox{' '}
          <code>permissions.sqlite</code>. On Windows it also reads the{' '}
          <code>CapabilityAccessManager</code> registry.
          Start the backend: <code>npm run dev:all</code>
        </div>
      </div>

      {error && !data && <ServerOffBanner error={error} />}

      {/* Risk Rating Alert Banner */}
      {data && <RiskRatingAlert risk={risk} />}

      {/* Multi-Sensor Attack Alert Banner */}
      {data && (
        <MultiSensorAttackAlert
          cameraActive={data?.camera?.active}
          micActive={data?.microphone?.active}
          sensors={advancedSensors}
        />
      )}

      {loading && !data && (
        <div className="lm-loading">
          <div className="lm-spinner" />
          <span>Scanning browser profiles and system permissions…</span>
        </div>
      )}

      {/* Primary Sensor Status Panel (Replacing DeviceStatusSummary) */}
      {data && (
        <SensorStatusPanel
          camera={data.camera}
          microphone={data.microphone}
          browserData={browserData}
          bgApps={bgApps}
          advancedSensors={advancedSensors}
          risk={risk}
          aiRisk={aiRisk}
        />
      )}

      {/* Risk Score Matrix Panel */}
      {data && <RiskScorePanel risk={risk} aiRisk={aiRisk} />}

      {/* Main content grid */}
      {data && (
        <div className="lm-grid">
          <BrowserPanel browserData={browserData} detectedBrowsers={detectedBrowsers} />
          <OSAppsPanel os={data.os} />
        </div>
      )}

      {(data || loading) && (
        <ScanFooter
          lastScan={lastScan}
          countdown={countdown}
          loading={loading}
          onRefresh={scan}
          onExport={exportToCSV}
        />
      )}
    </div>
  )
}
