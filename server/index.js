/**
 * SensorGuard – Scanner Backend
 *
 * Express server that reads real browser/OS permission data:
 *   GET /api/scan/all  – aggregate scan of all sources
 *   GET /api/health    – liveness probe
 *
 * Start: node server/index.js
 * Default port: 3005  (override via PORT env var)
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { execFileSync } = require('child_process');

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

// ── Security headers ──────────────────────────────────────────────────────────

// Remove X-Powered-By to avoid fingerprinting the server technology.
app.disable('x-powered-by');

// Helmet sets secure HTTP headers (CSP, X-Frame-Options, X-Content-Type-Options,
// Referrer-Policy, Strict-Transport-Security, etc.).
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", 'ws://127.0.0.1:8996', 'ws://127.0.0.1:8997', 'ws://127.0.0.1:8998', 'ws://127.0.0.1:8999', 'ws://127.0.0.1:9000'],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// ── CORS ──────────────────────────────────────────────────────────────────────

// Restrict CORS to localhost only – this is a local desktop tool.
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3005',
  'http://127.0.0.1:3005',
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. direct curl calls from localhost)
    // or from the known allowed origins.
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error('CORS: origin not allowed'));
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
}));

// ── Rate limiting ─────────────────────────────────────────────────────────────

// Limit each IP to 120 requests per minute to prevent API abuse.
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
});
app.use(limiter);

// ── Body parsing ──────────────────────────────────────────────────────────────

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
  const raw = req.body && req.body.pid;
  if (raw === undefined || raw === null || raw === '') {
    return res.status(400).json({ error: 'PID is required' });
  }

  // Accept only a positive integer PID to prevent command injection.
  // PID_MAX is the Linux kernel maximum (4,194,304 = 2²²); Windows also
  // uses 32-bit PIDs that are always multiples of 4, so this upper bound is safe.
  const PID_MAX = 4194304;
  const pidNum = Number(raw);
  if (!Number.isInteger(pidNum) || pidNum <= 0 || pidNum > PID_MAX) {
    return res.status(400).json({ error: 'Invalid PID' });
  }

  try {
    if (process.platform === 'win32') {
      // Use execFileSync with an argument array to avoid shell injection.
      execFileSync('taskkill', ['/F', '/PID', String(pidNum)]);
    } else {
      // Use process.kill() directly – no shell involved.
      process.kill(pidNum, 'SIGKILL');
    }
    res.json({ success: true, pid: pidNum });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

// Bind to 127.0.0.1 only so the API is not reachable from other machines
// on the network – reducing the attack surface and preventing remote detection.
app.listen(PORT, '127.0.0.1', () => {
  console.log(`[SensorGuard] Scanner backend running → http://localhost:${PORT}`);
  console.log(`[SensorGuard] Platform: ${process.platform}`);
  console.log(`[SensorGuard] Endpoints:`);
  console.log(`  GET /api/health`);
  console.log(`  GET /api/tabs`);
  console.log(`  GET /api/scan/all`);
});
