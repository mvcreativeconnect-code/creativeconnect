/*
 * CreativeConnect — GA4 + Google Consent Mode v2 + event helpers.
 * Exposes:
 *   CC.track(name, params)          -> fire an event (or console.info in local mode)
 *   CC.trackLead(name, params, cb)  -> fire an event, then call cb once the hit is sent
 *                                       (event_callback with a 1s timeout fallback)
 *   CC.openConsent()                -> re-open the cookie banner
 */
(function () {
  "use strict";

  var cfg = window.CC_CONFIG || {};
  var GA_ID = cfg.ga4MeasurementId || "G-XXXXXXXXXX";
  var GA_ENABLED = !!GA_ID && GA_ID !== "G-XXXXXXXXXX";
  var CONSENT_KEY = "cc_consent";
  var DEBUG = /[?&]debug_mode=1(&|$)/.test(window.location.search);

  // --- gtag bootstrap -------------------------------------------------------
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  // Consent Mode v2 defaults — everything denied, set BEFORE config.
  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "denied",
    wait_for_update: 500
  });

  // Honour a previously granted choice on repeat visits.
  var storedConsent = readConsent();
  if (storedConsent === "granted") {
    gtag("consent", "update", { analytics_storage: "granted" });
  }

  // Load gtag.js only when a real Measurement ID is configured.
  if (GA_ENABLED) {
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GA_ID);
    document.head.appendChild(s);

    gtag("js", new Date());
    var configParams = {};
    if (DEBUG) configParams.debug_mode = true;
    gtag("config", GA_ID, configParams); // fires page_view automatically
  } else {
    console.info("[GA4] Measurement ID not set — running in local console mode.");
  }

  // --- public helpers -------------------------------------------------------
  function track(name, params) {
    params = params || {};
    if (DEBUG) params.debug_mode = true;
    if (GA_ENABLED) {
      gtag("event", name, params);
    } else {
      console.info("[GA4 event]", name, params);
    }
  }

  // Fires an event and calls done() once the hit is sent (or after 1s), so a
  // redirect after generate_lead never hangs.
  function trackLead(name, params, done) {
    params = params || {};
    if (DEBUG) params.debug_mode = true;
    var finished = false;
    function finish() { if (!finished) { finished = true; if (typeof done === "function") done(); } }

    if (GA_ENABLED) {
      params.event_callback = finish;
      gtag("event", name, params);
      setTimeout(finish, 1000); // fallback so we never wait forever
    } else {
      console.info("[GA4 event]", name, params);
      setTimeout(finish, 300);
    }
  }

  // --- consent storage ------------------------------------------------------
  function readConsent() {
    try { return localStorage.getItem(CONSENT_KEY); } catch (e) { return null; }
  }
  function writeConsent(value) {
    try { localStorage.setItem(CONSENT_KEY, value); } catch (e) {}
  }

  // --- cookie banner --------------------------------------------------------
  var bannerEl = null;

  function buildBanner() {
    var el = document.createElement("div");
    el.className = "cookie-banner";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-live", "polite");
    el.setAttribute("aria-label", "Cookie consent");
    el.innerHTML =
      '<div class="cookie-banner__inner">' +
        '<p class="cookie-banner__text">We use cookies to measure visits and understand how people use this site. ' +
          'They only run if you accept, and store no personal data. ' +
          '<a href="privacy.html">Privacy &amp; cookies</a>.</p>' +
        '<div class="cookie-banner__actions">' +
          '<button type="button" class="btn btn-ghost" data-consent="decline">Decline</button>' +
          '<button type="button" class="btn btn-primary" data-consent="accept">Accept</button>' +
        '</div>' +
      '</div>';
    el.querySelector('[data-consent="accept"]').addEventListener("click", acceptConsent);
    el.querySelector('[data-consent="decline"]').addEventListener("click", declineConsent);
    return el;
  }

  function showBanner() {
    if (!bannerEl) {
      bannerEl = buildBanner();
      document.body.appendChild(bannerEl);
    }
    // Force a reflow so the slide-up transition runs, then reveal. This works
    // synchronously and doesn't depend on requestAnimationFrame (which is
    // throttled/paused in background tabs).
    void bannerEl.offsetWidth;
    bannerEl.classList.add("is-visible");
  }

  function hideBanner() {
    if (bannerEl) bannerEl.classList.remove("is-visible");
  }

  function acceptConsent() {
    writeConsent("granted");
    gtag("consent", "update", { analytics_storage: "granted" });
    hideBanner();
    // Let the visitor tracker (visits.js) start immediately on this page load.
    document.dispatchEvent(new Event("cc:consent-granted"));
  }

  function declineConsent() {
    writeConsent("denied");
    gtag("consent", "update", { analytics_storage: "denied" });
    hideBanner();
  }

  function openConsent() { showBanner(); }

  // --- expose + wire up -----------------------------------------------------
  window.CC = window.CC || {};
  window.CC.track = track;
  window.CC.trackLead = trackLead;
  window.CC.openConsent = openConsent;

  function init() {
    // Show the banner once, only if no choice has been made yet.
    if (readConsent() === null) showBanner();

    // Footer "Cookie settings" link(s) re-open the banner.
    var settings = document.querySelectorAll("[data-cookie-settings]");
    settings.forEach(function (link) {
      link.addEventListener("click", function (e) {
        e.preventDefault();
        openConsent();
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
