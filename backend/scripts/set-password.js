/**
 * Sets a new password for an existing account (e.g. a forgotten superadmin password).
 *
 *   npm run set-password -- SUPERADMIN
 *
 * Uses the database in backend/.env (MONGODB_URI). The password is typed twice at a
 * hidden prompt; it is never printed or stored as plain text. Like the app's own
 * "reset password", it unlocks the account and ends every existing session.
 */
const readline = require("readline");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const env = require("../src/config/env");
const User = require("../src/models/user");

const MIN_PASSWORD = 8; // same rule as AuthController

// Reads one line without echoing it.
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.startsWith(question)) rl.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main() {
  const roll = String(process.argv[2] || "").trim();
  if (!roll) {
    console.error("Usage: npm run set-password -- <login id>   (e.g. SUPERADMIN)");
    process.exit(1);
  }
  if (!process.stdin.isTTY) {
    console.error("Run this in a terminal: the password is typed at a hidden prompt.");
    process.exit(1);
  }
  await mongoose.connect(env.mongoUri);
  const user = await User.findOne({ roll_no: { $in: [roll, roll.toUpperCase()] } }).select("roll_no role status").lean();
  if (!user) {
    console.error(`No account with login id "${roll}".`);
    process.exit(1);
  }
  console.log(`Account: ${user.roll_no} (${user.role}${user.status === 1 ? "" : ", inactive"})`);

  const password = await askHidden("New password: ");
  if (password.length < MIN_PASSWORD || password.length > 128) {
    console.error(`Password must be ${MIN_PASSWORD} to 128 characters long. Nothing changed.`);
    process.exit(1);
  }
  if ((await askHidden("Type it again: ")) !== password) {
    console.error("The two passwords are different. Nothing changed.");
    process.exit(1);
  }

  await User.updateOne(
    { _id: user._id },
    {
      $set: { password: await bcrypt.hash(password, 10), login_failures: 0, updated_at: new Date() },
      $unset: { lock_until: "", session_sid: "", session_expires_at: "", admin_session_sid: "", sessionToken: "" },
    }
  );
  console.log(`Password changed for ${user.roll_no}. Log in with the new password; other sessions were signed out.`);
}

main()
  .then(() => mongoose.disconnect())
  .catch(async (err) => {
    console.error("Failed:", err.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
