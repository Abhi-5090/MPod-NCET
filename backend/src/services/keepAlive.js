// Keeps the backend awake on hosts that put idle services to sleep (Render's free plan
// sleeps after 15 minutes without incoming requests, which also stops background scoring).
//
// Every KEEP_ALIVE_MINUTES (default 5) the server calls its own public address at
// /backend/api/ping. The request goes out through the internet and back in through the
// host's front door, so it counts as incoming traffic.
//
// Address: KEEP_ALIVE_URL, or RENDER_EXTERNAL_URL, which Render sets by itself
// (e.g. https://mpod.onrender.com). With neither, or KEEP_ALIVE=false, it does nothing,
// so local development is unaffected.
const env = require("../config/env");

const PATH = "/backend/api/ping";
const TIMEOUT_MS = 30 * 1000;

let timer = null;
let failures = 0;

function settings() {
  const enabled = String(process.env.KEEP_ALIVE || "true").trim().toLowerCase() !== "false";
  const base = String(process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL || "").trim().replace(/\/+$/, "");
  const minutes = Number(process.env.KEEP_ALIVE_MINUTES) || 5;
  return {
    url: enabled && /^https?:\/\//i.test(base) ? base + PATH : null,
    intervalMs: Math.max(1, minutes) * 60 * 1000,
  };
}

async function ping(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "User-Agent": "mpod-keep-alive" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (failures) console.log(`[keep-alive] ${url} answers again.`);
    failures = 0;
    return true;
  } catch (err) {
    failures++;
    // Say it once, then every 12th failure (about once an hour), so the log isn't flooded.
    if (failures === 1 || failures % 12 === 0) {
      console.warn(`[keep-alive] Ping to ${url} failed (${err.message}); ${failures} in a row.`);
    }
    return false;
  }
}

function start() {
  if (timer || env.isTest) return false;
  const { url, intervalMs } = settings();
  if (!url) return false;
  timer = setInterval(() => ping(url), intervalMs);
  timer.unref(); // never keeps the process alive on its own during shutdown
  console.log(`[keep-alive] Pinging ${url} every ${intervalMs / 60000} min.`);
  return true;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, ping, settings, PATH };
