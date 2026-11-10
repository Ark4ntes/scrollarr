// Outils d'interface : création d'éléments, icônes, toasts, feuilles modales.
import { t, lang } from './i18n.js';

/** h('div.card', {onclick}, enfants…) */
export function h(spec, attrs, ...kids) {
  const [tag, ...classes] = spec.split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (attrs && (attrs instanceof Node || typeof attrs !== 'object' || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k instanceof Node ? k : String(k));
  }
}

/** Comme Element.append, mais ignore null/false et aplatit les tableaux. */
export function add(el, ...kids) { append(el, kids); return el; }
/** Comme Element.replaceChildren, avec la même tolérance. */
export function fill(el, ...kids) { el.replaceChildren(); append(el, kids); return el; }

const P = {
  home: '<path d="M4 11.5 12 4l8 7.5V20h-5.5v-5.5h-5V20H4z"/>',
  library: '<path d="M5 4v16M10 4v16M14.5 5.2l4.6 14.3"/>',
  my: '<path d="M6 3.5h12V21l-6-4.2L6 21z"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
  back: '<path d="M14.5 5 7.5 12l7 7"/>',
  next: '<path d="m9.5 5 7 7-7 7"/>',
  down: '<path d="m5 9 7 7 7-7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  download: '<path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 19.5h14"/>',
  trash: '<path d="M5 7h14M9.5 7V4.5h5V7M7 7l.8 12.5h8.4L17 7"/>',
  settings: '<path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  sort: '<path d="M8 5v14m0 0-3.5-3.5M8 19l3.5-3.5M16 19V5m0 0-3.5 3.5M16 5l3.5 3.5"/>',
  bell: '<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2H5zM10 20.5h4"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  pause: '<path d="M8 5.5v13M16 5.5v13"/>',
  offline: '<path d="M4 4l16 16M8.5 16.5a5 5 0 0 1 7 0M5.5 13a9.5 9.5 0 0 1 3.2-2.1m4.2-.8a9.500 9.500 0 0 1 5.600 2.900M2.500 9.500A14 14 0 0 1 6 7m4-1.300A14 14 0 0 1 21.500 9.500"/><circle cx="12" cy="19.500" r=".6"/>',
  refresh: '<path d="M19.500 12a7.500 7.500 0 1 1-2.300-5.400M19.500 4.500v4.500H15"/>',
};
export function icon(name, size = 22) {
  const s = document.createElement('span');
  s.className = 'ico';
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`;
  return s;
}

export function toast(message, { action, onAction, duration = 3500 } = {}) {
  const el = h('div.toast', { role: 'status' }, h('span', message));
  if (action) el.append(h('button', { type: 'button', onclick: () => { onAction?.(); el.remove(); } }, action));
  document.getElementById('toasts').append(el);
  if (duration) setTimeout(() => el.remove(), duration);
  return el;
}

/** Feuille qui monte depuis le bas de l'écran. Renvoie une fonction de fermeture. */
export function sheet(title, build) {
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const body = h('div.sheet-body');
  const wrap = h('div.sheet-wrap', { onclick: (e) => { if (e.target === wrap) close(); } },
    h('div.sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div.sheet-head', h('h2', title),
        h('button.iconbtn', { type: 'button', 'aria-label': t('Fermer'), onclick: close }, icon('close'))),
      body));
  build(body, close);
  document.body.append(wrap);
  document.addEventListener('keydown', onKey);
  wrap.querySelector('button, input, select')?.focus({ preventScroll: true });
  return close;
}

/** Feuille composée d'une liste d'actions. */
export function actionSheet(title, actions) {
  return sheet(title, (body, close) => {
    for (const a of actions.filter(Boolean)) {
      body.append(h('button.action' + (a.danger ? '.danger' : ''), {
        type: 'button', onclick: () => { close(); a.run(); },
      }, a.icon ? icon(a.icon) : null, h('span', a.label), a.hint ? h('small', a.hint) : null));
    }
  });
}

/** Image qui se retire proprement quand la vignette n'existe pas. */
export function cover(src, alt = '') {
  return h('img', {
    src, alt, loading: 'lazy', decoding: 'async', draggable: false,
    onerror: (e) => { e.target.classList.add('missing'); e.target.removeAttribute('src'); },
  });
}

export function emptyState(title, text, action) {
  return h('div.empty', h('p.empty-title', title), text ? h('p', text) : null, action || null);
}

export function spinner() { return h('div.spinner', { role: 'status', 'aria-label': t('Chargement') }); }

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString(lang(), { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtAgo(iso) {
  if (!iso) return '';
  const diff = (new Date(iso) - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(lang(), { numeric: 'auto' });
  const steps = [[60, 'second'], [60, 'minute'], [24, 'hour'], [7, 'day'], [4.35, 'week'], [12, 'month'], [Infinity, 'year']];
  let v = diff;
  for (const [n, unit] of steps) {
    if (Math.abs(v) < n) return rtf.format(Math.round(v), unit);
    v /= n;
  }
  return '';
}

export function fmtBytes(n) {
  const fr = lang() === 'fr';
  const mb = (n || 0) / 1048576;
  if (mb >= 1024) return (mb / 1024).toLocaleString(lang(), { maximumFractionDigits: 1 }) + (fr ? ' Go' : ' GB');
  return (n ? Math.max(1, Math.round(mb)) : 0) + (fr ? ' Mo' : ' MB');
}

/** Numéro de chapitre lisible : « 12 », « 12.5 ». */
export function chapterNo(book) {
  const n = book.metadata?.numberSort ?? book.number;
  if (n === undefined || n === null) return book.metadata?.number || '';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** Titre de chapitre, sans répéter le nom de la série. */
export function chapterTitle(book) {
  const title = book.metadata?.title || book.name || '';
  return title || t('Chapitre {n}', { n: chapterNo(book) });
}

export const debounce = (fn, ms) => { let id; return (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); }; };

/** Exécute fn sur chaque élément avec un nombre limité de tâches en parallèle. */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}
