/**
 * Chrome & Edge permission scanner.
 * Reads the Chromium-family `Preferences` JSON file (never locked).
 *
 * Permission key → friendly label mapping
 * Setting values: 1 = Allow, 2 = Block, anything else = Ask/Default
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const PERM_KEYS = {
  media_stream_camera: 'camera',
  media_stream_mic: 'microphone',
  geolocation: 'geolocation',
  notifications: 'notifications',
  clipboard_read: 'clipboard-read',
  clipboard_write: 'clipboard-write',
};



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
    const seen = new Set();
    result[label] = [];

    for (const [siteKey, val] of Object.entries(entries)) {
      // siteKey format: "https://meet.google.com:443,*"
      const originPart = siteKey.split(',')[0];
      let site = originPart;
      try { site = new URL(originPart).hostname || originPart; } catch { /* keep raw */ }
      if (!site || seen.has(site)) continue;
      seen.add(site);

      const setting = typeof val?.setting === 'number' ? val.setting : null;
      const status = setting === 1 ? 'allowed' : setting === 2 ? 'blocked' : 'ask';
      result[label].push({ site, status });
    }
  }
  return result;
}

module.exports = { parsePrefs };
