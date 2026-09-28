/*
 * CreativeConnect — admin API (all under /api/admin).
 * Login is rate-limited and public; everything else requires a valid admin
 * session cookie (see auth.js / requireAdmin).
 */
"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const path = require("path");
const os = require("os");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const { db, safeParse } = require("../db");
const auth = require("../auth");
const mailer = require("../mailer");
const { uploadImage, processUpload } = require("../upload");

const router = express.Router();
router.use(express.json({ limit: "64kb" }));
router.use(auth.csrfGuard); // sets CSRF cookie on GETs, validates it on writes

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please wait a few minutes." }
});

router.post("/login", loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  const admin = auth.verifyLogin(username, password);
  if (!admin) return res.status(401).json({ error: "Invalid username or password." });
  auth.issueToken(res, admin);
  auth.issueCsrf(res);
  res.json({ ok: true, admin: { id: admin.id, username: admin.username, role: admin.role } });
});

router.post("/logout", (req, res) => {
  auth.clearToken(res);
  res.json({ ok: true });
});

router.get("/me", (req, res) => {
  const admin = auth.currentAdmin(req);
  if (!admin) return res.status(401).json({ error: "Not authenticated" });
  res.json({ admin: { id: admin.id, username: admin.username, role: admin.role } });
});

// Everything below requires authentication.
router.use(auth.requireAdmin);

router.post("/change-password", (req, res) => {
  const { current_password, new_password } = req.body || {};
  const result = auth.changePassword(req.admin.id, current_password, new_password);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Dashboard stats
// ---------------------------------------------------------------------------
router.get("/stats", (req, res) => {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const byStatusRows = db.prepare("SELECT status, COUNT(*) c FROM leads GROUP BY status").all();
  const byStatus = { new: 0, contacted: 0, quoted: 0, booked: 0, lost: 0, archived: 0 };
  byStatusRows.forEach((r) => { if (r.status in byStatus) byStatus[r.status] = r.c; });
  res.json({
    leads_total: db.prepare("SELECT COUNT(*) c FROM leads").get().c,
    leads_new: byStatus.new,
    leads_week: db.prepare("SELECT COUNT(*) c FROM leads WHERE created_at >= ?").get(weekAgo).c,
    packages: db.prepare("SELECT COUNT(*) c FROM packages").get().c,
    portfolio: db.prepare("SELECT COUNT(*) c FROM portfolio").get().c,
    by_status: byStatus,
    recent: db
      .prepare("SELECT id, name, email, package_name, status, created_at FROM leads ORDER BY created_at DESC LIMIT 5")
      .all(),
    by_package: db
      .prepare("SELECT COALESCE(NULLIF(package_name, ''), 'Not specified') AS name, COUNT(*) c FROM leads GROUP BY name ORDER BY c DESC, name LIMIT 6")
      .all()
  });
});

// Reorder a package or portfolio item up/down (swaps with its neighbour).
function moveRow(table, id, dir) {
  const ids = db.prepare("SELECT id FROM " + table + " ORDER BY sort_order, id").all().map((r) => r.id);
  const i = ids.indexOf(id);
  if (i < 0) return false;
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= ids.length) return false;
  const tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
  const upd = db.prepare("UPDATE " + table + " SET sort_order = ? WHERE id = ?");
  db.transaction(() => { ids.forEach((rid, k) => upd.run(k, rid)); })();
  return true;
}

router.post("/packages/:id/move", (req, res) => {
  const ok = moveRow("packages", Number(req.params.id), req.body && req.body.dir === "up" ? "up" : "down");
  if (!ok) return res.status(400).json({ error: "Cannot move further." });
  res.json({ ok: true });
});
router.post("/portfolio/:id/move", (req, res) => {
  const ok = moveRow("portfolio", Number(req.params.id), req.body && req.body.dir === "up" ? "up" : "down");
  if (!ok) return res.status(400).json({ error: "Cannot move further." });
  res.json({ ok: true });
});

// Feature status (used by the dashboard/settings to show what's configured).
router.get("/status", (req, res) => {
  res.json({ email_configured: mailer.isConfigured() });
});

// ---------------------------------------------------------------------------
// Image upload (returns URLs for the optimised full image + square thumbnail)
// ---------------------------------------------------------------------------
router.post("/upload", (req, res) => {
  uploadImage.single("image")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });
    try {
      const out = await processUpload(req.file.buffer);
      res.json(out);
    } catch (e) {
      console.error("[upload]", e);
      res.status(500).json({ error: "Could not process the image." });
    }
  });
});

// ---------------------------------------------------------------------------
// Database backup — downloads a consistent copy of the SQLite file
// ---------------------------------------------------------------------------
router.get("/backup", async (req, res) => {
  const tmp = path.join(os.tmpdir(), "cc-backup-" + Date.now() + ".db");
  try {
    await db.backup(tmp);
    res.download(tmp, "creativeconnect-backup.db", () => {
      fs.unlink(tmp, () => {});
    });
  } catch (e) {
    console.error("[backup]", e);
    res.status(500).json({ error: "Backup failed." });
  }
});

// ---------------------------------------------------------------------------
// Site settings (home content + contact + analytics)
// ---------------------------------------------------------------------------
const SETTING_KEYS = [
  "business_name", "hero_eyebrow", "hero_title", "hero_subtitle",
  "trust_items", "footer_about",
  "instagram_handle", "whatsapp", "email",
  "ga4_measurement_id", "hubspot_portal_id", "hubspot_form_id",
  "smtp_host", "smtp_port", "smtp_secure", "smtp_user", "smtp_pass", "mail_from", "mail_to"
];

router.get("/settings", (req, res) => {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  // Return trust_items as an array for convenience.
  out.trust_items = safeParse(out.trust_items, []);
  // Never send the SMTP password to the client — just whether one is set.
  out.smtp_pass_set = !!out.smtp_pass;
  delete out.smtp_pass;
  res.json(out);
});

router.put("/settings", (req, res) => {
  const body = req.body || {};
  const upsert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  const tx = db.transaction((entries) => {
    for (const [key, value] of entries) upsert.run(key, value);
  });

  const entries = [];
  for (const key of SETTING_KEYS) {
    if (!(key in body)) continue;
    // Keep the existing SMTP password when the field is left blank.
    if (key === "smtp_pass" && !String(body[key] || "").trim()) continue;
    let value = body[key];
    if (key === "trust_items") {
      if (Array.isArray(value)) {
        value = JSON.stringify(value.map((v) => String(v).trim()).filter(Boolean));
      } else {
        // accept newline-separated text too
        value = JSON.stringify(String(value).split("\n").map((v) => v.trim()).filter(Boolean));
      }
    } else {
      value = String(value == null ? "" : value);
    }
    entries.push([key, value]);
  }
  tx(entries);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------
function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function normFeatures(features) {
  if (Array.isArray(features)) return features.map((f) => String(f).trim()).filter(Boolean);
  return String(features || "").split("\n").map((f) => f.trim()).filter(Boolean);
}

router.get("/packages", (req, res) => {
  const rows = db.prepare("SELECT * FROM packages ORDER BY sort_order, id").all();
  res.json(rows.map((p) => ({ ...p, popular: !!p.popular, active: !!p.active, features: safeParse(p.features, []) })));
});

router.post("/packages", (req, res) => {
  const b = req.body || {};
  const name = String(b.name || "").trim();
  if (!name) return res.status(400).json({ error: "Name is required." });
  let slug = slugify(b.slug || name);
  if (!slug) slug = "package-" + Date.now();
  // Ensure unique slug.
  const exists = db.prepare("SELECT 1 FROM packages WHERE slug = ?").get(slug);
  if (exists) slug = slug + "-" + Date.now().toString(36).slice(-4);

  const info = db
    .prepare(
      `INSERT INTO packages (slug, name, price, popular, image, features, sort_order, active)
       VALUES (?,?,?,?,?,?,?,?)`
    )
    .run(
      slug,
      name,
      String(b.price || ""),
      b.popular ? 1 : 0,
      String(b.image || ""),
      JSON.stringify(normFeatures(b.features)),
      Number(b.sort_order) || 0,
      b.active === false ? 0 : 1
    );
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});

router.put("/packages/:id", (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM packages WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Package not found." });
  const b = req.body || {};
  const name = b.name != null ? String(b.name).trim() : row.name;
  if (!name) return res.status(400).json({ error: "Name is required." });

  db.prepare(
    `UPDATE packages SET name = ?, price = ?, popular = ?, image = ?, features = ?, sort_order = ?, active = ? WHERE id = ?`
  ).run(
    name,
    b.price != null ? String(b.price) : row.price,
    b.popular != null ? (b.popular ? 1 : 0) : row.popular,
    b.image != null ? String(b.image) : row.image,
    b.features != null ? JSON.stringify(normFeatures(b.features)) : row.features,
    b.sort_order != null ? Number(b.sort_order) || 0 : row.sort_order,
    b.active != null ? (b.active ? 1 : 0) : row.active,
    id
  );
  res.json({ ok: true });
});

router.delete("/packages/:id", (req, res) => {
  const info = db.prepare("DELETE FROM packages WHERE id = ?").run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: "Package not found." });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------
router.get("/portfolio", (req, res) => {
  const rows = db.prepare("SELECT * FROM portfolio ORDER BY sort_order, id").all();
  res.json(rows.map((p) => ({ ...p, active: !!p.active })));
});

router.post("/portfolio", (req, res) => {
  const b = req.body || {};
  const title = String(b.title || "").trim();
  if (!title) return res.status(400).json({ error: "Title is required." });
  const info = db
    .prepare(
      `INSERT INTO portfolio (title, category, image_url, full_url, alt, sort_order, active)
       VALUES (?,?,?,?,?,?,?)`
    )
    .run(
      title,
      String(b.category || "").trim(),
      String(b.image_url || "").trim(),
      String(b.full_url || "").trim(),
      String(b.alt || "").trim(),
      Number(b.sort_order) || 0,
      b.active === false ? 0 : 1
    );
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});

router.put("/portfolio/:id", (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM portfolio WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Portfolio item not found." });
  const b = req.body || {};
  const title = b.title != null ? String(b.title).trim() : row.title;
  if (!title) return res.status(400).json({ error: "Title is required." });

  db.prepare(
    `UPDATE portfolio SET title = ?, category = ?, image_url = ?, full_url = ?, alt = ?, sort_order = ?, active = ? WHERE id = ?`
  ).run(
    title,
    b.category != null ? String(b.category).trim() : row.category,
    b.image_url != null ? String(b.image_url).trim() : row.image_url,
    b.full_url != null ? String(b.full_url).trim() : row.full_url,
    b.alt != null ? String(b.alt).trim() : row.alt,
    b.sort_order != null ? Number(b.sort_order) || 0 : row.sort_order,
    b.active != null ? (b.active ? 1 : 0) : row.active,
    id
  );
  res.json({ ok: true });
});

router.delete("/portfolio/:id", (req, res) => {
  const info = db.prepare("DELETE FROM portfolio WHERE id = ?").run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: "Portfolio item not found." });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Leads (the CRM inbox)
// ---------------------------------------------------------------------------
const LEAD_STATUSES = ["new", "contacted", "quoted", "booked", "lost", "archived"];

router.get("/leads/export.csv", (req, res) => {
  const rows = db.prepare("SELECT * FROM leads ORDER BY created_at DESC").all();
  const cols = ["id", "created_at", "name", "email", "phone", "shoot_type", "package_name", "preferred_date", "project_details", "budget_range", "locations", "consent", "status", "notes"];
  const esc = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  const csv = [cols.join(",")]
    .concat(rows.map((r) => cols.map((c) => esc(r[c])).join(",")))
    .join("\r\n");
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", 'attachment; filename="creativeconnect-leads.csv"');
  res.send(csv);
});

// Leads over time for the dashboard chart.
router.get("/leads/timeseries", (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 1), 90);
  // Bucket by UTC date so the keys match substr(created_at,1,10) (stored in UTC).
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const since = new Date(todayUtc - (days - 1) * 86400000);
  const rows = db
    .prepare("SELECT substr(created_at,1,10) AS d, COUNT(*) AS c FROM leads WHERE created_at >= ? GROUP BY d")
    .all(since.toISOString());
  const map = {};
  rows.forEach((r) => { map[r.d] = r.c; });
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since.getTime() + i * 86400000);
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, count: map[key] || 0 });
  }
  res.json(out);
});

// Leads list with optional status filter, text search and pagination.
router.get("/leads", (req, res) => {
  const status = req.query.status;
  const q = String(req.query.q || "").trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const where = [];
  const params = [];
  if (status && LEAD_STATUSES.includes(String(status))) {
    where.push("status = ?");
    params.push(String(status));
  }
  if (q) {
    where.push("(name LIKE ? OR email LIKE ? OR phone LIKE ? OR package_name LIKE ? OR shoot_type LIKE ?)");
    const like = "%" + q + "%";
    params.push(like, like, like, like, like);
  }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

  const total = db.prepare("SELECT COUNT(*) AS c FROM leads " + whereSql).get(...params).c;
  const rows = db
    .prepare("SELECT * FROM leads " + whereSql + " ORDER BY created_at DESC LIMIT ? OFFSET ?")
    .all(...params, limit, offset)
    .map((r) => ({ ...r, consent: !!r.consent }));

  res.json({ rows: rows, total: total, limit: limit, offset: offset });
});

router.patch("/leads/:id", (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM leads WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Lead not found." });
  const b = req.body || {};
  const status = b.status != null ? String(b.status) : row.status;
  if (!LEAD_STATUSES.includes(status)) {
    return res.status(400).json({ error: "Invalid status." });
  }
  const notes = b.notes != null ? String(b.notes).slice(0, 5000) : row.notes;
  db.prepare("UPDATE leads SET status = ?, notes = ? WHERE id = ?").run(status, notes, id);
  res.json({ ok: true });
});

router.delete("/leads/:id", (req, res) => {
  const info = db.prepare("DELETE FROM leads WHERE id = ?").run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: "Lead not found." });
  res.json({ ok: true });
});

// Bulk actions on leads (archive/mark/delete several at once)
router.post("/leads/bulk", (req, res) => {
  const b = req.body || {};
  const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: "No leads selected." });
  const ph = ids.map(() => "?").join(",");
  if (b.action === "delete") {
    db.prepare("DELETE FROM leads WHERE id IN (" + ph + ")").run(...ids);
    return res.json({ ok: true, affected: ids.length });
  }
  if (b.action === "status") {
    const status = String(b.status || "");
    if (!LEAD_STATUSES.includes(status)) return res.status(400).json({ error: "Invalid status." });
    db.prepare("UPDATE leads SET status = ? WHERE id IN (" + ph + ")").run(status, ...ids);
    return res.json({ ok: true, affected: ids.length });
  }
  res.status(400).json({ error: "Unknown bulk action." });
});

// ---------------------------------------------------------------------------
// Bulk reorder (drag & drop) for packages / portfolio
// ---------------------------------------------------------------------------
function reorderRows(table, ids) {
  if (!Array.isArray(ids) || !ids.length) return;
  const upd = db.prepare("UPDATE " + table + " SET sort_order = ? WHERE id = ?");
  db.transaction(() => { ids.forEach((id, i) => upd.run(i, Number(id))); })();
}
router.post("/packages/reorder", (req, res) => { reorderRows("packages", (req.body || {}).ids); res.json({ ok: true }); });
router.post("/portfolio/reorder", (req, res) => { reorderRows("portfolio", (req.body || {}).ids); res.json({ ok: true }); });

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------
router.get("/analytics", (req, res) => {
  const days = 30;
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const since = new Date(todayUtc - (days - 1) * 86400000);
  const tsRows = db.prepare("SELECT substr(created_at,1,10) AS d, COUNT(*) AS c FROM leads WHERE created_at >= ? GROUP BY d").all(since.toISOString());
  const tsMap = {};
  tsRows.forEach((r) => { tsMap[r.d] = r.c; });
  const timeseries = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since.getTime() + i * 86400000);
    const k = d.toISOString().slice(0, 10);
    timeseries.push({ date: k, count: tsMap[k] || 0 });
  }
  const byStatusRows = db.prepare("SELECT status, COUNT(*) c FROM leads GROUP BY status").all();
  const byStatus = { new: 0, contacted: 0, quoted: 0, booked: 0, lost: 0, archived: 0 };
  byStatusRows.forEach((r) => { if (r.status in byStatus) byStatus[r.status] = r.c; });
  const total = db.prepare("SELECT COUNT(*) c FROM leads").get().c;
  res.json({
    days: days,
    total: total,
    booked: byStatus.booked,
    conversion: total ? Math.round(byStatus.booked / total * 100) : 0,
    timeseries: timeseries,
    by_status: byStatus,
    by_shoot_type: db.prepare("SELECT COALESCE(NULLIF(shoot_type,''),'Not specified') AS name, COUNT(*) c FROM leads GROUP BY name ORDER BY c DESC, name").all(),
    by_package: db.prepare("SELECT COALESCE(NULLIF(package_name,''),'Not specified') AS name, COUNT(*) c FROM leads GROUP BY name ORDER BY c DESC, name").all()
  });
});

// ---------------------------------------------------------------------------
// Admin users (owner only)
// ---------------------------------------------------------------------------
router.get("/users", auth.requireOwner, (req, res) => {
  res.json(db.prepare("SELECT id, username, role, created_at FROM admins ORDER BY id").all());
});
router.post("/users", auth.requireOwner, (req, res) => {
  const b = req.body || {};
  const username = String(b.username || "").trim();
  const password = String(b.password || "");
  const role = b.role === "owner" ? "owner" : "editor";
  if (!username) return res.status(400).json({ error: "Username is required." });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  if (db.prepare("SELECT 1 FROM admins WHERE username = ?").get(username)) return res.status(400).json({ error: "That username is taken." });
  const info = db.prepare("INSERT INTO admins (username, password_hash, role, created_at) VALUES (?,?,?,?)")
    .run(username, bcrypt.hashSync(password, 12), role, new Date().toISOString());
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});
router.put("/users/:id", auth.requireOwner, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM admins WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "User not found." });
  const b = req.body || {};
  if (b.role) {
    const role = b.role === "owner" ? "owner" : "editor";
    if (role !== "owner" && row.role === "owner") {
      const owners = db.prepare("SELECT COUNT(*) c FROM admins WHERE role='owner'").get().c;
      if (owners <= 1) return res.status(400).json({ error: "There must be at least one owner." });
    }
    db.prepare("UPDATE admins SET role = ? WHERE id = ?").run(role, id);
  }
  if (b.password) {
    if (String(b.password).length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
    db.prepare("UPDATE admins SET password_hash = ? WHERE id = ?").run(bcrypt.hashSync(String(b.password), 12), id);
  }
  res.json({ ok: true });
});
router.delete("/users/:id", auth.requireOwner, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.admin.id) return res.status(400).json({ error: "You can't delete your own account." });
  const row = db.prepare("SELECT * FROM admins WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "User not found." });
  if (row.role === "owner") {
    const owners = db.prepare("SELECT COUNT(*) c FROM admins WHERE role='owner'").get().c;
    if (owners <= 1) return res.status(400).json({ error: "Can't delete the last owner." });
  }
  db.prepare("DELETE FROM admins WHERE id = ?").run(id);
  res.json({ ok: true });
});

// Test the configured SMTP settings by sending a test email.
router.post("/settings/test-email", async (req, res) => {
  try {
    const r = await mailer.sendTest();
    res.json({ ok: true, to: r.to });
  } catch (e) {
    res.status(400).json({ error: (e && e.message) || "Test email failed." });
  }
});

module.exports = router;
