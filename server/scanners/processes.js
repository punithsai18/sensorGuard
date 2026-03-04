/**
 * Running system processes scanner.
 *
 * Lists all currently-running desktop applications/processes on the host.
 *
 * Platform strategies:
 *   Windows — `tasklist /FO CSV /NH`  → Name, PID, Session, Mem
 *   Linux   — `ps -eo pid,comm,%cpu,%mem --no-headers`
 *   macOS   — `ps -Ao pid,comm,%cpu,%mem`
 *
 * Returns: { processes: [{ name, pid, cpu?, mem? }], note?, error? }
 */
const { execSync } = require('child_process');

// Maximum number of process entries returned to the UI.
const MAX_PROCS = 100;

function scanRunningProcesses() {
  const plat = process.platform;
  if (plat === 'win32')  return scanWindows();
  if (plat === 'linux')  return scanLinux();
  if (plat === 'darwin') return scanMac();
  return { processes: [], note: `Process scanning not supported on ${plat}.` };
}

// ── Windows ───────────────────────────────────────────────────────────────────

function scanWindows() {
  try {
    // tasklist /FO CSV /NH outputs lines like:
    // "chrome.exe","1234","Console","1","50,123 K"
    const raw = execSync('tasklist /FO CSV /NH', { encoding: 'utf8', timeout: 10000 });
    const procs = [];
    for (const line of raw.trim().split('\n')) {
      const cols = parseCsvLine(line);
      if (!cols || cols.length < 2) continue;
      const name = (cols[0] ?? '').trim();
      const pid  = parseInt(cols[1] ?? '', 10) || null;
      const memRaw = parseInt((cols[4] ?? '').replace(/\s*K$/, '').replace(/,/g, '').trim(), 10);
      const memStr = isNaN(memRaw) ? null : `${Math.round(memRaw / 1024)} MB`;
      if (!name) continue;
      procs.push({ name, pid, mem: memStr });
    }
    return { processes: procs.slice(0, MAX_PROCS) };
  } catch (e) {
    return { processes: [], error: e.message };
  }
}

/** Minimal CSV line parser (handles quoted fields with embedded commas). */
function parseCsvLine(line) {
  const result = [];
  let cur = '';
  let inQuote = false;
  for (const ch of line.trim()) {
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (ch === ',' && !inQuote) { result.push(cur); cur = ''; continue; }
    cur += ch;
  }
  result.push(cur);
  return result;
}

// ── Linux ─────────────────────────────────────────────────────────────────────

function scanLinux() {
  try {
    const raw = execSync('ps -eo pid,comm,%cpu,%mem --no-headers --sort=-%cpu', {
      encoding: 'utf8',
      timeout: 10000,
    });
    const procs = [];
    for (const line of raw.trim().split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) continue;
      const [pid, name, cpu, mem] = parts;
      procs.push({ name, pid: parseInt(pid, 10) || null, cpu: `${cpu}%`, mem: `${mem}%` });
    }
    return { processes: procs.slice(0, MAX_PROCS) };
  } catch (e) {
    return { processes: [], error: e.message };
  }
}

// ── macOS ─────────────────────────────────────────────────────────────────────

function scanMac() {
  try {
    const raw = execSync('ps -Ao pid,comm,%cpu,%mem', {
      encoding: 'utf8',
      timeout: 10000,
    });
    const procs = [];
    const lines = raw.trim().split('\n');
    // Skip header line
    for (const line of lines.slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) continue;
      const [pid, name, cpu, mem] = parts;
      procs.push({ name, pid: parseInt(pid, 10) || null, cpu: `${cpu}%`, mem: `${mem}%` });
    }
    // Sort by CPU descending
    procs.sort((a, b) => parseFloat(b.cpu) - parseFloat(a.cpu));
    return { processes: procs.slice(0, MAX_PROCS) };
  } catch (e) {
    return { processes: [], error: e.message };
  }
}

module.exports = { scanRunningProcesses };
