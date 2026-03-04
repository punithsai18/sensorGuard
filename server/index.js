/**
 * SensorGuard – Scanner Backend
 *
 * Express server that reads real browser/OS permission data:
 *   GET /api/scan/all  – aggregate scan of all sources
 *   GET /api/health    – liveness probe
 *
 * Start: node server/index.js
 * Default port: 3001  (override via PORT env var)
 */
const express = require('express');
const cors    = require('cors');

const { scanChrome, scanEdge }  = require('./scanners/chrome');
const { scanFirefox }           = require('./scanners/firefox');
const { scanWindowsApps }       = require('./scanners/windows');
const { detectActiveCamera }    = require('./scanners/camera');
const { scanBrowserTabs }       = require('./scanners/tabs');
const { detectActiveMicrophone } = require('./scanners/microphone');
const { scanRunningProcesses }  = require('./scanners/processes');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ── Health check ──────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, platform: process.platform, pid: process.pid });
});

// ── Browser tabs ──────────────────────────────────────────────────────────────

app.get('/api/tabs', (_req, res) => {
  try {
    res.json({ timestamp: new Date().toISOString(), ...scanBrowserTabs() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Aggregate scan ────────────────────────────────────────────────────────────

app.get('/api/scan/all', async (_req, res) => {
  /** Run a synchronous scanner safely; return { error } on throw. */
  function safeRun(fn) {
    try { return fn(); }
    catch (e) { return { error: e.message }; }
  }

  // Chrome, Edge, Windows, Camera are synchronous.
  // Firefox uses the sqlite3 CLI which is also synchronous.
  const result = {
    timestamp : new Date().toISOString(),
    platform  : process.platform,
    chrome    : safeRun(scanChrome),
    edge      : safeRun(scanEdge),
    firefox   : safeRun(scanFirefox),
    os        : safeRun(scanWindowsApps),
    camera    : safeRun(detectActiveCamera),
    microphone: safeRun(detectActiveMicrophone),
    processes : safeRun(scanRunningProcesses),
  };

  res.json(result);
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[SensorGuard] Scanner backend running → http://localhost:${PORT}`);
  console.log(`[SensorGuard] Platform: ${process.platform}`);
  console.log(`[SensorGuard] Endpoints:`);
  console.log(`  GET /api/health`);
  console.log(`  GET /api/tabs`);
  console.log(`  GET /api/scan/all`);
});
