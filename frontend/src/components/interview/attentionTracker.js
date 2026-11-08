/**
 * Turns per-frame face results into the attention summary saved with an interview:
 * where the student looked (left / straight / right), how often they turned away,
 * blinks, and the share of each facial expression.
 *
 * Input for each analysed frame: a list of faces { points: [{x,y}] x 68 | null,
 * expressions: {name: 0-1}, score: 0-1, box: {width,height} }, in raw camera
 * coordinates (not mirrored). "left" and "right" are the student's own left and right.
 *
 * Head direction comes from where the nose tip sits between the two jaw edges:
 * about 0.5 when facing the camera, towards 0 or 1 when the head turns. Measured on
 * real faces with this model: 0.41-0.63 facing the camera, 0.21-0.34 and 0.70-0.97
 * clearly turned. Each student's straight-ahead value is learned from the first
 * frames, so an off-centre webcam does not read as looking away.
 */

export const EMOTIONS = ["happy", "sad", "angry", "neutral", "surprise", "fear", "disgust"];
// face-api.js expression names -> names used in reports (same as the server's).
const EXPRESSION_NAMES = { fearful: "fear", disgusted: "disgust", surprised: "surprise" };

export const TURN_THRESHOLD = 0.15; // distance from the student's straight-ahead value
const CALIBRATION_FRAMES = 8;
const CONFIRM_FRAMES = 2; // a new direction must hold this many frames in a row
const LOST_TURN_MS = 5000; // face lost right after a turn: still that side, for this long
const MAX_FRAME_GAP_MS = 2000; // longer gaps (tab in background) are not counted
const CONFIDENT_FACE = 0.5; // a second face this sure triggers the "more than one person" warning
const MIN_EXPRESSION = 0.5; // an expression is counted when it is this dominant in a frame

const eyeAspectRatio = (eye) => {
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  return (d(eye[1], eye[5]) + d(eye[2], eye[4])) / (2 * d(eye[0], eye[3]));
};

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Nose-tip position between the jaw edges: 0.5 = facing the camera, >0.5 = turned to the student's left. */
export function yawRatio(points) {
  const left = points[0].x; // the student's right jaw edge (image left)
  const right = points[16].x;
  const width = right - left;
  if (!(width > 0)) return null;
  const r = (points[30].x - left) / width;
  // Outside the face: landmarks that do not fit the face (a bad frame); ignore it.
  return r < -0.1 || r > 1.1 ? null : r;
}

export function directionOf(ratio, straight = 0.5) {
  if (ratio == null) return null;
  const d = ratio - straight;
  return d > TURN_THRESHOLD ? "left" : d < -TURN_THRESHOLD ? "right" : "center";
}

export const normaliseExpressions = (expressions) =>
  Object.fromEntries(Object.entries(expressions || {}).map(([k, v]) => [EXPRESSION_NAMES[k] || k, Number(v) || 0]));

const area = (f) => (f.box ? (Number(f.box.width) || 0) * (Number(f.box.height) || 0) : 0);

export function createAttentionTracker() {
  const counts = Object.fromEntries(EMOTIONS.map((k) => [k, 0]));
  const seen = { left: 0, right: 0, center: 0 };
  const time = { left: 0, right: 0, center: 0, away: 0 };
  const calibration = [];
  let straight = null; // learned straight-ahead ratio
  let current = null; // confirmed direction
  let pending = null;
  let pendingFrames = 0;
  let pendingMs = 0; // time since the pending direction was first seen (still counted as `current`)
  let lastAt = null;
  let lostSince = null;
  let frames = 0;
  let blinks = 0;
  let eyeClosed = false;
  const openEyes = [];

  const baseline = () => (straight == null ? 0.5 : straight);

  function addTime(dt, now) {
    if (lostSince == null) {
      if (current) time[current] += dt;
      if (pending) pendingMs += dt;
      return;
    }
    // Face not found: right after a turn the head is probably turned further.
    if ((current === "left" || current === "right") && now - lostSince <= LOST_TURN_MS) time[current] += dt;
    else time.away += dt;
  }

  function trackDirection(ratio) {
    if (ratio == null) return null;
    if (straight == null && Math.abs(ratio - 0.5) < 0.2) {
      calibration.push(ratio);
      if (calibration.length >= CALIBRATION_FRAMES) straight = median(calibration);
    }
    const dir = directionOf(ratio, baseline());
    if (current == null) {
      current = dir;
      seen[dir] += 1;
    } else if (dir !== current) {
      if (dir === pending) pendingFrames += 1;
      else {
        pending = dir;
        pendingFrames = 1;
        pendingMs = 0;
      }
      if (pendingFrames >= CONFIRM_FRAMES) {
        // Confirmed: the time since the turn was first seen belongs to it, not to the
        // previous direction (matters on slow devices with long gaps between frames).
        time[current] -= pendingMs;
        time[dir] += pendingMs;
        current = dir;
        seen[dir] += 1;
        pending = null;
        pendingFrames = 0;
        pendingMs = 0;
      }
    } else {
      pending = null;
      pendingFrames = 0;
      pendingMs = 0;
    }
    return dir;
  }

  function trackBlink(points, dir) {
    if (dir !== "center") return; // eye shape is unreliable on a turned head
    const ear = (eyeAspectRatio(points.slice(36, 42)) + eyeAspectRatio(points.slice(42, 48))) / 2;
    if (!Number.isFinite(ear)) return;
    const open = openEyes.length >= 5 ? median(openEyes) : 0.3;
    if (ear < open * 0.7) {
      eyeClosed = true;
      return;
    }
    if (eyeClosed && ear > open * 0.85) blinks += 1;
    eyeClosed = false;
    openEyes.push(ear);
    if (openEyes.length > 30) openEyes.shift();
  }

  /**
   * One analysed frame. Returns { warning } ("multiple" | "none" | null) for the
   * on-screen messages, and the direction seen in this frame.
   */
  function update(faces, now = Date.now()) {
    frames += 1;
    const dt = lastAt == null ? 0 : Math.min(Math.max(now - lastAt, 0), MAX_FRAME_GAP_MS);
    lastAt = now;
    const list = Array.isArray(faces) ? faces : [];
    const confident = list.filter((f) => f.score == null || f.score >= CONFIDENT_FACE);

    if (!list.length) {
      if (lostSince == null) lostSince = now;
      addTime(dt, now);
      return { warning: "none", direction: null };
    }
    addTime(dt, now);
    lostSince = null;

    // The student is the largest face; others are only used for the warning.
    const face = list.reduce((a, b) => (area(b) > area(a) ? b : a), list[0]);
    const expr = normaliseExpressions(face.expressions);
    const total = Object.values(expr).reduce((s, v) => s + v, 0) || 1;
    EMOTIONS.forEach((k) => {
      if ((expr[k] || 0) / total >= MIN_EXPRESSION) counts[k] += 1;
    });

    let direction = null;
    if (face.points && face.points.length === 68) {
      direction = trackDirection(yawRatio(face.points));
      trackBlink(face.points, direction);
    }
    return { warning: confident.length > 1 ? "multiple" : null, direction };
  }

  /** Summary stored with the interview; null when no frame was analysed. */
  function summary() {
    if (!frames) return null;
    const totalExpr = Object.values(counts).reduce((s, v) => s + v, 0) || 1;
    const sec = (ms) => Math.round(ms / 1000);
    return {
      seen_left: seen.left,
      seen_right: seen.right,
      seen_center: seen.center,
      blinks,
      time_straight: sec(time.center),
      time_left: sec(time.left),
      time_right: sec(time.right),
      time_away: sec(time.away),
      emotions: Object.fromEntries(EMOTIONS.map((k) => [k, Number(((counts[k] / totalExpr) * 100).toFixed(2))])),
    };
  }

  return { update, summary, _state: () => ({ straight, current }) };
}
