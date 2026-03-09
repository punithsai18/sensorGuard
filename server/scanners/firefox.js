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
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const TYPE_MAP = {
  camera: 'camera',
  microphone: 'microphone',
  geo: 'geolocation',
  'desktop-notification': 'notifications',
  'storage-access': 'storage-access',
};



function scanFirefox(profilesDir) {
  if (!profilesDir) return { error: `Firefox profile not provided`, permissions: {} };
  const dbPath = path.join(profilesDir, 'permissions.sqlite');
  if (!fs.existsSync(dbPath)) return { error: `permissions.sqlite not found in ${profilesDir}`, permissions: {} };

  const pythonScriptPath = path.join(__dirname, 'sqlite_runner.py');
  let raw;
  try {
    const sql = "SELECT origin, type, permission FROM moz_perms;";
    raw = execSync(`python "${pythonScriptPath}" "${dbPath}" "${sql}"`, { encoding: 'utf8', timeout: 8000 });
  } catch (e) {
    return { error: `sqlite query failed: ${e.message}`, permissions: {} };
  }

  const result = {};
  for (const line of raw.trim().split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('|');
    if (parts.length < 3) continue;
    const [originRaw, type, permRaw] = parts;

    let site = originRaw.trim();
    try { site = new URL(site).hostname || site; } catch { /* keep raw */ }

    const label = TYPE_MAP[type.trim()] || type.trim();
    const perm = parseInt(permRaw.trim(), 10);
    const status = perm === 1 ? 'allowed' : perm === 2 ? 'blocked' : 'ask';

    if (!result[label]) result[label] = [];
    result[label].push({ site, status });
  }

  return result;
}

module.exports = { scanFirefox };
