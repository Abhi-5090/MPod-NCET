const request = require("supertest");
const app = require("../src/app");
const keepAlive = require("../src/services/keepAlive");

const ENV_KEYS = ["KEEP_ALIVE", "KEEP_ALIVE_URL", "RENDER_EXTERNAL_URL", "KEEP_ALIVE_MINUTES"];
const saved = {};
const realFetch = global.fetch;

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  jest.restoreAllMocks();
  global.fetch = realFetch;
});

describe("GET /backend/api/ping", () => {
  it("answers without a login or the database", async () => {
    const res = await request(app).get("/backend/api/ping");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("is not rate limited", async () => {
    for (let i = 0; i < 5; i++) {
      // eslint-disable-next-line no-await-in-loop
      expect((await request(app).get("/backend/api/ping")).status).toBe(200);
    }
  });
});

describe("keep-alive settings", () => {
  it("is off without an address (local development)", () => {
    expect(keepAlive.settings().url).toBeNull();
  });

  it("uses Render's own address and pings every 5 minutes by default", () => {
    process.env.RENDER_EXTERNAL_URL = "https://mpod.onrender.com/";
    expect(keepAlive.settings()).toEqual({ url: "https://mpod.onrender.com/backend/api/ping", intervalMs: 5 * 60 * 1000 });
  });

  it("prefers KEEP_ALIVE_URL, accepts another interval, and can be turned off", () => {
    process.env.RENDER_EXTERNAL_URL = "https://mpod.onrender.com";
    process.env.KEEP_ALIVE_URL = "https://api.example.edu";
    process.env.KEEP_ALIVE_MINUTES = "10";
    expect(keepAlive.settings()).toEqual({ url: "https://api.example.edu/backend/api/ping", intervalMs: 10 * 60 * 1000 });
    process.env.KEEP_ALIVE = "false";
    expect(keepAlive.settings().url).toBeNull();
  });

  it("ping reports success and failure without throwing", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce({ ok: false, status: 502 });
    expect(await keepAlive.ping("https://x/backend/api/ping")).toBe(true);
    expect(await keepAlive.ping("https://x/backend/api/ping")).toBe(false);
    expect(await keepAlive.ping("https://x/backend/api/ping")).toBe(false);
  });
});
