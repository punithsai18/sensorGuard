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
  'http://localhost:5174',
  'http://127.0.0.1:5174',
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
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);

    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const localISOTime = new Date(now - offset).toISOString();
    const dateStr = req.query.date || localISOTime.split('T')[0];

    // Query hourly aggregation
    const sql = `
      SELECT 
        CAST(strftime('%H', timestamp) AS INTEGER) as hour,
        app_name,
        SUM(duration_seconds) as seconds,
        MAX(exe_path) as exe_path
      FROM screen_time_sessions
      WHERE date(timestamp) = ?
      GROUP BY hour, app_name
      ORDER BY hour ASC, seconds DESC
    `;

    db.all(sql, [dateStr], (err, rows) => {
      db.close();
      if (err) return res.status(500).json({ error: err.message });

      // Initialize 24 hours
      const hours = Array.from({ length: 24 }, (_, i) => ({
        hour: i,
        apps: [],
        total_seconds: 0
      }));

      const summaryMap = {};
      let totalDaySeconds = 0;

      rows.forEach(row => {
        const h = row.hour;
        if (h >= 0 && h < 24) {
          hours[h].apps.push({ name: row.app_name, seconds: row.seconds, exe_path: row.exe_path });
          hours[h].total_seconds += row.seconds;
        }
        
        const baseApp = row.app_name.includes('::') ? row.app_name.split('::')[0] : row.app_name;
        if (!summaryMap[baseApp]) summaryMap[baseApp] = { seconds: 0, exe_path: row.exe_path };
        summaryMap[baseApp].seconds += row.seconds;
        if (row.exe_path) summaryMap[baseApp].exe_path = row.exe_path;
        totalDaySeconds += row.seconds;
      });

      const summary = Object.entries(summaryMap)
        .sort((a, b) => b[1].seconds - a[1].seconds)
        .map(([name, data]) => ({
          name,
          total_seconds: data.seconds,
          exe_path: data.exe_path,
          percentage: totalDaySeconds > 0 ? Math.round((data.seconds / totalDaySeconds) * 100) : 0
        }));

      // PART 3: ADD ICONS
      // We'll call the Python extractor for each app in the summary
      // To avoid massive overhead, we'll do it in one batch if possible, 
      // but for now, we'll implement a simple Python bridge.
      try {
        const { execSync } = require('child_process');
        const pythonPath = process.platform === 'win32' ? 'python' : 'python3';
        
        summary.forEach(app => {
          try {
            // This is a bit slow for a REST API, but it follows the requirement to use the Python extractor.
            // Caching in icon_extractor.py only works per-session, so here it will be cold-start.
            // In a real prod app, we'd have a long-running icon service.
            const cmd = `${pythonPath} -c "import sys; sys.path.append('.'); from backend.icon_extractor import get_app_icon; print(get_app_icon('${app.name}', r'${app.exe_path || ''}'))"`;
            const icon = execSync(cmd, { cwd: path.join(__dirname, '..') }).toString().trim();
            app.icon = icon !== 'None' ? icon : null;
          } catch (e) {
            app.icon = null;
          }
        });
      } catch (e) {
        console.error("Icon extraction failed", e);
      }

      res.json({ date: dateStr, hours, summary });
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/screentime/history', (req, res) => {
  try {
    const sqlite3 = require('sqlite3').verbose();
    const path = require('path');
    const dbPath = path.join(__dirname, '..', 'screen_time.db');
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);

    const daysCount = parseInt(req.query.days) || 7;
    const now = new Date();
    const startDateObj = new Date(now.getTime() - (daysCount - 1) * 24 * 60 * 60 * 1000);
    const offset = startDateObj.getTimezoneOffset() * 60000;
    const startDate = new Date(startDateObj.getTime() - offset).toISOString().split('T')[0];

    // Query daily aggregation
    const sql = `
      SELECT 
        date(timestamp) as day,
        app_name,
        SUM(duration_seconds) as seconds
      FROM screen_time_sessions
      WHERE day >= ?
      GROUP BY day, app_name
      ORDER BY day ASC, seconds DESC
    `;

    db.all(sql, [startDate], (err, rows) => {
      db.close();
      if (err) return res.status(500).json({ error: err.message });

      const daysMap = {};
      const summaryMap = {};
      let totalRangeSeconds = 0;

      rows.forEach(row => {
        const d = row.day;
        if (!daysMap[d]) daysMap[d] = { date: d, apps: [], total_seconds: 0 };
        
        daysMap[d].apps.push({ name: row.app_name, seconds: row.seconds });
        daysMap[d].total_seconds += row.seconds;

        const baseApp = row.app_name.includes('::') ? row.app_name.split('::')[0] : row.app_name;
        if (!summaryMap[baseApp]) summaryMap[baseApp] = 0;
        summaryMap[baseApp] += row.seconds;
        totalRangeSeconds += row.seconds;
      });

      const days = Object.values(daysMap);
      const summary = Object.entries(summaryMap)
        .sort((a, b) => b[1] - a[1])
        .map(([name, total]) => ({
          name,
          total_seconds: total,
          percentage: totalRangeSeconds > 0 ? Math.round((total / totalRangeSeconds) * 100) : 0
        }));

      res.json({ start: startDate, days, summary });
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/screentime/reset', (req, res) => {
  try {
    const sqlite3 = require('sqlite3').verbose();
    const path = require('path');
    const dbPath = path.join(__dirname, '..', 'screen_time.db');
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE);

    db.run("DELETE FROM screen_time_sessions", [], (err) => {
      db.close();
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, message: 'Screen time history cleared.' });
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
const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`[SensorGuard] Scanner backend running → http://localhost:${PORT}`);
  console.log(`[SensorGuard] Platform: ${process.platform}`);
  console.log(`[SensorGuard] Endpoints:`);
  console.log(`  GET /api/health`);
  console.log(`  GET /api/tabs`);
  console.log(`  GET /api/scan/all`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[SensorGuard] ERROR: Port ${PORT} is already in use.`);
    console.error(`[SensorGuard] Run: npx kill-port ${PORT}  OR  netstat -ano | findstr :${PORT}  to find and kill the process.`);
    process.exit(1);
  }
  throw err;
});
