const fs = require('fs');
const path = require('path');
const os = require('os');
const { globSync } = require('glob');

let DETECTED_BROWSERS = {};

function expandPath(p) {
    if (!p) return null;
    p = p.replace(/%([^%]+)%/g, (_, n) => process.env[n] || '');
    if (p.startsWith('~/')) {
        p = path.join(os.homedir(), p.slice(2));
    }
    return p;
}

const BROWSER_PATHS = {
    win32: {
        chrome: '%LOCALAPPDATA%\\Google\\Chrome\\User Data\\Default\\Preferences',
        edge: '%LOCALAPPDATA%\\Microsoft\\Edge\\User Data\\Default\\Preferences',
        brave: '%LOCALAPPDATA%\\BraveSoftware\\Brave-Browser\\User Data\\Default\\Preferences',
        opera: '%APPDATA%\\Opera Software\\Opera Stable\\Preferences',
        vivaldi: '%LOCALAPPDATA%\\Vivaldi\\User Data\\Default\\Preferences',
        firefox: '%APPDATA%\\Mozilla\\Firefox\\Profiles\\*.default*\\',
        arc: '%LOCALAPPDATA%\\Packages\\TheBrowserCompany.Arc*\\'
    },
    darwin: {
        chrome: '~/Library/Application Support/Google/Chrome/Default/Preferences',
        edge: '~/Library/Application Support/Microsoft Edge/Default/Preferences',
        brave: '~/Library/Application Support/BraveSoftware/Brave-Browser/Default/Preferences',
        firefox: '~/Library/Application Support/Firefox/Profiles/*.default*/'
    },
    linux: {
        chrome: '~/.config/google-chrome/Default/Preferences',
        brave: '~/.config/BraveSoftware/Brave-Browser/Default/Preferences',
        firefox: '~/.mozilla/firefox/*.default*/'
    }
};

function detectInstalledBrowsers() {
    const platform = process.platform;
    const pathConfig = BROWSER_PATHS[platform] || BROWSER_PATHS.linux;

    const detected = {};
    for (const [browser, rawPath] of Object.entries(pathConfig)) {
        const expanded = expandPath(rawPath);
        if (!expanded) continue;

        try {
            if (rawPath.includes('*')) {
                // To avoid permission errors doing deep matches, use absolute path glob
                const matches = globSync(expanded.replace(/\\/g, '/'));
                if (matches.length > 0) {
                    if (browser === 'arc') {
                        // Ensure finding preferences exactly
                        const p = path.join(matches[0], 'LocalCache', 'Local', 'Arc', 'User Data', 'Default', 'Preferences');
                        if (fs.existsSync(p)) {
                            detected[browser] = p;
                        } else {
                            detected[browser] = matches[0];
                        }
                    } else {
                        detected[browser] = matches[0];
                    }
                }
            } else {
                if (fs.existsSync(expanded)) {
                    detected[browser] = expanded;
                }
            }
        } catch (err) { }
    }

    DETECTED_BROWSERS = detected;
    return detected;
}

detectInstalledBrowsers();
setInterval(detectInstalledBrowsers, 60000);

function getDetectedBrowsers() {
    return DETECTED_BROWSERS;
}

module.exports = { detectInstalledBrowsers, getDetectedBrowsers };
