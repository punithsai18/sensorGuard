/**
 * Chrome & Edge permission scanner.
 * Reads the Chromium-family `Preferences` JSON file (never locked).
 *
 * Permission key → friendly label mapping
 * Setting values: 1 = Allow, 2 = Block, anything else = Ask/Default
 */
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const PERM_KEYS = {
  media_stream_camera : 'camera',
  media_stream_mic    : 'microphone',
  geolocation         : 'geolocation',
  notifications       : 'notifications',
  clipboard_read      : 'clipboard-read',
  clipboard_write     : 'clipboard-write',
};

/** Returns {Chrome, Edge, Chromium} paths for the current OS. */
function chromiumPaths() {
  const home = os.homedir();
  const plat = process.platform;

  if (plat === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return {
      Chrome   : path.join(local, 'Google', 'Chrome', 'User Data', 'Default', 'Preferences'),
      Edge     : path.join(local, 'Microsoft', 'Edge', 'User Data', 'Default', 'Preferences'),
    };
  }
  if (plat === 'darwin') {
    const lib = path.join(home, 'Library', 'Application Support');
    return {
      Chrome   : path.join(lib, 'Google', 'Chrome', 'Default', 'Preferences'),
      Edge     : path.join(lib, 'Microsoft Edge', 'Default', 'Preferences'),
    };
  }
  // Linux / BSD
  return {
    Chrome   : path.join(home, '.config', 'google-chrome', 'Default', 'Preferences'),
    Chromium : path.join(home, '.config', 'chromium', 'Default', 'Preferences'),
    Edge     : path.join(home, '.config', 'microsoft-edge', 'Default', 'Preferences'),
  };
}

/** Parse a Preferences JSON and return per-permission site lists. */
function parsePrefs(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Preferences file not found: ${filePath}`);
  }
  let prefs;
  try {
    prefs = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    throw new Error(`Failed to parse Preferences JSON: ${e.message}`);
  }

  const exceptions = prefs?.profile?.content_settings?.exceptions ?? {};
  const result = {};

  for (const [key, label] of Object.entries(PERM_KEYS)) {
    const entries = exceptions[key] ?? {};
    const seen    = new Set();
    result[label] = [];

    for (const [siteKey, val] of Object.entries(entries)) {
      // siteKey format: "https://meet.google.com:443,*"
      const originPart = siteKey.split(',')[0];
      let site = originPart;
      try { site = new URL(originPart).hostname || originPart; } catch { /* keep raw */ }
      if (!site || seen.has(site)) continue;
      seen.add(site);

      const setting = typeof val?.setting === 'number' ? val.setting : null;
      const status  = setting === 1 ? 'allowed' : setting === 2 ? 'blocked' : 'ask';
      result[label].push({ site, status });
    }
  }
  return result;
}

const PATHS = chromiumPaths();

function scanChrome() {
  const p = PATHS.Chrome || PATHS.Chromium;
  return parsePrefs(p);
}

function scanEdge() {
  return parsePrefs(PATHS.Edge);
}

module.exports = { scanChrome, scanEdge };
