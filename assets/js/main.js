/*
 * CreativeConnect — shared UI behaviour.
 * Runs on every page. Each feature guards on the elements it needs, so loading
 * it everywhere is safe.
 *
 * Content (hero text, trust, packages, portfolio, contact details) renders from
 * window.CC_CONFIG. content.js may refresh CC_CONFIG from Supabase and dispatch
 * "cc:content-updated"; we re-render on that. Event handlers are bound once and
 * use delegation, so re-rendering never breaks clicks.
 */
(function () {
  "use strict";

  var cfg = window.CC_CONFIG || {};
  var CC = window.CC || (window.CC = {});
  var track = CC.track || function () {};
  var currentFilter = "all";

  // ===========================================================================
  // Re-renderable content (safe to run any number of times)
  // ===========================================================================
  function fillFromConfig() {
    var waUrl = "https://wa.me/" + String(cfg.whatsapp || "").replace(/[^0-9]/g, "");
    var igUrl = "https://instagram.com/" + (cfg.instagramHandle || "");
    each("[data-wa-link]", function (a) { a.href = waUrl; });
    each("[data-ig-link]", function (a) { a.href = igUrl; });
    each("[data-ig-handle]", function (el) { el.textContent = "@" + (cfg.instagramHandle || ""); });
    each("[data-email-link]", function (a) { a.href = "mailto:" + (cfg.email || ""); });
    each("[data-email]", function (el) { el.textContent = cfg.email || ""; });
  }

  function renderHeroTrustFooter() {
    var hero = cfg.hero || {};
    setText('[data-cc="hero-eyebrow"]', hero.eyebrow);
    setText('[data-cc="hero-title"]', hero.title);
    setText('[data-cc="hero-subtitle"]', hero.subtitle);
    setText('[data-cc="footer-about"]', cfg.footerAbout);

    var ul = document.querySelector('[data-cc="trust-list"]');
    if (ul && Array.isArray(cfg.trust)) {
      ul.innerHTML = cfg.trust.map(function (t) { return "<li>" + escapeHtml(t) + "</li>"; }).join("");
    }
  }

  function renderHomePackages() {
    var grid = document.getElementById("packages-grid");
    if (!grid) return;
    var packages = cfg.packages || [];

    grid.innerHTML = packages.map(function (p) {
      var includes = (p.includes || []).map(function (i) {
        return '<li>' + escapeHtml(i) + '</li>';
      }).join("");
      var quoteOnly = /custom/i.test(p.price || "");
      var cta = quoteOnly ? "Request a custom quote" : "Choose " + p.name;
      var note = quoteOnly
        ? "Scoped and quoted per brief"
        : "Single Greater Malé location. Travel and extras quoted separately.";

      return '' +
        '<article class="package-card' + (p.popular ? " package-card--popular" : "") + '">' +
          (p.popular ? '<span class="package-card__badge">Most popular</span>' : "") +
          '<div class="media">' +
            '<img src="' + escapeHtml(packageImg(p.image)) + '" ' +
              'width="600" height="400" loading="lazy" alt="' + escapeHtml(p.name) + ' package — sample photography">' +
          '</div>' +
          '<div class="package-card__body">' +
            '<h3 class="package-card__name">' + escapeHtml(p.name) + '</h3>' +
            '<p class="package-card__price">' + escapeHtml(p.price) + '</p>' +
            '<ul class="package-card__includes">' + includes + '</ul>' +
            '<a class="btn btn-primary btn-block" href="booking.html?package=' + encodeURIComponent(p.id) + '" ' +
              'data-cta="packages" data-package="' + escapeHtml(p.name) + '">' + escapeHtml(cta) + '</a>' +
            '<p class="package-card__note">' + escapeHtml(note) + '</p>' +
          '</div>' +
        '</article>';
    }).join("");
  }

  function renderPortfolio() {
    var grid = document.getElementById("portfolio-grid");
    if (!grid) return;
    var items = cfg.portfolio || [];

    grid.innerHTML = items.map(function (p) {
      var full = p.full_url || p.image_url || "";
      var alt = p.alt || p.title || "";
      return '' +
        '<button class="portfolio-item" data-category="' + escapeHtml(p.category || "") + '" ' +
          'data-full="' + escapeHtml(full) + '" aria-label="Open image: ' + escapeHtml(p.title || "") + '">' +
          '<img src="' + escapeHtml(p.image_url || "") + '" width="600" height="600" loading="lazy" alt="' + escapeHtml(alt) + '">' +
        '</button>';
    }).join("");

    var filters = document.getElementById("portfolio-filters");
    if (filters) {
      var cats = [];
      items.forEach(function (p) {
        var c = (p.category || "").trim();
        if (c && cats.indexOf(c) === -1) cats.push(c);
      });
      var tabs = ['<button class="filter-tab is-active" role="tab" aria-selected="true" data-filter="all">All</button>'];
      cats.forEach(function (c) {
        tabs.push('<button class="filter-tab" role="tab" aria-selected="false" data-filter="' +
          escapeHtml(c) + '">' + escapeHtml(c) + "</button>");
      });
      filters.innerHTML = tabs.join("");
    }
    currentFilter = "all";
    applyFilter("all");
  }

  function applyFilter(filter) {
    filter = filter || "all";
    Array.prototype.forEach.call(document.querySelectorAll(".portfolio-item"), function (item) {
      var cat = item.getAttribute("data-category");
      item.hidden = !(filter === "all" || cat === filter);
    });
  }

  // Re-render everything that comes from config. Called on load and whenever
  // content.js refreshes CC_CONFIG from Supabase.
  function applyContent() {
    cfg = window.CC_CONFIG || cfg;
    fillFromConfig();
    renderHeroTrustFooter();
    renderHomePackages();
    renderPortfolio();
  }
  CC.applyContent = applyContent;

  // ===========================================================================
  // Event handlers — bound ONCE, delegated so they survive re-renders
  // ===========================================================================
  function initNav() {
    var toggle = document.querySelector(".nav-toggle");
    var menu = document.getElementById("primary-nav");
    if (!toggle || !menu) return;
    function close() { toggle.setAttribute("aria-expanded", "false"); menu.classList.remove("is-open"); }
    function open() { toggle.setAttribute("aria-expanded", "true"); menu.classList.add("is-open"); }
    toggle.addEventListener("click", function () {
      (toggle.getAttribute("aria-expanded") === "true") ? close() : open();
    });
    menu.addEventListener("click", function (e) { if (e.target.closest("a")) close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  }

  function initPortfolioFilter() {
    document.addEventListener("click", function (e) {
      var tab = e.target.closest(".filter-tab");
      if (!tab) return;
      currentFilter = tab.getAttribute("data-filter");
      Array.prototype.forEach.call(document.querySelectorAll(".filter-tab"), function (t) {
        var active = t === tab;
        t.classList.toggle("is-active", active);
        t.setAttribute("aria-selected", active ? "true" : "false");
      });
      applyFilter(currentFilter);
    });
  }

  function initLightbox() {
    var box = document.getElementById("lightbox");
    if (!box) return;
    var imgEl = box.querySelector(".lightbox__img");
    var closeBtn = box.querySelector(".lightbox__close");
    var prevBtn = box.querySelector(".lightbox__prev");
    var nextBtn = box.querySelector(".lightbox__next");
    var current = 0, lastFocused = null;

    function visible() {
      return Array.prototype.slice.call(document.querySelectorAll(".portfolio-item"))
        .filter(function (t) { return !t.hidden; });
    }
    function show(list, index) {
      if (!list.length) return;
      current = (index + list.length) % list.length;
      var t = list[current];
      imgEl.src = t.getAttribute("data-full");
      imgEl.alt = t.querySelector("img").getAttribute("alt");
    }
    function openItem(trigger) {
      var list = visible();
      var i = list.indexOf(trigger);
      if (i < 0) return;
      lastFocused = document.activeElement;
      show(list, i);
      box.hidden = false;
      document.body.classList.add("no-scroll");
      closeBtn.focus();
    }
    function close() {
      box.hidden = true;
      document.body.classList.remove("no-scroll");
      if (lastFocused) lastFocused.focus();
    }
    function step(d) { show(visible(), current + d); }

    document.addEventListener("click", function (e) {
      var it = e.target.closest(".portfolio-item");
      if (it) openItem(it);
    });
    closeBtn.addEventListener("click", close);
    prevBtn.addEventListener("click", function () { step(-1); });
    nextBtn.addEventListener("click", function () { step(1); });
    box.addEventListener("click", function (e) { if (e.target === box) close(); });
    document.addEventListener("keydown", function (e) {
      if (box.hidden) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "Tab") {
        var f = [closeBtn, prevBtn, nextBtn];
        var i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    });
  }

  function initReveal() {
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var els = document.querySelectorAll("[data-reveal]");
    if (!els.length) return;
    if (reduce || !("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("is-revealed"); });
      return;
    }
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add("is-revealed"); obs.unobserve(entry.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    els.forEach(function (el) { obs.observe(el); });
  }

  function initTracking() {
    document.addEventListener("click", function (e) {
      var cta = e.target.closest("[data-cta]");
      if (cta) {
        var params = { location: cta.getAttribute("data-cta") };
        var pkg = cta.getAttribute("data-package");
        if (pkg) params.package_name = pkg;
        track("cta_click", params);
      }
      var social = e.target.closest("[data-social]");
      if (social) {
        track("social_click", {
          platform: social.getAttribute("data-social"),
          location: social.getAttribute("data-location") || ""
        });
      }
    });
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================
  function each(sel, fn) { Array.prototype.forEach.call(document.querySelectorAll(sel), fn); }
  function setText(sel, value) {
    if (value == null) return;
    each(sel, function (el) { el.textContent = value; });
  }
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function packageImg(image) {
    if (!image) return "https://picsum.photos/seed/package/600/400";
    if (/^(https?:)?\/\//.test(image) || image.charAt(0) === "/") return image;
    return "https://picsum.photos/seed/" + encodeURIComponent(image) + "/600/400";
  }

  // ===========================================================================
  // Boot
  // ===========================================================================
  function init() {
    applyContent();          // render everything from config
    initNav();
    initPortfolioFilter();   // delegated — bound once
    initLightbox();          // delegated — bound once
    initReveal();
    initTracking();
    each("[data-year]", function (el) { el.textContent = new Date().getFullYear(); });

    // content.js refreshes CC_CONFIG from Supabase, then fires this.
    document.addEventListener("cc:content-updated", applyContent);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
