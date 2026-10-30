// Ollama as the primary provider from OLLAMA_URL / OLLAMA_MODEL (the names used by
// ollama_client.py), OpenAI as backup, and choosing an installed model.
const ollama = require("../src/services/ai/providers/ollama");

// Loads config/env.js with a clean set of AI variables.
function loadEnv(vars) {
  const keys = Object.keys(process.env).filter((k) => /^(AI_|OLLAMA_|DGX_|OPENAI_)/.test(k));
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  keys.forEach((k) => {
    process.env[k] = ""; // empty = unset (dotenv won't refill it from backend/.env)
  });
  Object.assign(process.env, vars);
  let env;
  jest.isolateModules(() => {
    env = require("../src/config/env");
  });
  keys.forEach((k) => {
    process.env[k] = saved[k];
  });
  Object.keys(vars).forEach((k) => {
    if (!(k in saved)) delete process.env[k];
  });
  return env;
}

describe("configuration from OLLAMA_URL and OLLAMA_MODEL", () => {
  test("Ollama is primary, every task uses OLLAMA_MODEL, and OpenAI is the backup when a key exists", () => {
    const env = loadEnv({ OLLAMA_URL: "http://127.0.0.1:7002", OLLAMA_MODEL: "llama3.1:8b", OPENAI_API_KEY: "sk-test" });
    expect(env.ai.provider).toBe("dgx");
    expect(env.ai.fallback).toBe("openai");
    expect(env.ai.dgx.baseURL).toBe("http://127.0.0.1:7002");
    expect(env.ai.dgx.label).toBe("Ollama");
    expect(env.ai.dgx.models).toEqual({ scoring: "llama3.1:8b", generation: "llama3.1:8b", summary: "llama3.1:8b", coding: "llama3.1:8b" });
    expect(env.ai.dgx.defaultModel).toBe("llama3.1:8b");
  });

  test("without an OpenAI key there is no backup; per-task models win over OLLAMA_MODEL", () => {
    const env = loadEnv({ OLLAMA_URL: "http://127.0.0.1:7002", OLLAMA_MODEL: "llama3.1:8b", OLLAMA_CODING_MODEL: "qwen2.5-coder:7b" });
    expect(env.ai.fallback).toBe("none");
    expect(env.ai.dgx.models.coding).toBe("qwen2.5-coder:7b");
    expect(env.ai.dgx.models.scoring).toBe("llama3.1:8b");
  });

  test("explicit AI_PROVIDER / AI_FALLBACK_PROVIDER always win", () => {
    const env = loadEnv({ OLLAMA_URL: "http://127.0.0.1:7002", OPENAI_API_KEY: "sk-test", AI_PROVIDER: "openai", AI_FALLBACK_PROVIDER: "none" });
    expect(env.ai.provider).toBe("openai");
    expect(env.ai.fallback).toBe("none");
  });

  test("without any Ollama address OpenAI stays the provider", () => {
    const env = loadEnv({ OPENAI_API_KEY: "sk-test" });
    expect(env.ai.provider).toBe("openai");
    expect(env.ai.fallback).toBe("none");
  });
});

describe("choosing an installed model", () => {
  const jsonRes = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
  function server(installed) {
    const chats = [];
    const fetchImpl = async (url, init) => {
      const body = init.body ? JSON.parse(init.body) : undefined;
      if (url.endsWith("/api/tags")) return jsonRes(200, { models: installed.map((name) => ({ name })) });
      if (url.endsWith("/api/show")) {
        return installed.includes(body.model) ? jsonRes(200, { capabilities: ["completion"] }) : jsonRes(404, { error: "not found" });
      }
      if (url.endsWith("/api/chat")) {
        chats.push(body.model);
        if (!installed.includes(body.model)) return jsonRes(404, { error: `model "${body.model}" not found, try pulling it first` });
        return jsonRes(200, { message: { content: '{"accuracy": 70}' }, done_reason: "stop" });
      }
      return jsonRes(404, {});
    };
    return { fetchImpl, chats };
  }
  const cfg = (over) => ({
    baseURL: "http://127.0.0.1:7002",
    timeoutMs: 5000,
    interactiveTimeoutMs: 5000,
    numCtx: 4096,
    keepAlive: "-1",
    think: "auto",
    reasoningTokens: 0,
    models: { scoring: "llama3.1:8b" },
    defaultModel: "llama3.1:8b",
    ...over,
  });
  const ask = (p, model) => p.chat({ model, system: "s", user: "u", maxTokens: 10, temperature: 0 });

  test("a configured model that is installed is used as is, and the answer says which model replied", async () => {
    const s = server(["llama3.1:8b"]);
    const out = await ask(ollama.create(cfg(), { fetchImpl: s.fetchImpl }), "llama3.1:8b");
    expect(out.model).toBe("llama3.1:8b");
    expect(s.chats).toEqual(["llama3.1:8b"]);
  });

  test("a name without a tag matches the installed tag", async () => {
    const s = server(["llama3.1:8b"]);
    const out = await ask(ollama.create(cfg(), { fetchImpl: s.fetchImpl }), "llama3.1");
    expect(out.model).toBe("llama3.1:8b");
  });

  test("a task model that isn't installed falls back to OLLAMA_MODEL", async () => {
    const s = server(["llama3.1:8b"]);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const out = await ask(ollama.create(cfg(), { fetchImpl: s.fetchImpl }), "qwen3-coder:30b");
    expect(out.model).toBe("llama3.1:8b");
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/qwen3-coder:30b" is not installed; using "llama3.1:8b"/));
    warn.mockRestore();
  });

  test("a tagged name never silently switches to a different size of the same model", async () => {
    const s = server(["llama3.1:70b"]);
    const err = await ask(ollama.create(cfg({ defaultModel: null }), { fetchImpl: s.fetchImpl }), "llama3.1:8b").catch((e) => e);
    expect(err.reason).toBe("model_missing");
    expect(s.chats).toEqual([]); // detected before any chat request; the 70b model is never used
  });

  test("when nothing usable is installed the model is reported missing (so OpenAI takes over)", async () => {
    const s = server([]);
    const err = await ask(ollama.create(cfg(), { fetchImpl: s.fetchImpl }), "llama3.1:8b").catch((e) => e);
    expect(err).toMatchObject({ reason: "model_missing", outage: true });
  });

  test("an unreachable server fails immediately, without waiting for the chat timeout", async () => {
    const fetchImpl = async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    };
    const started = Date.now();
    const err = await ollama.create(cfg(), { fetchImpl }).chat({ model: "llama3.1:8b", system: "s", user: "u", maxTokens: 5, interactive: true }).catch((e) => e);
    expect(err).toMatchObject({ reason: "network", outage: true });
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
