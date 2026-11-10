import * as api from '../api.js';
import { h, spinner, emptyState, add, fill } from '../ui.js';
import { t } from '../i18n.js';
import { topbar, seriesCard, chips, searchButton } from '../components.js';

// L'état survit à la navigation pour que le retour arrière retrouve la grille telle quelle.
const state = { libraryId: '', genre: '', status: '', sort: 'title', items: [], page: 0, done: false, key: '' };
const keyOf = () => [state.libraryId, state.genre, state.status, state.sort, api.signature()].join('|');

/** Permet à un autre écran (recherche par genre) de préparer le filtre. */
export function presetGenre(genre) {
  Object.assign(state, { genre, libraryId: '', status: '', items: [], page: 0, done: false, key: '' });
}

export async function library(root) {
  const [libs, genreList] = await Promise.all([api.libraries(), api.genres().catch(() => [])]);
  // Un filtre mémorisé peut viser un serveur qui n'est plus utilisé.
  if (state.libraryId && !libs.some((l) => l.id === state.libraryId)) state.libraryId = '';
  if (state.genre && !genreList.includes(state.genre)) state.genre = '';
  // Avec plusieurs serveurs, deux bibliothèques peuvent porter le même nom.
  const libName = (l) => (api.multi() ? `${l.name} (${api.serverLabel(l.id)})` : l.name);
  const grid = h('div.grid');
  const more = h('div.grid-more');
  let loading = false;
  let alive = true;

  async function loadMore() {
    if (loading || state.done || !alive) return;
    loading = true;
    fill(more, spinner());
    const key = keyOf();
    try {
      const res = await api.seriesList({
        libraryId: state.libraryId, genre: state.genre, readStatus: state.status, sort: state.sort, page: state.page, size: 36,
      });
      if (key !== keyOf() || !alive) return;
      state.items.push(...res.content);
      state.page++;
      state.done = res.last || res.content.length === 0;
      state.key = key;
      add(grid, ...res.content.map(seriesCard));
      more.replaceChildren();
      if (!state.items.length) fill(more, emptyState(t('Aucune série ne correspond'), t('Essayez d’élargir les filtres.')));
    } catch (e) {
      fill(more, h('button.btn', { type: 'button', onclick: () => loadMore() }, t('Réessayer')));
    } finally {
      loading = false;
      // Tant que la sentinelle reste visible (grand écran), on continue de remplir.
      // Si les filtres ont changé pendant le chargement, on repart avec les nouveaux.
      if (alive && !state.done && (key !== keyOf() || more.getBoundingClientRect().top < innerHeight + 400)) loadMore();
    }
  }

  function reset() {
    Object.assign(state, { items: [], page: 0, done: false, key: '' });
    grid.replaceChildren();
    loadMore();
  }

  const select = (label, options, value, onChange) =>
    h('label.select', h('span.sr', label),
      h('select', { onchange: (e) => onChange(e.target.value) },
        options.map(([v, l]) => h('option', { value: v, selected: v === value }, l))));

  add(root, 
    topbar(t('Bibliothèque'), { large: true, actions: [searchButton()] }),
    libs.length > 1
      ? chips([{ value: '', label: t('Tout') }, ...libs.map((l) => ({ value: l.id, label: libName(l) }))], state.libraryId,
        (v) => { state.libraryId = v; reset(); })
      : null,
    h('div.filters',
      select(t('Tri'), [['title', t('De A à Z')], ['updated', t('Mises à jour récentes')], ['added', t('Ajouts récents')]], state.sort,
        (v) => { state.sort = v; reset(); }),
      select(t('Lecture'), [['', t('Lues et non lues')], ['UNREAD', t('Non commencées')], ['IN_PROGRESS', t('En cours')], ['READ', t('Terminées')]], state.status,
        (v) => { state.status = v; reset(); }),
      genreList.length
        ? select(t('Genre'), [['', t('Tous les genres')], ...genreList.map((g) => [g, g])], state.genre, (v) => { state.genre = v; reset(); })
        : null),
    grid, more);

  if (state.key === keyOf() && state.items.length) add(grid, ...state.items.map(seriesCard));
  else reset();

  const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) loadMore(); }, { rootMargin: '600px' });
  io.observe(more);
  return () => { alive = false; io.disconnect(); };
}
