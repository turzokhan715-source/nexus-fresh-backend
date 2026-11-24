const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));

const PORT = process.env.PORT || 10000;
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET || "nexus_fresh_secret_key_change_in_env";

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
    categories: { type: Array, default: [] },
    submissions: { type: Array, default: [] },
    config: { type: Object, default: {} }
  },
  { timestamps: true }
);

const BoardState = mongoose.model("BoardState", boardStateSchema);

function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password || "")).digest("hex");
}

function signToken(payload) {
  const data = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString("base64url");
  const sig = crypto.createHmac("sha256", JWT_SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [data, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", JWT_SECRET).update(data).digest("base64url");
  if (sig !== expected) return null;
  try {
    return JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function getAuthUser(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return null;
  return verifyToken(auth.slice(7).trim());
}

async function getOrCreateBoard() {
  let doc = await BoardState.findOne({ key: "main_board" });
  if (!doc) {
    doc = await BoardState.create({
      key: "main_board",
      users: [],
      exe_files: [],
      scripts: [],
      otp_logs: [],
      payment_requests: [],
      categories: [
        { id: "default_cat", name: "Account / Data", rate: 0.05 }
      ],
      submissions: [],
      config: {}
    });
  }
  return doc;
}

function findUserIndex(users, identifier) {
  const idLower = String(identifier || "").trim().toLowerCase();
  if (!idLower) return -1;
  return users.findIndex((u) => {
    const uid = String(u.user_id || "").trim().toLowerCase();
    const uname = String(u.username || "").trim().toLowerCase();
    const email = String(u.email || "").trim().toLowerCase();
    return uid === idLower || uname === idLower || email === idLower;
  });
}

app.get("/", (req, res) => {
  res.json({ ok: true, status: "nexus_fresh_unified_server_running" });
});

// ---------------- ADMIN BOARD ENDPOINTS ----------------
app.get("/api/board", async (req, res) => {
  try {
    const doc = await getOrCreateBoard();
    res.json({
      users: doc.users || [],
      exe_files: doc.exe_files || [],
      scripts: doc.scripts || [],
      otp_logs: doc.otp_logs || [],
      payment_requests: doc.payment_requests || [],
      categories: doc.categories || [],
      submissions: doc.submissions || [],
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
    if (Array.isArray(incoming.categories)) updateFields.categories = incoming.categories;
    if (Array.isArray(incoming.submissions)) updateFields.submissions = incoming.submissions;
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
      exe_files: doc.exe_files || [],
      scripts: doc.scripts || [],
      payment_requests: doc.payment_requests || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------- USER AUTH ENDPOINTS ----------------
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, username, email, password } = req.body || {};
    const rawId = String(username || email || name || "").trim();
    if (!rawId || !password) {
      return res.status(400).json({ message: "Username/email and password are required." });
    }

    const doc = await getOrCreateBoard();
    const users = Array.isArray(doc.users) ? [...doc.users] : [];

    const existingIdx = findUserIndex(users, rawId) !== -1
      ? findUserIndex(users, rawId)
      : (email ? findUserIndex(users, email) : -1);

    if (existingIdx !== -1) {
      return res.status(409).json({ message: "Account already exists." });
    }

    const userId = String(username || name || email).trim();
    const newUser = {
      user_id: userId,
      username: String(username || name || rawId).trim(),
      name: String(name || username || rawId).trim(),
      email: String(email || "").trim(),
      password: String(password),
      password_hash: hashPassword(password),
      status: "Pending",
      active: false,
      balance: 0,
      otp_rate: 0,
      allow_number_add: false,
      assigned_numbers: [],
      payment_requests: [],
      otp_logs: [],
      created_at: new Date().toISOString()
    };

    users.push(newUser);
    doc.users = users;
    doc.markModified("users");
    await doc.save();

    const token = signToken({ user_id: newUser.user_id, email: newUser.email });
    return res.status(201).json({
      ok: true,
      message: "Registered successfully.",
      token,
      user: {
        user_id: newUser.user_id,
        username: newUser.username,
        name: newUser.name,
        email: newUser.email,
        status: newUser.status,
        active: newUser.active,
        balance: newUser.balance
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, username, password } = req.body || {};
    const ident = String(email || username || "").trim();
    if (!ident || !password) {
      return res.status(400).json({ message: "Credentials required." });
    }

    const doc = await getOrCreateBoard();
    const users = Array.isArray(doc.users) ? doc.users : [];
    const idx = findUserIndex(users, ident);
    if (idx === -1) {
      return res.status(401).json({ message: "Invalid user credentials." });
    }

    const u = users[idx];
    const pwMatch =
      String(u.password || "") === String(password) ||
      String(u.password_hash || "") === hashPassword(password);

    if (!pwMatch) {
      return res.status(401).json({ message: "Invalid password." });
    }

    const token = signToken({ user_id: u.user_id, email: u.email || "" });
    return res.json({
      ok: true,
      token,
      user: {
        user_id: u.user_id,
        username: u.username || u.user_id,
        name: u.name || u.user_id,
        email: u.email || "",
        status: u.status || "Pending",
        active: Boolean(u.active),
        balance: Number(u.balance || 0)
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---------------- USER DASHBOARD ENDPOINTS ----------------
app.get("/api/user/me", async (req, res) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ message: "Unauthorized" });

    const doc = await getOrCreateBoard();
    const users = Array.isArray(doc.users) ? doc.users : [];
    const idx = findUserIndex(users, authUser.user_id || authUser.email);
    if (idx === -1) return res.status(404).json({ message: "User not found" });

    const u = users[idx];
    return res.json({
      user: {
        user_id: u.user_id,
        username: u.username || u.user_id,
        name: u.name || u.user_id,
        email: u.email || "",
        status: u.status || "Pending",
        active: Boolean(u.active),
        balance: Number(u.balance || 0),
        otp_rate: Number(u.otp_rate || 0),
        assigned_numbers: Array.isArray(u.assigned_numbers) ? u.assigned_numbers : []
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/categories", async (req, res) => {
  try {
    const doc = await getOrCreateBoard();
    res.json({ categories: doc.categories || [] });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/submissions/my", async (req, res) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ message: "Unauthorized" });

    const doc = await getOrCreateBoard();
    const uid = String(authUser.user_id || "").toLowerCase();
    const subs = (doc.submissions || []).filter(
      (s) => String(s.user_id || "").toLowerCase() === uid
    );
    res.json({ submissions: subs });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/submissions", async (req, res) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ message: "Unauthorized" });

    const { category, data } = req.body || {};
    if (!data || !String(data).trim()) {
      return res.status(400).json({ message: "Data is required." });
    }

    const doc = await getOrCreateBoard();
    const subs = Array.isArray(doc.submissions) ? [...doc.submissions] : [];
    const newSub = {
      id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      user_id: authUser.user_id,
      category: category || "General",
      categoryName: category || "General",
      data: String(data).trim(),
      rate: 0,
      status: "pending",
      createdAt: new Date().toISOString()
    };
    subs.push(newSub);
    doc.submissions = subs;
    doc.markModified("submissions");
    await doc.save();

    res.status(201).json({ ok: true, submission: newSub });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/withdrawals/my", async (req, res) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ message: "Unauthorized" });

    const doc = await getOrCreateBoard();
    const uid = String(authUser.user_id || "").toLowerCase();
    const reqs = (doc.payment_requests || []).filter(
      (r) => String(r.user_id || "").toLowerCase() === uid
    );
    res.json({ withdrawals: reqs });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/withdrawals", async (req, res) => {
  try {
    const authUser = getAuthUser(req);
    if (!authUser) return res.status(401).json({ message: "Unauthorized" });

    const { method, account, amount } = req.body || {};
    const amt = Number(amount || 0);
    if (!method || !account || !amt || amt <= 0) {
      return res.status(400).json({ message: "Valid method, account, and amount are required." });
    }

    const doc = await getOrCreateBoard();
    const users = Array.isArray(doc.users) ? [...doc.users] : [];
    const uIdx = findUserIndex(users, authUser.user_id);
    if (uIdx !== -1) {
      const curBal = Number(users[uIdx].balance || 0);
      if (amt > curBal) {
        return res.status(400).json({ message: "Insufficient balance." });
      }
    }

    const reqs = Array.isArray(doc.payment_requests) ? [...doc.payment_requests] : [];
    const newReq = {
      id: `wd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      user_id: authUser.user_id,
      method: String(method).trim(),
      number: String(account).trim(),
      account: String(account).trim(),
      amount_usd: amt,
      amount: amt,
      status: "Pending",
      created_at: new Date().toISOString().replace("T", " ").slice(0, 19),
      createdAt: new Date().toISOString()
    };

    reqs.push(newReq);
    doc.payment_requests = reqs;
    doc.markModified("payment_requests");
    await doc.save();

    res.status(201).json({ ok: true, withdrawal: newReq });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
