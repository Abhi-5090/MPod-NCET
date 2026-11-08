const path = require("path");

const BACKEND_ROOT = path.resolve(__dirname, "../..");
// Optional: one folder for every uploaded file (e.g. a persistent disk on Render).
// Without it, files are stored inside the backend folder as before.
const UPLOADS_DIR = (process.env.UPLOADS_DIR || "").trim() ? path.resolve(process.env.UPLOADS_DIR.trim()) : null;

// Absolute paths so the server behaves the same whatever directory it is started from.
module.exports = {
  BACKEND_ROOT,
  UPLOADS_DIR,
  PROFILE_PICS_DIR: UPLOADS_DIR ? path.join(UPLOADS_DIR, "profile-pics") : path.join(BACKEND_ROOT, "src/uploads/profile-pics"),
  TECH_ICONS_DIR: path.join(UPLOADS_DIR || path.join(BACKEND_ROOT, "uploads"), "technology-icons"),
  MODULE_ICONS_DIR: path.join(UPLOADS_DIR || path.join(BACKEND_ROOT, "uploads"), "module-icons"),
  // Shipped with the code (not an upload), shown when a user has no picture.
  DEFAULT_PROFILE_PIC: path.join(BACKEND_ROOT, "src/uploads/profile-pics/default.png"),
  FACE_MODELS_DIR: path.join(BACKEND_ROOT, "public/models"),
};
