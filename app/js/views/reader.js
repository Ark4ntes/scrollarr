// Lecteur vertical continu : toutes les pages d'un chapitre empilées dans une
// seule bande, chargées à l'approche et déchargées quand elles sont loin.
import * as api from '../api.js';
import * as store from '../store.js';
import * as downloads from '../downloads.js';
import { h, icon, cover, sheet, toast, debounce, chapterNo, chapterTitle, emptyState, add, fill } from '../ui.js';
import { t } from '../i18n.js';
import { back, go } from '../router.js';

const isImage = (p) => (p.mediaType || 'image/').startsWith('image/');
const byNumber = (a, b) => (a.metadata?.numberSort ?? a.number ?? 0) - (b.metadata?.numberSort ?? b.number ?? 0);

async function loadBook(id) {
  await downloads.load();
  const dl = downloads.get(id);
  try {
    const [book, pages] = await Promise.all([api.book(id), api.bookPages(id)]);
    return { book, pages };
  } catch (e) {
    if (e instanceof api.OfflineError && dl?.pages) return { book: dl.book, pages: dl.pages };
    throw e;
  }
}

/** Chapitre voisin ; hors ligne, on se rabat sur les chapitres téléchargés de la série. */
async function neighbour(book, dir) {
  try { return await (dir > 0 ? api.nextBook(book.id) : api.previousBook(book.id)); }
  catch {
    const local = downloads.all().filter((r) => r.seriesId === book.seriesId && r.status === 'done').map((r) => r.book).sort(byNumber);
    const i = local.findIndex((b) => b.id === book.id);
    return i < 0 ? null : local[i + dir] || null;
  }
}

export async function reader(root, { id }) {
  const cfg = store.getSettings();
  const loaded = await loadBook(id);
  const book = loaded.book;
  const pages = loaded.pages.filter(isImage);
  const total = pages.length;
  const seriesPath = `/series/${book.seriesId}`;
  document.title = `${book.seriesTitle} – ${chapterTitle(book)}`;

  if (!total) {
    add(root, emptyState(t('Ce chapitre ne peut pas être lu ici'),
      t('Scrollarr affiche les formats en images (CBZ, CBR, PDF). Ouvrez ce fichier dans Komga.'),
      h('button.btn', { type: 'button', onclick: () => back(seriesPath) }, t('Retour à la série'))));
    return;
  }

  const pending = api.pendingProgress(id);
  const rp = pending || book.readProgress;
  const wasCompleted = !!rp?.completed;
  const start = rp && !rp.completed ? Math.min(Math.max(1, rp.page), total) : 1;
  let cur = start;
  let finished = false;

  // ── Bande de pages ──
  const boxes = pages.map((p, i) => {
    const box = h('div.pg', { dataset: { i } });
    if (p.width && p.height) box.style.aspectRatio = `${p.width} / ${p.height}`;
    else box.classList.add('guess');
    return box;
  });

  function load(i) {
    const box = boxes[i];
    if (box.firstChild) return;
    const img = new Image();
    img.alt = t('Page {n}', { n: i + 1 });
    img.decoding = 'async';
    img.draggable = false;
    img.onload = () => {
      if (box.classList.contains('guess')) {
        // Dimensions inconnues à l'avance : on corrige la hauteur sans faire sauter la lecture.
        const before = box.offsetHeight;
        box.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
        box.classList.remove('guess');
        const delta = box.offsetHeight - before;
        if (delta && box.getBoundingClientRect().top < 0) scrollBy(0, delta);
      }
      box.classList.add('ok');
    };
    img.onerror = () => {
      if (!img.dataset.retried && pages[i].fallbackUrl) {
        // Format que le navigateur ne sait pas afficher : on demande à Komga de convertir.
        img.dataset.retried = '1';
        img.src = pages[i].fallbackUrl;
        return;
      }
      fill(box, h('button.btn', { type: 'button', onclick: (e) => { e.stopPropagation(); box.replaceChildren(); load(i); } },
        icon('refresh', 18), t('Recharger la page {n}', { n: i + 1 })));
    };
    img.src = pages[i].url;
    add(box, img);
  }
  function unload(i) {
    const box = boxes[i];
    if (!box.classList.contains('ok')) return;
    box.classList.remove('ok');
    box.replaceChildren();
  }

  const idx = (e) => Number(e.target.dataset.i);
  const near = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) load(idx(e)); }),
    { rootMargin: '200% 0px 300% 0px' });
  const far = new IntersectionObserver((es) => es.forEach((e) => { if (!e.isIntersecting) unload(idx(e)); }),
    { rootMargin: '1200% 0px 1200% 0px' });
  // Ligne horizontale au milieu de l'écran : la page qui la croise est la page courante.
  const mid = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) setCurrent(idx(e) + 1); }),
    { rootMargin: '-50% 0px -50% 0px' });

  const ends = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) setCurrent(total); }),
    { rootMargin: '-50% 0px -50% 0px' });

  // ── Progression ──
  let moved = false;
  const save = (opts) => {
    if (wasCompleted && !finished) return; // relecture : on ne « dé-termine » pas un chapitre lu
    // Ouvrir un chapitre sans le faire défiler ne doit pas le placer en tête de l'historique.
    if (!moved && !finished) return;
    api.saveProgress(id, finished ? total : cur, finished, { ...opts, book }).catch(() => {});
  };
  const saveSoon = debounce(save, 1500);

  const count = h('output.r-count');
  const slider = h('input.r-slider', { type: 'range', min: '1', max: String(total), step: '1', value: String(start), 'aria-label': t('Aller à la page') });
  let seeking = 0;
  slider.addEventListener('input', () => {
    seeking = Date.now();
    boxes[slider.value - 1].scrollIntoView({ block: 'start' });
  });

  function setCurrent(n) {
    if (n !== start) moved = true;
    cur = n;
    count.textContent = `${n} / ${total}`;
    if (Date.now() - seeking > 400) slider.value = n;
    slider.style.setProperty('--fill', (total > 1 ? ((n - 1) / (total - 1)) * 100 : 100) + '%');
    if (n >= total) finished = true;
    if (n >= total - 2) preloadNext();
    saveSoon();
  }

  // ── Chapitres voisins ──
  const prevBtn = h('button.iconbtn', { type: 'button', disabled: true, 'aria-label': t('Chapitre précédent') }, icon('back'));
  const nextBtn = h('button.iconbtn', { type: 'button', disabled: true, 'aria-label': t('Chapitre suivant') }, icon('next'));
  const endBody = h('div.end-next');
  let nextB = null;
  let preloaded = false;
  const open = (b) => { save(); go(`/read/${b.id}`, { replace: true }); };

  neighbour(book, -1).then((b) => { if (b) { prevBtn.disabled = false; prevBtn.onclick = () => open(b); } });
  neighbour(book, +1).then((b) => {
    nextB = b;
    if (b) {
      nextBtn.disabled = false;
      nextBtn.onclick = () => open(b);
      fill(endBody, 
        h('button.nextcard', { type: 'button', onclick: () => open(b) },
          h('div.nextcard-img', cover(api.bookThumb(b.id))),
          h('div', h('p.nextcard-kicker', t('Chapitre suivant')), h('p.nextcard-title', chapterTitle(b))),
          icon('next')));
      if (cur >= total - 2) preloadNext();
    } else {
      fill(endBody, h('p.end-note', t('Vous êtes à jour : c’était le dernier chapitre disponible.')));
    }
  });
  function preloadNext() {
    if (preloaded || !nextB || !api.isReachable()) return;
    preloaded = true;
    api.bookPages(nextB.id).then((ps) => ps.filter(isImage).slice(0, 2).forEach((p) => { new Image().src = p.url; })).catch(() => {});
  }

  const favBtn = h('button.btn', { type: 'button' });
  const paintFav = () => {
    const on = store.isFavorite(book.seriesId);
    fill(favBtn, icon(on ? 'check' : 'plus', 18), on ? t('Abonné') : t('S’abonner à la série'));
    favBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  favBtn.onclick = async () => {
    if (store.isFavorite(book.seriesId)) store.toggleFavorite({ id: book.seriesId });
    else {
      const s = await api.series(book.seriesId).catch(() => ({ id: book.seriesId, name: book.seriesTitle }));
      store.toggleFavorite(s);
    }
    paintFav();
  };
  paintFav();

  // ── Défilement automatique ──
  let auto = false;
  let raf = 0;
  const autoBtn = h('button.iconbtn', { type: 'button', 'aria-label': t('Défilement automatique'), 'aria-pressed': 'false', onclick: (e) => { e.stopPropagation(); auto ? stopAuto() : startAuto(); } }, icon('play'));
  function startAuto() {
    auto = true;
    fill(autoBtn, icon('pause'));
    autoBtn.setAttribute('aria-pressed', 'true');
    setBars(false);
    let last = performance.now();
    let carry = 0;
    const step = (now) => {
      if (!auto) return;
      carry += (cfg.autoSpeed * Math.min(100, now - last)) / 1000;
      last = now;
      const px = Math.floor(carry);
      if (px) { carry -= px; scrollBy(0, px); }
      if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) return stopAuto();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  function stopAuto() {
    auto = false;
    cancelAnimationFrame(raf);
    fill(autoBtn, icon('play'));
    autoBtn.setAttribute('aria-pressed', 'false');
    setBars(true);
  }

  // ── Barres ──
  const strip = h('div.strip', boxes);
  const el = h('div.reader',
    h('header.rbar.top',
      h('button.iconbtn', { type: 'button', 'aria-label': t('Retour à la série'), onclick: () => { save(); back(seriesPath); } }, icon('back')),
      h('div.r-title', h('p.r-series', book.seriesTitle), h('p.r-chapter', chapterTitle(book))),
      autoBtn,
      h('button.iconbtn', { type: 'button', 'aria-label': t('Réglages de lecture'), onclick: openSettings }, icon('settings'))),
    start === 1 ? null : h('p.r-resume', t('Reprise à la page {n}', { n: start })),
    strip,
    h('section.end',
      h('p.end-kicker', t('Fin du chapitre {n}', { n: chapterNo(book) })),
      h('h2', book.seriesTitle),
      endBody,
      h('div.end-actions', favBtn,
        h('button.btn', { type: 'button', onclick: () => { save(); back(seriesPath); } }, t('Tous les chapitres')))),
    h('footer.rbar.bottom', prevBtn, h('div.r-seek', slider, count), nextBtn));

  function applyLook() {
    el.style.setProperty('--gap', cfg.gap + 'px');
    el.style.setProperty('--maxw', cfg.maxWidth >= 1600 ? 'none' : cfg.maxWidth + 'px');
    el.dataset.bg = cfg.readerBg;
  }
  applyLook();

  let bars = true;
  function setBars(v) { bars = v; el.classList.toggle('bars-off', !v); }
  strip.addEventListener('click', () => { if (auto) stopAuto(); else setBars(!bars); });

  let lastY = 0;
  let up = 0;
  const onScroll = () => {
    const y = scrollY;
    const dy = y - lastY;
    lastY = y;
    if (auto || Date.now() - seeking < 400) return;
    if (dy > 0) { up = 0; if (y > 80 && bars) setBars(false); }
    else if (dy < 0) { up -= dy; if ((up > 160 || y < 8) && !bars) setBars(true); }
    if (innerHeight + y >= document.documentElement.scrollHeight - 40 && !bars) setBars(true);
  };

  // ── Réglages ──
  function openSettings(e) {
    e?.stopPropagation();
    sheet(t('Réglages de lecture'), (body) => {
      const set = (k, v) => { store.setSetting(k, v); applyLook(); };
      const choice = (label, key, options) => h('fieldset.field', h('legend', label),
        h('div.seg', options.map(([v, l]) => h('label', h('input', { type: 'radio', name: key, checked: cfg[key] === v, onchange: () => set(key, v) }), h('span', l)))));
      const range = (label, key, min, max, step, fmt) => {
        const out = h('output', fmt(cfg[key]));
        return h('label.field', h('span.field-label', label, out),
          h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(cfg[key]),
            oninput: (ev) => { set(key, Number(ev.target.value)); out.textContent = fmt(cfg[key]); } }));
      };
      add(body, 
        choice(t('Espace entre les pages'), 'gap', [[0, t('Aucun')], [8, t('Fin')], [28, t('Large')]]),
        choice(t('Fond'), 'readerBg', [['black', t('Noir')], ['white', t('Blanc')]]),
        innerWidth > 620 ? range(t('Largeur des pages'), 'maxWidth', 480, 1600, 20, (v) => (v >= 1600 ? t('Tout l’écran') : v + ' px')) : null,
        range(t('Vitesse du défilement automatique'), 'autoSpeed', 30, 320, 10, (v) => v + ' px/s'),
        h('label.field.check', h('input', { type: 'checkbox', checked: cfg.keepAwake, onchange: (ev) => { set('keepAwake', ev.target.checked); ev.target.checked ? lockScreen() : unlockScreen(); } }),
          h('span', t('Garder l’écran allumé pendant la lecture'))));
    });
  }

  // ── Écran allumé ──
  let wake = null;
  async function lockScreen() {
    if (!cfg.keepAwake || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try { wake = await navigator.wakeLock.request('screen'); } catch { /* refusé (batterie faible, etc.) */ }
  }
  function unlockScreen() { wake?.release().catch(() => {}); wake = null; }

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') save({ keepalive: true });
    else lockScreen();
  };
  const onHide = () => save({ keepalive: true });
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.sheet-wrap')) back(seriesPath); };

  // ── Montage ──
  add(root, el);
  if (start > 1) boxes[start - 1].scrollIntoView({ block: 'start' });
  lastY = scrollY;
  count.textContent = `${start} / ${total}`;
  slider.style.setProperty('--fill', (total > 1 ? ((start - 1) / (total - 1)) * 100 : 100) + '%');
  boxes.forEach((b) => { near.observe(b); far.observe(b); mid.observe(b); });
  // Un saut direct en bas de page ne fait croiser la ligne à aucune page : la fin compte aussi.
  ends.observe(el.querySelector('.end'));
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('keydown', onKey);
  lockScreen();
  if (!api.isReachable() && !downloads.isDone(id)) toast(t('Hors ligne : ce chapitre n’est pas téléchargé, des pages peuvent manquer.'), { duration: 6000 });

  return () => {
    stopAuto();
    save({ keepalive: true });
    near.disconnect(); far.disconnect(); mid.disconnect(); ends.disconnect();
    removeEventListener('scroll', onScroll);
    removeEventListener('pagehide', onHide);
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('keydown', onKey);
    unlockScreen();
    document.title = 'Scrollarr';
  };
}
