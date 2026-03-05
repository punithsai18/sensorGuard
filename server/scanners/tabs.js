/**
 * Browser tab scanner.
 *
 * Reads the most-recently-visited URLs from each browser's local history
 * database. Because browsers keep their SQLite history files on disk, we can
 * copy them to /tmp and query with the sqlite3 CLI (same technique used by the
 * Firefox permissions scanner).
 *
 * Chrome time format: microseconds since 1601-01-01 (Windows FILETIME).
 * Firefox time format: microseconds since 1970-01-01 (Unix epoch µs).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// µs offset between 1601-01-01 and 1970-01-01 in milliseconds
const CHROME_EPOCH_OFFSET_MS = 11644473600000;

/** Convert a Chrome timestamp (µs since 1601) to a JS Date. */
function chromeTime(t) {
  const ms = Math.floor(Number(t) / 1000) - CHROME_EPOCH_OFFSET_MS;
  return isNaN(ms) ? null : new Date(ms).toISOString();
}

/** Convert a Firefox timestamp (µs since Unix epoch) to a JS Date. */
function firefoxTime(t) {
  const ms = Math.floor(Number(t) / 1000);
  return isNaN(ms) ? null : new Date(ms).toISOString();
}

/** Return browser history DB paths for the current OS. */
function historyPaths() {
  const home = os.homedir();
  const plat = process.platform;

  if (plat === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return {
      chrome: path.join(local, 'Google', 'Chrome', 'User Data', 'Default', 'History'),
      edge: path.join(local, 'Microsoft', 'Edge', 'User Data', 'Default', 'History'),
      firefox: firefoxPlacesPath(path.join(appdata, 'Mozilla', 'Firefox', 'Profiles')),
    };
  }
  if (plat === 'darwin') {
    const lib = path.join(home, 'Library', 'Application Support');
    return {
      chrome: path.join(lib, 'Google', 'Chrome', 'Default', 'History'),
      edge: path.join(lib, 'Microsoft Edge', 'Default', 'History'),
      firefox: firefoxPlacesPath(path.join(home, 'Library', 'Application Support', 'Firefox', 'Profiles')),
    };
  }
  // Linux / BSD
  return {
    chrome: path.join(home, '.config', 'google-chrome', 'Default', 'History'),
    chromium: path.join(home, '.config', 'chromium', 'Default', 'History'),
    edge: path.join(home, '.config', 'microsoft-edge', 'Default', 'History'),
    firefox: firefoxPlacesPath(path.join(home, '.mozilla', 'firefox')),
  };
}

/** Locate the first Firefox profile's places.sqlite. */
function firefoxPlacesPath(profilesDir) {
  if (!fs.existsSync(profilesDir)) return null;
  try {
    for (const entry of fs.readdirSync(profilesDir)) {
      const db = path.join(profilesDir, entry, 'places.sqlite');
      if (fs.existsSync(db)) return db;
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Copy a SQLite DB to /tmp via python script and query it natively
 * using python's built-in sqlite3.
 */
function querySqlite(dbPath, sql) {
  const pythonScriptPath = path.join(__dirname, 'sqlite_runner.py');
  try {
    return execSync(`python "${pythonScriptPath}" "${dbPath}" "${sql}"`, { encoding: 'utf8', timeout: 8000 });
  } catch (e) {
    throw new Error(`Python sqlite query failed: ${e.message}`);
  }
}

/** Parse one pipe-delimited line from sqlite3 CLI output. */
function parseLine(line, timeConverter) {
  const parts = line.split('|');
  if (parts.length < 2) return null;
  const [url, title, rawTime] = parts;
  const trimUrl = (url || '').trim();
  if (!trimUrl) return null;
  return {
    url: trimUrl,
    title: (title || '').trim() || null,
    visitedAt: rawTime ? timeConverter(rawTime.trim()) : null,
  };
}

/** Skip internal browser pages and the SensorGuard app's own localhost URLs. */
function isRealUrl(url) {
  return !/^(chrome|edge|about|data|blob|chrome-extension):/.test(url)
    && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?([/?#]|$)/.test(url);
}

/** Read the most recent N URLs from a Chromium-family History SQLite. */
function readChromiumHistory(dbPath, limit = 30) {
  if (!dbPath || !fs.existsSync(dbPath)) {
    throw new Error(`History file not found: ${dbPath}`);
  }
  const sql =
    `SELECT u.url, u.title, u.last_visit_time ` +
    `FROM urls u ` +
    `WHERE u.hidden = 0 ` +
    `ORDER BY u.last_visit_time DESC LIMIT ${limit};`;
  const raw = querySqlite(dbPath, sql);
  return raw
    .trim()
    .split('\n')
    .map(line => parseLine(line, chromeTime))
    .filter(Boolean)
    .filter(t => isRealUrl(t.url));
}

/** Read the most recent N URLs from Firefox's places.sqlite. */
function readFirefoxHistory(dbPath, limit = 30) {
  if (!dbPath || !fs.existsSync(dbPath)) {
    throw new Error(`Firefox places.sqlite not found: ${dbPath}`);
  }
  const sql =
    `SELECT p.url, p.title, p.last_visit_date ` +
    `FROM moz_places p ` +
    `WHERE p.hidden = 0 AND p.last_visit_date IS NOT NULL ` +
    `  AND p.url NOT LIKE 'place:%' AND p.url NOT LIKE 'about:%' ` +
    `ORDER BY p.last_visit_date DESC LIMIT ${limit};`;
  const raw = querySqlite(dbPath, sql);
  return raw
    .trim()
    .split('\n')
    .map(line => parseLine(line, firefoxTime))
    .filter(Boolean)
    .filter(t => isRealUrl(t.url));
}

/** Safe wrapper — returns { tabs, error } so one browser failure won't break others. */
function safeRead(fn) {
  try {
    return { tabs: fn(), error: null };
  } catch (e) {
    return { tabs: [], error: e.message };
  }
}

function scanBrowserTabs() {
  const paths = historyPaths();
  return {
    chrome: safeRead(() => readChromiumHistory(paths.chrome || paths.chromium)),
    edge: safeRead(() => readChromiumHistory(paths.edge)),
    firefox: safeRead(() => readFirefoxHistory(paths.firefox)),
  };
}

module.exports = { scanBrowserTabs };
