const env = require("../config/env");
// Human-readable status for interview lists (admin), combining schedule and evaluation state.
function listStatus(row, now = Date.now()) {
  const ev = row.evaluation_status;
  if (row.status === 0 || ev === "completed") return "Attempted";
  if (ev === "failed") return "Evaluation failed";
  if (ev === "pending" || ev === "processing") return row.evaluation_waiting_for_ai ? "Waiting for AI" : "Evaluating";
  if (row.attempt && row.attempt.started_at) return "In progress";
  if (new Date(row.start_date_time).getTime() < now - env.startGraceMinutes * 60000) return "Expired";
  return "Upcoming";
}

const EMOTION_NAMES = ["neutral", "happy", "sad", "angry", "surprise", "fear", "disgust"];

// Short camera summary for admin lists, from the face-tracking totals saved at submit:
// share of time looking at the screen, the most frequent expression, and look-aways.
// null when the camera recorded nothing (camera off, or interviews from before it was used).
function cameraSummary(e) {
  const src = Array.isArray(e) ? e[0] : e;
  if (!src || typeof src !== "object") return null;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const em = src.emotions || {};
  const [mood, moodPct] = EMOTION_NAMES.map((k) => [k, num(em[k])]).sort((a, b) => b[1] - a[1])[0];
  const straight = num(src.time_straight);
  const total = straight + num(src.time_left) + num(src.time_right) + num(src.time_away);
  if (!moodPct && !total) return null;
  return {
    attention: total ? Math.round((straight / total) * 100) : null,
    mood: moodPct ? mood : null,
    mood_pct: moodPct ? Math.round(moodPct) : null,
    looked_away: num(src.seen_left) + num(src.seen_right),
    blinks: num(src.blinks),
  };
}

// Applies listStatus and removes internal fields from list rows.
const decorate = (rows) =>
  rows.map((r) => {
    const out = { ...r, interview_status: listStatus(r) };
    out.provisional = r.evaluation_mode === "provisional";
    out.evaluation_error =
      r.evaluation_status === "failed" || r.evaluation_waiting_for_ai || out.provisional ? r.evaluation_error || null : null;
    out.camera = cameraSummary(r.emotions);
    delete out.attempt;
    delete out.emotions;
    return out;
  });

module.exports = { listStatus, decorate, cameraSummary };
