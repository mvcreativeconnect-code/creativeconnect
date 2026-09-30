/*
 * CreativeConnect — Supabase-powered admin (static build / GitHub Pages).
 * Full dashboard: Leads (CRM), Analytics, and live site-content editing
 * (Home text, Packages, Portfolio, Settings) plus Account (password).
 * Everything is plain fetch against Supabase Auth + REST. RLS enforces access:
 * only a signed-in admin can read leads or write content.
 */
(function () {
  "use strict";

  var cfg = (window.CC_CONFIG && window.CC_CONFIG.supabase) || {};
  var BASE = String(cfg.url || "").replace(/\/+$/, "");
  var ANON = cfg.anonKey || "";
  var SESSION_KEY = "cc_admin_session";
  var STATUSES = ["new", "contacted", "quoted", "booked", "lost", "archived"];

  // ---- DOM helpers ---------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function toast(msg, kind) {
    var t = $("toast"); if (!t) return;
    t.textContent = msg; t.className = "show" + (kind ? " " + kind : "");
    setTimeout(function () { t.className = ""; }, 3200);
  }
  function val(id) { var e = $(id); return e ? e.value : ""; }

  // ---- session -------------------------------------------------------------
  function saveSession(tok, email) {
    var s = {
      access_token: tok.access_token, refresh_token: tok.refresh_token,
      expires_at: tok.expires_at || (Math.floor(Date.now() / 1000) + (tok.expires_in || 3600)),
      email: email || (tok.user && tok.user.email) || ""
    };
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {}
    return s;
  }
  function getSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) { return null; } }
  function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} }

  // ---- auth ----------------------------------------------------------------
  function login(email, password) {
    return fetch(BASE + "/auth/v1/token?grant_type=password", {
      method: "POST", headers: { "apikey": ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, password: password })
    }).then(function (res) {
      return res.json().then(function (b) {
        if (!res.ok) throw new Error(b.error_description || b.msg || b.error || "Sign-in failed.");
        return saveSession(b, email);
      });
    });
  }
  function refresh() {
    var s = getSession();
    if (!s || !s.refresh_token) return Promise.reject(new Error("No session"));
    return fetch(BASE + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST", headers: { "apikey": ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: s.refresh_token })
    }).then(function (res) {
      if (!res.ok) throw new Error("Session expired");
      return res.json().then(function (b) { return saveSession(b, s.email); });
    });
  }
  function logout() {
    var s = getSession();
    if (s && s.access_token) {
      fetch(BASE + "/auth/v1/logout", { method: "POST", headers: { "apikey": ANON, "Authorization": "Bearer " + s.access_token } }).catch(function () {});
    }
    clearSession(); showLogin();
  }
  function authFetch(path, options, _retried) {
    var s = getSession();
    if (!s) return Promise.reject(new Error("Not signed in"));
    options = options || {};
    options.headers = Object.assign({ "apikey": ANON, "Authorization": "Bearer " + s.access_token }, options.headers || {});
    return fetch(BASE + path, options).then(function (res) {
      if (res.status === 401 && !_retried) return refresh().then(function () { return authFetch(path, options, true); });
      return res;
    });
  }

  // ---- data ----------------------------------------------------------------
  var leads = [];
  var content = null;        // site_config.data (or null if not set up)
  var contentError = null;
  var visits = [];           // recent visit rows
  var visitsError = null;
  var visitsRange = 30;      // days
  var reportDate = isoDay(new Date(Date.now() - 864e5)); // default: yesterday
  var charts = [];           // live Chart.js instances (destroyed on view change)

  function fetchVisits() {
    var since = new Date(Date.now() - visitsRange * 864e5).toISOString();
    var q = "/rest/v1/visits?select=id,visitor_id,is_new,path,referrer,device,browser,created_at" +
      "&created_at=gte." + encodeURIComponent(since) + "&order=created_at.desc&limit=20000";
    return authFetch(q, { headers: { "Accept": "application/json" } })
      .then(function (res) {
        if (!res.ok) return res.text().then(function (t) { throw new Error(t); });
        return res.json();
      }).then(function (rows) { visitsError = null; visits = rows || []; return visits; })
      .catch(function (e) { visitsError = e.message; visits = []; });
  }

  function fetchLeads() {
    return authFetch("/rest/v1/leads?select=*&order=created_at.desc", { headers: { "Accept": "application/json" } })
      .then(function (res) {
        if (!res.ok) return res.text().then(function (t) { throw new Error(t); });
        return res.json();
      }).then(function (rows) { leads = rows || []; updateLeadsBadge(); return leads; });
  }
  function updateStatus(id, status) {
    return authFetch("/rest/v1/leads?id=eq." + encodeURIComponent(id), {
      method: "PATCH", headers: { "Content-Type": "application/json", "Prefer": "return=minimal" },
      body: JSON.stringify({ status: status })
    }).then(function (r) { if (!r.ok) return r.text().then(function (t) { throw new Error(t); }); return true; });
  }
  function deleteLead(id) {
    return authFetch("/rest/v1/leads?id=eq." + encodeURIComponent(id), { method: "DELETE", headers: { "Prefer": "return=minimal" } })
      .then(function (r) { if (!r.ok) return r.text().then(function (t) { throw new Error(t); }); return true; });
  }
  function fetchContent() {
    return authFetch("/rest/v1/site_config?select=data&id=eq.1", { headers: { "Accept": "application/json" } })
      .then(function (res) {
        if (!res.ok) return res.text().then(function (t) { throw new Error(t); });
        return res.json();
      }).then(function (rows) {
        contentError = null;
        content = (rows && rows[0] && rows[0].data) || null;
        return content;
      }).catch(function (e) { contentError = e.message; content = null; });
  }
  function saveContent() {
    return authFetch("/rest/v1/site_config?id=eq.1", {
      method: "PATCH", headers: { "Content-Type": "application/json", "Prefer": "return=minimal" },
      body: JSON.stringify({ data: content })
    }).then(function (r) { if (!r.ok) return r.text().then(function (t) { throw new Error(t); }); return true; });
  }
  function changePassword(pw) {
    return authFetch("/auth/v1/user", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw })
    }).then(function (res) {
      return res.json().then(function (b) { if (!res.ok) throw new Error(b.msg || b.error_description || b.error || "Failed"); return b; });
    });
  }

  function updateLeadsBadge() {
    var b = $("nav-leads"); if (!b) return;
    var n = leads.filter(function (l) { return l.status === "new"; }).length;
    if (n > 0) { b.hidden = false; b.textContent = n; } else { b.hidden = true; }
  }

  // ===========================================================================
  // Views
  // ===========================================================================
  var currentFilter = "all";

  function contentNotReady() {
    return '<div class="card"><h2>One-time setup needed</h2>' +
      '<p class="muted">To edit your site content here, run <code>supabase/content-schema.sql</code> once in your Supabase SQL editor, then reload this page.</p>' +
      (contentError ? '<p class="hint">(' + esc(contentError) + ')</p>' : '') + '</div>';
  }

  function view_dashboard() {
    var total = leads.length;
    var fresh = leads.filter(function (l) { return l.status === "new"; }).length;
    var weekAgo = Date.now() - 7 * 864e5;
    var week = leads.filter(function (l) { return new Date(l.created_at).getTime() >= weekAgo; }).length;
    var booked = leads.filter(function (l) { return l.status === "booked"; }).length;
    var recent = leads.slice(0, 5).map(function (l) {
      return '<tr><td><b>' + esc(l.name) + '</b><div class="lead-sub">' + esc(l.email) + '</div></td>' +
        '<td>' + esc(l.package_slug || "—") + '</td><td class="muted nowrap">' + esc(new Date(l.created_at).toLocaleDateString()) + '</td>' +
        '<td style="text-transform:capitalize">' + esc(l.status) + '</td></tr>';
    }).join("") || '<tr><td colspan="4" class="muted" style="padding:18px;text-align:center">No bookings yet.</td></tr>';

    return '<h1 class="page">Dashboard</h1><p class="page-sub">Overview of your bookings.</p>' +
      '<div class="stats">' +
        stat("accent", fresh, "New") + stat("", week, "This week") + stat("", booked, "Booked") + stat("", total, "Total") +
      '</div>' +
      '<div class="card"><h2>Recent bookings</h2><div class="table-wrap"><table><thead><tr><th>Contact</th><th>Package</th><th>Date</th><th>Status</th></tr></thead>' +
      '<tbody>' + recent + '</tbody></table></div>' +
      '<div class="save-bar"><a class="btn btn-sm" href="#leads" data-go="leads">Manage all leads →</a></div></div>';
  }
  function stat(cls, n, label) {
    return '<div class="stat ' + cls + '"><div class="n">' + n + '</div><div class="l">' + label + '</div></div>';
  }

  function view_leads() {
    var rows = leads.filter(function (l) { return currentFilter === "all" || l.status === currentFilter; });
    var body = rows.length ? rows.map(leadRow).join("") :
      '<tr><td colspan="7" class="muted" style="padding:22px;text-align:center">No leads' + (currentFilter === "all" ? " yet." : " with this status.") + '</td></tr>';
    var chips = ["all"].concat(STATUSES).map(function (s) {
      return '<button class="chip' + (s === currentFilter ? " active" : "") + '" data-filter="' + s + '">' + s + '</button>';
    }).join("");
    return '<h1 class="page">Booking requests</h1><p class="page-sub">Every booking from your site lands here.</p>' +
      '<div class="toolbar">' + chips + '<button class="btn btn-sm" id="leads-refresh" style="margin-left:auto">Refresh</button></div>' +
      '<div class="table-wrap"><table><thead><tr><th>Contact</th><th>Shoot</th><th>Package</th><th>Preferred</th><th>Received</th><th>Status</th><th></th></tr></thead>' +
      '<tbody id="leads-body">' + body + '</tbody></table></div>';
  }
  function leadRow(l) {
    var opts = STATUSES.map(function (s) { return '<option value="' + s + '"' + (s === l.status ? " selected" : "") + '>' + s + '</option>'; }).join("");
    var note = l.project_details ? '<div class="lead-note">' + esc(l.project_details) + '</div>' : "";
    return '<tr>' +
      '<td><div class="lead-name">' + esc(l.name) + '</div><div class="lead-sub"><a href="mailto:' + esc(l.email) + '">' + esc(l.email) + '</a>' + (l.phone ? " · " + esc(l.phone) : "") + '</div>' + note + '</td>' +
      '<td>' + esc(l.shoot_type || "—") + '</td><td>' + esc(l.package_slug || "—") + '</td>' +
      '<td>' + esc(l.preferred_date || "—") + '</td><td class="muted nowrap">' + esc(new Date(l.created_at).toLocaleString()) + '</td>' +
      '<td><select class="status-sel" data-id="' + l.id + '">' + opts + '</select></td>' +
      '<td><button class="btn-del" data-del="' + l.id + '" title="Delete">✕</button></td></tr>';
  }

  function view_analytics() {
    var head = '<h1 class="page">Analytics</h1><p class="page-sub">Visitor traffic to your site.</p>';
    if (visitsError) {
      return head + '<div class="card"><h2>One-time setup needed</h2><p class="muted">To collect visitor stats, run <code>supabase/analytics-schema.sql</code> once in your Supabase SQL editor, then reload.</p><p class="hint">(' + esc(visitsError) + ')</p></div>';
    }
    var s = visitorStats();
    var ranges = [7, 30, 90].map(function (d) {
      return '<button class="chip' + (d === visitsRange ? " active" : "") + '" data-range="' + d + '">' + d + ' days</button>';
    }).join("");
    var empty = visits.length ? "" :
      '<div class="card"><p class="muted">No visits recorded in this range yet. Visits appear here once people browse the site and accept cookies.</p></div>';

    return head +
      '<div class="toolbar">' + ranges + '<button class="btn btn-sm" id="an-refresh" style="margin-left:auto">Refresh</button></div>' +
      '<div class="stats">' +
        stat("accent", s.total, "Total visits") + stat("", s.unique, "Unique visitors") +
        stat("", s.newv, "New visitors") + stat("", s.returning, "Returning visits") +
      '</div>' + empty +
      chartCard("Visits over time", "ch-time") +
      '<div class="row">' + chartCard("Devices", "ch-device") + chartCard("Browsers", "ch-browser") + '</div>' +
      chartCard("Top pages", "ch-pages") +
      chartCard("Top referrers", "ch-ref") +
      '<div class="card"><h2>Bookings by status</h2>' + bars(countBy(leads, function (l) { return l.status; }, STATUSES)) + '</div>';
  }
  function chartCard(title, id) {
    return '<div class="card" style="min-width:280px"><h2>' + esc(title) + '</h2>' +
      '<div style="position:relative;height:260px"><canvas id="' + id + '"></canvas></div></div>';
  }

  // ---- visitor data helpers ------------------------------------------------
  function visitorStats() {
    var uniq = {}; var newv = 0;
    visits.forEach(function (v) { uniq[v.visitor_id] = 1; if (v.is_new) newv++; });
    var total = visits.length;
    return { total: total, unique: Object.keys(uniq).length, newv: newv, returning: total - newv };
  }
  function visitsByDay(days) {
    var out = [], map = {};
    visits.forEach(function (v) {
      var d = isoDay(new Date(v.created_at));
      (map[d] = map[d] || { v: 0, u: {} });
      map[d].v++; map[d].u[v.visitor_id] = 1;
    });
    for (var i = days - 1; i >= 0; i--) {
      var day = isoDay(new Date(Date.now() - i * 864e5));
      var m = map[day];
      out.push({ label: day.slice(5), visits: m ? m.v : 0, unique: m ? Object.keys(m.u).length : 0 });
    }
    return out;
  }

  // ---- Chart.js rendering --------------------------------------------------
  function haveCharts() { return typeof window.Chart !== "undefined"; }
  function destroyCharts() { charts.forEach(function (c) { try { c.destroy(); } catch (e) {} }); charts = []; }
  function mkChart(id, cfgObj) {
    var el = $(id); if (!el || !haveCharts()) return;
    charts.push(new Chart(el.getContext("2d"), cfgObj));
  }
  var PALETTE = ["#E8A33D", "#7FB77E", "#6C9BD1", "#C77DFF", "#E8705A", "#9AA0AA", "#4ECDC4", "#F4D35E"];
  function chartsTheme() {
    if (haveCharts()) { Chart.defaults.color = "#9AA0AA"; Chart.defaults.font.family = "Inter, sans-serif"; Chart.defaults.borderColor = "rgba(255,255,255,.06)"; }
  }
  function drawAnalyticsCharts() {
    if (!haveCharts()) return; // CDN blocked — stat tiles + bars still show
    chartsTheme();
    var d = visitsByDay(visitsRange);
    mkChart("ch-time", {
      type: "line",
      data: {
        labels: d.map(function (x) { return x.label; }),
        datasets: [
          { label: "Visits", data: d.map(function (x) { return x.visits; }), borderColor: "#E8A33D", backgroundColor: "rgba(232,163,61,.15)", fill: true, tension: .3 },
          { label: "Unique", data: d.map(function (x) { return x.unique; }), borderColor: "#7FB77E", backgroundColor: "transparent", tension: .3 }
        ]
      },
      options: chartOpts(true)
    });
    doughnut("ch-device", countBy(visits, function (v) { return v.device || "Unknown"; }));
    doughnut("ch-browser", countBy(visits, function (v) { return v.browser || "Unknown"; }));
    barChart("ch-pages", countBy(visits, function (v) { return v.path || "/"; }).slice(0, 8));
    barChart("ch-ref", countBy(visits, function (v) { return v.referrer || "direct"; }).slice(0, 8));
  }
  function chartOpts(legend) {
    return {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: !!legend } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
    };
  }
  function doughnut(id, data) {
    mkChart(id, {
      type: "doughnut",
      data: { labels: data.map(function (x) { return x.label; }), datasets: [{ data: data.map(function (x) { return x.n; }), backgroundColor: PALETTE, borderColor: "#16181D", borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
    });
  }
  function barChart(id, data) {
    mkChart(id, {
      type: "bar",
      data: { labels: data.map(function (x) { return x.label; }), datasets: [{ label: "Visits", data: data.map(function (x) { return x.n; }), backgroundColor: "#E8A33D" }] },
      options: Object.assign(chartOpts(false), { indexAxis: "y" })
    });
  }

  // ===========================================================================
  // Reports (daily summary + CSV / PDF export)
  // ===========================================================================
  function view_reports() {
    var head = '<h1 class="page">Reports</h1><p class="page-sub">Daily summary of visitor activity. Pick a day, then export.</p>';
    if (visitsError) {
      return head + '<div class="card"><h2>One-time setup needed</h2><p class="muted">Run <code>supabase/analytics-schema.sql</code> in Supabase, then reload.</p></div>';
    }
    return head +
      '<div class="toolbar"><label style="margin:0;align-self:center">Day</label>' +
        '<input type="date" id="rep-date" value="' + esc(reportDate) + '" max="' + esc(isoDay(new Date())) + '" style="width:auto">' +
        '<button class="btn btn-sm" id="rep-csv">Export CSV</button>' +
        '<button class="btn btn-sm" id="rep-pdf">Export PDF</button></div>' +
      '<div id="report-out"></div>';
  }

  function reportFor(day) {
    var dv = visits.filter(function (v) { return isoDay(new Date(v.created_at)) === day; });
    var uniq = {}; dv.forEach(function (v) { uniq[v.visitor_id] = 1; });
    var newv = dv.filter(function (v) { return v.is_new; }).length;
    var hours = []; for (var i = 0; i < 24; i++) hours.push(0);
    dv.forEach(function (v) { hours[new Date(v.created_at).getHours()]++; });
    var peakH = 0; for (var h = 0; h < 24; h++) if (hours[h] > hours[peakH]) peakH = h;
    var busiest = hours.map(function (n, i) { return { label: pad(i) + ":00", n: n }; })
      .filter(function (x) { return x.n > 0; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 6);
    var pages = countBy(dv, function (v) { return v.path || "/"; }).slice(0, 10);
    var bookings = leads.filter(function (l) { return isoDay(new Date(l.created_at)) === day; }).length;
    return {
      day: day, total: dv.length, unique: Object.keys(uniq).length, newv: newv,
      returning: dv.length - newv, bookings: bookings,
      peak: dv.length ? (pad(peakH) + ":00") : "—", pages: pages, busiest: busiest
    };
  }

  function renderReport() {
    var out = $("report-out"); if (!out) return;
    var r = reportFor($("rep-date").value || reportDate);
    reportDate = r.day;
    var pages = r.pages.length ? bars(r.pages) : '<p class="muted">No page views.</p>';
    var busy = r.busiest.length ? bars(r.busiest) : '<p class="muted">No activity.</p>';
    out.innerHTML =
      '<div class="stats">' +
        stat("accent", r.total, "Visits") + stat("", r.unique, "Unique visitors") +
        stat("", r.newv, "New visitors") + stat("", r.bookings, "Bookings") +
      '</div>' +
      '<div class="card"><h2>Summary — ' + esc(r.day) + '</h2>' +
        '<p class="muted">' + r.total + ' visits from ' + r.unique + ' unique visitors (' + r.newv +
        ' new, ' + r.returning + ' returning). Peak hour: <b>' + esc(r.peak) + '</b>. Bookings: <b>' + r.bookings + '</b>.</p></div>' +
      '<div class="row"><div class="card"><h2>Top pages</h2>' + pages + '</div>' +
      '<div class="card"><h2>Busiest hours</h2>' + busy + '</div></div>';
  }

  function reportRows(r) {
    var rows = [
      ["CreativeConnect — daily report", r.day],
      ["Total visits", r.total], ["Unique visitors", r.unique],
      ["New visitors", r.newv], ["Returning visits", r.returning],
      ["Bookings", r.bookings], ["Peak hour", r.peak],
      [], ["Top pages", "Visits"]
    ];
    r.pages.forEach(function (p) { rows.push([p.label, p.n]); });
    rows.push([]); rows.push(["Busiest hours", "Visits"]);
    r.busiest.forEach(function (h) { rows.push([h.label, h.n]); });
    return rows;
  }
  function exportCSV() {
    var r = reportFor($("rep-date").value || reportDate);
    var csv = reportRows(r).map(function (row) {
      return row.map(function (c) { return '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"'; }).join(",");
    }).join("\r\n");
    download("creativeconnect-report-" + r.day + ".csv", csv, "text/csv");
  }
  function exportPDF() {
    var r = reportFor($("rep-date").value || reportDate);
    var JsPDF = window.jspdf && window.jspdf.jsPDF;
    if (!JsPDF) { window.print(); return; } // graceful fallback
    var doc = new JsPDF({ unit: "pt", format: "a4" });
    var y = 56;
    doc.setFontSize(18); doc.text("CreativeConnect — Daily Report", 40, y); y += 22;
    doc.setFontSize(11); doc.setTextColor(120); doc.text(r.day, 40, y); doc.setTextColor(0); y += 26;
    function line(k, v) { doc.setFontSize(12); doc.text(String(k), 40, y); doc.text(String(v), 320, y); y += 18; }
    line("Total visits", r.total); line("Unique visitors", r.unique);
    line("New visitors", r.newv); line("Returning visits", r.returning);
    line("Bookings", r.bookings); line("Peak hour", r.peak);
    y += 12; doc.setFontSize(13); doc.text("Top pages", 40, y); y += 18;
    r.pages.forEach(function (p) { line(p.label, p.n); });
    y += 12; doc.setFontSize(13); doc.text("Busiest hours", 40, y); y += 18;
    r.busiest.forEach(function (h) { line(h.label, h.n); });
    doc.save("creativeconnect-report-" + r.day + ".pdf");
  }
  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime + ";charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function countBy(arr, keyFn, order) {
    var m = {}; arr.forEach(function (x) { var k = keyFn(x) || "—"; m[k] = (m[k] || 0) + 1; });
    var keys = order ? order.filter(function (k) { return m[k]; }) : Object.keys(m).sort(function (a, b) { return m[b] - m[a]; });
    return keys.map(function (k) { return { label: k, n: m[k] }; });
  }
  function byWeek(arr, n) {
    var out = []; var now = Date.now();
    for (var i = n - 1; i >= 0; i--) {
      var start = now - (i + 1) * 7 * 864e5, end = now - i * 7 * 864e5;
      var c = arr.filter(function (l) { var t = new Date(l.created_at).getTime(); return t >= start && t < end; }).length;
      out.push({ label: i === 0 ? "This week" : i + "w ago", n: c });
    }
    return out;
  }
  function bars(data) {
    var max = data.reduce(function (m, d) { return Math.max(m, d.n); }, 1);
    return '<div class="bars">' + data.map(function (d) {
      return '<div class="bar-row"><div class="bar-label">' + esc(d.label) + '</div>' +
        '<div class="bar-track"><div class="bar-fill" style="width:' + Math.round(d.n / max * 100) + '%"></div></div>' +
        '<div class="bar-n">' + d.n + '</div></div>';
    }).join("") + '</div>';
  }

  function view_home() {
    if (!content) return '<h1 class="page">Home content</h1>' + contentNotReady();
    var h = content.hero || {};
    return '<h1 class="page">Home content</h1><p class="page-sub">Edit the words on your home page. Changes go live after you save.</p>' +
      '<div class="card"><h2>Business</h2>' +
        field("Business name", "f-business", content.businessName) +
      '</div>' +
      '<div class="card"><h2>Hero (top of the page)</h2>' +
        field("Eyebrow (small line above the title)", "f-hero-eyebrow", h.eyebrow) +
        field("Title", "f-hero-title", h.title) +
        area("Subtitle", "f-hero-subtitle", h.subtitle) +
      '</div>' +
      '<div class="card"><h2>Trust strip</h2>' +
        area("One item per line", "f-trust", (content.trust || []).join("\n")) +
      '</div>' +
      '<div class="card"><h2>Footer</h2>' +
        area("About line", "f-footer-about", content.footerAbout) +
        saveBar("save-home") +
      '</div>';
  }
  function collect_home() {
    content.businessName = val("f-business").trim();
    content.hero = content.hero || {};
    content.hero.eyebrow = val("f-hero-eyebrow").trim();
    content.hero.title = val("f-hero-title").trim();
    content.hero.subtitle = val("f-hero-subtitle").trim();
    content.trust = val("f-trust").split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
    content.footerAbout = val("f-footer-about").trim();
  }

  function view_packages() {
    if (!content) return '<h1 class="page">Packages</h1>' + contentNotReady();
    var items = (content.packages || []).map(function (p, i) {
      return '<div class="item" data-i="' + i + '">' +
        '<div class="item-head"><span class="t">' + esc(p.name || "Package") + '</span>' +
          '<div class="item-actions">' + moveDel(i) + '</div></div>' +
        '<div class="grid2">' +
          field("Name", "pk-name-" + i, p.name) +
          field("Price", "pk-price-" + i, p.price) +
          field("ID / slug (lowercase)", "pk-id-" + i, p.id) +
          field("Image (URL or seed word)", "pk-image-" + i, p.image) +
        '</div>' +
        area("What's included (one per line)", "pk-inc-" + i, (p.includes || []).join("\n")) +
        '<label class="checkline"><input type="checkbox" id="pk-pop-' + i + '"' + (p.popular ? " checked" : "") + '> Mark as “Most popular”</label>' +
      '</div>';
    }).join("");
    return '<h1 class="page">Packages</h1><p class="page-sub">Edit prices and what each package includes.</p>' +
      items +
      '<button class="btn btn-sm" id="add-package">+ Add package</button>' +
      '<div class="card" style="margin-top:1rem">' + saveBar("save-packages") + '</div>';
  }
  function collect_packages() {
    (content.packages || []).forEach(function (p, i) {
      p.name = val("pk-name-" + i).trim();
      p.price = val("pk-price-" + i).trim();
      p.id = (val("pk-id-" + i).trim() || slug(p.name));
      p.image = val("pk-image-" + i).trim();
      p.includes = val("pk-inc-" + i).split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
      p.popular = !!($("pk-pop-" + i) && $("pk-pop-" + i).checked);
    });
  }

  function view_portfolio() {
    if (!content) return '<h1 class="page">Portfolio</h1>' + contentNotReady();
    var items = (content.portfolio || []).map(function (p, i) {
      return '<div class="item" data-i="' + i + '">' +
        '<div class="item-head"><span class="t">' + esc(p.title || "Photo") + '</span><div class="item-actions">' + moveDel(i) + '</div></div>' +
        '<div class="grid2">' +
          field("Title", "pf-title-" + i, p.title) +
          field("Category", "pf-cat-" + i, p.category) +
          field("Thumbnail URL", "pf-img-" + i, p.image_url) +
          field("Large URL (lightbox)", "pf-full-" + i, p.full_url) +
        '</div>' +
        field("Alt text (description)", "pf-alt-" + i, p.alt) +
      '</div>';
    }).join("");
    return '<h1 class="page">Portfolio</h1><p class="page-sub">Manage the “Recent shoots” photos. Category groups them into filter tabs.</p>' +
      items +
      '<button class="btn btn-sm" id="add-portfolio">+ Add photo</button>' +
      '<div class="card" style="margin-top:1rem">' + saveBar("save-portfolio") + '</div>';
  }
  function collect_portfolio() {
    (content.portfolio || []).forEach(function (p, i) {
      p.title = val("pf-title-" + i).trim();
      p.category = val("pf-cat-" + i).trim();
      p.image_url = val("pf-img-" + i).trim();
      p.full_url = val("pf-full-" + i).trim();
      p.alt = val("pf-alt-" + i).trim();
    });
  }

  function view_settings() {
    if (!content) return '<h1 class="page">Settings</h1>' + contentNotReady();
    return '<h1 class="page">Settings</h1><p class="page-sub">Contact details shown across your site.</p>' +
      '<div class="card">' +
        field("Instagram handle (no @)", "s-ig", content.instagramHandle) +
        field("WhatsApp number (digits only)", "s-wa", content.whatsapp) +
        field("Contact email", "s-email", content.email) +
        field("Google Analytics ID (takes effect on next publish)", "s-ga4", content.ga4MeasurementId) +
        saveBar("save-settings") +
      '</div>';
  }
  function collect_settings() {
    content.instagramHandle = val("s-ig").trim().replace(/^@/, "");
    content.whatsapp = val("s-wa").replace(/[^0-9]/g, "");
    content.email = val("s-email").trim();
    content.ga4MeasurementId = val("s-ga4").trim();
  }

  function view_account() {
    var s = getSession();
    return '<h1 class="page">Account</h1><p class="page-sub">You are signed in as <b>' + esc(s ? s.email : "") + '</b>.</p>' +
      '<div class="card"><h2>Change password</h2>' +
        '<div class="field"><label for="ac-pw">New password (min 6 characters)</label><input type="password" id="ac-pw"></div>' +
        '<div class="field"><label for="ac-pw2">Confirm new password</label><input type="password" id="ac-pw2"></div>' +
        '<p class="form-error" id="ac-err"></p>' +
        '<button class="btn btn-primary" id="ac-save">Update password</button>' +
      '</div>' +
      '<div class="card"><h2>Other admins</h2><p class="muted">Add or remove admin logins in your Supabase dashboard → <b>Authentication → Users</b>. (For security, that isn’t exposed here.)</p></div>';
  }

  // ---- small form builders -------------------------------------------------
  function field(label, id, v) {
    return '<div class="field"><label for="' + id + '">' + label + '</label><input type="text" id="' + id + '" value="' + esc(v) + '"></div>';
  }
  function area(label, id, v) {
    return '<div class="field"><label for="' + id + '">' + label + '</label><textarea id="' + id + '">' + esc(v) + '</textarea></div>';
  }
  function moveDel(i) {
    return '<button class="mini" data-up="' + i + '" title="Move up">↑</button>' +
      '<button class="mini" data-down="' + i + '" title="Move down">↓</button>' +
      '<button class="mini" data-remove="' + i + '" title="Remove" style="color:var(--err)">✕</button>';
  }
  function saveBar(id) {
    return '<div class="save-bar"><button class="btn btn-primary" id="' + id + '">Save changes</button><span class="save-note" id="' + id + '-note"></span></div>';
  }
  function slug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item"; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function isoDay(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }

  // ===========================================================================
  // Router + wiring
  // ===========================================================================
  var VIEWS = {
    dashboard: view_dashboard, leads: view_leads, analytics: view_analytics,
    reports: view_reports, home: view_home, packages: view_packages,
    portfolio: view_portfolio, settings: view_settings, account: view_account
  };

  function setView(name) {
    if (!VIEWS[name]) name = "dashboard";
    destroyCharts(); // free any Chart.js instances before replacing the DOM
    Array.prototype.forEach.call(document.querySelectorAll(".sidebar a"), function (a) {
      a.classList.toggle("active", a.getAttribute("data-view") === name);
    });
    $("panel").innerHTML = VIEWS[name]();
    wireView(name);
    try { history.replaceState(null, "", "#" + name); } catch (e) {}
    window.scrollTo(0, 0);
  }

  function wireView(name) {
    if (name === "leads") wireLeads();
    else if (name === "analytics") wireAnalytics();
    else if (name === "reports") wireReports();
    else if (name === "dashboard") {
      var go = $("panel").querySelector("[data-go]");
      if (go) go.addEventListener("click", function (e) { e.preventDefault(); setView("leads"); });
    }
    else if (name === "home") onSave("save-home", collect_home);
    else if (name === "settings") onSave("save-settings", collect_settings);
    else if (name === "packages") wirePackages();
    else if (name === "portfolio") wirePortfolio();
    else if (name === "account") wireAccount();
  }

  function wireLeads() {
    Array.prototype.forEach.call($("panel").querySelectorAll(".chip"), function (c) {
      c.addEventListener("click", function () { currentFilter = c.getAttribute("data-filter"); setView("leads"); });
    });
    var rf = $("leads-refresh");
    if (rf) rf.addEventListener("click", function () { rf.disabled = true; fetchLeads().then(function () { setView("leads"); }).catch(bail); });
    Array.prototype.forEach.call($("panel").querySelectorAll(".status-sel"), function (sel) {
      sel.addEventListener("change", function () {
        updateStatus(sel.getAttribute("data-id"), sel.value).then(function () {
          var l = leads.filter(function (x) { return String(x.id) === sel.getAttribute("data-id"); })[0];
          if (l) l.status = sel.value; updateLeadsBadge(); toast("Status updated");
        }).catch(function (e) { toast("Update failed: " + e.message, "err"); });
      });
    });
    Array.prototype.forEach.call($("panel").querySelectorAll("[data-del]"), function (btn) {
      btn.addEventListener("click", function () {
        if (!window.confirm("Delete this lead permanently?")) return;
        var id = btn.getAttribute("data-del");
        deleteLead(id).then(function () {
          leads = leads.filter(function (x) { return String(x.id) !== id; });
          updateLeadsBadge(); setView("leads"); toast("Lead deleted");
        }).catch(function (e) { toast("Delete failed: " + e.message, "err"); });
      });
    });
  }

  function wireAnalytics() {
    drawAnalyticsCharts();
    Array.prototype.forEach.call($("panel").querySelectorAll("[data-range]"), function (c) {
      c.addEventListener("click", function () {
        visitsRange = +c.getAttribute("data-range");
        fetchVisits().then(function () { setView("analytics"); });
      });
    });
    var rf = $("an-refresh");
    if (rf) rf.addEventListener("click", function () { rf.disabled = true; fetchVisits().then(function () { setView("analytics"); }); });
  }

  function wireReports() {
    renderReport();
    var d = $("rep-date"); if (d) d.addEventListener("change", renderReport);
    var csv = $("rep-csv"); if (csv) csv.addEventListener("click", exportCSV);
    var pdf = $("rep-pdf"); if (pdf) pdf.addEventListener("click", exportPDF);
  }

  function onSave(id, collectFn) {
    var btn = $(id); if (!btn) return;
    btn.addEventListener("click", function () {
      collectFn();
      var note = $(id + "-note");
      btn.disabled = true; if (note) { note.className = "save-note"; note.textContent = "Saving…"; }
      saveContent().then(function () {
        if (note) { note.className = "save-note ok"; note.textContent = "Saved ✓ (live on your site)"; }
        toast("Saved");
      }).catch(function (e) {
        if (note) { note.className = "save-note err"; note.textContent = e.message; }
        toast("Save failed", "err");
      }).then(function () { btn.disabled = false; });
    });
  }

  function wirePackages() {
    onSave("save-packages", collect_packages);
    var add = $("add-package");
    if (add) add.addEventListener("click", function () {
      collect_packages();
      content.packages = content.packages || [];
      content.packages.push({ id: "", name: "New package", price: "MVR 0", popular: false, image: "package", includes: [] });
      setView("packages");
    });
    wireItemActions("packages", collect_packages);
  }
  function wirePortfolio() {
    onSave("save-portfolio", collect_portfolio);
    var add = $("add-portfolio");
    if (add) add.addEventListener("click", function () {
      collect_portfolio();
      content.portfolio = content.portfolio || [];
      var seed = "photo-" + Date.now();
      content.portfolio.push({ title: "New photo", category: "Portraits",
        image_url: "https://picsum.photos/seed/" + seed + "/600/600",
        full_url: "https://picsum.photos/seed/" + seed + "/1200/1200", alt: "New photo" });
      setView("portfolio");
    });
    wireItemActions("portfolio", collect_portfolio);
  }
  function wireItemActions(key, collectFn) {
    if (!content) return; // content not set up yet — view shows the setup notice
    var arr = content[key] || [];
    function rerun() { setView(key); }
    Array.prototype.forEach.call($("panel").querySelectorAll("[data-up]"), function (b) {
      b.addEventListener("click", function () { var i = +b.getAttribute("data-up"); if (i > 0) { collectFn(); swap(arr, i, i - 1); rerun(); } });
    });
    Array.prototype.forEach.call($("panel").querySelectorAll("[data-down]"), function (b) {
      b.addEventListener("click", function () { var i = +b.getAttribute("data-down"); if (i < arr.length - 1) { collectFn(); swap(arr, i, i + 1); rerun(); } });
    });
    Array.prototype.forEach.call($("panel").querySelectorAll("[data-remove]"), function (b) {
      b.addEventListener("click", function () { var i = +b.getAttribute("data-remove"); if (window.confirm("Remove this item?")) { collectFn(); arr.splice(i, 1); rerun(); } });
    });
  }
  function swap(a, i, j) { var t = a[i]; a[i] = a[j]; a[j] = t; }

  function wireAccount() {
    var btn = $("ac-save"); if (!btn) return;
    btn.addEventListener("click", function () {
      var pw = val("ac-pw"), pw2 = val("ac-pw2"), err = $("ac-err");
      err.textContent = "";
      if (pw.length < 6) { err.textContent = "Password must be at least 6 characters."; return; }
      if (pw !== pw2) { err.textContent = "Passwords don’t match."; return; }
      btn.disabled = true;
      changePassword(pw).then(function () { toast("Password updated"); $("ac-pw").value = ""; $("ac-pw2").value = ""; })
        .catch(function (e) { err.textContent = e.message; }).then(function () { btn.disabled = false; });
    });
  }

  function bail(e) { toast((e && e.message) || "Error", "err"); }

  // ===========================================================================
  // Login / boot
  // ===========================================================================
  function showLogin() {
    $("login-view").classList.remove("hidden");
    $("app-view").classList.add("hidden");
    var e = $("login-error"); if (e) e.textContent = "";
  }
  function showApp() {
    $("login-view").classList.add("hidden");
    $("app-view").classList.remove("hidden");
    var s = getSession(); if (s && $("who")) $("who").textContent = s.email;
    // Load leads + content + visits, then render the starting view.
    Promise.all([fetchLeads().catch(function () {}), fetchContent(), fetchVisits()]).then(function () {
      var start = (location.hash || "#dashboard").slice(1);
      setView(VIEWS[start] ? start : "dashboard");
    });
  }

  function init() {
    if (!BASE || !ANON) {
      document.body.innerHTML = '<p style="max-width:640px;margin:80px auto;font-family:sans-serif;color:#333">Supabase is not configured (missing url / anon key in config.js).</p>';
      return;
    }
    var form = $("login-form");
    if (form) form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = val("login-email").trim(), pass = val("login-password"), errEl = $("login-error"), btn = $("login-btn");
      errEl.textContent = ""; btn.disabled = true; btn.textContent = "Signing in…";
      login(email, pass).then(showApp)
        .catch(function (err) { errEl.textContent = err.message; })
        .then(function () { btn.disabled = false; btn.textContent = "Sign in"; });
    });
    if ($("logout-btn")) $("logout-btn").addEventListener("click", logout);
    Array.prototype.forEach.call(document.querySelectorAll(".sidebar a"), function (a) {
      a.addEventListener("click", function (e) { e.preventDefault(); setView(a.getAttribute("data-view")); });
    });

    var s = getSession();
    if (s && s.access_token && s.expires_at && (s.expires_at - 60) > Math.floor(Date.now() / 1000)) showApp();
    else if (s && s.refresh_token) refresh().then(showApp).catch(function () { clearSession(); showLogin(); });
    else showLogin();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
