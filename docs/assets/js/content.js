/*
 * CreativeConnect — live content loader (static build).
 * The site renders instantly from the built-in config.js, then this fetches the
 * latest editable content from Supabase (site_config row) and, if present,
 * updates window.CC_CONFIG in place and fires "cc:content-updated" so the page
 * re-renders. If Supabase is unreachable or empty, the built-in content stands.
 * Only public/editable fields are touched — never the supabase keys.
 */
(function () {
  "use strict";

  var sb = (window.CC_CONFIG && window.CC_CONFIG.supabase) || {};
  var base = String(sb.url || "").replace(/\/+$/, "");
  if (!base || !sb.anonKey) return;

  // Editable keys the admin manages. (ga4MeasurementId is applied by analytics.js
  // at page load, so we don't hot-swap it here — it takes effect on next deploy.)
  var KEYS = ["businessName", "hero", "trust", "footerAbout",
              "instagramHandle", "whatsapp", "email", "packages", "portfolio"];

  fetch(base + "/rest/v1/site_config?select=data&id=eq.1", {
    headers: {
      "apikey": sb.anonKey,
      "Authorization": "Bearer " + sb.anonKey,
      "Accept": "application/json"
    }
  }).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }).then(function (rows) {
    var data = rows && rows[0] && rows[0].data;
    if (!data || typeof data !== "object") return;
    var c = window.CC_CONFIG;
    KEYS.forEach(function (k) { if (data[k] !== undefined) c[k] = data[k]; });
    whenReady(function () { document.dispatchEvent(new Event("cc:content-updated")); });
  }).catch(function (e) {
    if (window.console) console.info("[content] using built-in content (" + e.message + ")");
  });

  function whenReady(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }
})();
