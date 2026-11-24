const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));

const PORT = process.env.PORT || 10000;
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

if (!MONGO_URI) {
  console.error("Missing MONGO_URI environment variable.");
  process.exit(1);
}

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("Connected to fresh MongoDB"))
  .catch((err) => {
    console.error("MongoDB connection error:", err.message);
    process.exit(1);
  });

const boardStateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "main_board" },
    users: { type: Array, default: [] },
    exe_files: { type: Array, default: [] },
    scripts: { type: Array, default: [] },
    otp_logs: { type: Array, default: [] },
    payment_requests: { type: Array, default: [] },
    config: { type: Object, default: {} }
  },
  { timestamps: true }
);

const BoardState = mongoose.model("BoardState", boardStateSchema);

async function getOrCreateEmptyBoard() {
  let doc = await BoardState.findOne({ key: "main_board" });
  if (!doc) {
    doc = await BoardState.create({
      key: "main_board",
      users: [],
      exe_files: [],
      scripts: [],
      otp_logs: [],
      payment_requests: [],
      config: {}
    });
  }
  return doc;
}

app.get("/", (req, res) => {
  res.json({ ok: true, status: "fresh_backend_running" });
});

app.get("/api/board", async (req, res) => {
  try {
    const doc = await getOrCreateEmptyBoard();
    res.json({
      users: doc.users || [],
      exe_files: doc.exe_files || [],
      scripts: doc.scripts || [],
      otp_logs: doc.otp_logs || [],
      payment_requests: doc.payment_requests || [],
      config: doc.config || {}
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/board", async (req, res) => {
  try {
    const incoming = req.body && typeof req.body === "object" ? req.body : {};
    const updateFields = {};
    if (Array.isArray(incoming.users)) updateFields.users = incoming.users;
    if (Array.isArray(incoming.exe_files)) updateFields.exe_files = incoming.exe_files;
    if (Array.isArray(incoming.scripts)) updateFields.scripts = incoming.scripts;
    if (Array.isArray(incoming.otp_logs)) updateFields.otp_logs = incoming.otp_logs;
    if (Array.isArray(incoming.payment_requests)) {
      updateFields.payment_requests = incoming.payment_requests;
    }
    if (incoming.config && typeof incoming.config === "object") {
      updateFields.config = incoming.config;
    }

    const doc = await BoardState.findOneAndUpdate(
      { key: "main_board" },
      { $set: updateFields },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.json({
      ok: true,
      users: doc.users || [],
      exe_files: doc.exe_files || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
