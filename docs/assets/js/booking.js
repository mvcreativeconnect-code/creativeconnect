/*
 * CreativeConnect — booking page logic.
 * Package selector, validation, HubSpot submit (or demo mode), and the
 * generate_lead -> redirect flow.
 */
(function () {
  "use strict";

  var cfg = window.CC_CONFIG || {};
  var CC = window.CC || (window.CC = {});
  var track = CC.track || function () {};
  var trackLead = CC.trackLead || function (n, p, cb) { cb && cb(); };

  var form = document.getElementById("booking-form");
  if (!form) return; // not the booking page

  var packages = cfg.packages || [];
  var selectorEl = document.getElementById("package-selector");
  var hiddenPackage = document.getElementById("field-package");
  var statusEl = document.getElementById("form-status");
  var submitBtn = document.getElementById("submit-btn");
  var formStarted = false;

  // ---------------------------------------------------------------------------
  // Step 1 — package selector (radio group)
  // ---------------------------------------------------------------------------
  function preselectedId() {
    var id = getParam("package");
    var found = packages.some(function (p) { return p.id === id; });
    if (found) return id;
    var popular = packages.filter(function (p) { return p.popular; })[0];
    return popular ? popular.id : (packages[0] && packages[0].id);
  }

  function renderPackages() {
    if (!selectorEl) return;
    var chosen = preselectedId();

    selectorEl.innerHTML = packages.map(function (p) {
      var includes = (p.includes || []).slice(0, 3).map(function (i) {
        return "<li>" + escapeHtml(i) + "</li>";
      }).join("");
      var checked = p.id === chosen;

      return '' +
        '<label class="pkg-option' + (p.popular ? " pkg-option--popular" : "") + '">' +
          '<input type="radio" name="package_choice" value="' + escapeHtml(p.id) + '" ' +
            (checked ? "checked" : "") + '>' +
          '<span class="pkg-option__inner">' +
            (p.popular ? '<span class="pkg-option__badge">Most popular</span>' : "") +
            '<span class="pkg-option__name">' + escapeHtml(p.name) + '</span>' +
            '<span class="pkg-option__price">' + escapeHtml(p.price) + '</span>' +
            '<ul class="pkg-option__includes">' + includes + '</ul>' +
          '</span>' +
        '</label>';
    }).join("");

    // Reflect the initial choice and fire select_package for the pre-select too.
    setPackage(chosen, true);

    selectorEl.addEventListener("change", function (e) {
      if (e.target.name === "package_choice") setPackage(e.target.value, false);
    });
  }

  function setPackage(id, isPreselect) {
    var pkg = packages.filter(function (p) { return p.id === id; })[0];
    if (!pkg) return;
    if (hiddenPackage) hiddenPackage.value = pkg.name;

    // Visual selected state
    Array.prototype.forEach.call(selectorEl.querySelectorAll(".pkg-option"), function (label) {
      var input = label.querySelector("input");
      label.classList.toggle("is-selected", input.checked);
    });

    toggleBrief(isQuoteOnly(pkg));

    track("select_package", { package_name: pkg.name });
    if (!isPreselect) maybeFormStart();
  }

  // ---------------------------------------------------------------------------
  // Custom-quote ("Going Big") brief fields
  // ---------------------------------------------------------------------------
  function isQuoteOnly(pkg) { return !!pkg && /custom quote/i.test(pkg.price || ""); }

  var briefBlock = document.getElementById("brief-block");
  var quoteMode = false;

  function toggleBrief(on) {
    quoteMode = !!on;
    if (!briefBlock) return;
    briefBlock.hidden = !quoteMode;
    var details = document.getElementById("field-project-details");
    if (details) {
      if (quoteMode) { details.setAttribute("required", "required"); details.setAttribute("aria-required", "true"); }
      else { details.removeAttribute("required"); details.removeAttribute("aria-required"); showError("project_details", ""); }
    }
    var submit = document.getElementById("submit-btn");
    if (submit) submit.textContent = quoteMode ? "Request a custom quote" : "Send booking request";
    var dateEl2 = document.getElementById("field-date");
    if (dateEl2) {
      var lbl = document.querySelector('label[for="field-date"]');
      if (lbl) lbl.firstChild.nodeValue = quoteMode ? "Preferred start date " : "Preferred date ";
    }
  }

  // ---------------------------------------------------------------------------
  // form_start — fire once on first interaction
  // ---------------------------------------------------------------------------
  function maybeFormStart() {
    if (formStarted) return;
    formStarted = true;
    track("form_start", { form_id: "booking" });
  }
  form.addEventListener("focusin", maybeFormStart, { once: false });
  form.addEventListener("change", maybeFormStart);

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------
  var fields = {
    firstname: {
      el: form.querySelector("#field-name"),
      validate: function (v) { return v.trim() ? "" : "Please enter your name."; }
    },
    email: {
      el: form.querySelector("#field-email"),
      validate: function (v) {
        if (!v.trim()) return "Please enter your email.";
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? "" : "Please enter a valid email address.";
      }
    },
    shoot_type: {
      el: form.querySelector("#field-shoot-type"),
      validate: function (v) { return v ? "" : "Please choose a shoot type."; }
    },
    preferred_date: {
      el: form.querySelector("#field-date"),
      validate: function (v) {
        if (!v) return "Please choose a preferred date.";
        var today = new Date(); today.setHours(0, 0, 0, 0);
        var picked = new Date(v + "T00:00:00");
        return picked < today ? "Please choose a date that isn't in the past." : "";
      }
    },
    project_details: {
      el: form.querySelector("#field-project-details"),
      validate: function (v) {
        if (!quoteMode) return "";
        return v.trim().length >= 20 ? "" : "Please tell us a little about the project (at least a sentence).";
      }
    },
    consent: {
      el: form.querySelector("#field-consent"),
      validate: function (_v, el) { return el.checked ? "" : "Please agree so we can reply to your request."; }
    }
  };

  // No past dates in the picker itself.
  var dateEl = fields.preferred_date.el;
  if (dateEl) dateEl.min = todayISO();

  function showError(key, message) {
    var f = fields[key];
    if (!f || !f.el) return;
    var errEl = document.getElementById("error-" + key);
    f.el.setAttribute("aria-invalid", message ? "true" : "false");
    if (errEl) errEl.textContent = message;
  }

  function validateField(key) {
    var f = fields[key];
    if (!f || !f.el) return true;
    var message = f.validate(f.el.value, f.el);
    showError(key, message);
    return !message;
  }

  // Live-clear errors as the user fixes them.
  Object.keys(fields).forEach(function (key) {
    var el = fields[key].el;
    if (!el) return;
    el.addEventListener("blur", function () { validateField(key); });
    el.addEventListener("input", function () {
      if (el.getAttribute("aria-invalid") === "true") validateField(key);
    });
    el.addEventListener("change", function () {
      if (el.getAttribute("aria-invalid") === "true") validateField(key);
    });
  });

  function validateAll() {
    var firstInvalid = null;
    Object.keys(fields).forEach(function (key) {
      var ok = validateField(key);
      if (!ok && !firstInvalid) firstInvalid = fields[key].el;
    });
    return firstInvalid;
  }

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    clearStatus();

    var firstInvalid = validateAll();
    if (firstInvalid) {
      setStatus("Please fix the highlighted fields and try again.", "error");
      firstInvalid.focus();
      return; // don't clear the form on error
    }

    var data = collect();
    setLoading(true);

    (cfg.staticMode ? submitLeadStatic(data) : submitLead(data))
      .then(function () {
        // generate_lead only after a successful submission, before redirect.
        trackLead("generate_lead", {
          package_name: data.package_name,
          shoot_type: data.shoot_type,
          form_id: "booking"
        }, function () {
          window.location.href = "thanks.html?package=" + encodeURIComponent(data.package_id) +
            (data.quote_only ? "&type=quote" : "");
        });
      })
      .catch(function (err) {
        console.error("[booking] submit failed:", err);
        setLoading(false);
        showWhatsAppFallback();
      });
  });

  function collect() {
    var chosen = form.querySelector('input[name="package_choice"]:checked');
    var pkgId = chosen ? chosen.value : (packages[0] && packages[0].id);
    var pkg = packages.filter(function (p) { return p.id === pkgId; })[0] || {};
    return {
      firstname: fields.firstname.el.value.trim(),
      email: fields.email.el.value.trim(),
      phone: (form.querySelector("#field-phone") || {}).value ?
             form.querySelector("#field-phone").value.trim() : "",
      shoot_type: fields.shoot_type.el.value,
      preferred_date: fields.preferred_date.el.value,
      consent: fields.consent.el.checked,
      package_id: pkg.id || pkgId,
      package_name: pkg.name || "",
      quote_only: /custom quote/i.test(pkg.price || ""),
      project_details: val("#field-project-details"),
      budget_range: val("#field-budget"),
      locations: val("#field-locations")
    };
  }

  function val(sel) {
    var el = form.querySelector(sel);
    return el && el.value ? el.value.trim() : "";
  }

  // Static build (e.g. GitHub Pages) has no backend, so the request is sent
  // via a pre-filled WhatsApp message instead of being saved to a database.
  function submitLeadStatic(data) {
    var wa = String(cfg.whatsapp || "").replace(/[^0-9]/g, "");
    var msg =
      "New booking request%0A" +
      "Name: " + encodeURIComponent(data.firstname) + "%0A" +
      "Email: " + encodeURIComponent(data.email) + "%0A" +
      "Phone: " + encodeURIComponent(data.phone || "-") + "%0A" +
      "Shoot type: " + encodeURIComponent(data.shoot_type) + "%0A" +
      "Package: " + encodeURIComponent(data.package_name) + "%0A" +
      "Preferred date: " + encodeURIComponent(data.preferred_date);
    var url = wa ? "https://wa.me/" + wa + "?text=" + msg
                 : "mailto:" + (cfg.email || "") + "?subject=Booking%20request&body=" + msg;
    window.open(url, "_blank", "noopener");
    return new Promise(function (resolve) { setTimeout(resolve, 300); });
  }

  // Save the booking request to our own backend. It is stored in the SQLite
  // database and appears in the admin "Leads" inbox. Returns a promise that
  // resolves on success and rejects on any network/validation error (which
  // triggers the WhatsApp fallback message).
  function submitLead(data) {
    return fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: data.firstname,
        email: data.email,
        phone: data.phone,
        shoot_type: data.shoot_type,
        package_name: data.package_name,
        preferred_date: data.preferred_date,
        project_details: data.project_details,
        budget_range: data.budget_range,
        locations: data.locations,
        consent: data.consent,
        website: (document.getElementById("cc-website") || {}).value || "" // honeypot
      })
    }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          throw new Error(body.error || "Server responded " + res.status);
        });
      }
      return res.json().catch(function () { return {}; });
    });
  }

  // ---------------------------------------------------------------------------
  // UI state
  // ---------------------------------------------------------------------------
  function setLoading(loading) {
    submitBtn.disabled = loading;
    submitBtn.classList.toggle("is-loading", loading);
    submitBtn.setAttribute("aria-busy", loading ? "true" : "false");
    submitBtn.textContent = loading ? "Sending…" : "Send booking request";
  }

  function setStatus(msg, kind) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = "form-status" + (kind ? " form-status--" + kind : "");
  }
  function clearStatus() { setStatus("", ""); }

  function showWhatsAppFallback() {
    if (!statusEl) return;
    var wa = "https://wa.me/" + String(cfg.whatsapp || "").replace(/[^0-9]/g, "");
    statusEl.className = "form-status form-status--error";
    statusEl.innerHTML =
      "Sorry — we couldn't send that just now. Please try again, or " +
      '<a href="' + wa + '" data-social="whatsapp" data-location="booking_error" target="_blank" rel="noopener">' +
      "message us on WhatsApp</a> and we'll sort your booking.";
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function getParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }
  function todayISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // Init
  renderPackages();
})();
