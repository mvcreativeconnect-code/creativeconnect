/*
 * CreativeConnect — privacy-friendly visitor tracking (static build).
 * Records one visit per page load into Supabase, but ONLY after the visitor
 * accepts cookies. Stores no personal data: a random anonymous id (cookie),
 * the page path, referrer host, and a coarse device/browser label.
 *
 * "New vs returning" comes from whether the anonymous cookie already existed.
 */
(function () {
  "use strict";

  var sb = (window.CC_CONFIG && window.CC_CONFIG.supabase) || {};
  var BASE = String(sb.url || "").replace(/\/+$/, "");
  var ANON = sb.anonKey || "";
  var COOKIE = "cc_vid";
  if (!BASE || !ANON) return;

  var tracked = false;

  function granted() {
    try { return localStorage.getItem("cc_consent") === "granted"; } catch (e) { return false; }
  }

  function getCookie(name) {
    var m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function setCookie(name, value, days) {
    var d = new Date(); d.setTime(d.getTime() + days * 864e5);
    document.cookie = name + "=" + encodeURIComponent(value) +
      ";expires=" + d.toUTCString() + ";path=/;SameSite=Lax";
  }
  function randomId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "v-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function device(ua) {
    if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return "Tablet";
    if (/Mobi|Android|iPhone|iPod|Windows Phone/i.test(ua)) return "Mobile";
    return "Desktop";
  }
  function browser(ua) {
    if (/Edg\//.test(ua)) return "Edge";
    if (/OPR\/|Opera/.test(ua)) return "Opera";
    if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) return "Chrome";
    if (/Firefox\//.test(ua)) return "Firefox";
    if (/Safari\//.test(ua) && /Version\//.test(ua)) return "Safari";
    return "Other";
  }
  function refHost() {
    if (!document.referrer) return "direct";
    try {
      var h = new URL(document.referrer).hostname.replace(/^www\./, "");
      if (h === location.hostname) return null; // internal navigation — skip
      return h;
    } catch (e) { return null; }
  }

  function track() {
    if (tracked) return;
    tracked = true;

    var vid = getCookie(COOKIE);
    var isNew = false;
    if (!vid) { vid = randomId(); setCookie(COOKIE, vid, 365); isNew = true; }

    var ua = navigator.userAgent || "";
    fetch(BASE + "/rest/v1/visits", {
      method: "POST",
      headers: {
        "apikey": ANON,
        "Authorization": "Bearer " + ANON,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      },
      body: JSON.stringify({
        visitor_id: vid,
        is_new: isNew,
        path: location.pathname || "/",
        referrer: refHost(),
        device: device(ua),
        browser: browser(ua)
      })
    }).catch(function () { /* analytics must never break the page */ });
  }

  if (granted()) track();
  else document.addEventListener("cc:consent-granted", function () { track(); }, { once: true });
})();
