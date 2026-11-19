const mongoose = require("mongoose");
const { startDb, stopDb, clearDb, installFakeLlm, llmCalls } = require("./helpers");
const evaluation = require("../src/services/evaluation");
const { _internals } = require("../src/services/interviewSession");
const Technology = require("../src/models/technology");
const Module = require("../src/models/module");
const Topic = require("../src/models/topic");
const Question = require("../src/models/liteInterviewQuestion");
const { SUBJECTS, seed } = require("../scripts/seed-subjects");

const isAiCall = (c) => c.messages[0].content.includes("You write interview questions");

beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => {
  await clearDb();
  installFakeLlm();
  llmCalls.length = 0;
});

async function moduleOf(subject, name) {
  const tech = await Technology.findOne({ technology_name: subject }).lean();
  const mod = await Module.findOne({ technology: tech._id, module_name: name }).lean();
  return { tech, mod };
}

describe("subject question sets (seed:subjects)", () => {
  it("has 15 questions per subject, each with an answer", () => {
    for (const s of SUBJECTS) {
      const qs = s.modules.flatMap((m) => m.questions);
      expect(qs).toHaveLength(15);
      qs.forEach(([q, a]) => expect(q.trim() && a.trim()).toBeTruthy());
      expect(new Set(qs.map(([q]) => q)).size).toBe(15);
    }
  });

  it("creates subjects, modules, topics and 45 questions; running again adds nothing", async () => {
    const first = await seed();
    expect(first).toMatchObject({ technologies: 3, modules: 4, topics: 8, added: 45 });
    const again = await seed();
    expect(again).toMatchObject({ technologies: 0, modules: 0, topics: 0, added: 0, updated: 0 });
    expect(await Technology.countDocuments()).toBe(3);
    expect(await Question.countDocuments()).toBe(45);
    expect(await Question.countDocuments({ module: { $ne: null } })).toBe(45);
  });

  it("reuses an existing Maths subject instead of duplicating it", async () => {
    const maths = await Technology.create({ technology_name: "maths", technology_category: "nocode" });
    await Module.create({ technology: maths._id, module_name: "Additions" });
    await seed();
    expect(await Technology.countDocuments({ technology_name: /^maths$/i })).toBe(1);
    expect(await Module.countDocuments({ technology: maths._id })).toBe(3);
  });

  it("an interview on Physics > Units asks exactly those questions, without the AI", async () => {
    await seed();
    const { tech, mod } = await moduleOf("Physics", "Units and Measurements");
    const qs = await _internals.buildQuestions("ai generated", { technology: tech._id, module: [mod._id], topic: [], level: "Beginner", questions_count: "15" });
    expect(qs).toHaveLength(15);
    expect(qs.map((q) => q.qid)).toEqual(Array.from({ length: 15 }, (_, i) => `q${i + 1}`));
    expect(qs.every((q) => q.source === "bank" && q.reference)).toBe(true);
    const physics = new Set(SUBJECTS[0].modules[0].questions.map(([q]) => q));
    expect(qs.every((q) => physics.has(q.question))).toBe(true);
    expect(llmCalls.filter(isAiCall)).toHaveLength(0);
  });

  it("asks a random subset when fewer questions are scheduled", async () => {
    await seed();
    const { tech, mod } = await moduleOf("Chemistry", "Chemical Formulas");
    const qs = await _internals.buildQuestions("ai generated", { technology: tech._id, module: [mod._id], level: "Beginner", questions_count: "5" });
    expect(qs).toHaveLength(5);
    expect(new Set(qs.map((q) => q.question)).size).toBe(5);
  });

  it("only the selected Maths section is asked", async () => {
    await seed();
    const { tech, mod } = await moduleOf("Maths", "Equations and Evaluation");
    const qs = await _internals.buildQuestions("ai generated", { technology: tech._id, module: [mod._id], level: "Beginner", questions_count: "8" });
    const evalQs = new Set(SUBJECTS[2].modules[1].questions.map(([q]) => q));
    expect(qs.every((q) => evalQs.has(q.question))).toBe(true);
  });

  it("asking for more questions than the set has tops up with AI questions", async () => {
    await seed();
    const { tech, mod } = await moduleOf("Maths", "Algebraic Formulas"); // 7 questions
    const qs = await _internals.buildQuestions("ai generated", { technology: tech._id, module: [mod._id], level: "Beginner", questions_count: "10" });
    expect(qs).toHaveLength(10);
    expect(qs.filter((q) => q.source === "bank")).toHaveLength(7);
    expect(qs.filter((q) => q.source === "ai")).toHaveLength(3);
  });

  it("modules without a question set still use the AI", async () => {
    const tech = await Technology.create({ technology_name: "Java", technology_category: "highcode" });
    const mod = await Module.create({ technology: tech._id, module_name: "OOP" });
    await Topic.create({ technology: tech._id, module: mod._id, topic_name: "Inheritance" });
    await Question.create({ technology: tech._id, question: "What is inheritance?", answer: "x", status: 1 }); // general, no module
    const qs = await _internals.buildQuestions("ai generated", { technology: tech._id, module: [mod._id], level: "Beginner", questions_count: "3" });
    expect(qs.every((q) => q.source === "ai")).toBe(true);
    expect(llmCalls.filter(isAiCall)).toHaveLength(1);
  });

  it("scoring sends the expected answer to the AI", async () => {
    await evaluation.evaluateVerbalInterview([{ question: "Evaluate 3 × 4 × 7 × 6 × 5.", answer: "2520", time: 5, reference: "2520" }]);
    const scoring = llmCalls.find((c) => c.messages[0].content.includes("evaluator of technical interview answers"));
    expect(scoring.messages[1].content).toContain('Expected answer: "2520"');
    expect(scoring.messages[0].content).toContain("short factual questions");
  });

  it("other sections' questions are not used by the fallback when the AI is down", async () => {
    await seed();
    const { tech } = await moduleOf("Maths", "Algebraic Formulas");
    const additions = await Module.create({ technology: tech._id, module_name: "Additions" });
    evaluation._setClient({ chat: { completions: { create: async () => { throw Object.assign(new Error("down"), { status: 503 }); } } } });
    const qs = await _internals.buildQuestions("ai generated", { technology: tech._id, module: [additions._id], level: "Beginner", questions_count: "4" });
    const seeded = new Set(SUBJECTS[2].modules.flatMap((m) => m.questions.map(([q]) => q)));
    expect(qs.length).toBe(4);
    expect(qs.some((q) => seeded.has(q.question))).toBe(false);
    expect(mongoose.connection.readyState).toBe(1);
  });
});
