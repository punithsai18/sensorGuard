/**
 * Active camera usage detector.
 *
 * Platform strategies:
 *   Linux  — enumerate /dev/video* and check /proc/<pid>/fd/ symlinks
 *   Windows — CapabilityAccessManager registry: LastUsedTimeStop==0 means
 *             the app is actively capturing from the webcam right now
 *   macOS  — lsof on AppleCamera device
 *
 * Returns:
 *   { active: bool, processes: [...], videoDevices: [...], error?: string }
 */
const fs           = require('fs');
const { execSync } = require('child_process');

function detectActiveCamera() {
  const plat = process.platform;
  if (plat === 'linux')  return detectLinux();
  if (plat === 'win32')  return detectWindows();
  if (plat === 'darwin') return detectMac();
  return { active: false, processes: [], error: `Unsupported platform: ${plat}` };
}

// ── Linux ─────────────────────────────────────────────────────────────────────

function detectLinux() {
  let videoDevices = [];
  try {
    videoDevices = fs.readdirSync('/dev').filter(d => d.startsWith('video'));
  } catch {
    return { active: false, processes: [], error: 'Cannot read /dev' };
  }

  if (videoDevices.length === 0) {
    return { active: false, processes: [], videoDevices, note: 'No /dev/video* devices found on this machine.' };
  }

  const using = [];

  // Walk /proc/<pid>/fd/* for symlinks pointing at /dev/video*
  try {
    const pids = fs.readdirSync('/proc').filter(e => /^\d+$/.test(e));
    for (const pid of pids) {
      const fdDir = `/proc/${pid}/fd`;
      let fds;
      try { fds = fs.readdirSync(fdDir); } catch { continue; }
      for (const fd of fds) {
        let target;
        try { target = fs.readlinkSync(`${fdDir}/${fd}`); } catch { continue; }
        const matched = videoDevices.find(v => target === `/dev/${v}`);
        if (matched) {
          let comm = pid;
          try { comm = fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim(); } catch { /* keep pid */ }
          using.push({ device: matched, pid, process: comm });
        }
      }
    }
  } catch (e) {
    return { active: false, processes: [], videoDevices, error: e.message };
  }

  return { active: using.length > 0, processes: using, videoDevices };
}

// ── Windows ───────────────────────────────────────────────────────────────────

/**
 * Windows camera detection via CapabilityAccessManager registry.
 *
 * When an app is actively using the webcam, Windows sets:
 *   LastUsedTimeStart ≠ 0  (FILETIME when capture began)
 *   LastUsedTimeStop  = 0  (not yet written → device is still open)
 *
 * Registry path:
 *   HKCU:\Software\Microsoft\Windows\CurrentVersion\
 *     CapabilityAccessManager\ConsentStore\webcam
 *
 * Sub-keys are either UWP package names or, under the "NonPackaged"
 * sub-tree, full .exe paths of Win32 apps.
 */
function detectWindows() {
  const ps = [
    `$base = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\webcam';`,
    `$active = @();`,
    `Get-ChildItem $base -ErrorAction SilentlyContinue | ForEach-Object {`,
    `  if ($_.PSChildName -eq 'NonPackaged') {`,
    `    Get-ChildItem $_.PsPath -ErrorAction SilentlyContinue | ForEach-Object {`,
    `      $v = Get-ItemProperty $_.PsPath -ErrorAction SilentlyContinue;`,
    `      if ($v.LastUsedTimeStart -and $v.LastUsedTimeStart -ne 0 -and $v.LastUsedTimeStop -eq 0) {`,
    // Win32 NonPackaged keys are stored as "C:#Program Files#App#app.exe" — split on '#' to get the exe path.
    `        $active += ($_.PSChildName -split '#')[0]`,
    `      }`,
    `    }`,
    `  } else {`,
    `    $v = Get-ItemProperty $_.PsPath -ErrorAction SilentlyContinue;`,
    `    if ($v.LastUsedTimeStart -and $v.LastUsedTimeStart -ne 0 -and $v.LastUsedTimeStop -eq 0) {`,
    `      $active += $_.PSChildName`,
    `    }`,
    `  }`,
    `};`,
    `$active | Select-Object -Unique`,
  ].join(' ');

  try {
    const output = execSync(
      `powershell -NoProfile -NonInteractive -Command "${ps}"`,
      { encoding: 'utf8', timeout: 8000 },
    );
    const procs = output.trim().split('\n').map(s => s.trim()).filter(Boolean);
    return { active: procs.length > 0, processes: procs.map(p => ({ process: p })) };
  } catch (e) {
    return { active: false, processes: [], error: e.message };
  }
}

// ── macOS ─────────────────────────────────────────────────────────────────────

function detectMac() {
  try {
    // lsof on AppleCamera or FaceTime device node
    const output = execSync(
      `lsof /dev/ 2>/dev/null | grep -iE "AppleCamera|FaceTime|camera" | awk '{print $1}' | sort -u`,
      { encoding: 'utf8', timeout: 8000 },
    );
    const procs = output.trim().split('\n').filter(Boolean);
    return { active: procs.length > 0, processes: procs.map(p => ({ process: p })) };
  } catch (e) {
    return { active: false, processes: [], error: e.message };
  }
}

module.exports = { detectActiveCamera };
