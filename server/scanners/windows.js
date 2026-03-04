/**
 * Windows CapabilityAccessManager scanner.
 *
 * Registry path:
 *   HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\<capability>
 *
 * Each sub-key is an app package name or executable path.
 * The `Value` property is "Allow" or "Deny".
 *
 * On non-Windows the function returns an empty result with a platform note.
 */
const { execSync } = require('child_process');

const CAPABILITIES = {
  webcam      : 'camera',
  microphone  : 'microphone',
  location    : 'geolocation',
};

function scanWindowsApps() {
  if (process.platform !== 'win32') {
    return {
      note: 'Windows registry scan only runs on Windows. Run this tool on Windows to see app-level permissions.',
      camera     : [],
      microphone : [],
      geolocation: [],
    };
  }

  const result = { camera: [], microphone: [], geolocation: [] };

  // Combine all three capability reads into a single PowerShell invocation to
  // avoid the ~1-2 s startup cost per call.
  const capabilities = Object.entries(CAPABILITIES)
    .map(([cap, label]) => `'${cap}|${label}'`)
    .join(',');

  const ps = [
    `$caps = @(${capabilities});`,
    `foreach ($entry in $caps) {`,
    `  $c,$l = $entry -split '\\|';`,
    `  $regPath = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\$c";`,
    `  Get-ChildItem $regPath -ErrorAction SilentlyContinue | ForEach-Object {`,
    `    $v = Get-ItemProperty $_.PsPath -Name Value -ErrorAction SilentlyContinue;`,
    `    if ($v) { Write-Output ($l + '|' + $_.PSChildName + '|' + $v.Value) }`,
    `  }`,
    `}`,
  ].join(' ');

  try {
    const output = execSync(`powershell -NoProfile -NonInteractive -Command "${ps}"`, {
      encoding: 'utf8',
      timeout : 10000,
    });

    for (const line of output.trim().split('\n')) {
      if (!line.trim()) continue;
      const parts = line.split('|').map(s => s.trim());
      if (parts.length < 3) continue;
      const [label, rawName, rawPerm] = parts;
      if (!result[label]) continue;
      const app    = rawName.split('\\').pop() || rawName;
      const status = rawPerm === 'Allow' ? 'allowed' : 'blocked';
      result[label].push({ app, status });
    }
  } catch (e) {
    for (const label of Object.values(CAPABILITIES)) {
      result[label] = [{ error: e.message }];
    }
  }

  return result;
}

module.exports = { scanWindowsApps };
