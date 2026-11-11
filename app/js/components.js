// Briques d'interface partagées entre les écrans.
import * as api from './api.js';
import { h, icon, cover, chapterNo } from './ui.js';
import { t } from './i18n.js';
import { back } from './router.js';
import { newCount } from './store.js';

export const seriesTitle = (s) => s.metadata?.title || s.name || '';

/** Part lue d'un chapitre, entre 0 et 1. */
export function bookProgress(book) {
  const p = book.readProgress;
  if (!p) return 0;
  if (p.completed) return 1;
  const total = book.media?.pagesCount || 0;
  return total ? Math.min(1, p.page / total) : 0;
}

export function topbar(title, { onBack, fallback, actions = [], large = false } = {}) {
  return h('header.topbar' + (large ? '.large' : ''),
    onBack !== false && !large
      ? h('button.iconbtn', { type: 'button', 'aria-label': t('Retour'), onclick: onBack || (() => back(fallback)) }, icon('back'))
      : null,
    h('h1', title),
    h('div.topbar-actions', actions));
}

export function searchButton() {
  return h('a.iconbtn', { href: '#/search', 'aria-label': t('Rechercher') }, icon('search'));
}

/** « Page 7 sur 18 », ou « Page 7 » quand le serveur ne connaît pas encore le total. */
export function pageOf(b) {
  const n = b.media?.pagesCount;
  return n ? t('Page {p} sur {n}', { p: b.readProgress.page, n }) : t('Page {p}', { p: b.readProgress.page });
}
/** « Chapitre 12, page 7 sur 18 ». */
export function chapterAndPage(b) {
  const n = chapterNo(b);
  const total = b.media?.pagesCount;
  return total
    ? t('Chapitre {n}, page {p} sur {total}', { n, p: b.readProgress.page, total })
    : t('Chapitre {n}, page {p}', { n, p: b.readProgress.page });
}

/** Couverture de série au format livre. */
export function seriesCard(s) {
  const fresh = newCount(s.id);
  return h('a.card', { href: `#/series/${s.id}` },
    h('div.card-img', cover(api.seriesThumb(s.id)),
      fresh > 0 ? h('span.badge.up', { title: t('{n} nouveaux chapitres', { n: fresh }) }, 'UP') : null,
      s.booksUnreadCount > 0 && s.booksUnreadCount < s.booksCount
        ? h('span.badge.count', String(s.booksUnreadCount)) : null),
    h('p.card-title', seriesTitle(s)),
    h('p.card-sub', s.booksCount === 1 ? t('1 chapitre') : t('{n} chapitres', { n: s.booksCount })));
}

/** Chapitre présenté par sa couverture (rangée « Nouveaux chapitres »). */
export function bookCard(b) {
  return h('a.card', { href: `#/read/${b.id}` },
    h('div.card-img', cover(api.bookThumb(b.id)), h('span.badge.no', '#' + chapterNo(b))),
    h('p.card-title', b.seriesTitle),
    h('p.card-sub', b.metadata?.title || b.name));
}

/** Carte large « reprendre la lecture ». */
export function resumeCard(b) {
  const pct = Math.round(bookProgress(b) * 100);
  return h('a.resume', { href: `#/read/${b.id}` },
    h('div.resume-img', cover(api.bookThumb(b.id))),
    h('div.resume-body',
      h('p.resume-series', b.seriesTitle),
      h('p.resume-chapter', t('Chapitre {n}', { n: chapterNo(b) })),
      h('div.meter', { role: 'img', 'aria-label': t('{n} % lu', { n: pct }) }, h('i', { style: { width: pct + '%' } })),
      // Un chapitre entamé dont le total de pages est encore inconnu (archive jamais rouverte) n'est pas « pas encore commencé ».
      h('p.resume-state', pct > 0 || (b.readProgress && !b.media?.pagesCount) ? pageOf(b) : t('Pas encore commencé'))));
}

/** Rangée horizontale titrée. */
export function row(title, items, { moreHref } = {}) {
  if (!items.length) return null;
  return h('section.row',
    h('div.row-head', h('h2', title), moreHref ? h('a.row-more', { href: moreHref }, t('Tout voir')) : null),
    h('div.scroller', items));
}

export function chips(options, value, onChange) {
  const wrap = h('div.chips', { role: 'tablist' });
  const paint = () => {
    wrap.replaceChildren(...options.map((o) =>
      h('button.chip' + (o.value === value ? '.on' : ''), {
        type: 'button', role: 'tab', 'aria-selected': o.value === value ? 'true' : 'false',
        onclick: () => { if (o.value === value) return; value = o.value; paint(); onChange(value); },
      }, o.label)));
  };
  paint();
  return wrap;
}
