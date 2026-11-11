import * as api from '../api.js';
import { h, icon, cover, chapterNo, emptyState, add, fill } from '../ui.js';
import { t } from '../i18n.js';
import { row, seriesCard, bookCard, resumeCard, searchButton, bookProgress, seriesTitle, chapterAndPage } from '../components.js';
import * as store from '../store.js';
import * as profiles from '../profiles.js';

const val = (r, fallback = []) => (r.status === 'fulfilled' ? r.value?.content ?? fallback : fallback);

export async function home(root) {
  const results = await Promise.allSettled([
    api.booksInProgress(12), api.booksOnDeck(12), api.booksLatest(18), api.seriesNew(18), api.seriesUpdated(18),
  ]);
  // Si tout a échoué pour la même raison (hors ligne sans cache, session expirée), on remonte l'erreur.
  if (results.every((r) => r.status === 'rejected')) throw results[0].reason;
  const [inProgress, onDeck, latest, fresh, updated] = results.map((r) => val(r));

  // « Reprendre » : d'abord les chapitres entamés, puis le prochain chapitre des séries en cours.
  const seen = new Set();
  const resume = [...inProgress, ...onDeck].filter((b) => !seen.has(b.seriesId) && seen.add(b.seriesId));

  add(root, 
    h('header.topbar.brand',
      h('h1.wordmark', 'Scrollarr'),
      h('div.topbar-actions', searchButton(),
        // Avec plusieurs profils, un raccourci rappelle lequel est ouvert.
        profiles.list().length > 1
          ? h('a.avatar.small', { href: '#/profiles', 'aria-label': t('Profil : {name}. Changer de profil', { name: profiles.active().name }) },
            (profiles.active().name.trim()[0] || '?').toUpperCase())
          : null)));

  if (!resume.length && !latest.length && !fresh.length && !updated.length) {
    add(root, emptyState(t('La bibliothèque est vide'),
      t('Ajoutez des séries sur votre serveur : elles apparaîtront ici après le prochain scan.')));
    return;
  }

  add(root, hero(resume[0], updated[0] || fresh[0]));

  const favs = store.favorites();
  const favCards = h('div.scroller');
  const favRow = favs.length
    ? h('section.row', h('div.row-head', h('h2', t('Mes abonnements')), h('a.row-more', { href: '#/my/subscriptions' }, t('Tout voir'))), favCards)
    : null;
  if (favRow) {
    favRow.hidden = true;
    store.refreshFavorites().then((list) => {
      const cards = list.filter((x) => x.series).map((x) => seriesCard(x.series));
      if (!cards.length) return;
      // Les séries avec des nouveautés passent devant.
      cards.sort((a, b) => !!b.querySelector('.up') - !!a.querySelector('.up'));
      fill(favCards, ...cards);
      favRow.hidden = false;
    }).catch(() => {});
  }

  add(root, 
    row(t('Reprendre'), resume.slice(1).map(resumeCard), { moreHref: '#/my/recent' }),
    favRow,
    row(t('Nouveaux chapitres'), latest.map(bookCard)),
    row(t('Nouvelles séries'), fresh.map(seriesCard)),
    row(t('Mises à jour récentes'), updated.map(seriesCard), { moreHref: '#/library' }),
  );
}

function hero(book, series) {
  if (book) {
    const pct = Math.round(bookProgress(book) * 100);
    const n = chapterNo(book);
    return h('a.hero', { href: `#/read/${book.id}` },
      h('div.hero-tone', { 'aria-hidden': 'true' }),
      h('span.hero-no', { 'aria-hidden': 'true' }, n),
      h('div.hero-cover', cover(api.seriesThumb(book.seriesId))),
      h('div.hero-text',
        h('p.hero-kicker', pct > 0 ? t('Vous en étiez là') : t('La suite vous attend')),
        h('h2', book.seriesTitle),
        h('p.hero-sub', pct > 0
          ? chapterAndPage(book)
          : t('Chapitre {n}', { n })),
        h('span.btn.primary', icon('play', 18), pct > 0 ? t('Reprendre') : t('Lire'))));
  }
  if (!series) return null;
  return h('a.hero', { href: `#/series/${series.id}` },
    h('div.hero-tone', { 'aria-hidden': 'true' }),
    h('div.hero-cover', cover(api.seriesThumb(series.id))),
    h('div.hero-text',
      h('p.hero-kicker', t('Dernière arrivée')),
      h('h2', seriesTitle(series)),
      h('p.hero-sub', series.booksCount === 1 ? t('1 chapitre') : t('{n} chapitres', { n: series.booksCount })),
      h('span.btn.primary', t('Voir la série'))));
}
