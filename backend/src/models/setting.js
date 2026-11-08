const mongoose = require("mongoose");

// Platform-wide settings changed from the admin portal, one document per key
// (e.g. "ai_provider": which AI provider answers every request).
const SettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, maxlength: 100 },
    value: { type: mongoose.Schema.Types.Mixed },
    updated_by: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
    updated_by_name: { type: String, maxlength: 200 },
  },
  { timestamps: true, collection: "settings" }
);

module.exports = mongoose.model("setting", SettingSchema);
