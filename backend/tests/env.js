process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-that-is-long-enough-for-hs256-signing";
process.env.OPENAI_API_KEY = "test";
// Tests always use the (faked) OpenAI provider, whatever backend/.env says: blank every
// Ollama/DGX setting (an empty value stops dotenv from filling it in from backend/.env).
for (const k of ["OLLAMA_URL", "OLLAMA_MODEL", "OLLAMA_BASE_URL", "OLLAMA_API_KEY", "DGX_BASE_URL", "DGX_MODEL", "DGX_API_KEY", "DGX_VISION_URL", "DGX_PROTOCOL", "DGX_LABEL"]) {
  process.env[k] = "";
}
for (const t of ["SCORING", "GENERATION", "SUMMARY", "CODING"]) {
  for (const k of [`OLLAMA_${t}_MODEL`, `DGX_${t}_MODEL`, `DGX_${t}_URL`, `DGX_${t}_API_KEY`, `DGX_${t}_PROTOCOL`]) process.env[k] = "";
}
process.env.AI_PROVIDER = "openai";
process.env.AI_FALLBACK_PROVIDER = "none";
process.env.OLLAMA_PRELOAD = "false";
process.env.EMAIL_USER = "noreply@example.com";
process.env.EMAIL_PASS = "x";
if (!process.env.MONGOMS_SYSTEM_BINARY) {
  const fs = require("fs");
  for (const p of ["/opt/homebrew/bin/mongod", "/usr/local/bin/mongod", "/usr/bin/mongod"]) {
    if (fs.existsSync(p)) {
      process.env.MONGOMS_SYSTEM_BINARY = p;
      break;
    }
  }
}
