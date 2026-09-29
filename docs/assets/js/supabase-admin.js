/*
 * CreativeConnect — Supabase-powered admin (static build / GitHub Pages).
 * Sign in with the Supabase Auth user you created, then read / update / delete
 * leads. All access is via plain fetch against Supabase's Auth + REST endpoints;
 * row-level security enforces who can see what. No backend server required.
 */
(function () {
  "use strict";

  var cfg = (window.CC_CONFIG && window.CC_CONFIG.supabase) || {};
  var BASE = String(cfg.url || "").replace(/\/+$/, "");
  var ANON = cfg.anonKey || "";
  var SESSION_KEY = "cc_admin_session";

  var STATUSES = ["new", "contacted", "quoted", "booked", "lost", "archived"];

  // ---- tiny DOM helpers ----------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function toast(msg, kind) {
    var t = $("toast");
    if (!t) return;
    t.textContent = msg;
    t.className = "show" + (kind ? " " + kind : "");
    setTimeout(function () { t.className = ""; }, 3200);
  }

  // ---- session storage -----------------------------------------------------
  function saveSession(tok, email) {
    var s = {
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      expires_at: tok.expires_at || (Math.floor(Date.now() / 1000) + (tok.expires_in || 3600)),
      email: email || (tok.user && tok.user.email) || ""
    };
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {}
    return s;
  }
  function getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) { return null; }
  }
  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  // ---- auth ----------------------------------------------------------------
  function login(email, password) {
    return fetch(BASE + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { "apikey": ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, password: password })
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok) {
          throw new Error(body.error_description || body.msg || body.error || "Sign-in failed.");
        }
        return saveSession(body, email);
      });
    });
  }

  function refresh() {
    var s = getSession();
    if (!s || !s.refresh_token) return Promise.reject(new Error("No session"));
    return fetch(BASE + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { "apikey": ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: s.refresh_token })
    }).then(function (res) {
      if (!res.ok) throw new Error("Session expired");
      return res.json().then(function (body) { return saveSession(body, s.email); });
    });
  }

  function logout() {
    var s = getSession();
    if (s && s.access_token) {
      // Best-effort server-side revoke; ignore result.
      fetch(BASE + "/auth/v1/logout", {
        method: "POST",
        headers: { "apikey": ANON, "Authorization": "Bearer " + s.access_token }
      }).catch(function () {});
    }
    clearSession();
    showLogin();
  }

  // Authenticated fetch: adds headers, refreshes once on 401.
  function authFetch(path, options, _retried) {
    var s = getSession();
    if (!s) return Promise.reject(new Error("Not signed in"));
    options = options || {};
    options.headers = Object.assign({
      "apikey": ANON,
      "Authorization": "Bearer " + s.access_token
    }, options.headers || {});

    return fetch(BASE + path, options).then(function (res) {
      if (res.status === 401 && !_retried) {
        return refresh().then(function () { return authFetch(path, options, true); });
      }
      return res;
    });
  }

  // ---- leads ---------------------------------------------------------------
  function fetchLeads() {
    return authFetch("/rest/v1/leads?select=*&order=created_at.desc", {
      headers: { "Accept": "application/json" }
    }).then(function (res) {
      if (!res.ok) return res.text().then(function (t) { throw new Error("Load failed: " + t); });
      return res.json();
    });
  }

  function updateStatus(id, status) {
    return authFetch("/rest/v1/leads?id=eq." + encodeURIComponent(id), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Prefer": "return=minimal" },
      body: JSON.stringify({ status: status })
    }).then(function (res) {
      if (!res.ok) return res.text().then(function (t) { throw new Error(t); });
      return true;
    });
  }

  function deleteLead(id) {
    return authFetch("/rest/v1/leads?id=eq." + encodeURIComponent(id), {
      method: "DELETE",
      headers: { "Prefer": "return=minimal" }
    }).then(function (res) {
      if (!res.ok) return res.text().then(function (t) { throw new Error(t); });
      return true;
    });
  }

  // ---- views ---------------------------------------------------------------
  function showLogin() {
    $("login-view").classList.remove("hidden");
    $("app-view").classList.add("hidden");
    var s = $("login-error"); if (s) s.textContent = "";
  }

  function showApp() {
    $("login-view").classList.add("hidden");
    $("app-view").classList.remove("hidden");
    var sess = getSession();
    if (sess && $("who")) $("who").textContent = sess.email;
    loadAndRender();
  }

  var currentLeads = [];
  var currentFilter = "all";

  function loadAndRender() {
    var panel = $("leads-body");
    if (panel) panel.innerHTML = '<tr><td colspan="7" class="muted" style="padding:24px;text-align:center">Loading…</td></tr>';
    fetchLeads().then(function (rows) {
      currentLeads = rows || [];
      renderStats();
      renderTable();
    }).catch(function (err) {
      console.error(err);
      if (String(err.message || "").indexOf("Not signed in") >= 0 || String(err.message).indexOf("expired") >= 0) {
        clearSession(); showLogin(); return;
      }
      if (panel) panel.innerHTML = '<tr><td colspan="7" class="muted" style="padding:24px;text-align:center">Could not load leads. ' + esc(err.message) + '</td></tr>';
    });
  }

  function renderStats() {
    var total = currentLeads.length;
    var fresh = currentLeads.filter(function (l) { return l.status === "new"; }).length;
    var weekAgo = Date.now() - 7 * 864e5;
    var week = currentLeads.filter(function (l) { return new Date(l.created_at).getTime() >= weekAgo; }).length;
    var booked = currentLeads.filter(function (l) { return l.status === "booked"; }).length;
    setText("stat-total", total);
    setText("stat-new", fresh);
    setText("stat-week", week);
    setText("stat-booked", booked);
  }
  function setText(id, v) { var e = $(id); if (e) e.textContent = v; }

  function renderTable() {
    var body = $("leads-body");
    if (!body) return;
    var rows = currentLeads.filter(function (l) {
      return currentFilter === "all" || l.status === currentFilter;
    });
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7" class="muted" style="padding:24px;text-align:center">No leads' +
        (currentFilter === "all" ? " yet. When someone books, it appears here." : " with this status.") + '</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (l) {
      var opts = STATUSES.map(function (s) {
        return '<option value="' + s + '"' + (s === l.status ? " selected" : "") + '>' + s + '</option>';
      }).join("");
      var date = l.preferred_date ? esc(l.preferred_date) : "—";
      var when = new Date(l.created_at).toLocaleString();
      var details = l.project_details ? '<div class="lead-note">' + esc(l.project_details) + '</div>' : "";
      return '' +
        '<tr>' +
          '<td><div class="lead-name">' + esc(l.name) + '</div>' +
            '<div class="lead-sub"><a href="mailto:' + esc(l.email) + '">' + esc(l.email) + '</a>' +
            (l.phone ? ' · ' + esc(l.phone) : "") + '</div>' + details + '</td>' +
          '<td>' + esc(l.shoot_type || "—") + '</td>' +
          '<td>' + esc(l.package_slug || "—") + '</td>' +
          '<td>' + date + '</td>' +
          '<td class="nowrap muted">' + esc(when) + '</td>' +
          '<td><select class="status-sel" data-id="' + l.id + '">' + opts + '</select></td>' +
          '<td><button class="btn-del" data-id="' + l.id + '" title="Delete">✕</button></td>' +
        '</tr>';
    }).join("");

    // wire status selects + delete buttons
    Array.prototype.forEach.call(body.querySelectorAll(".status-sel"), function (sel) {
      sel.addEventListener("change", function () {
        var id = sel.getAttribute("data-id");
        updateStatus(id, sel.value)
          .then(function () {
            var lead = currentLeads.filter(function (l) { return String(l.id) === String(id); })[0];
            if (lead) lead.status = sel.value;
            renderStats();
            toast("Status updated");
          })
          .catch(function (e) { toast("Update failed: " + e.message, "err"); });
      });
    });
    Array.prototype.forEach.call(body.querySelectorAll(".btn-del"), function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-id");
        if (!window.confirm("Delete this lead permanently?")) return;
        deleteLead(id)
          .then(function () {
            currentLeads = currentLeads.filter(function (l) { return String(l.id) !== String(id); });
            renderStats(); renderTable();
            toast("Lead deleted");
          })
          .catch(function (e) { toast("Delete failed: " + e.message, "err"); });
      });
    });
  }

  // ---- boot ----------------------------------------------------------------
  function init() {
    if (!BASE || !ANON) {
      document.body.innerHTML = '<p style="max-width:640px;margin:80px auto;font-family:sans-serif;color:#333">' +
        'Supabase is not configured (missing url / anon key in config.js).</p>';
      return;
    }

    // login form
    var form = $("login-form");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var email = $("login-email").value.trim();
        var pass = $("login-password").value;
        var errEl = $("login-error");
        var btn = $("login-btn");
        errEl.textContent = "";
        btn.disabled = true; btn.textContent = "Signing in…";
        login(email, pass)
          .then(function () { showApp(); })
          .catch(function (err) { errEl.textContent = err.message; })
          .then(function () { btn.disabled = false; btn.textContent = "Sign in"; });
      });
    }

    // logout + filter + refresh
    if ($("logout-btn")) $("logout-btn").addEventListener("click", logout);
    if ($("refresh-btn")) $("refresh-btn").addEventListener("click", loadAndRender);
    Array.prototype.forEach.call(document.querySelectorAll(".filter-chip"), function (chip) {
      chip.addEventListener("click", function () {
        currentFilter = chip.getAttribute("data-status");
        Array.prototype.forEach.call(document.querySelectorAll(".filter-chip"), function (c) {
          c.classList.toggle("active", c === chip);
        });
        renderTable();
      });
    });

    // Restore an existing session if valid, else show login.
    var s = getSession();
    if (s && s.access_token && s.expires_at && (s.expires_at - 60) > Math.floor(Date.now() / 1000)) {
      showApp();
    } else if (s && s.refresh_token) {
      refresh().then(showApp).catch(function () { clearSession(); showLogin(); });
    } else {
      showLogin();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
