import * as api from '../api.js';
import * as store from '../store.js';
import * as downloads from '../downloads.js';
import { h, icon, cover, emptyState, fmtAgo, fmtBytes, chapterNo, chapterTitle, actionSheet, toast, add, fill } from '../ui.js';
import { t } from '../i18n.js';
import { topbar, chips, seriesCard, searchButton, bookProgress, chapterAndPage } from '../components.js';
import { go } from '../router.js';

const TAB_KEY = 'scrollarr.myTab';

export async function my(root, { tab }) {
  tab ||= sessionStorage.getItem(TAB_KEY) || 'recent';
  sessionStorage.setItem(TAB_KEY, tab);
  const body = h('div.my-body');
  add(root, 
    topbar(t('Ma liste'), { large: true, actions: [searchButton()] }),
    chips([
      { value: 'recent', label: t('Récents') },
      { value: 'subscriptions', label: t('Abonnements') },
      { value: 'downloads', label: t('Téléchargements') },
    ], tab, (v) => go('/my/' + v, { replace: true })),
    body);
  if (tab === 'subscriptions') return subscriptions(body);
  if (tab === 'downloads') return downloaded(body);
  return recent(body);
}

async function recent(body) {
  // Un historique fidèle : une ligne par chapitre lu, le plus récent en premier.
  const books = (await api.booksRecentlyRead(80)).content;
  if (!books.length) {
    add(body, emptyState(t('Rien de lu pour l’instant'), t('Les chapitres que vous lisez apparaîtront ici, le plus récent en premier.'),
      h('a.btn.primary', { href: '#/library' }, t('Parcourir la bibliothèque'))));
    return;
  }
  add(body, h('ul.lines', books.map((b) => {
    const done = b.readProgress?.completed;
    return h('li.line',
      h('a.line-main', { href: `#/series/${b.seriesId}` },
        h('div.line-img', cover(api.seriesThumb(b.seriesId))),
        h('div.line-body',
          h('p.line-title', b.seriesTitle),
          h('p.line-sub', done ? t('Chapitre {n} terminé', { n: chapterNo(b) }) : chapterAndPage(b)),
          h('p.line-meta', fmtAgo(b.readProgress?.readDate)))),
      done ? null : h('a.btn.small', { href: `#/read/${b.id}` }, t('Reprendre')));
  })));
}

async function subscriptions(body) {
  if (!store.favorites().length) {
    add(body, emptyState(t('Aucun abonnement'),
      t('Abonnez-vous à une série depuis sa fiche : ses nouveaux chapitres seront signalés ici.'),
      h('a.btn.primary', { href: '#/library' }, t('Parcourir la bibliothèque'))));
    return;
  }
  const list = await store.refreshFavorites();
  const withNews = list.filter((x) => x.series && store.newCount(x.item.id) > 0);
  const others = list.filter((x) => !withNews.includes(x));
  const card = (x) => x.series ? seriesCard(x.series)
    // Série injoignable pour l'instant : on affiche ce qu'on sait d'elle.
    : h('a.card', { href: `#/series/${x.item.id}` }, h('div.card-img', cover(api.seriesThumb(x.item.id))), h('p.card-title', x.item.title));
  if (withNews.length) add(body, h('h2.sub', t('Nouveaux chapitres')), h('div.grid', withNews.map(card)));
  if (others.length) add(body, withNews.length ? h('h2.sub', t('À jour')) : null, h('div.grid', others.map(card)));
}

async function downloaded(body) {
  await downloads.load();
  const paint = async () => {
    const recs = downloads.all();
    if (!recs.length) {
      fill(body, emptyState(t('Aucun chapitre hors ligne'),
        t('Téléchargez des chapitres depuis la fiche d’une série pour les lire sans connexion.')));
      return;
    }
    const groups = new Map();
    for (const r of recs) (groups.get(r.seriesId) || groups.set(r.seriesId, []).get(r.seriesId)).push(r);
    const { used, quota } = await downloads.usage();
    fill(body, 
      h('p.note', quota
        ? t('{used} utilisés sur cet appareil, {free} encore disponibles.', { used: fmtBytes(used), free: fmtBytes(Math.max(0, quota - used)) })
        : t('{used} utilisés sur cet appareil.', { used: fmtBytes(used) })),
      ...[...groups.values()].map((list) => {
        list.sort((a, b) => (a.book.metadata?.numberSort ?? 0) - (b.book.metadata?.numberSort ?? 0));
        const first = list[0];
        return h('section.dlgroup',
          h('div.dlgroup-head',
            h('a.dlgroup-title', { href: `#/series/${first.seriesId}` },
              h('div.line-img', cover(api.seriesThumb(first.seriesId))), h('h2', first.seriesTitle)),
            h('button.iconbtn', { type: 'button', 'aria-label': t('Supprimer les téléchargements de {title}', { title: first.seriesTitle }),
              onclick: () => actionSheet(first.seriesTitle, [{ icon: 'trash', danger: true, label: t('Supprimer les {n} chapitres téléchargés', { n: list.length }),
                run: async () => { await downloads.removeSeries(first.seriesId); toast(t('Téléchargements supprimés')); } }]) }, icon('trash', 20))),
          h('ul.dls', list.map((r) => h('li',
            h('a', { href: `#/read/${r.id}` },
              h('span.dls-title', chapterTitle(r.book)),
              h('span.dls-state', r.status === 'done' ? fmtBytes(r.bytes)
                : r.status === 'downloading' ? `${r.done}/${r.total || '…'}`
                  : r.status === 'queued' ? t('En attente') : t('Incomplet'))),
            r.status === 'error' || r.status === 'paused'
              ? h('button.textbtn', { type: 'button', onclick: () => downloads.enqueue(r.book, r.seriesTitle) }, t('Reprendre')) : null,
            h('button.iconbtn', { type: 'button', 'aria-label': t('Supprimer {title}', { title: chapterTitle(r.book) }), onclick: () => downloads.remove(r.id) }, icon('close', 18))))));
      }));
  };
  await paint();
  let timer = 0;
  const onChange = () => { clearTimeout(timer); timer = setTimeout(paint, 250); };
  downloads.events.addEventListener('change', onChange);
  return () => { clearTimeout(timer); downloads.events.removeEventListener('change', onChange); };
}
