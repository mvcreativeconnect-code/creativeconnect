/*
 * CreativeConnect — public routes (no auth).
 *   GET  /                      -> server-rendered home page
 *   GET  /index.html            -> same
 *   GET  /assets/js/config.js   -> window.CC_CONFIG generated from the DB
 *   GET  /api/content           -> public content as JSON (handy for tests)
 *   POST /api/leads             -> store a booking request (the CRM inbox)
 */
"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const { db, getPublicConfig } = require("../db");
const { renderHome, generateConfigJs } = require("../render");
const mailer = require("../mailer");

const router = express.Router();

// Guard the lead endpoint against spam / abuse.
const leadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." }
});

function baseUrl(req) {
  return req.protocol + "://" + req.get("host");
}

router.get(["/", "/index.html"], (req, res, next) => {
  try {
    res.set("Cache-Control", "no-cache");
    res.type("html").send(renderHome(baseUrl(req)));
  } catch (err) {
    next(err);
  }
});

// --- SEO: robots.txt + sitemap.xml (URLs built from the request host) ------
router.get("/robots.txt", (req, res) => {
  const base = baseUrl(req);
  res.type("text/plain").send(
    "User-agent: *\n" +
    "Allow: /\n" +
    "Disallow: /admin\n" +
    "Disallow: /api\n" +
    "Sitemap: " + base + "/sitemap.xml\n"
  );
});

router.get("/sitemap.xml", (req, res) => {
  const base = baseUrl(req);
  const today = new Date().toISOString().slice(0, 10);
  const pages = [
    { loc: "/", priority: "1.0" },
    { loc: "/booking.html", priority: "0.9" },
    { loc: "/privacy.html", priority: "0.3" }
  ];
  const urls = pages
    .map((p) => "  <url><loc>" + base + p.loc + "</loc><lastmod>" + today + "</lastmod><priority>" + p.priority + "</priority></url>")
    .join("\n");
  res.type("application/xml").send(
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + "\n</urlset>\n"
  );
});

router.get("/assets/js/config.js", (req, res, next) => {
  try {
    res.set("Cache-Control", "no-cache");
    res.type("application/javascript").send(generateConfigJs());
  } catch (err) {
    next(err);
  }
});

router.get("/api/content", (req, res) => {
  res.json(getPublicConfig());
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post("/api/leads", leadLimiter, express.json({ limit: "16kb" }), (req, res) => {
  const b = req.body || {};

  // Honeypot: bots fill the hidden "website" field. Pretend success, store nothing.
  if (String(b.website || "").trim()) {
    return res.status(201).json({ ok: true });
  }

  const name = String(b.name || b.firstname || "").trim();
  const email = String(b.email || "").trim();
  const phone = String(b.phone || "").trim();
  const shootType = String(b.shoot_type || "").trim();
  const packageName = String(b.package_name || "").trim();
  const preferredDate = String(b.preferred_date || "").trim();
  const projectDetails = String(b.project_details || "").trim().slice(0, 4000);
  const budgetRange = String(b.budget_range || "").trim().slice(0, 120);
  const locations = String(b.locations || "").trim().slice(0, 300);
  const consent = b.consent ? 1 : 0;

  const errors = {};
  if (!name) errors.name = "Name is required.";
  if (!email || !EMAIL_RE.test(email)) errors.email = "A valid email is required.";
  if (!shootType) errors.shoot_type = "Shoot type is required.";
  if (!preferredDate) errors.preferred_date = "Preferred date is required.";
  if (!consent) errors.consent = "Consent is required.";

  // Cap field lengths defensively.
  if (name.length > 200 || email.length > 200 || phone.length > 60) {
    return res.status(400).json({ error: "One or more fields are too long." });
  }
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: "Validation failed.", fields: errors });
  }

  const createdAt = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO leads (name, email, phone, shoot_type, package_name, preferred_date,
                          project_details, budget_range, locations, consent, status, source, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?, 'new', 'website', ?)`
    )
    .run(name, email, phone, shootType, packageName, preferredDate,
         projectDetails, budgetRange, locations, consent, createdAt);

  // Fire-and-forget emails (no-op unless SMTP is configured):
  //  1) notify the business, 2) auto-reply confirmation to the customer.
  const lead = {
    name: name, email: email, phone: phone, shoot_type: shootType,
    package_name: packageName, preferred_date: preferredDate,
    project_details: projectDetails, budget_range: budgetRange, locations: locations,
    created_at: createdAt
  };
  mailer.sendLeadNotification(lead).catch((err) => console.error("[mail] notification failed:", err.message));
  mailer.sendCustomerAutoReply(lead).catch((err) => console.error("[mail] auto-reply failed:", err.message));

  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});

module.exports = router;
