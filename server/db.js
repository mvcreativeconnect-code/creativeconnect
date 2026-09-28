/*
 * CreativeConnect — database layer (SQLite via better-sqlite3).
 * Creates the schema on first run and seeds it from the site's original
 * content so the live site looks identical until you edit it in the admin.
 *
 * Tables: settings (key/value), packages, portfolio, leads, admins.
 */
"use strict";

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "creativeconnect.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS packages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    slug       TEXT UNIQUE NOT NULL,
    name       TEXT NOT NULL,
    price      TEXT NOT NULL DEFAULT '',
    popular    INTEGER NOT NULL DEFAULT 0,
    image      TEXT NOT NULL DEFAULT '',
    features   TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
    sort_order INTEGER NOT NULL DEFAULT 0,
    active     INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS portfolio (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    category   TEXT NOT NULL DEFAULT '',
    image_url  TEXT NOT NULL DEFAULT '',
    full_url   TEXT NOT NULL DEFAULT '',
    alt        TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    active     INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS leads (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    email          TEXT NOT NULL,
    phone          TEXT NOT NULL DEFAULT '',
    shoot_type     TEXT NOT NULL DEFAULT '',
    package_name   TEXT NOT NULL DEFAULT '',
    preferred_date TEXT NOT NULL DEFAULT '',
    consent        INTEGER NOT NULL DEFAULT 0,
    status         TEXT NOT NULL DEFAULT 'new',
    source         TEXT NOT NULL DEFAULT 'website',
    notes          TEXT NOT NULL DEFAULT '',
    created_at     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS admins (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_leads_created ON leads (created_at);
  CREATE INDEX IF NOT EXISTS idx_leads_status  ON leads (status);
`);

// --- Migrations ------------------------------------------------------------
// Add a role column to admins (owner | editor) for multi-user support.
// Extra brief fields captured with a custom-quote ("Going Big") request.
var leadCols = db.prepare("PRAGMA table_info(leads)").all().map((c) => c.name);
["project_details", "budget_range", "locations"].forEach(function (col) {
  if (leadCols.indexOf(col) === -1) {
    db.exec("ALTER TABLE leads ADD COLUMN " + col + " TEXT NOT NULL DEFAULT ''");
  }
});

var adminCols = db.prepare("PRAGMA table_info(admins)").all().map((c) => c.name);
if (adminCols.indexOf("role") === -1) {
  db.exec("ALTER TABLE admins ADD COLUMN role TEXT NOT NULL DEFAULT 'editor'");
}

// ---------------------------------------------------------------------------
// Default content — mirrors the original static site so nothing visibly
// changes until an admin edits it. (Canonical seed lives here.)
// ---------------------------------------------------------------------------
const DEFAULT_SETTINGS = {
  business_name: "CreativeConnect",
  hero_eyebrow: "Book your shoot in 60 seconds",
  hero_title: "Your story, beautifully shot.",
  hero_subtitle: "Photo and video for weddings, events and brands across the Maldives.",
  trust_items: JSON.stringify([
    "Written quote before you book",
    "Photo + video in one team",
    "Island-wide travel"
  ]),
  footer_about: "Photo and video production across the Maldives. We help couples and brands turn moments into work they're proud to share.",
  instagram_handle: "mvcreativeconnect",
  whatsapp: "9607428224",
  email: "mvcreativeconnect@gmail.com",
  ga4_measurement_id: "G-XXXXXXXXXX",
  hubspot_portal_id: "",
  hubspot_form_id: "",
  smtp_host: "",
  smtp_port: "587",
  smtp_secure: "false",
  smtp_user: "",
  smtp_pass: "",
  mail_from: "",
  mail_to: ""
};

const DEFAULT_PACKAGES = [
  {
    slug: "essentials", name: "Essentials", price: "MVR 2,500", popular: 0, image: "package-essentials",
    features: ["Up to 2 hours at one location", "30 edited photos", "Private online gallery", "Target delivery: 5 business days"]
  },
  {
    slug: "story", name: "Story", price: "MVR 5,500", popular: 1, image: "package-story",
    features: ["Up to 4 hours of photo and video", "80 edited photos", "One 60-second highlight reel", "Private online gallery", "Target delivery: 7 business days"]
  },
  {
    slug: "brand", name: "Brand", price: "MVR 9,500", popular: 0, image: "package-brand",
    features: ["Up to 8 hours of photo and video", "120 edited photos", "Three short vertical social reels", "Use on your own website and organic social", "Target delivery: 10 business days"]
  },
  {
    slug: "going-big", name: "Going Big", price: "Custom price", popular: 0, image: "package-goingbig",
    features: ["Full weddings, resort campaigns and multi-location events", "Crew, schedule and deliverables planned around your brief", "Drone, talent and styling quoted as needed", "No fixed hours or deliverable counts", "Timeline agreed in the quote"]
  }
];

function pic(seed, size) {
  return "https://picsum.photos/seed/" + encodeURIComponent(seed) + "/" + size;
}
const DEFAULT_PORTFOLIO = [
  { title: "Beach wedding ceremony",        category: "Weddings & Events", seed: "wedding-1",  alt: "Beach wedding ceremony at sunset" },
  { title: "Couple portrait by the water",  category: "Weddings & Events", seed: "wedding-2",  alt: "Couple portrait by the water" },
  { title: "Event celebration with guests", category: "Weddings & Events", seed: "wedding-3",  alt: "Event celebration with guests" },
  { title: "Resort brand lifestyle shot",   category: "Brand & Product",   seed: "brand-1",    alt: "Resort brand lifestyle shot" },
  { title: "Product flat-lay for social",   category: "Brand & Product",   seed: "brand-2",    alt: "Product flat-lay for social media" },
  { title: "Café interior brand photo",     category: "Brand & Product",   seed: "brand-3",    alt: "Café interior brand photography" },
  { title: "Graduation portrait outdoors",  category: "Portraits",         seed: "portrait-1", alt: "Graduation portrait outdoors" },
  { title: "Studio headshot",               category: "Portraits",         seed: "portrait-2", alt: "Studio headshot on dark background" },
  { title: "Family portrait on the beach",  category: "Portraits",         seed: "portrait-3", alt: "Family portrait on the beach" }
];

// ---------------------------------------------------------------------------
// Seed (idempotent). Existing rows/edits are never overwritten.
// ---------------------------------------------------------------------------
function seed() {
  const now = new Date().toISOString();

  const insSetting = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(key, value);

  const pkgCount = db.prepare("SELECT COUNT(*) AS c FROM packages").get().c;
  if (pkgCount === 0) {
    const ins = db.prepare(
      "INSERT INTO packages (slug, name, price, popular, image, features, sort_order, active) VALUES (?,?,?,?,?,?,?,1)"
    );
    DEFAULT_PACKAGES.forEach((p, i) =>
      ins.run(p.slug, p.name, p.price, p.popular, p.image, JSON.stringify(p.features), i)
    );
  }

  const pfCount = db.prepare("SELECT COUNT(*) AS c FROM portfolio").get().c;
  if (pfCount === 0) {
    const ins = db.prepare(
      "INSERT INTO portfolio (title, category, image_url, full_url, alt, sort_order, active) VALUES (?,?,?,?,?,?,1)"
    );
    DEFAULT_PORTFOLIO.forEach((p, i) =>
      ins.run(p.title, p.category, pic(p.seed, "600/600"), pic(p.seed, "1200/1200"), p.alt, i)
    );
  }

  // Bootstrap the first admin. Password comes from env; if unset, a strong
  // random one is generated and printed once so the app is never wide open.
  const adminCount = db.prepare("SELECT COUNT(*) AS c FROM admins").get().c;
  if (adminCount === 0) {
    const username = process.env.ADMIN_USERNAME || "admin";
    let password = process.env.ADMIN_PASSWORD;
    let generated = false;
    if (!password) {
      password = crypto.randomBytes(9).toString("base64url"); // ~12 chars
      generated = true;
    }
    const hash = bcrypt.hashSync(password, 12);
    db.prepare("INSERT INTO admins (username, password_hash, role, created_at) VALUES (?,?,?,?)")
      .run(username, hash, "owner", now);

    console.log("\n==================== ADMIN ACCOUNT CREATED ====================");
    console.log("  Username: " + username);
    if (generated) {
      console.log("  Password: " + password + "   <-- generated, save it now");
      console.log("  (set ADMIN_PASSWORD in .env to choose your own next time)");
    } else {
      console.log("  Password: (from ADMIN_PASSWORD in your environment)");
    }
    console.log("  Change it any time from the admin dashboard.");
    console.log("===============================================================\n");
  }

  // Guarantee at least one owner (older DBs default the new column to 'editor').
  const owners = db.prepare("SELECT COUNT(*) AS c FROM admins WHERE role = 'owner'").get().c;
  if (owners === 0) {
    const first = db.prepare("SELECT id FROM admins ORDER BY id LIMIT 1").get();
    if (first) db.prepare("UPDATE admins SET role = 'owner' WHERE id = ?").run(first.id);
  }
}
seed();

// ---------------------------------------------------------------------------
// Read helpers used by the public site (config.js + server-rendered home).
// ---------------------------------------------------------------------------
function getSettings() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

function getActivePackages() {
  return db
    .prepare("SELECT * FROM packages WHERE active = 1 ORDER BY sort_order, id")
    .all()
    .map((p) => ({
      id: p.slug,
      name: p.name,
      price: p.price,
      popular: !!p.popular,
      image: p.image,
      includes: safeParse(p.features, [])
    }));
}

function getActivePortfolio() {
  return db
    .prepare("SELECT * FROM portfolio WHERE active = 1 ORDER BY sort_order, id")
    .all()
    .map((p) => ({
      title: p.title,
      category: p.category,
      image_url: p.image_url,
      full_url: p.full_url || p.image_url,
      alt: p.alt || p.title
    }));
}

// Public site config consumed by the browser as window.CC_CONFIG.
function getPublicConfig() {
  const s = getSettings();
  return {
    ga4MeasurementId: s.ga4_measurement_id || "G-XXXXXXXXXX",
    hubspot: { portalId: s.hubspot_portal_id || "", formId: s.hubspot_form_id || "" },
    instagramHandle: s.instagram_handle || "",
    whatsapp: s.whatsapp || "",
    email: s.email || "",
    hero: {
      eyebrow: s.hero_eyebrow || "",
      title: s.hero_title || "",
      subtitle: s.hero_subtitle || ""
    },
    trust: safeParse(s.trust_items, []),
    businessName: s.business_name || "CreativeConnect",
    footerAbout: s.footer_about || "",
    packages: getActivePackages(),
    portfolio: getActivePortfolio()
  };
}

function safeParse(str, fallback) {
  try {
    const v = JSON.parse(str);
    return v == null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

module.exports = {
  db,
  DB_PATH,
  getSettings,
  getActivePackages,
  getActivePortfolio,
  getPublicConfig,
  safeParse
};
