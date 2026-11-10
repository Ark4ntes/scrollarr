import * as api from '../api.js';
import { h, icon, spinner, emptyState, debounce, add, fill } from '../ui.js';
import { t } from '../i18n.js';
import { seriesCard } from '../components.js';
import { back, go } from '../router.js';
import { presetGenre } from './library.js';

const RECENT_KEY = 'scrollarr.searches';
const recents = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; } };
const remember = (q) => localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...recents().filter((x) => x !== q)].slice(0, 8)));

let lastQuery = '';

export async function search(root) {
  const input = h('input', {
    type: 'search', placeholder: t('Titre de série'), 'aria-label': t('Rechercher une série'),
    autocomplete: 'off', autocapitalize: 'off', enterkeyhint: 'search', value: lastQuery,
  });
  const out = h('div.search-out');
  let seq = 0;

  async function run(q) {
    lastQuery = q;
    const id = ++seq;
    if (!q) return idle();
    fill(out, spinner());
    try {
      const res = await api.seriesList({ search: q, size: 60 });
      if (id !== seq) return;
      if (!res.content.length) {
        fill(out, emptyState(t('Aucun résultat pour « {q} »', { q }), t('Vérifiez l’orthographe ou essayez un autre titre.')));
        return;
      }
      remember(q);
      fill(out, h('div.grid', res.content.map(seriesCard)));
    } catch {
      if (id === seq) fill(out, emptyState(t('Recherche impossible'), t('Le serveur ne répond pas. Réessayez une fois reconnecté.')));
    }
  }

  async function idle() {
    const past = recents();
    fill(out, 
      past.length ? h('section.block', h('h2', t('Recherches récentes')),
        h('div.chips.wrap', past.map((q) => h('button.chip', { type: 'button', onclick: () => { input.value = q; run(q); } }, q)))) : null);
    const id = seq;
    const genres = await api.genres().catch(() => []);
    if (id !== seq || !genres.length) return;
    add(out, h('section.block', h('h2', t('Parcourir par genre')),
      h('div.chips.wrap', genres.map((g) => h('button.chip', { type: 'button', onclick: () => { presetGenre(g); go('/library'); } }, g)))));
  }

  input.addEventListener('input', debounce(() => run(input.value.trim()), 300));
  add(root, 
    h('header.topbar.searchbar',
      h('button.iconbtn', { type: 'button', 'aria-label': t('Retour'), onclick: () => back() }, icon('back')),
      h('form.searchfield', { role: 'search', onsubmit: (e) => { e.preventDefault(); input.blur(); run(input.value.trim()); } },
        icon('search', 18), input)),
    out);

  if (lastQuery) run(lastQuery); else { idle(); input.focus(); }
}
