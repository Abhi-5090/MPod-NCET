/**
 * Adds simple Physics, Chemistry and Maths questions (15 each) to the database in backend/.env.
 *
 *   npm run seed:subjects
 *
 * Creates the subjects (technologies), their sections (modules and topics) and the
 * questions with their expected answers. Questions are linked to their module, so an
 * interview scheduled with that module asks exactly these questions (see
 * services/interviewSession.js). Safe to run again: nothing is duplicated, and edits to
 * the questions below update the stored ones. An existing "Maths" subject is reused.
 */
const mongoose = require("mongoose");
const env = require("../src/config/env");
const { escapeRegex } = require("../src/lib/http");
const Technology = require("../src/models/technology");
const Module = require("../src/models/module");
const Topic = require("../src/models/topic");
const Question = require("../src/models/liteInterviewQuestion");

const BY = "subjects-seed";

// [question, expected answer]
const SUBJECTS = [
  {
    name: "Physics",
    category: "nocode",
    modules: [
      {
        name: "Units and Measurements",
        topics: ["SI base units", "Derived units"],
        questions: [
          ["What is the SI unit of power?", "Watt (W). One watt is one joule per second."],
          ["What is the SI unit of force?", "Newton (N). One newton is one kilogram metre per second squared."],
          ["What is the SI unit of energy?", "Joule (J)."],
          ["What is the SI unit of work?", "Joule (J). Work and energy have the same unit."],
          ["What is the SI unit of pressure?", "Pascal (Pa). One pascal is one newton per square metre."],
          ["What is the SI unit of frequency?", "Hertz (Hz). One hertz is one cycle per second."],
          ["What is the SI unit of electric current?", "Ampere (A)."],
          ["What is the SI unit of voltage, that is, potential difference?", "Volt (V)."],
          ["What is the SI unit of electrical resistance?", "Ohm (Ω)."],
          ["What is the SI unit of electric charge?", "Coulomb (C)."],
          ["What is the SI unit of speed?", "Metre per second (m/s)."],
          ["What is the SI unit of acceleration?", "Metre per second squared (m/s²)."],
          ["What is the SI unit of temperature?", "Kelvin (K)."],
          ["What is the SI unit of mass?", "Kilogram (kg)."],
          ["What is the SI unit of momentum?", "Kilogram metre per second (kg·m/s)."],
        ],
      },
    ],
  },
  {
    name: "Chemistry",
    category: "nocode",
    modules: [
      {
        name: "Chemical Formulas",
        topics: ["Elements and gases", "Common compounds"],
        questions: [
          ["What is the chemical formula of oxygen gas?", "O2 (O 2): two oxygen atoms."],
          ["What is the chemical formula of carbon dioxide?", "CO2 (C O 2): one carbon atom and two oxygen atoms."],
          ["What is the chemical formula of water?", "H2O (H 2 O): two hydrogen atoms and one oxygen atom."],
          ["What is the chemical formula of common salt, sodium chloride?", "NaCl (N a C l)."],
          ["What is the chemical formula of methane?", "CH4 (C H 4): one carbon atom and four hydrogen atoms."],
          ["What is the chemical formula of ammonia?", "NH3 (N H 3): one nitrogen atom and three hydrogen atoms."],
          ["What is the chemical formula of sulphuric acid?", "H2SO4 (H 2 S O 4)."],
          ["What is the chemical formula of hydrochloric acid?", "HCl (H C l)."],
          ["What is the chemical formula of glucose?", "C6H12O6 (C 6 H 12 O 6)."],
          ["What is the chemical formula of nitrogen gas?", "N2 (N 2): two nitrogen atoms."],
          ["What is the chemical formula of ozone?", "O3 (O 3): three oxygen atoms."],
          ["What is the chemical formula of calcium carbonate?", "CaCO3 (C a C O 3)."],
          ["What is the chemical formula of sodium hydroxide?", "NaOH (N a O H)."],
          ["What is the chemical formula of hydrogen gas?", "H2 (H 2): two hydrogen atoms."],
          ["What is the chemical formula of ethanol?", "C2H5OH (C 2 H 5 O H), also written C2H6O."],
        ],
      },
    ],
  },
  {
    name: "Maths",
    category: "nocode",
    modules: [
      {
        name: "Algebraic Formulas",
        topics: ["Algebraic identities", "Area and interest formulas"],
        questions: [
          ["What is the formula for a plus b whole square, (a + b)²?", "(a + b)² = a² + 2ab + b²"],
          ["What is the formula for a minus b whole square, (a − b)²?", "(a − b)² = a² − 2ab + b²"],
          ["What is a square minus b square, a² − b², written as a product?", "a² − b² = (a + b)(a − b)"],
          ["What is the formula for a plus b whole cube, (a + b)³?", "(a + b)³ = a³ + 3a²b + 3ab² + b³"],
          ["What is the formula for the area of a circle?", "Area = πr² (pi times radius squared)."],
          ["What is the formula for the area of a rectangle?", "Area = length × breadth."],
          ["What is the formula for simple interest?", "Simple interest = (P × T × R) / 100: principal times time times rate, divided by 100."],
        ],
      },
      {
        name: "Equations and Evaluation",
        topics: ["Linear equations", "Arithmetic evaluation"],
        questions: [
          ["Evaluate 3 × 4 × 7 × 6 × 5.", "2520"],
          ["Solve for x: 2x + 3 = 11.", "x = 4"],
          ["Solve for x: 5x = 45.", "x = 9"],
          ["Evaluate 12 + 8 × 3.", "36 (multiplication first: 8 × 3 = 24, then 12 + 24)."],
          ["Evaluate (15 + 5) × 4.", "80"],
          ["What is 25 percent of 200?", "50"],
          ["What is the square root of 144?", "12"],
          ["Evaluate 9 × 8 − 20 ÷ 4.", "67 (72 − 5)."],
        ],
      },
    ],
  },
];

const byName = (field, name) => ({ [field]: new RegExp(`^${escapeRegex(name)}$`, "i") });

async function findOrCreate(Model, filter, create, counts, label) {
  const found = await Model.findOne(filter);
  if (found) {
    if (found.status === 0) {
      found.status = 1; // reactivate rather than create a duplicate
      await found.save();
    }
    return found;
  }
  counts[label]++;
  return Model.create(create);
}

async function seed() {
  const counts = { technologies: 0, modules: 0, topics: 0, added: 0, updated: 0 };
  for (const s of SUBJECTS) {
    const tech = await findOrCreate(
      Technology,
      byName("technology_name", s.name),
      { technology_name: s.name, technology_category: s.category, added_by: BY, status: 1 },
      counts,
      "technologies"
    );
    let total = 0;
    for (const m of s.modules) {
      const mod = await findOrCreate(
        Module,
        { technology: tech._id, ...byName("module_name", m.name) },
        { technology: tech._id, module_name: m.name, added_by: BY, status: 1 },
        counts,
        "modules"
      );
      for (const t of m.topics) {
        await findOrCreate(
          Topic,
          { module: mod._id, ...byName("topic_name", t) },
          { technology: tech._id, module: mod._id, topic_name: t, added_by: BY, status: 1 },
          counts,
          "topics"
        );
      }
      for (const [question, answer] of m.questions) {
        const existing = await Question.findOne({ technology: tech._id, question }).lean();
        if (!existing) {
          await Question.create({ technology: tech._id, module: mod._id, question, answer, status: 1, previous_asked_status: 0, created_by: BY, company: [] });
          counts.added++;
        } else if (String(existing.module) !== String(mod._id) || existing.answer !== answer || existing.status !== 1) {
          await Question.updateOne({ _id: existing._id }, { $set: { module: mod._id, answer, status: 1 } });
          counts.updated++;
        }
        total++;
      }
    }
    console.log(`${s.name}: ${total} questions in ${s.modules.map((m) => m.name).join(", ")}`);
  }
  return counts;
}

async function main() {
  await mongoose.connect(env.mongoUri);
  const c = await seed();
  console.log(
    `Done. New: ${c.technologies} subjects, ${c.modules} modules, ${c.topics} topics, ${c.added} questions; ${c.updated} questions updated.`
  );
}

if (require.main === module) {
  main()
    .then(() => mongoose.disconnect())
    .catch(async (err) => {
      console.error("Failed:", err.message);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { SUBJECTS, seed };
