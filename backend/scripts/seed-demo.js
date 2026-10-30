#!/usr/bin/env node
/**
 * Adds a complete set of demo data to the database in backend/.env (e.g. MongoDB Atlas)
 * so every screen has something to show:
 *   - a college ("Demo Engineering College", 200 credits) with a college admin,
 *     placement admin, trainer and 12 students
 *   - technologies, modules and topics; an interview question bank with answers
 *   - companies, tags and company questions; coding problems
 *   - interviews: upcoming, today, completed with reports, and a no-show
 *
 *   node scripts/seed-demo.js --confirm
 *
 * Only adds records (never changes or deletes existing ones) and stops if the demo college
 * already exists. Interviews are scheduled through the real scheduling code, so credits and
 * the credit history stay consistent. All demo accounts share one strong random password,
 * printed once at the end. No emails are sent.
 */
const crypto = require("crypto");
const env = require("../src/config/env");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

// No emails for demo interviews.
const mailer = require("../src/services/mailer");
mailer.sendMail = async () => true;

const Tenant = require("../src/models/tenant");
const User = require("../src/models/user");
const Technology = require("../src/models/technology");
const Module = require("../src/models/module");
const Topic = require("../src/models/topic");
const Company = require("../src/models/companies");
const Tag = require("../src/models/tags");
const CompanyQuestion = require("../src/models/companyQuestion");
const CodingQuestion = require("../src/models/codingQuestion");
const LiteInterviewQuestion = require("../src/models/liteInterviewQuestion");
const Interview = require("../src/models/interview");
const CompanyInterview = require("../src/models/companyInterview");
const CodingInterview = require("../src/models/codingInterview");
const scheduling = require("../src/services/scheduling");
const { detectTransactions } = require("../src/lib/db");

const BY = "demo-seed";
const ORG_CODE = "DEMO";

// ------------------------------------------------------------------ content
const SYLLABUS = {
  Java: {
    "Object-Oriented Programming": ["Classes and objects", "Inheritance", "Polymorphism", "Abstraction", "Encapsulation"],
    Collections: ["ArrayList", "HashMap", "HashSet", "Iterators"],
    "Exception Handling": ["Checked vs unchecked exceptions", "try-catch-finally", "Custom exceptions"],
  },
  Python: {
    "Python Basics": ["Data types", "Lists and tuples", "Dictionaries", "Functions"],
    "OOP in Python": ["Classes", "Inheritance", "Decorators"],
  },
  DBMS: {
    SQL: ["SELECT and JOIN", "GROUP BY and aggregates", "Indexes"],
    "Database Design": ["Normalization", "Keys", "Transactions and ACID"],
  },
  "Web Development": {
    "HTML and CSS": ["Semantic HTML", "Flexbox", "Responsive design"],
    JavaScript: ["Closures", "Promises", "Event loop"],
    React: ["Components", "State and props", "Hooks"],
  },
};

const QUESTION_BANK = {
  Java: [
    ["What is inheritance in Java?", "Inheritance lets a class (subclass) acquire the fields and methods of another class (superclass) using the extends keyword, enabling code reuse and polymorphism. Example: class Dog extends Animal."],
    ["What is the difference between an abstract class and an interface?", "An abstract class can have state, constructors and both abstract and concrete methods, and a class extends only one. An interface defines a contract (abstract, default and static methods, constants) and a class can implement many."],
    ["How does a HashMap work internally?", "It stores entries in buckets chosen by the key's hashCode; collisions are kept in a linked list or a balanced tree. equals() finds the exact key. It resizes when the load factor (0.75) is exceeded."],
    ["What is the difference between checked and unchecked exceptions?", "Checked exceptions (e.g. IOException) must be declared or handled at compile time; unchecked exceptions (RuntimeException subclasses, e.g. NullPointerException) need not be."],
  ],
  Python: [
    ["What is the difference between a list and a tuple?", "Lists are mutable and use square brackets; tuples are immutable, use parentheses, and can be dictionary keys when their items are hashable."],
    ["What is a decorator in Python?", "A function that takes another function and returns a new function that adds behaviour, applied with @decorator syntax, e.g. for logging or timing."],
    ["How are dictionaries implemented?", "As hash tables: keys are hashed to find a slot, giving average O(1) lookup, insert and delete. Since Python 3.7 they keep insertion order."],
  ],
  DBMS: [
    ["What is normalization?", "Organising tables to reduce redundancy and update anomalies by splitting data into related tables following normal forms (1NF, 2NF, 3NF, BCNF)."],
    ["What are the ACID properties?", "Atomicity (all or nothing), Consistency (valid state to valid state), Isolation (concurrent transactions don't interfere), Durability (committed data survives failures)."],
    ["What is the difference between INNER JOIN and LEFT JOIN?", "INNER JOIN returns only rows that match in both tables; LEFT JOIN returns all rows of the left table, with NULLs where the right table has no match."],
  ],
  "Web Development": [
    ["What is a closure in JavaScript?", "A function together with the variables of the scope it was created in; it can use those variables even after the outer function has returned."],
    ["What is the event loop?", "The mechanism that runs JavaScript's single thread: it executes the call stack, then microtasks (promises), then the next macrotask (timers, I/O) from the queue."],
    ["What are React hooks?", "Functions such as useState and useEffect that let function components keep state and run side effects without classes."],
  ],
};

const COMPANIES = [
  { name: "TCS", type: "service_based" },
  { name: "Infosys", type: "service_based" },
  { name: "Wipro", type: "service_based" },
  { name: "Accenture", type: "service_based" },
  { name: "Amazon", type: "product_based" },
  { name: "Zoho", type: "product_based" },
];
const COMPANY_QUESTIONS = {
  TR1: [
    "Explain the four pillars of object-oriented programming.",
    "What is the difference between a process and a thread?",
    "Write the logic to check whether a string is a palindrome.",
    "What is normalization in databases?",
  ],
  TR2: ["Explain how you would design a URL shortener.", "What happens when you type a URL in the browser?"],
  HR1: [
    "Tell me about yourself.",
    "Why do you want to join our company?",
    "Describe a challenge you faced in a project and how you solved it.",
    "Where do you see yourself in five years?",
  ],
};

const html = (paras) => paras.map((p) => `<p>${p}</p>`).join("");
const CODING = [
  ["Two Sum", "easy", 15, "Given an array of integers and a target, return the indices of the two numbers that add up to the target.", "nums = [2,7,11,15], target = 9", "[0,1]", "2 <= n <= 10^4; exactly one answer exists."],
  ["Reverse a String", "easy", 15, "Reverse the given string without using built-in reverse functions.", "s = \"hello\"", "\"olleh\"", "1 <= length <= 10^5"],
  ["Valid Parentheses", "easy", 15, "Given a string of brackets ()[]{}, decide whether every bracket is closed in the correct order.", "s = \"([]{})\"", "true", "1 <= length <= 10^4"],
  ["Longest Substring Without Repeating Characters", "medium", 20, "Find the length of the longest substring without repeating characters.", "s = \"abcabcbb\"", "3", "0 <= length <= 5 * 10^4"],
  ["Merge Intervals", "medium", 20, "Merge all overlapping intervals and return the non-overlapping intervals.", "[[1,3],[2,6],[8,10]]", "[[1,6],[8,10]]", "1 <= n <= 10^4"],
  ["Kth Largest Element", "medium", 20, "Find the kth largest element in an unsorted array.", "nums = [3,2,1,5,6,4], k = 2", "5", "1 <= k <= n <= 10^5"],
  ["LRU Cache", "hard", 30, "Design a cache with get and put in O(1) that evicts the least recently used item when full.", "capacity = 2; put(1,1), put(2,2), get(1), put(3,3), get(2)", "1, -1", "1 <= capacity <= 3000"],
  ["Median of Two Sorted Arrays", "hard", 30, "Return the median of two sorted arrays in O(log(m+n)) time.", "nums1 = [1,3], nums2 = [2]", "2.0", "0 <= m, n <= 1000"],
];

const STAFF = [
  { roll_no: "DEMOADMIN", first_name: "Priya Sharma", role: "tenantadmin", gender: "female" },
  { roll_no: "DEMOPLACEMENT", first_name: "Rahul Verma", role: "placementadmin", gender: "male" },
  { roll_no: "DEMOTRAINER", first_name: "Anita Rao", role: "trainer", gender: "female" },
];
const STUDENTS = [
  ["Aarav Patel", "male", "CSE"], ["Diya Reddy", "female", "CSE"], ["Vivaan Kumar", "male", "CSE"], ["Ananya Iyer", "female", "IT"],
  ["Arjun Nair", "male", "IT"], ["Ishita Singh", "female", "ECE"], ["Kabir Mehta", "male", "ECE"], ["Meera Joshi", "female", "CSE"],
  ["Rohan Gupta", "male", "EEE"], ["Sneha Pillai", "female", "IT"], ["Aditya Rao", "male", "CSE"], ["Kavya Menon", "female", "ECE"],
].map(([name, gender, branch], i) => ({
  roll_no: `21DEMO${String(i + 1).padStart(3, "0")}`,
  first_name: name,
  role: "student",
  gender,
  branch,
  passout_year: i % 3 === 0 ? 2026 : 2027,
  mobile: 9000000001 + i,
}));

// ------------------------------------------------------------------ helpers
const strongPassword = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return Array.from(crypto.randomBytes(14), (b) => alphabet[b % alphabet.length]).join("") + "@26";
};
const at = (days, hour, minute = 0) => {
  // IST wall-clock time `days` from today
  const ist = new Date(Date.now() + 330 * 60000);
  ist.setUTCDate(ist.getUTCDate() + days);
  ist.setUTCHours(hour, minute, 0, 0);
  return new Date(ist.getTime() - 330 * 60000);
};
const inMinutes = (m) => new Date(Date.now() + m * 60000);

function verbalReport(questions, accuracies) {
  const results = questions.map((q, i) => ({
    given_question: q,
    given_answer: accuracies[i] ? `Sample answer to: ${q}` : "",
    accuracy: accuracies[i],
    analysis: accuracies[i] >= 70 ? "Correct and well explained." : accuracies[i] ? "Partly correct; key points are missing." : "",
    improvements: accuracies[i] >= 70 ? "Add a real-world example." : "Cover the main definition and give an example.",
    confidence_level: accuracies[i] === 0 ? "low" : accuracies[i] <= 50 ? "medium" : "high",
    time: 40 + i * 5,
  }));
  const avg = Math.round(accuracies.reduce((a, b) => a + b, 0) / accuracies.length);
  return {
    question_details: results,
    overall_analysis: [
      {
        strengths: ["Clear communication", "Good grasp of core concepts"],
        areas_of_improvement: ["Give more practical examples", "Structure longer answers"],
        interview_parameters: {
          communication_skills: Math.min(100, avg + 8),
          understandability: avg,
          analytical_skills: Math.max(0, avg - 5),
          time_management: 80,
          domain_skills: avg,
          logical_thinking: Math.max(0, avg - 3),
          attention_to_detail: Math.max(0, avg - 8),
        },
      },
    ],
  };
}

const completed = (startedAt, extra) => ({
  status: 0,
  evaluation_status: "completed",
  evaluation_mode: "ai",
  attempt: { started_at: startedAt, deadline_at: new Date(startedAt.getTime() + 30 * 60000), platform: "web", resumes: 0 },
  submitted_at: new Date(startedAt.getTime() + 20 * 60000),
  evaluated_at: new Date(startedAt.getTime() + 21 * 60000),
  ...extra,
});

/** Removes everything this script created (only records marked as demo data). */
async function removeDemo() {
  const CreditTransaction = require("../src/models/creditTransaction");
  const tenant = await Tenant.findOne({ organization_code: ORG_CODE }).lean();
  const counts = {};
  if (tenant) {
    for (const [name, Model] of Object.entries({ Interview, CompanyInterview, CodingInterview, CreditTransaction, User })) {
      // eslint-disable-next-line no-await-in-loop
      counts[name] = (await Model.deleteMany({ tenant_id: tenant._id })).deletedCount;
    }
    await Tenant.deleteOne({ _id: tenant._id });
    counts.Tenant = 1;
  }
  for (const [name, Model, field] of [
    ["Technology", Technology, "added_by"], ["Module", Module, "added_by"], ["Topic", Topic, "added_by"],
    ["Company", Company, "added_by"], ["Tag", Tag, "added_by"], ["CompanyQuestion", CompanyQuestion, "added_by"],
    ["CodingQuestion", CodingQuestion, "added_by"], ["LiteInterviewQuestion", LiteInterviewQuestion, "created_by"],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    counts[name] = (await Model.deleteMany({ [field]: BY })).deletedCount;
  }
  return counts;
}

// ------------------------------------------------------------------ main
async function main() {
  const remove = process.argv.includes("--remove");
  if (!process.argv.includes("--confirm")) {
    console.log(`This ${remove ? "removes" : "adds"} demo data in the database in backend/.env. Run again with --confirm.`);
    process.exit(1);
  }
  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 15000 });
  await detectTransactions();
  const db = mongoose.connection.db;
  console.log(`Database: ${db.databaseName} on ${env.mongoUri.replace(/\/\/[^@]*@/, "//***@").split("/")[2]}`);

  if (remove) {
    console.log("Removed demo data:", JSON.stringify(await removeDemo()));
    return;
  }
  if (await Tenant.exists({ organization_code: ORG_CODE })) {
    console.log("Demo data is already there (college code DEMO). Nothing changed.");
    return;
  }
  const admin = await User.findOne({ role: { $in: ["superadmin", "admin"] }, status: { $ne: 0 } }).lean();
  if (!admin) throw new Error("No platform admin found to act as the creator of the demo interviews.");

  try {
    await addDemo(admin);
  } catch (err) {
    // leave nothing half-created
    await removeDemo().catch(() => {});
    throw err;
  }
}

async function addDemo(admin) {
  // College
  const tenant = await Tenant.create({
    organization_name: "Demo Engineering College",
    organization_code: ORG_CODE,
    contact_person: "Priya Sharma",
    email: "placements@demo-college.example",
    active_credits: 200,
    assigned_credits: [200],
    interview_duration_minutes: 30,
    status: 1,
  });

  // People
  const password = strongPassword();
  const hash = await bcrypt.hash(password, 10);
  for (const u of [...STAFF, ...STUDENTS]) {
    // eslint-disable-next-line no-await-in-loop
    await User.create({
      ...u,
      email: `${u.roll_no.toLowerCase()}@demo-college.example`,
      college: "Demo Engineering College",
      tenant_id: tenant._id,
      status: 1,
      password: hash,
    });
  }

  // Syllabus + question bank
  const techIds = {};
  for (const [techName, modules] of Object.entries(SYLLABUS)) {
    // eslint-disable-next-line no-await-in-loop
    const tech = await Technology.create({ technology_name: techName, technology_category: "highcode", added_by: BY, status: 1 });
    techIds[techName] = { id: tech._id, modules: {} };
    for (const [moduleName, topics] of Object.entries(modules)) {
      // eslint-disable-next-line no-await-in-loop
      const mod = await Module.create({ technology: tech._id, module_name: moduleName, added_by: BY, status: 1 });
      // eslint-disable-next-line no-await-in-loop
      const ts = await Topic.insertMany(topics.map((t) => ({ technology: tech._id, module: mod._id, topic_name: t, added_by: BY, status: 1 })));
      techIds[techName].modules[moduleName] = { id: mod._id, topics: ts.map((t) => t._id) };
    }
  }
  const companyIds = {};
  for (const c of COMPANIES) {
    // eslint-disable-next-line no-await-in-loop
    const doc = await Company.create({ company_name: c.name, added_date: new Date().toISOString(), update_date: new Date().toISOString(), added_by: BY, status: 1 });
    companyIds[c.name] = doc._id;
  }
  for (const [techName, qa] of Object.entries(QUESTION_BANK)) {
    // eslint-disable-next-line no-await-in-loop
    await LiteInterviewQuestion.insertMany(
      qa.map(([question, answer], i) => ({
        technology: techIds[techName].id,
        question,
        answer,
        company: i === 0 ? [companyIds.TCS, companyIds.Infosys] : [],
        previous_asked_status: i === 0 ? 1 : 0,
        created_by: BY,
        status: 1,
      }))
    );
  }

  // Company questions
  const tags = await Tag.insertMany([
    { tag_name: "Freshers 2026", createdAt: new Date(), updatedAt: new Date(), added_by: BY, status: 1 },
    { tag_name: "Campus Drive", createdAt: new Date(), updatedAt: new Date(), added_by: BY, status: 1 },
  ]);
  const cq = [];
  for (const c of COMPANIES) {
    for (const [round, qs] of Object.entries(COMPANY_QUESTIONS)) {
      if (round === "TR2" && c.type !== "product_based") continue;
      qs.forEach((question, i) =>
        cq.push({ company: companyIds[c.name], type: c.type, round, year: String(2023 + (i % 3)), tag: tags[i % 2]._id, question, added_by: BY, status: 1 })
      );
    }
  }
  await CompanyQuestion.insertMany(cq);

  // Coding problems
  await CodingQuestion.insertMany(
    CODING.map(([problem_name, complexity, time, desc, input, output, constraints], i) => ({
      problem_name,
      complexity,
      time,
      description: html([desc]),
      input: html([input]),
      output: html([output]),
      constraints: html([constraints]),
      company: i < 2 ? companyIds.Amazon : null,
      added_by: BY,
      status: 1,
    }))
  );

  // Interviews, through the real scheduling code (credits + ledger)
  const req = (body) => ({ body: { tenant_id: String(tenant._id), ...body }, auth: { isPlatform: true, user: admin, role: admin.role } });
  const java = techIds.Java;
  const oop = java.modules["Object-Oriented Programming"];
  const techBody = (roll, start, extra = {}) => ({
    platform: "web",
    roll_no: roll,
    start_date_time: start.toISOString(),
    technology: String(java.id),
    module: JSON.stringify([String(oop.id)]),
    topic: JSON.stringify([]),
    level: "easy",
    questions_count: 5,
    ...extra,
  });
  const companyBody = (roll, start, extra = {}) => ({
    platform: "web",
    roll_no: roll,
    start_date_time: start.toISOString(),
    company: JSON.stringify([String(companyIds.TCS), String(companyIds.Infosys)]),
    type: JSON.stringify(["service_based"]),
    round: JSON.stringify(["TR1", "HR1"]),
    questions_count: 5,
    ...extra,
  });
  const codingBody = (roll, start, extra = {}) => ({ platform: "web", roll_no: roll, start_date_time: start.toISOString(), level: "easy", questions_count: 2, ...extra });
  const s = STUDENTS.map((u) => u.roll_no);
  const created = { upcoming: 0, completed: 0, expired: 0 };

  // Upcoming: tomorrow and later today
  for (const [i, roll] of s.slice(0, 4).entries()) {
    // eslint-disable-next-line no-await-in-loop
    await scheduling.scheduleSingle(req(techBody(roll, at(1, 10 + i))), "ai generated");
    created.upcoming++;
  }
  await scheduling.scheduleSingle(req(companyBody(s[4], at(1, 15))), "company");
  await scheduling.scheduleSingle(req(codingBody(s[5], at(2, 11))), "coding");
  await scheduling.scheduleSingle(req(techBody(s[6], inMinutes(120), { platform: "mpod" })), "ai generated");
  created.upcoming += 3;

  // Completed with reports (scheduled ahead, then moved into the past with results)
  const javaQs = [
    "What is inheritance in Java?",
    "Explain polymorphism with an example.",
    "What is encapsulation?",
    "What is the difference between an abstract class and an interface?",
    "What is a constructor?",
  ];
  const techDone = [
    [s[0], -1, [85, 70, 90, 60, 75]],
    [s[1], -1, [95, 88, 80, 90, 85]],
    [s[2], -2, [40, 55, 30, 0, 45]],
    [s[3], -3, [70, 65, 75, 80, 60]],
    [s[7], -1, [60, 72, 0, 50, 68]],
  ];
  for (const [roll, days, acc] of techDone) {
    // eslint-disable-next-line no-await-in-loop
    const doc = await scheduling.scheduleSingle(req(techBody(roll, at(30, 9 + created.completed % 8))), "ai generated");
    const start = at(days, 11);
    // eslint-disable-next-line no-await-in-loop
    await Interview.updateOne(
      { _id: doc._id },
      {
        $set: completed(start, {
          start_date_time: start,
          issued_questions: javaQs.map((q, i) => ({ qid: `q${i + 1}`, question: q, source: "ai" })),
          ...verbalReport(javaQs, acc),
        }),
      }
    );
    created.completed++;
  }
  const hrQs = ["Tell me about yourself.", "Why do you want to join our company?", "Explain the four pillars of object-oriented programming.", "What is normalization in databases?", "Where do you see yourself in five years?"];
  for (const [roll, days, acc] of [[s[8], -1, [80, 75, 70, 65, 85]], [s[9], -2, [90, 85, 60, 70, 80]]]) {
    // eslint-disable-next-line no-await-in-loop
    const doc = await scheduling.scheduleSingle(req(companyBody(roll, at(31, 10 + created.completed % 6))), "company");
    const start = at(days, 14);
    // eslint-disable-next-line no-await-in-loop
    await CompanyInterview.updateOne(
      { _id: doc._id },
      { $set: completed(start, { start_date_time: start, issued_questions: hrQs.map((q, i) => ({ qid: `q${i + 1}`, question: q })), ...verbalReport(hrQs, acc) }) }
    );
    created.completed++;
  }
  for (const [roll, days, acc] of [[s[10], -1, ["90", "70"]], [s[11], -2, ["60", "40"]]]) {
    // eslint-disable-next-line no-await-in-loop
    const doc = await scheduling.scheduleSingle(req(codingBody(roll, at(32, 10 + created.completed % 6))), "coding");
    const start = at(days, 16);
    const problems = CODING.slice(0, 2);
    // eslint-disable-next-line no-await-in-loop
    await CodingInterview.updateOne(
      { _id: doc._id },
      {
        $set: completed(start, {
          start_date_time: start,
          issued_questions: problems.map(([name], i) => ({ qid: `q${i + 1}`, question: name, problem_name: name })),
          emotions: { seen_left: "2", seen_right: "1", seen_center: "9", blinks: "38", time_straight: "1100", time_left: "60", time_right: "40", analysis: "browser", emotions: { neutral: 72, happy: 18, sad: 2, angry: 0, surprise: 5, fear: 2, disgust: 1 } },
          question_details: problems.map(([name, , , desc], i) => ({
            problem: name,
            question: name,
            description: html([desc]),
            given_answer: "def solve(data):\n    # sample solution\n    return data",
            optimized_answer: "",
            idea: "Use a hash map to find the answer in one pass.",
            idea_check: 1,
            matched_accuracy: 80,
            is_code: true,
            accuracy: acc[i],
            efficiency: { time_complexity: "O(n)", space_complexity: "O(n)" },
            code_quality: { readability: "High", variable_naming: "Descriptive" },
            logical_approach: Number(acc[i]) >= 70 ? "Correct" : "Partially correct",
            output_format: "Correct",
            observations: ["Handles the main case", "Edge cases need more care"],
            analysis: "Clear approach with readable code.",
            time: 600 + i * 120,
            optimized_result: { optimized_percentage: 0, time_complexity: "O(n)", space_complexity: "O(n)", optimization_comment: "No optimization submitted." },
          })),
        }),
      }
    );
    created.completed++;
  }

  // A no-show (expired)
  {
    const doc = await scheduling.scheduleSingle(req(techBody(s[11], at(33, 12))), "ai generated");
    await Interview.updateOne({ _id: doc._id }, { $set: { start_date_time: at(-1, 9) } });
    created.expired++;
  }

  const left = (await Tenant.findById(tenant._id).lean()).active_credits;
  console.log("\nDemo data added:");
  console.log(`  College: Demo Engineering College (code DEMO), ${left} of 200 credits left`);
  console.log(`  People: ${STAFF.length} staff, ${STUDENTS.length} students`);
  console.log(`  Content: ${Object.keys(SYLLABUS).length} technologies, ${Object.values(SYLLABUS).reduce((n, m) => n + Object.keys(m).length, 0)} modules, ` +
    `${Object.values(SYLLABUS).reduce((n, m) => n + Object.values(m).flat().length, 0)} topics, ${Object.values(QUESTION_BANK).flat().length} bank questions, ` +
    `${COMPANIES.length} companies, ${cq.length} company questions, ${CODING.length} coding problems`);
  console.log(`  Interviews: ${created.upcoming} upcoming, ${created.completed} completed with reports, ${created.expired} expired`);
  console.log("\nLogins (all demo accounts share this password):");
  console.log(`  Password: ${password}`);
  console.log(`  Admin portal: ${STAFF.map((u) => `${u.roll_no} (${u.role})`).join(", ")}`);
  console.log(`  Student site: ${STUDENTS[0].roll_no} ... ${STUDENTS[STUDENTS.length - 1].roll_no}`);
}

main()
  .then(() => mongoose.disconnect())
  .catch(async (err) => {
    console.error("Failed:", err.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
