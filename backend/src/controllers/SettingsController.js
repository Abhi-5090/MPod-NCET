const env = require("../config/env");
const ai = require("../services/ai");
const aiSettings = require("../services/aiSettings");
const aiStatus = require("../services/aiStatus");
const { asyncHandler, badRequest } = require("../lib/http");

// Whether a provider has the settings it needs in backend/.env (keys are never returned).
const configured = (name) => (name === "openai" ? Boolean(env.ai.openai.apiKey) : Boolean(env.ai.dgx.configured));

const NOT_CONFIGURED = {
  openai: "OpenAI is not set up on the server: add OPENAI_API_KEY to backend/.env and restart the backend.",
  dgx: "The DGX Spark is not set up on the server: add DGX_BASE_URL (and DGX_API_KEY) to backend/.env and restart the backend.",
};

function view() {
  const inUse = ai.chain();
  return {
    provider: inUse[0], // serving every AI request now
    backup: inUse[1] || null, // only when the choice comes from backend/.env
    chosen: aiSettings.choice(), // null: never chosen in the admin portal
    env_default: { provider: env.ai.provider, fallback: env.ai.fallback },
    providers: aiSettings.PROVIDERS.map((name) => {
      const p = ai.providers[name];
      const d = p.describe();
      return {
        name,
        label: name === "dgx" ? "DGX Spark" : "OpenAI",
        engine: p.label, // e.g. "Ollama" on the DGX Spark
        configured: configured(name),
        endpoint: d.endpoint,
        models: d.models,
        status: aiStatus.providerState(name),
      };
    }),
  };
}

const validProvider = (body) => {
  const provider = String((body && body.provider) || "").trim().toLowerCase();
  if (!aiSettings.PROVIDERS.includes(provider)) throw badRequest('Choose "dgx" (DGX Spark) or "openai" (OpenAI).');
  return provider;
};

/** GET /api/settings/ai-model : the provider in use, both providers and their status. */
const getAiModel = asyncHandler(async (req, res) => {
  await aiSettings.reload();
  res.json(view());
});

/** PUT /api/settings/ai-model { provider }: every AI request goes to this provider from now on. */
const setAiModel = asyncHandler(async (req, res) => {
  const provider = validProvider(req.body);
  if (!configured(provider)) throw badRequest(NOT_CONFIGURED[provider]);
  await aiSettings.set(provider, req.auth.user);
  if (!env.isTest) console.log(`[ai] ${req.auth.user.roll_no} switched AI requests to ${provider}`);
  // Check the new provider now so the page (and the admin banner) show its real state.
  await aiStatus.checkProvider(provider).catch(() => {});
  res.json(view());
});

/** POST /api/settings/ai-model/test { provider }: checks that a provider answers. */
const testAiModel = asyncHandler(async (req, res) => {
  const provider = validProvider(req.body);
  if (!configured(provider)) throw badRequest(NOT_CONFIGURED[provider]);
  const status = await aiStatus.checkProvider(provider);
  res.json({ provider, status });
});

module.exports = { getAiModel, setAiModel, testAiModel };
