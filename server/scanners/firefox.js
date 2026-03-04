/**
 * Firefox permission scanner.
 * Reads the `moz_perms` table from Firefox's permissions.sqlite.
 *
 * Strategy:
 *   1. Locate the first Firefox profile directory.
 *   2. Copy permissions.sqlite to /tmp (avoids WAL-lock while Firefox is open).
 *   3. Query via the system sqlite3 CLI (no native npm bindings needed).
 *
 * Permission values in moz_perms: 1 = Allow, 2 = Deny
 * Common types: camera, microphone, geo, desktop-notification, storage-access
 */
const fs           = require('fs');
const path         = require('path');
const os           = require('os');
const { execSync } = require('child_process');

const TYPE_MAP = {
  camera               : 'camera',
  microphone           : 'microphone',
  geo                  : 'geolocation',
  'desktop-notification': 'notifications',
  'storage-access'     : 'storage-access',
};

/** Return the Firefox Profiles root directory for this OS. */
function firefoxProfilesDir() {
  const home = os.homedir();
  const plat = process.platform;
  if (plat === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Mozilla', 'Firefox', 'Profiles');
  }
  if (plat === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Firefox', 'Profiles');
  }
  return path.join(home, '.mozilla', 'firefox');
}

/** Find the first permissions.sqlite in any profile directory. */
function findPermDb(profilesDir) {
  if (!fs.existsSync(profilesDir)) return null;
  let entries;
  try { entries = fs.readdirSync(profilesDir); } catch { return null; }
  for (const entry of entries) {
    const db = path.join(profilesDir, entry, 'permissions.sqlite');
    if (fs.existsSync(db)) return db;
  }
  return null;
}

function scanFirefox() {
  const profilesDir = firefoxProfilesDir();
  const dbPath      = findPermDb(profilesDir);

  if (!dbPath) {
    return { error: 'Firefox profile not found', permissions: {} };
  }

  // Use a process-specific temp path to avoid races with concurrent server instances
  const tmpPath = path.join(os.tmpdir(), `sg_firefox_perms_${process.pid}.sqlite`);
  try {
    fs.copyFileSync(dbPath, tmpPath);
  } catch (e) {
    return { error: `Cannot copy Firefox DB: ${e.message}`, permissions: {} };
  }

  // Query via sqlite3 CLI (available on Linux/macOS; Windows may need WSL or sqlite3.exe)
  let raw;
  try {
    raw = execSync(
      `sqlite3 "${tmpPath}" "SELECT origin, type, permission FROM moz_perms;"`,
      { encoding: 'utf8', timeout: 8000 },
    );
  } catch (e) {
    return { error: `sqlite3 query failed: ${e.message}`, permissions: {} };
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }

  const result = {};
  for (const line of raw.trim().split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('|');
    if (parts.length < 3) continue;
    const [originRaw, type, permRaw] = parts;

    let site = originRaw.trim();
    try { site = new URL(site).hostname || site; } catch { /* keep raw */ }

    const label  = TYPE_MAP[type.trim()] || type.trim();
    const perm   = parseInt(permRaw.trim(), 10);
    const status = perm === 1 ? 'allowed' : perm === 2 ? 'blocked' : 'ask';

    if (!result[label]) result[label] = [];
    result[label].push({ site, status });
  }

  return result;
}

module.exports = { scanFirefox };
