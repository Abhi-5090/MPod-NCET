// The AI provider chosen in the admin portal (Settings > AI Model Usage).
//
// When an admin has chosen one, every AI request (questions, scoring, summaries,
// coding) goes to that provider only. Until then AI_PROVIDER / AI_FALLBACK_PROVIDER
// in backend/.env decide. The choice is stored in the database and re-read every few
// seconds, so a change reaches every running backend without a restart.
const mongoose = require("mongoose");
const env = require("../config/env");
const Setting = require("../models/setting");

const KEY = "ai_provider";
const PROVIDERS = ["dgx", "openai"];
const RELOAD_MS = 10 * 1000;

let chosen = null; // { provider, updated_at, updated_by_name } | null
let timer = null;

const valid = (p) => PROVIDERS.includes(p);

/** The admin's provider ("dgx" | "openai"), or null when backend/.env decides. */
const current = () => (chosen ? chosen.provider : null);

/** The stored choice with who changed it and when (null when never chosen). */
const choice = () => (chosen ? { ...chosen } : null);

function apply(doc) {
  const before = current();
  chosen =
    doc && valid(doc.value)
      ? { provider: doc.value, updated_at: doc.updatedAt || null, updated_by_name: doc.updated_by_name || null }
      : null;
  if (before !== current()) {
    if (!env.isTest) console.log(`[ai] provider chosen in the admin portal: ${current() || "none (backend/.env decides)"}`);
    require("./aiStatus").recheckNow(); // lazy: aiStatus requires the AI gateway, which requires this
  }
}

/** Re-reads the choice from the database (keeps the last known value if it can't). */
async function reload() {
  if (mongoose.connection.readyState !== 1) return current();
  try {
    apply(await Setting.findOne({ key: KEY }).lean());
  } catch (err) {
    if (!env.isTest) console.warn(`[ai] could not read the AI provider setting: ${err.message}`);
  }
  return current();
}

/** Saves an admin's choice; takes effect for the next AI request. */
async function set(provider, user) {
  if (!valid(provider)) throw new Error(`Unknown AI provider "${provider}".`);
  const doc = await Setting.findOneAndUpdate(
    { key: KEY },
    { $set: { value: provider, updated_by: user ? user._id : undefined, updated_by_name: user ? user.first_name || user.roll_no : undefined } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  apply(doc);
  return choice();
}

async function start() {
  await reload();
  if (timer) return;
  timer = setInterval(() => reload().catch(() => {}), RELOAD_MS);
  timer.unref();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Test helper: forget the choice held in memory. */
const _reset = () => {
  chosen = null;
};

module.exports = { PROVIDERS, current, choice, reload, set, start, stop, _reset };
