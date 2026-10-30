// Business-logic fixes from the full-application review.
const { app, request, startDb, stopDb, clearDb, seed, loginAs, makeUser, installFakeLlm } = require("./helpers");
const Interview = require("../src/models/interview");
const CodingInterview = require("../src/models/codingInterview");
const Tenant = require("../src/models/tenant");

let s;
beforeAll(async () => {
  await startDb();
  installFakeLlm();
});
afterAll(stopDb);
beforeEach(async () => {
  await clearDb();
  s = await seed();
});

const minutes = (m) => new Date(Date.now() + m * 60000);
const techFields = () => ({ platform: "web", technology: s.tech._id, module: [s.mod._id], topic: [s.topic._id], level: "easy", questions_count: "2" });

describe("dashboards count each interview for its own college", () => {
  test("same roll number in two colleges is not double counted; submitted-but-scoring counts as attempted", async () => {
    // College B student with the SAME roll number as a college A student
    await makeUser({ roll_no: s.studentA.roll_no, role: "student", tenant_id: s.tenantB._id, email: "dup@b.com" });
    await Interview.create({ ...techFields(), roll_no: s.studentA.roll_no, tenant_id: s.tenantA._id, start_date_time: minutes(-60), status: 0 });
    // submitted, evaluation still pending
    await Interview.create({ ...techFields(), roll_no: s.studentA.roll_no, tenant_id: s.tenantA._id, start_date_time: minutes(-30), status: 1, submitted_at: new Date(), evaluation_status: "pending" });
    await Interview.create({ ...techFields(), roll_no: s.studentA.roll_no, tenant_id: s.tenantA._id, start_date_time: minutes(60), status: 1 });
    // legacy interview without tenant_id for an unambiguous student of college A
    await Interview.create({ ...techFields(), roll_no: s.studentA2.roll_no, start_date_time: minutes(-90), status: 0 });

    const a = await loginAs(s.adminA, { admin: true });
    const b = await loginAs(s.adminB, { admin: true });
    const attemptedA = (await a.get(`/backend/api/get-interview-stats/${s.tenantA._id}`)).body;
    const assignedA = (await a.get(`/backend/api/get-assigned-interview-stats/${s.tenantA._id}`)).body;
    const attemptedB = (await b.get(`/backend/api/get-interview-stats/${s.tenantB._id}`)).body;
    expect(attemptedA.technologyInterviews).toBe(3); // 2 scored + 1 still being scored
    expect(assignedA.technologyInterviews).toBe(4);
    expect(attemptedB.technologyInterviews).toBe(0); // college B's same-roll student took nothing
  });

  test("student totals exclude staff and deactivated accounts and include other genders", async () => {
    await makeUser({ roll_no: "X1", role: "student", tenant_id: s.tenantA._id, gender: "Male" });
    await makeUser({ roll_no: "X2", role: "student", tenant_id: s.tenantA._id, gender: "" });
    await makeUser({ roll_no: "X3", role: "student", tenant_id: s.tenantA._id, gender: "female", status: 0 });
    const a = await loginAs(s.adminA, { admin: true });
    const res = await a.get(`/backend/api/get-users-stats/${s.tenantA._id}`);
    // seed has 2 active students in A (no gender) + X1 + X2
    expect(res.body).toMatchObject({ male: 1, female: 0, total: 4 });
  });
});

describe("credits for no-shows and scheduling races", () => {
  test("deleting an expired, never-started interview gives no refund; an upcoming one is refunded", async () => {
    const a = await loginAs(s.adminA, { admin: true });
    const expired = await Interview.create({ ...techFields(), roll_no: s.studentA.roll_no, tenant_id: s.tenantA._id, start_date_time: minutes(-60), status: 1 });
    const del1 = await a.delete(`/backend/api/delete-interviewee-details/${expired._id}`);
    expect(del1.status).toBe(200);
    expect(del1.body.refunded).toBe(false);

    const sched = await a.post("/backend/api/add-interviewee-details").send({ ...techFields(), roll_no: s.studentA.roll_no, start_date_time: minutes(120).toISOString(), tenant_id: String(s.tenantA._id) });
    expect(sched.status).toBe(201);
    const id = sched.body.data?._id || sched.body._id || (await Interview.findOne({ start_date_time: { $gt: new Date() } }))._id;
    const del2 = await a.delete(`/backend/api/delete-interviewee-details/${id}`);
    expect(del2.body.refunded).toBe(true);
  });

  test("questions that failed to prepare (our fault) are still refunded after the start window", async () => {
    const a = await loginAs(s.adminA, { admin: true });
    const iv = await Interview.create({ ...techFields(), roll_no: s.studentA.roll_no, tenant_id: s.tenantA._id, start_date_time: minutes(-60), status: 1, attempt: { generation_failed_at: minutes(-55) } });
    const del = await a.delete(`/backend/api/delete-interviewee-details/${iv._id}`);
    expect(del.body.refunded).toBe(true);
  });

  test("an expired interview cannot be moved to a new time (that would reuse its credit)", async () => {
    const a = await loginAs(s.adminA, { admin: true });
    const iv = await Interview.create({ ...techFields(), roll_no: s.studentA.roll_no, tenant_id: s.tenantA._id, start_date_time: minutes(-60), status: 1 });
    const res = await a.put(`/backend/api/edit-interviewee-details/${iv._id}`).send({ start_date_time: minutes(120).toISOString() });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EXPIRED");
  });

  test("two simultaneous schedules for the same student and time create one interview and charge one credit", async () => {
    const a = await loginAs(s.adminA, { admin: true });
    const before = (await Tenant.findById(s.tenantA._id)).active_credits;
    const body = { ...techFields(), roll_no: s.studentA.roll_no, start_date_time: minutes(120).toISOString(), tenant_id: String(s.tenantA._id) };
    const results = await Promise.all([1, 2, 3].map(() => a.post("/backend/api/add-interviewee-details").send(body)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 400 && r.body.code === "ALREADY_SCHEDULED")).toHaveLength(2);
    expect(await Interview.countDocuments({ roll_no: s.studentA.roll_no })).toBe(1);
    expect((await Tenant.findById(s.tenantA._id)).active_credits).toBe(before - 1);
  });

  test("a student in another college with the same roll number is not blocked by the overlap rule", async () => {
    await makeUser({ roll_no: s.studentA.roll_no, role: "student", tenant_id: s.tenantB._id, email: "dup2@b.com" });
    const start = minutes(120);
    await Interview.create({ ...techFields(), roll_no: s.studentA.roll_no, tenant_id: s.tenantA._id, start_date_time: start, status: 1 });
    const b = await loginAs(s.adminB, { admin: true });
    const res = await b.post("/backend/api/add-interviewee-details").send({ ...techFields(), roll_no: s.studentA.roll_no, start_date_time: start.toISOString(), tenant_id: String(s.tenantB._id) });
    expect(res.status).toBe(201);
  });
});

describe("coding level any", () => {
  test("a coding interview at level 'any' can be started", async () => {
    const iv = await CodingInterview.create({ platform: "web", roll_no: s.studentA.roll_no, tenant_id: s.tenantA._id, start_date_time: minutes(-1), level: "any", questions_count: "1", status: 1 });
    const agent = await loginAs(s.studentA);
    const st = await agent.post("/backend/api/interview-session/start").send({ interview_id: String(iv._id), interview_type: "coding" });
    expect(st.status).toBe(200);
    expect(st.body.questions).toHaveLength(1);
  });
});

describe("interview engine fixes", () => {
  const { PASSWORD } = require("./helpers");
  const kioskFor = async (name) => {
    const k = request.agent(app);
    const reg = await k.post("/backend/api/kiosk/register").send({ roll_no: s.adminA.roll_no, password: PASSWORD, device_name: name });
    expect(reg.status).toBe(201);
    return k;
  };
  const mpodInterview = () =>
    Interview.create({ ...techFields(), platform: "mpod", roll_no: s.studentA.roll_no, tenant_id: s.tenantA._id, start_date_time: minutes(-1), status: 1 });

  test("an attempt started on one kiosk can't be taken over from another kiosk", async () => {
    const iv = await mpodInterview();
    const k1 = await kioskFor("Lab 1");
    const k2 = await kioskFor("Lab 2");
    const start = await k1.post("/backend/api/kiosk/start").send({ interview_id: String(iv._id), interview_type: "ai generated" });
    expect(start.status).toBe(200);
    // the second kiosk doesn't even see it, and can't start it directly
    expect((await k2.post("/backend/api/kiosk/interview").send({ roll_no: s.studentA.roll_no })).status).toBe(404);
    const steal = await k2.post("/backend/api/kiosk/start").send({ interview_id: String(iv._id), interview_type: "ai generated" });
    expect(steal.status).toBe(409);
    expect(steal.body.code).toBe("OTHER_DEVICE");
    // the first kiosk's session still works
    const save = await request(app).post("/backend/api/interview-session/answer").set("X-Attempt-Token", start.body.attempt_token)
      .send({ interview_id: String(iv._id), interview_type: "ai generated", question_id: start.body.questions[0].id, answer: "x" });
    expect(save.status).toBe(200);
  });

  test("a blank final save keeps the text an earlier autosave stored", async () => {
    const iv = await Interview.create({ ...techFields(), roll_no: s.studentA.roll_no, tenant_id: s.tenantA._id, start_date_time: minutes(-1), status: 1 });
    const agent = await loginAs(s.studentA);
    const st = await agent.post("/backend/api/interview-session/start").send({ interview_id: String(iv._id), interview_type: "ai generated" });
    const send = (fields) => request(app).post("/backend/api/interview-session/answer").set("X-Attempt-Token", st.body.attempt_token)
      .send({ interview_id: String(iv._id), interview_type: "ai generated", question_id: st.body.questions[0].id, ...fields });
    await send({ answer: "Inheritance lets a class reuse another class", time: 40 });
    await send({ answer: "", time: 60, final: true });
    const a = (await Interview.findById(iv._id).lean()).answers.find((x) => x.qid === st.body.questions[0].id);
    expect(a).toMatchObject({ answer: "Inheritance lets a class reuse another class", final: true, time: 60 });
  });

  test("an old interview whose roll number exists in two colleges is not given to either kiosk", async () => {
    await makeUser({ roll_no: s.studentA.roll_no, role: "student", tenant_id: s.tenantB._id, email: "dup3@b.com" });
    const iv = await Interview.create({ ...techFields(), platform: "mpod", roll_no: s.studentA.roll_no, start_date_time: minutes(-1), status: 1 }); // no tenant_id
    const k1 = await kioskFor("Lab 1");
    expect((await k1.post("/backend/api/kiosk/start").send({ interview_id: String(iv._id), interview_type: "ai generated" })).status).toBe(404);
  });

  test("deleting is blocked while the student is taking the interview", async () => {
    const iv = await Interview.create({ ...techFields(), roll_no: s.studentA.roll_no, tenant_id: s.tenantA._id, start_date_time: minutes(-1), status: 1 });
    const agent = await loginAs(s.studentA);
    expect((await agent.post("/backend/api/interview-session/start").send({ interview_id: String(iv._id), interview_type: "ai generated" })).status).toBe(200);
    const a = await loginAs(s.adminA, { admin: true });
    const del = await a.delete(`/backend/api/delete-interviewee-details/${iv._id}`);
    expect(del.status).toBe(409);
    expect(await Interview.exists({ _id: iv._id })).toBeTruthy();
  });

  test("an impossible date is a clear 400, not a server error", async () => {
    const a = await loginAs(s.adminA, { admin: true });
    const res = await a.get(`/backend/api/get-all-interviewee-details/${s.tenantA._id}?date=2025-02-31`);
    expect(res.status).toBe(400);
  });

  test("student overall accuracy averages only the interview types taken", async () => {
    await Interview.create({ ...techFields(), roll_no: s.studentA.roll_no, tenant_id: s.tenantA._id, start_date_time: minutes(-60), status: 0,
      question_details: [{ given_question: "q", given_answer: "a", accuracy: 80 }] });
    const agent = await loginAs(s.studentA);
    const res = await agent.get(`/backend/api/overall-accuracy/${s.studentA.roll_no}`);
    expect(res.status).toBe(200);
    expect(res.body.overall).toBe(80);
  });
});
