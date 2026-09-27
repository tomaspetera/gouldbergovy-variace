/*
 * Online listovací leták – CZ / EN.
 * Desktop a širší displeje: dvoustrany s otáčením listu.
 * Mobil na výšku: jedna strana, listování tažením prstu, zoom dvěma prsty / dvojitým klepnutím.
 */
(function () {
  "use strict";

  const D = window.LEAFLET;
  const N = D.pages;
  const AR = D.pageWidth / D.pageHeight;
  const MAX_ZOOM = 4;
  const HINT_KEY = "leaflet-hint-seen";
  const LANG_KEY = "leaflet-lang";

  const I18N = {
    cz: {
      html: "cs",
      title: "Gouldbergovy variace · 23 Poems",
      brand: "Gouldbergovy variace",
      leaflet: "Leták",
      prev: "Předchozí strana",
      next: "Další strana",
      zoomIn: "Přiblížit",
      zoomOut: "Oddálit",
      thumbs: "Přehled stran",
      download: "Stáhnout PDF",
      fullscreen: "Celá obrazovka",
      close: "Zavřít",
      cta: "Navštivte 23poems.com",
      page: (n) => `Strana ${n}`,
      hintTouch: "Listujte přetažením prstu · přibližujte dvěma prsty nebo dvojitým klepnutím",
      hintMouse: "Listujte šipkami, kolečkem nebo kliknutím na okraj · dvojklikem přiblížíte",
    },
    en: {
      html: "en",
      title: "Gould-berg Variations · 23 Poems",
      brand: "Gould-berg Variations",
      leaflet: "Leaflet",
      prev: "Previous page",
      next: "Next page",
      zoomIn: "Zoom in",
      zoomOut: "Zoom out",
      thumbs: "All pages",
      download: "Download PDF",
      fullscreen: "Full screen",
      close: "Close",
      cta: "Visit 23poems.com",
      page: (n) => `Page ${n}`,
      hintTouch: "Swipe to turn pages · pinch or double-tap to zoom",
      hintMouse: "Turn pages with arrows, the mouse wheel or by clicking the edge · double-click to zoom",
    },
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const stage = $("#stage");
  const zoomEl = $("#zoom");
  const book = $("#book");
  const leaf = $(".leaf", book);
  const slotL = $(".page.left", book);
  const slotR = $(".page.right", book);
  const faceF = $(".face.front", leaf);
  const faceB = $(".face.back", leaf);
  const holders = [slotL, slotR, faceF, faceB];
  holders.forEach((h) => {
    h._lo = $("img.lo", h);
    h._hi = $("img.hi", h);
    h._fx = $(".cast, .shade", h);
  });

  const pageLabel = $("#pageLabel");
  const hint = $("#hint");
  const sheet = $("#sheet");
  const thumbsGrid = $("#thumbs");
  const thumbsBtn = $("#thumbsBtn");
  const zoomInBtn = $("#zoomIn");
  const zoomOutBtn = $("#zoomOut");
  const downloadLink = $("#download");
  const cta = $("#cta");
  const fsBtn = $("#fullscreen");

  // Stav prohlížeče
  const S = {
    lang: "cz",
    mode: "", // "single" | "spread"
    views: [],
    vi: 0,
    focusPage: 1,
    W: 0, H: 0, left: 0, top: 0,
    pw: 0, ph: 0, bx: 0, by: 0,
  };
  // Zoom: posun (x, y) a měřítko s, počátek vlevo nahoře plochy
  const Z = { s: 1, x: 0, y: 0 };
  let flip = null;

  document.documentElement.style.setProperty("--page-ar", AR.toFixed(4));

  /* ---------------- obrázky ---------------- */

  const baseUrl = (lang, p) => `pages/${lang}/${p}.webp`;
  const hdUrl = (lang, p) => `pages/${lang}/hd/${p}.webp`;
  const thumbUrl = (lang, p) => `pages/${lang}/thumb/${p}.webp`;
  const hdReady = new Set();
  const hdLoading = new Set();
  const preloaded = {};

  function preload(lang) {
    if (preloaded[lang]) return;
    preloaded[lang] = [];
    for (let p = 1; p <= N; p++) {
      const im = new Image();
      im.decoding = "async";
      im.src = baseUrl(lang, p);
      preloaded[lang].push(im);
    }
  }

  function wantHD() {
    return S.pw * (window.devicePixelRatio || 1) * Z.s > D.baseWidth * 1.1;
  }

  function fill(h, page) {
    const lo = h._lo, hi = h._hi;
    if (!page) {
      h.classList.add("empty");
      h.dataset.page = "";
      lo.removeAttribute("src");
      hi.removeAttribute("src");
      return;
    }
    h.classList.remove("empty");
    h.dataset.page = page;
    const lu = baseUrl(S.lang, page);
    if (lo.getAttribute("src") !== lu) lo.src = lu;
    if (h.classList.contains("page")) lo.alt = I18N[S.lang].page(page);
    const hu = hdUrl(S.lang, page);
    if (wantHD() && hdReady.has(hu)) {
      if (hi.getAttribute("src") !== hu) hi.src = hu;
    } else if (hi.hasAttribute("src")) {
      hi.removeAttribute("src");
    }
  }

  function refreshHolders() {
    holders.forEach((h) => { if (h.dataset.page) fill(h, +h.dataset.page); });
  }

  function loadHD(page) {
    const u = hdUrl(S.lang, page);
    if (hdReady.has(u) || hdLoading.has(u)) return;
    hdLoading.add(u);
    const im = new Image();
    im.onload = () => {
      const done = () => { hdLoading.delete(u); hdReady.add(u); refreshHolders(); };
      im.decode ? im.decode().then(done, done) : done();
    };
    im.onerror = () => hdLoading.delete(u);
    im.src = u;
  }

  function visiblePages() {
    if (flip) return holders.map((h) => +h.dataset.page).filter(Boolean);
    return viewPages(S.views[S.vi]);
  }

  let hdTimer = 0;
  function scheduleHD() {
    clearTimeout(hdTimer);
    hdTimer = setTimeout(() => {
      if (wantHD()) visiblePages().forEach(loadHD);
      refreshHolders();
    }, 60);
  }

  function waitDecode(imgs, ms) {
    const ps = imgs
      .filter((i) => i.getAttribute("src") && i.decode)
      .map((i) => i.decode().catch(() => {}));
    if (!ps.length) return Promise.resolve();
    return Promise.race([Promise.all(ps), new Promise((r) => setTimeout(r, ms))]);
  }

  /* ---------------- pohledy (strana / dvoustrana) ---------------- */

  function buildViews(mode) {
    const v = [];
    if (mode === "single") {
      for (let p = 1; p <= N; p++) v.push({ l: null, r: p });
    } else {
      v.push({ l: null, r: 1 });
      for (let p = 2; p <= N; p += 2) v.push({ l: p, r: p + 1 <= N ? p + 1 : null });
    }
    return v;
  }

  const viewPages = (v) => [v.l, v.r].filter(Boolean);
  const viewOf = (page) => S.views.findIndex((v) => v.l === page || v.r === page);
  // Stránka, na které uživatel "je" – ve dvoustraně ta, na kterou přešel (např. z přehledu),
  // aby se po otočení telefonu na výšku zobrazila právě ona.
  function currentPage() {
    if (!S.views.length) return S.focusPage;
    const pages = viewPages(S.views[S.vi]);
    return pages.includes(S.focusPage) ? S.focusPage : pages[0];
  }

  // Obálku (a případnou samostatnou zadní stranu) ve dvoustraně vycentrujeme.
  function shiftOf(v) {
    if (S.mode !== "spread") return 0;
    if (!v.l) return -S.pw / 2;
    if (!v.r) return S.pw / 2;
    return 0;
  }

  function setBookX(x) {
    book.style.transform = x ? `translate3d(${x}px,0,0)` : "";
  }

  // Viditelná oblast stránek v souřadnicích plochy (bez zoomu)
  function contentRect() {
    const v = S.views[S.vi];
    let x = S.bx, w = S.pw;
    if (S.mode === "spread") {
      if (v.l && v.r) w = 2 * S.pw;
      else x = S.bx + S.pw / 2;
    }
    return { x, y: S.by, w, h: S.ph };
  }

  /* ---------------- rozvržení ---------------- */

  function layout() {
    const r = stage.getBoundingClientRect();
    const W = r.width, H = r.height;
    if (!W || !H) return;
    S.left = r.left;
    S.top = r.top;

    const narrow = W < 700;
    const mx = narrow ? 12 : 88, my = H < 420 ? 8 : narrow ? 12 : 28;
    const aw = Math.max(60, W - 2 * mx), ah = Math.max(60, H - 2 * my);
    const singleH = Math.min(aw / AR, ah);
    const spreadH = Math.min(aw / (2 * AR), ah);
    const mode = spreadH >= singleH * 0.8 ? "spread" : "single";
    const ph = Math.floor(mode === "spread" ? spreadH : singleH);
    const pw = Math.round(ph * AR);

    const sizeChanged = mode !== S.mode || pw !== S.pw || ph !== S.ph;
    S.W = W;
    S.H = H;
    if (!sizeChanged) {
      positionBook();
      if (Z.s > 1) { clampZoom(); applyZoom(false); }
      return;
    }

    if (flip) endFlip(flip.target === 1);
    const page = currentPage();
    S.pw = pw;
    S.ph = ph;
    if (mode !== S.mode) {
      S.mode = mode;
      S.views = buildViews(mode);
      book.classList.toggle("spread", mode === "spread");
      book.classList.toggle("single", mode === "single");
    }
    S.vi = Math.max(0, viewOf(page));
    positionBook();
    Z.s = 1; Z.x = 0; Z.y = 0;
    applyZoom(false);
    renderIdle();
  }

  function positionBook() {
    const bw = S.mode === "spread" ? 2 * S.pw : S.pw;
    S.bx = Math.round((S.W - bw) / 2);
    S.by = Math.round((S.H - S.ph) / 2);
    book.style.width = bw + "px";
    book.style.height = S.ph + "px";
    book.style.left = S.bx + "px";
    book.style.top = S.by + "px";
    book.style.perspective = Math.round(S.pw * 5) + "px";
  }

  /* ---------------- vykreslení ---------------- */

  let leafToken = 0;

  function renderIdle() {
    const v = S.views[S.vi];
    fill(slotL, S.mode === "spread" ? v.l : null);
    fill(slotR, v.r);
    slotL._fx.style.opacity = 0;
    slotR._fx.style.opacity = 0;
    setBookX(shiftOf(v));
    // List schováme až po vykreslení nových stran pod ním (bez bliknutí).
    const token = ++leafToken;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (token !== leafToken || flip) return;
      leaf.classList.remove("on");
      leaf.style.transform = "";
      fill(faceF, null);
      fill(faceB, null);
    }));
    updateUI();
    placeCta();
    scheduleHD();
  }

  // Tlačítko na 23poems.com: na poslední straně ve volném místě, které našel build skript;
  // když místo není, plave nad spodní lištou.
  function placeCta() {
    const v = S.views[S.vi];
    if (!viewPages(v).includes(N)) { cta.classList.remove("show"); return; }
    const gap = D.langs[S.lang].cta;
    if (gap) {
      const slot = v.r === N ? slotR : slotL;
      if (cta.parentNode !== slot) slot.appendChild(cta);
      const h = Math.min(gap.h * 0.7, 0.07) * S.ph;
      cta.classList.remove("floating");
      cta.style.top = (gap.y * S.ph - h / 2).toFixed(1) + "px";
      cta.style.height = h.toFixed(1) + "px";
      cta.style.fontSize = (h * 0.38).toFixed(1) + "px";
    } else {
      if (cta.parentNode !== stage) stage.appendChild(cta);
      cta.classList.add("floating");
      cta.style.top = cta.style.height = cta.style.fontSize = "";
    }
    cta.classList.add("show");
  }

  function flipSpec(dir) {
    const A = S.views[S.vi], B = S.views[S.vi + dir];
    if (S.mode === "spread") {
      return dir > 0
        ? { underL: A.l, underR: B.r, front: A.r, back: B.l, a0: 0, a1: -180, x0: shiftOf(A), x1: shiftOf(B) }
        : { underL: B.l, underR: A.r, front: B.r, back: A.l, a0: -180, a1: 0, x0: shiftOf(A), x1: shiftOf(B) };
    }
    // Jedna strana: list se odklopí k divákovi a zmizí (0° → -90°).
    return dir > 0
      ? { underL: null, underR: B.r, front: A.r, back: null, a0: 0, a1: -90, x0: 0, x1: 0 }
      : { underL: null, underR: A.r, front: B.r, back: null, a0: -90, a1: 0, x0: 0, x1: 0 };
  }

  function startFlip(dir) {
    const f = { dir, spec: flipSpec(dir), p: 0, target: 1, ready: false, dragging: false, raf: 0, onReady: null };
    flip = f;
    leafToken++;
    leaf.classList.remove("on");
    cta.classList.remove("show");
    fill(faceF, f.spec.front);
    fill(faceB, f.spec.back);
    // Počkáme na dekódování obrázků, ať list ani strany pod ním neprobliknou bíle.
    const imgs = [faceF._lo, faceB._lo];
    [f.spec.underL, f.spec.underR].forEach((p) => {
      if (!p) return;
      const im = new Image();
      im.src = baseUrl(S.lang, p);
      imgs.push(im);
    });
    waitDecode(imgs, 150).then(() => {
      if (flip !== f) return;
      fill(slotL, S.mode === "spread" ? f.spec.underL : null);
      fill(slotR, f.spec.underR);
      renderFlip(f);
      leaf.classList.add("on");
      f.ready = true;
      if (f.onReady) { const fn = f.onReady; f.onReady = null; fn(); }
    });
    return f;
  }

  function whenReady(f, fn) {
    if (f.ready) fn();
    else f.onReady = fn;
  }

  function renderFlip(f) {
    const sp = f.spec;
    const a = sp.a0 + (sp.a1 - sp.a0) * f.p;
    leaf.style.transform = `rotateY(${a.toFixed(2)}deg)`;
    setBookX(sp.x0 + (sp.x1 - sp.x0) * f.p);
    const t = -a; // 0 … 180
    if (S.mode === "spread") {
      faceF._fx.style.opacity = t < 90 ? (t / 90).toFixed(3) : 0;
      faceB._fx.style.opacity = t > 90 ? ((180 - t) / 90).toFixed(3) : 0;
      slotR._fx.style.opacity = t < 90 ? (1 - t / 90).toFixed(3) : 0;
      slotL._fx.style.opacity = t > 90 ? (1 - (180 - t) / 90).toFixed(3) : 0;
    } else {
      faceF._fx.style.opacity = (t / 90).toFixed(3);
      slotR._fx.style.opacity = (1 - t / 90).toFixed(3);
    }
  }

  function animateFlip(f, target, duration, ease, done) {
    cancelAnimationFrame(f.raf);
    f.target = target;
    const from = f.p;
    // Na skryté záložce prohlížeč animace pozastavuje – list rovnou dokončíme.
    if (reduceMotion.matches || document.hidden) {
      f.p = target;
      renderFlip(f);
      done();
      return;
    }
    const dur = duration;
    const t0 = performance.now();
    const step = (now) => {
      if (flip !== f) return;
      const k = dur ? Math.min(1, (now - t0) / dur) : 1;
      f.p = from + (target - from) * ease(k);
      renderFlip(f);
      if (k < 1) f.raf = requestAnimationFrame(step);
      else done();
    };
    f.raf = requestAnimationFrame(step);
  }

  function endFlip(commit) {
    const f = flip;
    if (!f) return;
    cancelAnimationFrame(f.raf);
    flip = null;
    if (commit && f.ready) {
      S.vi += f.dir;
      S.focusPage = currentPage();
    }
    renderIdle();
  }

  const flipDuration = () => (S.mode === "spread" ? 760 : 520);
  const dragDistance = () => (S.mode === "spread" ? S.pw * 1.2 : S.pw * 0.75);
  const canGo = (dir) => S.vi + dir >= 0 && S.vi + dir < S.views.length;

  function go(dir) {
    if (flip) {
      if (flip.dragging) return;
      endFlip(flip.target === 1);
    }
    if (!canGo(dir)) { bump(dir); return; }
    hideHint();
    if (Z.s > 1.001) resetZoom(true);
    const f = startFlip(dir);
    whenReady(f, () => animateFlip(f, 1, flipDuration(), easeInOut, () => endFlip(true)));
  }

  function goToPage(page) {
    const vi = viewOf(page);
    if (vi < 0) return;
    if (flip) endFlip(flip.target === 1);
    S.focusPage = page;
    if (vi === S.vi) return;
    if (Math.abs(vi - S.vi) === 1) return go(vi - S.vi);
    resetZoom(false);
    fadeSwap(() => { S.vi = vi; });
  }

  function fadeSwap(change) {
    if (reduceMotion.matches) { change(); renderIdle(); return; }
    book.classList.add("fading");
    setTimeout(() => {
      change();
      renderIdle();
      book.classList.remove("fading");
    }, 160);
  }

  function bump(dir) {
    if (reduceMotion.matches || !book.animate) return;
    const x = shiftOf(S.views[S.vi]);
    book.animate(
      [
        { transform: `translate3d(${x}px,0,0)` },
        { transform: `translate3d(${x - dir * 16}px,0,0)` },
        { transform: `translate3d(${x}px,0,0)` },
      ],
      { duration: 300, easing: "ease-out" }
    );
  }

  /* ---------------- zoom ---------------- */

  function clampZoom() {
    const c = contentRect();
    const s = Z.s, cw = c.w * s, ch = c.h * s;
    Z.x = cw <= S.W ? (S.W - cw) / 2 - c.x * s : clamp(Z.x, S.W - (c.x + c.w) * s, -c.x * s);
    Z.y = ch <= S.H ? (S.H - ch) / 2 - c.y * s : clamp(Z.y, S.H - (c.y + c.h) * s, -c.y * s);
  }

  let movingTimer = 0;
  function applyZoom(animate) {
    zoomEl.style.transition = animate && !reduceMotion.matches ? "transform .32s cubic-bezier(.2,.8,.2,1)" : "none";
    zoomEl.style.transform =
      Z.s === 1 && !Z.x && !Z.y ? "" : `translate3d(${Z.x}px,${Z.y}px,0) scale(${Z.s})`;
    const zoomed = Z.s > 1.001;
    stage.classList.toggle("zoomed", zoomed);
    zoomOutBtn.disabled = !zoomed;
    zoomInBtn.disabled = Z.s >= MAX_ZOOM - 0.001;
    if (animate) {
      zoomEl.classList.add("moving");
      clearTimeout(movingTimer);
      movingTimer = setTimeout(() => zoomEl.classList.remove("moving"), 360);
    }
  }

  function startMoving() {
    clearTimeout(movingTimer);
    zoomEl.classList.add("moving");
  }

  function endMoving() {
    clearTimeout(movingTimer);
    zoomEl.classList.remove("moving");
  }

  function setZoom(s, px, py, animate) {
    s = clamp(s, 1, MAX_ZOOM);
    const cx = (px - Z.x) / Z.s, cy = (py - Z.y) / Z.s;
    Z.s = s;
    if (s <= 1.001) {
      Z.s = 1; Z.x = 0; Z.y = 0;
    } else {
      Z.x = px - cx * s;
      Z.y = py - cy * s;
      clampZoom();
    }
    applyZoom(animate);
    scheduleHD();
  }

  const resetZoom = (animate) => setZoom(1, 0, 0, animate);
  const zoomBy = (k) => setZoom(Z.s * k, S.W / 2, S.H / 2, true);
  const doubleTapZoom = () => (S.mode === "spread" ? 2 : 2.5);

  /* ---------------- gesta ---------------- */

  const ptrs = new Map();
  let G = null;
  let lastTap = null, tapTimer = 0, inertiaRaf = 0, lastPointerType = "mouse";

  const now = () => performance.now();
  const local = (e) => ({ x: e.clientX - S.left, y: e.clientY - S.top, t: now() });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  function velocity(samples) {
    const n = samples.length;
    if (n < 2) return { x: 0, y: 0 };
    const last = samples[n - 1];
    let first = last;
    for (let i = n - 2; i >= 0 && last.t - samples[i].t <= 100; i--) first = samples[i];
    const dt = last.t - first.t;
    if (dt <= 0 || now() - last.t > 100) return { x: 0, y: 0 };
    return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
  }

  function zoneAt(p) {
    const c = contentRect();
    const edge = S.pw * 0.3;
    if (p.x < c.x + edge) return -1;
    if (p.x > c.x + c.w - edge) return 1;
    return 0;
  }

  function updateCursor(p) {
    let c;
    if (Z.s > 1.001) c = "grab";
    else {
      const z = zoneAt(p);
      c = z && canGo(z) ? "pointer" : "zoom-in";
    }
    if (stage.style.cursor !== c) stage.style.cursor = c;
  }

  stage.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button, a")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    lastPointerType = e.pointerType;
    e.preventDefault();
    hideHint();
    try { stage.setPointerCapture(e.pointerId); } catch (_) {}
    const p = local(e);
    ptrs.set(e.pointerId, p);
    stopInertia();

    if (ptrs.size === 1) {
      G = { type: "pending", start: p, last: p, samples: [p], mouse: e.pointerType === "mouse" };
    } else if (ptrs.size === 2) {
      if (G && G.type === "rubber") rubberBack();
      if (flip) endFlip(!flip.dragging && flip.target === 1);
      startPinch();
    }
  });

  stage.addEventListener("pointermove", (e) => {
    const p = local(e);
    if (!ptrs.has(e.pointerId)) {
      if (e.pointerType === "mouse") updateCursor(p);
      return;
    }
    ptrs.set(e.pointerId, p);
    if (!G || G.type === "none") return;
    if (G.type === "pinch") { updatePinch(); return; }

    G.samples.push(p);
    if (G.samples.length > 8) G.samples.shift();
    const dx = p.x - G.start.x, dy = p.y - G.start.y;

    if (G.type === "pending") {
      if (Math.hypot(dx, dy) < (G.mouse ? 5 : 10)) return;
      if (Z.s > 1.001) {
        G.type = "pan";
        stage.classList.add("grabbing");
        startMoving();
      } else if (Math.abs(dx) > Math.abs(dy)) {
        const dir = dx < 0 ? 1 : -1;
        if (canGo(dir)) {
          if (flip) endFlip(flip.target === 1);
          const f = startFlip(dir);
          f.dragging = true;
          G.type = "flip";
          G.origin = p.x;
        } else {
          G.type = "rubber";
        }
      } else {
        G.type = "none";
      }
    }

    if (G.type === "pan") {
      Z.x += p.x - G.last.x;
      Z.y += p.y - G.last.y;
      clampZoom();
      applyZoom(false);
    } else if (G.type === "flip" && flip) {
      flip.p = clamp(-(p.x - G.origin) * flip.dir / dragDistance(), 0, 1);
      if (flip.ready) renderFlip(flip);
    } else if (G.type === "rubber") {
      setBookX(shiftOf(S.views[S.vi]) + Math.sign(dx) * Math.min(60, Math.abs(dx) * 0.25));
    }
    G.last = p;
  });

  function onPointerUp(e) {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (!G) return;

    if (G.type === "pinch") {
      if (ptrs.size < 2) { settlePinch(); G = ptrs.size ? { type: "none" } : null; }
      return;
    }
    if (ptrs.size) return;
    if (G.type === "none") { G = null; return; }

    const p = local(e);
    const v = velocity(G.samples);
    if (G.type === "pending" && e.type === "pointerup") {
      onTap(p);
    } else if (G.type === "flip" && flip) {
      const f = flip;
      f.dragging = false;
      const toward = -v.x * f.dir; // px/ms směrem k dokončení
      const commit = toward > 0.35 || (f.p > 0.3 && toward > -0.2);
      const dur = Math.max(160, flipDuration() * Math.abs((commit ? 1 : 0) - f.p));
      whenReady(f, () => animateFlip(f, commit ? 1 : 0, dur, easeOut, () => endFlip(commit)));
    } else if (G.type === "pan") {
      stage.classList.remove("grabbing");
      startInertia(v.x, v.y);
    } else if (G.type === "rubber") {
      rubberBack();
    }
    G = null;
  }

  stage.addEventListener("pointerup", onPointerUp);
  stage.addEventListener("pointercancel", onPointerUp);
  stage.addEventListener("lostpointercapture", onPointerUp);

  function rubberBack() {
    book.style.transition = "transform .25s cubic-bezier(.2,.8,.2,1)";
    setBookX(shiftOf(S.views[S.vi]));
    setTimeout(() => { book.style.transition = ""; }, 260);
  }

  function startPinch() {
    const [a, b] = Array.from(ptrs.values());
    const m = mid(a, b);
    G = { type: "pinch", d0: Math.max(20, dist(a, b)), s0: Z.s, x0: Z.x, y0: Z.y, m0: m, m };
    startMoving();
  }

  function updatePinch() {
    const [a, b] = Array.from(ptrs.values());
    const m = mid(a, b);
    let s = (G.s0 * dist(a, b)) / G.d0;
    if (s < 1) s = Math.max(0.6, 1 - (1 - s) * 0.45);
    if (s > MAX_ZOOM) s = MAX_ZOOM + (s - MAX_ZOOM) * 0.3;
    const cx = (G.m0.x - G.x0) / G.s0, cy = (G.m0.y - G.y0) / G.s0;
    Z.s = s;
    Z.x = m.x - cx * s;
    Z.y = m.y - cy * s;
    G.m = m;
    applyZoom(false);
    if (wantHD()) visiblePages().forEach(loadHD);
  }

  function settlePinch() {
    if (Z.s < 1.03) {
      Z.s = 1; Z.x = 0; Z.y = 0;
    } else {
      if (Z.s > MAX_ZOOM) {
        const cx = (G.m.x - Z.x) / Z.s, cy = (G.m.y - Z.y) / Z.s;
        Z.s = MAX_ZOOM;
        Z.x = G.m.x - cx * Z.s;
        Z.y = G.m.y - cy * Z.s;
      }
      clampZoom();
    }
    applyZoom(true);
    scheduleHD();
  }

  function startInertia(vx, vy) {
    if (Math.hypot(vx, vy) < 0.05 || reduceMotion.matches) { endMoving(); scheduleHD(); return; }
    let last = now();
    const step = (t) => {
      const dt = Math.min(32, t - last);
      last = t;
      const ix = Z.x + vx * dt, iy = Z.y + vy * dt;
      Z.x = ix;
      Z.y = iy;
      clampZoom();
      if (Math.abs(Z.x - ix) > 0.5) vx = 0;
      if (Math.abs(Z.y - iy) > 0.5) vy = 0;
      const decay = Math.pow(0.94, dt / 16);
      vx *= decay;
      vy *= decay;
      applyZoom(false);
      if (Math.hypot(vx, vy) > 0.02) inertiaRaf = requestAnimationFrame(step);
      else { inertiaRaf = 0; endMoving(); scheduleHD(); }
    };
    inertiaRaf = requestAnimationFrame(step);
  }

  function stopInertia() {
    if (inertiaRaf) { cancelAnimationFrame(inertiaRaf); inertiaRaf = 0; }
  }

  function onTap(p) {
    const t = now();
    if (lastTap && t - lastTap.t < 320 && dist(p, lastTap) < 40) {
      clearTimeout(tapTimer);
      lastTap = null;
      if (Z.s > 1.001) resetZoom(true);
      else setZoom(doubleTapZoom(), p.x, p.y, true);
      return;
    }
    lastTap = { x: p.x, y: p.y, t };
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => {
      lastTap = null;
      if (Z.s > 1.001) return;
      const z = zoneAt(p);
      if (z) go(z);
    }, 300);
  }

  // Kolečko: s Ctrl / gestem na touchpadu zoom, jinak listování (po přiblížení posun).
  let wheelArmed = true, wheelLast = 0, wheelAcc = 0, wheelTimer = 0;
  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? S.H : 1;
    const dx = e.deltaX * k, dy = e.deltaY * k;
    const p = local(e);
    if (e.ctrlKey || e.metaKey) {
      stopInertia();
      startMoving();
      // gesto na touchpadu posílá malé kroky, kolečko myši ~100 na cvaknutí
      setZoom(Z.s * Math.exp(-clamp(dy, -50, 50) * 0.008), p.x, p.y, false);
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(endMoving, 200);
      return;
    }
    if (Z.s > 1.001) {
      Z.x -= dx;
      Z.y -= dy;
      clampZoom();
      applyZoom(false);
      return;
    }
    const t = now();
    if (t - wheelLast > 220) { wheelArmed = true; wheelAcc = 0; }
    wheelLast = t;
    wheelAcc += Math.abs(dx) > Math.abs(dy) ? dx : dy;
    if (wheelArmed && Math.abs(wheelAcc) > 40) {
      wheelArmed = false;
      go(wheelAcc > 0 ? 1 : -1);
    }
  }, { passive: false });

  // Safari na iOS: nezoomovat celou stránku, zoom řeší prohlížeč letáku.
  ["gesturestart", "gesturechange", "gestureend"].forEach((type) =>
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false })
  );
  stage.addEventListener("contextmenu", (e) => { if (lastPointerType !== "mouse") e.preventDefault(); });

  document.addEventListener("keydown", (e) => {
    if (sheet.classList.contains("open")) {
      if (e.key === "Escape") closeSheet();
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const zoomed = Z.s > 1.001;
    const pan = (x, y) => { Z.x += x; Z.y += y; clampZoom(); applyZoom(true); };
    switch (e.key) {
      case "ArrowRight": zoomed ? pan(-80, 0) : go(1); break;
      case "ArrowLeft": zoomed ? pan(80, 0) : go(-1); break;
      case "ArrowDown": if (!zoomed) return; pan(0, -80); break;
      case "ArrowUp": if (!zoomed) return; pan(0, 80); break;
      case "PageDown": go(1); break;
      case "PageUp": go(-1); break;
      case " ":
        if (e.target.closest("button, a")) return;
        go(e.shiftKey ? -1 : 1);
        break;
      case "Home": goToPage(1); break;
      case "End": goToPage(N); break;
      case "+": case "=": zoomBy(1.5); break;
      case "-": case "_": zoomBy(1 / 1.5); break;
      case "0": case "Escape": resetZoom(true); break;
      default: return;
    }
    e.preventDefault();
  });

  /* ---------------- UI ---------------- */

  $$("[data-go]").forEach((b) => b.addEventListener("click", () => go(+b.dataset.go)));
  zoomInBtn.addEventListener("click", () => zoomBy(1.6));
  zoomOutBtn.addEventListener("click", () => {
    if (Z.s / 1.6 < 1.1) resetZoom(true);
    else zoomBy(1 / 1.6);
  });
  $$(".lang button").forEach((b) => b.addEventListener("click", () => setLang(b.dataset.lang)));

  function updateUI() {
    const pages = viewPages(S.views[S.vi]);
    pageLabel.textContent = (pages.length > 1 ? `${pages[0]}–${pages[1]}` : pages[0]) + " / " + N;
    $$("[data-go]").forEach((b) => { b.disabled = !canGo(+b.dataset.go); });
    $$(".thumb", thumbsGrid).forEach((t) => {
      const cur = pages.includes(+t.dataset.page);
      t.classList.toggle("current", cur);
      if (cur) t.setAttribute("aria-current", "page");
      else t.removeAttribute("aria-current");
    });
    try { history.replaceState(null, "", `#${S.lang}/${currentPage()}`); } catch (_) {}
  }

  function setLang(lang, initial) {
    if (!D.langs[lang] || (lang === S.lang && !initial)) return;
    const t = I18N[lang];
    const apply = () => {
      S.lang = lang;
      document.documentElement.lang = t.html;
      document.title = t.title;
      $$("[data-i18n]").forEach((el) => { el.textContent = t[el.dataset.i18n]; });
      $$("[data-i18n-label]").forEach((el) => {
        el.setAttribute("aria-label", t[el.dataset.i18nLabel]);
        if (el.matches("button, a")) el.title = t[el.dataset.i18nLabel];
      });
      $$(".lang button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
      downloadLink.href = `pdf/Online_letak_GV_${lang.toUpperCase()}.pdf`;
      buildThumbs();
      buildText();
      try { localStorage.setItem(LANG_KEY, lang); } catch (_) {}
    };
    preload(lang);
    if (initial) { apply(); return; }
    if (flip) endFlip(flip.target === 1);
    fadeSwap(apply);
  }

  function buildThumbs() {
    thumbsGrid.textContent = "";
    for (let p = 1; p <= N; p++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "thumb";
      b.dataset.page = p;
      const img = document.createElement("img");
      img.src = thumbUrl(S.lang, p);
      img.alt = "";
      img.loading = "lazy";
      img.draggable = false;
      const label = document.createElement("span");
      label.textContent = p;
      b.append(img, label);
      b.setAttribute("aria-label", I18N[S.lang].page(p));
      b.addEventListener("click", () => { closeSheet(); goToPage(p); });
      thumbsGrid.append(b);
    }
    if (S.views.length) updateUI();
  }

  function buildText() {
    const box = $("#srText");
    box.textContent = "";
    box.lang = I18N[S.lang].html;
    D.langs[S.lang].text.forEach((blocks, i) => {
      const h = document.createElement("h2");
      h.textContent = I18N[S.lang].page(i + 1);
      box.append(h);
      blocks.forEach((txt) => {
        const para = document.createElement("p");
        para.textContent = txt;
        box.append(para);
      });
    });
  }

  function openSheet() {
    sheet.inert = false;
    sheet.removeAttribute("inert");
    sheet.classList.add("open");
    const cur = $(".thumb.current", thumbsGrid) || $(".thumb", thumbsGrid);
    if (cur) {
      cur.scrollIntoView({ block: "nearest" });
      cur.focus({ preventScroll: true });
    }
  }

  function closeSheet() {
    if (!sheet.classList.contains("open")) return;
    sheet.classList.remove("open");
    sheet.setAttribute("inert", "");
    thumbsBtn.focus({ preventScroll: true });
  }

  thumbsBtn.addEventListener("click", openSheet);
  $("#sheetClose").addEventListener("click", closeSheet);
  sheet.addEventListener("click", (e) => { if (e.target === sheet) closeSheet(); });

  // Celá obrazovka (na iPhonu prohlížeč nepodporuje, tlačítko se skryje)
  const root = document.documentElement;
  const requestFs = root.requestFullscreen || root.webkitRequestFullscreen;
  const exitFs = document.exitFullscreen || document.webkitExitFullscreen;
  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  if (!requestFs) fsBtn.hidden = true;
  fsBtn.addEventListener("click", () => {
    if (fsElement()) exitFs.call(document);
    else requestFs.call(root);
  });
  ["fullscreenchange", "webkitfullscreenchange"].forEach((type) =>
    document.addEventListener(type, () => root.classList.toggle("is-fullscreen", !!fsElement()))
  );

  let hintTimer = 0;
  function showHint() {
    try { if (localStorage.getItem(HINT_KEY)) return; } catch (_) {}
    const touch = window.matchMedia("(pointer: coarse)").matches;
    $("#hintText").textContent = I18N[S.lang][touch ? "hintTouch" : "hintMouse"];
    hint.classList.add("show");
    hintTimer = setTimeout(hideHint, 6000);
  }

  function hideHint() {
    if (!hint.classList.contains("show")) return;
    clearTimeout(hintTimer);
    hint.classList.remove("show");
    try { localStorage.setItem(HINT_KEY, "1"); } catch (_) {}
  }

  /* ---------------- start ---------------- */

  function parseHash() {
    const m = /^#(cz|en)(?:\/(\d+))?/.exec(location.hash);
    return m ? { lang: m[1], page: m[2] ? clamp(+m[2], 1, N) : null } : null;
  }

  function initialLang(fromHash) {
    if (fromHash) return fromHash.lang;
    const q = new URLSearchParams(location.search).get("lang");
    if (q && D.langs[q.toLowerCase()]) return q.toLowerCase();
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved && D.langs[saved]) return saved;
    } catch (_) {}
    const langs = navigator.languages || [navigator.language || ""];
    return langs.some((l) => /^(cs|sk)\b/i.test(l)) ? "cz" : "en";
  }

  window.addEventListener("hashchange", () => {
    const h = parseHash();
    if (!h) return;
    if (h.lang !== S.lang) setLang(h.lang);
    if (h.page) goToPage(h.page);
  });

  const h = parseHash();
  S.focusPage = (h && h.page) || 1;
  setLang(initialLang(h), true);
  layout();

  if ("ResizeObserver" in window) new ResizeObserver(() => layout()).observe(stage);
  else window.addEventListener("resize", layout);

  setTimeout(showHint, 700);
})();
