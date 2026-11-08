const { startDb, stopDb, clearDb, seed, loginAs } = require("./helpers");
const env = require("../src/config/env");
const ai = require("../src/services/ai");
const aiStatus = require("../src/services/aiStatus");
const aiSettings = require("../src/services/aiSettings");
const { AiError } = require("../src/services/ai/errors");

const URL = "/backend/api/settings/ai-model";

describe("Settings > AI Model Usage", () => {
  const original = { provider: env.ai.provider, fallback: env.ai.fallback, configured: env.ai.dgx.configured, dgx: ai.providers.dgx };
  const calls = { dgx: 0, openai: 0 };
  let dgxDown = false;
  let s;

  // Stand-ins for both providers: count the calls each one receives.
  const fakeDgx = {
    ...original.dgx,
    chat: async ({ model }) => {
      calls.dgx += 1;
      if (dgxDown) throw new AiError("Cannot reach Ollama.", { provider: "dgx", reason: "network" });
      return { content: JSON.stringify({ accuracy: 80 }), usage: {}, model };
    },
    health: async () => {
      if (dgxDown) throw new AiError("Cannot reach Ollama.", { provider: "dgx", reason: "network" });
      return {};
    },
  };
  const ask = () => ai.chatJson("generation", { system: "s", user: "u" });

  beforeAll(startDb);
  afterAll(async () => {
    Object.assign(env.ai, { provider: original.provider, fallback: original.fallback });
    env.ai.dgx.configured = original.configured;
    ai.providers.dgx = original.dgx;
    aiSettings._reset();
    aiStatus._reset();
    await stopDb();
  });
  beforeEach(async () => {
    await clearDb();
    s = await seed();
    aiSettings._reset();
    aiStatus._reset();
    // backend/.env says: DGX Spark first, OpenAI as the backup.
    Object.assign(env.ai, { provider: "dgx", fallback: "openai" });
    env.ai.dgx.configured = true;
    ai.providers.dgx = fakeDgx;
    ai.providers.openai._setClient({
      chat: {
        completions: {
          create: async () => {
            calls.openai += 1;
            return { choices: [{ message: { content: JSON.stringify({ accuracy: 55 }) }, finish_reason: "stop" }], usage: {} };
          },
        },
      },
    });
    calls.dgx = 0;
    calls.openai = 0;
    dgxDown = false;
  });

  test("only platform admins can see or change it", async () => {
    const college = await loginAs(s.adminA, { admin: true });
    expect((await college.get(URL)).status).toBe(403);
    expect((await college.put(URL).send({ provider: "openai" })).status).toBe(403);
    expect(aiSettings.current()).toBeNull();
  });

  test("shows the provider in use and both providers before anything is chosen", async () => {
    const agent = await loginAs(s.platform, { admin: true });
    const res = await agent.get(URL);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ provider: "dgx", backup: "openai", chosen: null });
    expect(res.body.providers.map((p) => [p.name, p.label, p.configured])).toEqual([
      ["dgx", "DGX Spark", true],
      ["openai", "OpenAI", true],
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/apiKey|"test"/); // no keys
  });

  test("choosing OpenAI sends every request to OpenAI only, straight away", async () => {
    const agent = await loginAs(s.platform, { admin: true });
    const res = await agent.put(URL).send({ provider: "openai" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ provider: "openai", backup: null, chosen: { provider: "openai", updated_by_name: "Plat" } });
    expect(ai.chain()).toEqual(["openai"]);
    Object.assign(calls, { dgx: 0, openai: 0 }); // saving health-checks the provider; count only the request
    expect((await ask()).accuracy).toBe(55);
    expect(calls).toEqual({ dgx: 0, openai: 1 });
  });

  test("choosing the DGX Spark uses it only: no switch to OpenAI when it is down", async () => {
    const agent = await loginAs(s.platform, { admin: true });
    await agent.put(URL).send({ provider: "openai" });
    expect((await agent.put(URL).send({ provider: "dgx" })).body.provider).toBe("dgx");
    Object.assign(calls, { dgx: 0, openai: 0 });
    expect((await ask()).accuracy).toBe(80);
    dgxDown = true;
    const err = await ask().catch((e) => e);
    expect(err.reason).toBe("network");
    expect(calls.openai).toBe(0);
    expect(aiStatus.getStatus()).toMatchObject({ provider: "dgx", available: false, fallback: null });
  });

  test("the choice is saved: another server (or a restart) picks it up from the database", async () => {
    const agent = await loginAs(s.platform, { admin: true });
    await agent.put(URL).send({ provider: "openai" });
    aiSettings._reset(); // a server that has not seen the change yet
    expect(ai.chain()).toEqual(["dgx", "openai"]);
    await aiSettings.reload();
    expect(ai.chain()).toEqual(["openai"]);
  });

  test("rejects unknown and unconfigured providers", async () => {
    const agent = await loginAs(s.platform, { admin: true });
    expect((await agent.put(URL).send({ provider: "regex" })).status).toBe(400);
    env.ai.dgx.configured = false;
    const res = await agent.put(URL).send({ provider: "dgx" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/DGX_BASE_URL/);
    expect(aiSettings.current()).toBeNull();
  });

  test("test button checks one provider and reports its state", async () => {
    const agent = await loginAs(s.platform, { admin: true });
    expect((await agent.post(`${URL}/test`).send({ provider: "dgx" })).body.status).toMatchObject({ name: "dgx", ok: true });
    dgxDown = true;
    const res = await agent.post(`${URL}/test`).send({ provider: "dgx" });
    expect(res.body.status).toMatchObject({ ok: false, reason: "network", message: "Cannot reach Ollama." });
  });
});
