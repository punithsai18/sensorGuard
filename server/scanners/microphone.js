/**
 * Active microphone / audio-input usage detector.
 *
 * Platform strategies:
 *   Linux  — enumerate /dev/snd/pcmC*D*c (capture devices) and check
 *             /proc/<pid>/fd/ symlinks, the same technique used by camera.js
 *   Windows — CapabilityAccessManager registry: LastUsedTimeStop==0 means
 *             the app is actively capturing from the microphone right now
 *   macOS  — lsof on CoreAudio / AppleHDA device files
 *
 * Returns:
 *   { active: bool, processes: [...], audioDevices: [...], error?: string }
 */
const fs = require('fs');
const { execSync } = require('child_process');

function detectActiveMicrophone() {
  const plat = process.platform;
  if (plat === 'linux') return detectLinux();
  if (plat === 'win32') return detectWindows();
  if (plat === 'darwin') return detectMac();
  return { active: false, processes: [], error: `Unsupported platform: ${plat}` };
}

// ── Linux ─────────────────────────────────────────────────────────────────────

function detectLinux() {
  // Capture (microphone) ALSA devices match: pcmC<N>D<M>c
  let audioDevices = [];
  try {
    audioDevices = fs.readdirSync('/dev/snd').filter(d => /pcmC\d+D\d+c/.test(d));
  } catch {
    return { active: false, processes: [], error: 'Cannot read /dev/snd' };
  }

  if (audioDevices.length === 0) {
    return {
      active: false,
      processes: [],
      audioDevices,
      note: 'No /dev/snd capture devices found on this machine.',
    };
  }

  const using = [];

  try {
    const pids = fs.readdirSync('/proc').filter(e => /^\d+$/.test(e));
    for (const pid of pids) {
      const fdDir = `/proc/${pid}/fd`;
      let fds;
      try { fds = fs.readdirSync(fdDir); } catch { continue; }
      for (const fd of fds) {
        let target;
        try { target = fs.readlinkSync(`${fdDir}/${fd}`); } catch { continue; }
        const matched = audioDevices.find(d => target === `/dev/snd/${d}`);
        if (matched && !using.find(u => u.pid === pid)) {
          let comm = pid;
          try { comm = fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim(); } catch { /* keep pid */ }
          using.push({ device: matched, pid, process: comm });
        }
      }
    }
  } catch (e) {
    return { active: false, processes: [], audioDevices, error: e.message };
  }

  return { active: using.length > 0, processes: using, audioDevices };
}

// ── Windows ───────────────────────────────────────────────────────────────────

/**
 * Windows microphone detection via CapabilityAccessManager registry.
 *
 * Same logic as camera.js but queries the 'microphone' capability sub-key.
 * LastUsedTimeStop == 0 means the app is still actively capturing audio.
 */
function detectWindows() {
  const ps = [
    `$base = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';`,
    `$active = @();`,
    `Get-ChildItem $base -ErrorAction SilentlyContinue | ForEach-Object {`,
    `  if ($_.PSChildName -eq 'NonPackaged') {`,
    `    Get-ChildItem $_.PsPath -ErrorAction SilentlyContinue | ForEach-Object {`,
    `      $v = Get-ItemProperty $_.PsPath -ErrorAction SilentlyContinue;`,
    `      if ($v.LastUsedTimeStart -and $v.LastUsedTimeStart -ne 0 -and $v.LastUsedTimeStop -eq 0) {`,
    // Win32 NonPackaged keys are stored as "C:#Program Files#App#app.exe" — replace '#' with '\' to get the exe path.
    `        $active += ($_.PSChildName).Replace('#','\\')`,
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
    // AppleHDA/CoreAudio is used by the mic input pipeline on macOS
    const output = execSync(
      `lsof /dev/ 2>/dev/null | grep -iE "AppleHDA|CoreAudio|snd" | awk '{print $1}' | sort -u`,
      { encoding: 'utf8', timeout: 8000 },
    );
    const procs = output.trim().split('\n').filter(Boolean);
    return { active: procs.length > 0, processes: procs.map(p => ({ process: p })) };
  } catch (e) {
    return { active: false, processes: [], error: e.message };
  }
}

module.exports = { detectActiveMicrophone };
