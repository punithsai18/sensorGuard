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
const cors = require('cors');
const { execSync } = require('child_process');

const { parsePrefs } = require('./scanners/chrome');
const { scanFirefox } = require('./scanners/firefox');
const { scanWindowsApps } = require('./scanners/windows');
const { detectActiveCamera } = require('./scanners/camera');
const { scanBrowserTabs } = require('./scanners/tabs');
const { detectActiveMicrophone } = require('./scanners/microphone');
const { scanRunningProcesses } = require('./scanners/processes');
const { getDetectedBrowsers } = require('./scanners/browserDetection');

const app = express();
const PORT = process.env.PORT || 3005;

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

// ── Screen Time ───────────────────────────────────────────────────────────────

app.get('/api/screentime', (req, res) => {
  try {
    const sqlite3 = require('sqlite3').verbose();
    const path = require('path');
    const dbPath = path.join(__dirname, '..', 'screen_time.db');

    // Note: Python sqlite3 built-in handles locking better, but Node sqlite3 works for simple reads.
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) return res.status(500).json({ error: 'DB not found', details: err.message });

      const targetDate = req.query.date || new Date().toISOString().split('T')[0];

      db.all("SELECT app_name, total_seconds, last_seen FROM screen_time_sessions WHERE date = ? ORDER BY total_seconds DESC", [targetDate], (err, rows) => {
        db.close();

        if (err) return res.status(500).json({ error: 'DB read error', details: err.message });

        let total = 0;
        const apps = {};

        for (const row of rows) {
          total += row.total_seconds;

          let name = row.app_name;
          let domain = null;
          if (name.includes('::')) {
            const parts = name.split('::');
            name = parts[0];
            domain = parts[1];
          }

          if (!apps[name]) apps[name] = { name, seconds: 0, percent: 0, domains: [] };

          if (!domain) {
            apps[name].seconds += row.total_seconds;
          } else {
            apps[name].seconds += row.total_seconds;
            apps[name].domains.push({ domain, seconds: row.total_seconds });
          }
        }

        const finalApps = Object.values(apps).map(a => {
          a.percent = total > 0 ? ((a.seconds / total) * 100).toFixed(1) : 0;
          a.domains.sort((x, y) => y.seconds - x.seconds);
          return a;
        }).sort((x, y) => y.seconds - x.seconds);

        res.json({
          date: targetDate,
          total_seconds: total,
          apps: finalApps
        });
      });
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// ── Timeline Events ──────────────────────────────────────────────────────────

app.get('/api/timeline', (req, res) => {
  try {
    const sqlite3 = require('sqlite3').verbose();
    const path = require('path');
    const dbPath = path.join(__dirname, '..', 'screen_time.db');

    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) return res.status(500).json({ error: 'DB not found', details: err.message });

      db.all("SELECT id, timestamp, event_type, event_source, event_detail FROM timeline_events ORDER BY id DESC LIMIT 100", [], (err, rows) => {
        db.close();
        if (err) return res.status(500).json({ error: 'DB read error', details: err.message });
        res.json({ events: rows });
      });
    });
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
    timestamp: new Date().toISOString(),
    platform: process.platform,
    os: safeRun(scanWindowsApps),
    camera: safeRun(detectActiveCamera),
    microphone: safeRun(detectActiveMicrophone),
    processes: safeRun(scanRunningProcesses),
  };

  const detected = getDetectedBrowsers();
  for (const [browser, path] of Object.entries(detected)) {
    if (browser === 'firefox') {
      result.firefox = safeRun(() => scanFirefox(path));
    } else {
      result[browser] = safeRun(() => parsePrefs(path));
    }
  }

  res.json(result);
});

// ── Process Kill ──────────────────────────────────────────────────────────────

app.post('/api/kill', (req, res) => {
  const { pid } = req.body;
  if (!pid) return res.status(400).json({ error: 'PID is required' });

  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /F /PID ${pid}`);
    } else {
      execSync(`kill -9 ${pid}`);
    }
    res.json({ success: true, pid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
