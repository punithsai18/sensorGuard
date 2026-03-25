// ── Risk Matrix Utility ────────────────────────────────────────────────────────
//
// Each sensor is rated on two axes:
//   Likelihood  1 (Rare) → 5 (Almost Certain)
//   Impact      1 (Negligible) → 5 (Severe)
//   Risk Score  = Likelihood × Impact  (range 1 – 25)
//
// Rating bands:
//   HIGH    ≥ 15  (red)
//   MEDIUM   8-14 (amber)
//   LOW      1-7  (green)

export const RISK_THRESHOLDS = {
  CRITICAL: { min: 20, label: 'CRITICAL', color: '#dc2626', bg: 'rgba(220, 38, 38, 0.20)', icon: '🔴' },
  HIGH:     { min: 15, label: 'HIGH',     color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)', icon: '🟠' },
  MEDIUM:   { min:  8, label: 'MEDIUM',   color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)', icon: '🟡' },
  LOW:      { min:  1, label: 'LOW',      color: '#22c55e', bg: 'rgba(34, 197, 94, 0.08)',  icon: '🟢' },
}

// Per-sensor weights [likelihood, impact] when the sensor is active/triggered.
// Idle score is always 1 (1×1).
export const SENSOR_RISK_WEIGHTS = {
  keyboard:       { icon: '⌨',  label: 'Keyboard Hook',  likelihood: 5, impact: 5, description: 'Global keyboard hook — all keystrokes may be captured' },
  screen_capture: { icon: '🖥', label: 'Screen Capture',  likelihood: 4, impact: 4, description: 'Screen is being recorded or mirrored' },
  clipboard:      { icon: '📋', label: 'Clipboard',       likelihood: 4, impact: 3, description: 'Clipboard contents are being accessed by an app' },
  camera:         { icon: '📷', label: 'Camera',          likelihood: 3, impact: 3, description: 'Camera is actively streaming video' },
  microphone:     { icon: '🎙', label: 'Microphone',      likelihood: 3, impact: 3, description: 'Microphone is actively recording audio' },
  location:       { icon: '📍', label: 'Location',        likelihood: 2, impact: 4, description: 'Device location is being read by an app' },
  network:        { icon: '🌐', label: 'Network',         likelihood: 2, impact: 2, description: 'Unusual outbound network activity detected' },
  usb:            { icon: '🔌', label: 'USB',             likelihood: 2, impact: 2, description: 'USB device is connected and being accessed' },
}

/**
 * Return the risk rating string ('HIGH' | 'MEDIUM' | 'LOW') for a numeric score.
 */
export function getRiskRating(score) {
  if (score >= RISK_THRESHOLDS.CRITICAL.min) return 'CRITICAL'
  if (score >= RISK_THRESHOLDS.HIGH.min)     return 'HIGH'
  if (score >= RISK_THRESHOLDS.MEDIUM.min)   return 'MEDIUM'
  return 'LOW'
}

/**
 * Compute the risk score for a single sensor.
 * Returns 1 when idle (minimum score), otherwise likelihood × impact.
 */
export function getSensorScore(sensorKey, isActive) {
  if (!isActive) return 1
  const w = SENSOR_RISK_WEIGHTS[sensorKey]
  return w ? w.likelihood * w.impact : 1
}

/**
 * Derive the active/idle state of every sensor from component state.
 *
 * @param {boolean}      cameraActive
 * @param {boolean}      micActive
 * @param {object|null}  advancedSensors  – data from useAdvancedSensors()
 * @returns {Record<string, boolean>}
 */
export function getSensorActiveMap(cameraActive, micActive, advancedSensors) {
  const s = advancedSensors || {}
  return {
    keyboard:       s.keyboard?.status       !== 'IDLE',
    screen_capture: s.screen_capture?.status !== 'IDLE',
    clipboard:      s.clipboard?.status      !== 'IDLE',
    camera:         !!cameraActive,
    microphone:     !!micActive,
    location:       s.location?.status       === 'ACTIVE',
    network:        s.network?.status        !== 'IDLE',
    usb:            s.usb?.status            !== 'IDLE',
  }
}

/**
 * Compute risk scores for all sensors and return an aggregate result.
 *
 * @param {boolean}      cameraActive
 * @param {boolean}      micActive
 * @param {object|null}  advancedSensors
 * @returns {{
 *   scores:               Record<string, number>,
 *   isActive:             Record<string, boolean>,
 *   maxScore:             number,
 *   totalScore:           number,
 *   rating:               'HIGH'|'MEDIUM'|'LOW',
 *   activeHighRiskSensors: string[],
 * }}
 */
export function computeOverallRisk(cameraActive, micActive, advancedSensors) {
  const isActive = getSensorActiveMap(cameraActive, micActive, advancedSensors)

  const scores = {}
  for (const key of Object.keys(SENSOR_RISK_WEIGHTS)) {
    scores[key] = getSensorScore(key, isActive[key])
  }

  const allScores   = Object.values(scores)
  const maxScore    = Math.max(...allScores)
  const activeOnly  = Object.entries(scores).filter(([k]) => isActive[k]).map(([, v]) => v)
  const totalScore  = activeOnly.reduce((a, b) => a + b, 0)

  const activeHighRiskSensors = Object.entries(scores)
    .filter(([k, s]) => isActive[k] && getRiskRating(s) !== 'LOW')
    .map(([k]) => SENSOR_RISK_WEIGHTS[k]?.label ?? k)

  return {
    scores,
    isActive,
    maxScore,
    totalScore,
    rating: getRiskRating(maxScore),
    activeHighRiskSensors,
  }
}

/**
 * Return alert copy appropriate for each risk rating.
 */
export function getRiskAlertMessage(rating, activeHighRiskSensors) {
  const list = activeHighRiskSensors.length > 0 ? ` (${activeHighRiskSensors.join(', ')})` : ''
  if (rating === 'HIGH') {
    return {
      title:  'HIGH RISK — Immediate Action Recommended',
      detail: `One or more critical sensors are active${list}. Your data or privacy may be at serious risk. Review the Risk Matrix below and terminate any suspicious processes.`,
    }
  }
  if (rating === 'MEDIUM') {
    return {
      title:  'MEDIUM RISK — Elevated Sensor Activity',
      detail: `Sensors with elevated risk are currently active${list}. Review the Risk Matrix below and confirm that all active sensors are expected.`,
    }
  }
  return null
}
