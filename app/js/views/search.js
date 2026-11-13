import * as api from '../api.js';
import * as ss from '../sourcesearch.js';
import { h, icon, cover, spinner, emptyState, debounce, add, fill, toast, sheet } from '../ui.js';
import { t, lang } from '../i18n.js';
import { seriesCard } from '../components.js';
import { back, go } from '../router.js';
import { presetGenre } from './library.js';

const RECENT_KEY = 'scrollarr.searches';
const recents = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; } };
const remember = (q) => localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...recents().filter((x) => x !== q)].slice(0, 8)));

let lastQuery = '';
// Résultats de la dernière recherche chez les sources : gardés pour le retour depuis une fiche, sans refaire de requête chez les sites.
let lastRemote = null;

/**
 * Recherche chez les sources (collecteur qui sait chercher par titre), sous les résultats de la bibliothèque.
 * Rien n'est demandé ni au serveur ni aux sources tant que l'utilisateur n'a pas appuyé sur le bouton ; le choix des
 * sources se fait ici aussi, et il est gardé sur l'appareil.
 */
function remoteSection(q, isAlive) {
  const k = api.searchCollector();
  const controls = h('div.remote-controls');
  const body = h('div.remote-body');
  const el = h('section.block.remote', { 'data-collector': k.id }, controls, body);
  const label = { all: t('Toutes langues') };
  const elements = new Map(); // identifiant de source -> son bloc
  let dead = false;
  let running = false;
  let list = null; // sources connues, une fois lues
  let data = lastRemote?.query === q ? lastRemote : null;
  const live = () => !dead && isAlive();

  const langOf = (source) => ss.languageLabel(source.language, label.all);
  const chosen = () => (list ? ss.selectedIds(list, ss.loadSaved(k.id), lang()) : []);

  // ── Une source et ses résultats ──
  const FAILURE = (e) => (e instanceof api.OfflineError ? t('Serveur injoignable : cette source n’a pas été cherchée.')
    : e instanceof api.AuthError ? t('Connexion requise.')
      : e instanceof api.ApiError && e.status === 408 ? t('Cette source n’a pas répondu à temps.')
        : t('Cette source a refusé la recherche ou ne répond pas.'));

  function item(group, r) {
    const text = h('div.src-text', h('p.src-title', r.title), h('p.src-sub', [langOf(group.source), group.source.label].filter(Boolean).join(' · ')));
    const img = h('div.src-cover', cover(r.cover));
    if (r.inLibrary && r.seriesId) {
      return h('li', h('a.src-item.in', { href: `#/series/${r.seriesId}` }, img, text, h('span.src-state', icon('check', 16), t('Dans la bibliothèque'))));
    }
    if (r.inLibrary) return h('li', h('div.src-item.in', img, text, h('span.src-state', icon('check', 16), t('Déjà suivi'))));
    const btn = h('button.btn.small.primary', { type: 'button', onclick: () => addIt(group, r, btn) }, t('Ajouter'));
    return h('li', h('div.src-item', img, text, btn));
  }

  function paintGroup(group) {
    const note = (text, cls = '') => h('p.src-note' + cls, text);
    let content;
    if (group.state === 'wait') content = note(t('En attente'));
    else if (group.state === 'run') content = note(t('Recherche…'));
    else if (group.state === 'error') content = note(group.message, '.err');
    else if (!group.results.length) content = note(t('Aucun résultat'));
    else content = [h('ul.src-list', group.results.map((r) => item(group, r))), group.more ? note(t('D’autres résultats existent chez cette source : précisez le titre.')) : null];
    const next = h('section.src', { 'data-source': group.source.id, 'data-state': group.state, 'aria-busy': group.state === 'run' ? 'true' : null },
      h('h3.src-head', group.source.icon ? h('img.src-icon', { src: group.source.icon, alt: '', width: 20, height: 20, loading: 'lazy' }) : null,
        h('span', group.source.label), langOf(group.source) ? h('small.src-lang', langOf(group.source)) : null,
        group.source.nsfw ? h('small.src-lang.adult', '18+') : null),
      content);
    const old = elements.get(group.source.id);
    if (old?.isConnected) old.replaceWith(next); else body.append(next);
    elements.set(group.source.id, next);
  }

  async function addIt(group, r, btn) {
    btn.disabled = true;
    btn.textContent = t('Ajout…');
    try {
      const { seriesId, complete } = await api.addFromSource({ ...r, collector: k.id });
      r.inLibrary = true; r.seriesId = seriesId; // le retour depuis la fiche le montre dans la bibliothèque
      if (!complete) toast(t('Série ajoutée, mais ses chapitres n’ont pas pu être récupérés chez la source. Rouvrez la fiche plus tard.'), { duration: 6000 });
      if (live() && seriesId) go(`/series/${seriesId}`);
      else if (live()) { paintGroup(group); toast(t('Ajoutée à {collector}.', { collector: k.label })); }
    } catch (e) {
      if (!live()) return;
      btn.disabled = false;
      btn.textContent = t('Ajouter');
      toast(e instanceof api.OfflineError ? t('Serveur injoignable. Réessayez une fois reconnecté.') : t('L’ajout a échoué.'));
    }
  }

  // ── Boutons ──
  function paintControls() {
    if (!live()) return;
    if (!api.canSearchNow()) {
      fill(controls, h('p.note.remote-offline', t('Hors ligne : la recherche chez les sources a besoin du serveur. Elle sera de nouveau proposée dès qu’il répond.')));
      return;
    }
    fill(controls,
      h('p.note', t('La recherche interroge les sites des sources, par l’intermédiaire de {collector}. Elle ne part que si vous la lancez.', { collector: k.label })),
      h('div.remote-actions',
        h('button.btn.primary', { type: 'button', disabled: running, onclick: run },
          running ? t('Recherche en cours…') : data ? t('Chercher de nouveau') : t('Chercher chez les sources de {collector}', { collector: k.label })),
        h('button.textbtn', { type: 'button', onclick: choose },
          list ? t('Choisir les sources ({n} sur {total})', { n: chosen().length, total: list.length }) : t('Choisir les sources'))));
  }

  async function readSources() {
    try { list = await api.sources(); return list; }
    catch { toast(t('Impossible de lire la liste des sources.')); return null; }
  }

  async function run() {
    if (running) return;
    running = true;
    paintControls();
    if (!(await readSources())) { running = false; return paintControls(); }
    const picked = list.filter((s) => chosen().includes(s.id));
    fill(body);
    elements.clear();
    if (!list.length) { running = false; paintControls(); return fill(body, h('p.note', t('Aucune source installée sur {collector}. Ajoutez des extensions dans son interface.', { collector: k.label }))); }
    if (!picked.length) { running = false; paintControls(); return fill(body, h('p.note', t('Aucune source choisie. Choisissez-en au moins une.'))); }
    data = lastRemote = { query: q, groups: new Map(picked.map((s) => [s.id, { source: s, state: 'wait', results: [], more: false }])) };
    data.groups.forEach(paintGroup);
    await ss.searchEach(picked, q, (s) => api.searchSource(s.id, q), {
      cancelled: () => !live(),
      stopWhen: (e) => e instanceof api.OfflineError,
      onStart: (s) => { const g = data.groups.get(s.id); g.state = 'run'; paintGroup(g); },
      onSource: (s, out) => {
        const g = data.groups.get(s.id);
        if (out.ok) Object.assign(g, { state: 'done', results: out.results, more: out.more });
        else Object.assign(g, { state: 'error', message: out.skipped ? FAILURE(new api.OfflineError()) : FAILURE(out.error) });
        paintGroup(g);
      },
    });
    running = false;
    paintControls();
  }

  function choose() {
    readSources().then((all) => {
      if (!all || !live()) return;
      sheet(t('Sources interrogées'), (box) => {
        const paint = () => {
          const on = new Set(chosen());
          fill(box,
            h('p.note.sheet-note', t('Seules les sources cochées sont interrogées. Ce choix est gardé sur cet appareil. Les sources 18+ ne sont jamais cochées d’office.')),
            h('div.src-quick',
              h('button.btn.small', { type: 'button', onclick: () => { ss.forgetSelection(k.id); paint(); paintControls(); } }, t('Réinitialiser')),
              h('button.btn.small', { type: 'button', onclick: () => { ss.saveSelection(k.id, []); paint(); paintControls(); } }, t('Aucune'))),
            all.map((s) => {
              const meta = [langOf(s), s.nsfw ? '18+' : null].filter(Boolean).join(' · ');
              const box2 = h('input', { type: 'checkbox', checked: on.has(s.id), onchange: () => {
                if (box2.checked) on.add(s.id); else on.delete(s.id);
                ss.saveSelection(k.id, all.filter((x) => on.has(x.id)).map((x) => x.id));
                paintControls();
              } });
              return h('label.check.src-pick', box2, h('span', h('strong', s.label), meta ? h('small', meta) : null));
            }));
        };
        paint();
      });
    });
  }

  paintControls();
  if (data) {
    // Une recherche laissée en route en quittant l'écran ne reprendra pas toute seule.
    for (const g of data.groups.values()) if (g.state === 'wait' || g.state === 'run') Object.assign(g, { state: 'error', message: t('Recherche interrompue : relancez-la.') });
    data.groups.forEach(paintGroup);
  }
  const onNet = () => paintControls();
  api.events.addEventListener('reachable', onNet);
  addEventListener('online', onNet);
  addEventListener('offline', onNet);
  el.cancel = () => { dead = true; api.events.removeEventListener('reachable', onNet); removeEventListener('online', onNet); removeEventListener('offline', onNet); };
  return el;
}

export async function search(root) {
  let alive = true;
  let remote = null;
  const isAlive = () => alive;
  // Sous les résultats de la bibliothèque, si un collecteur sait chercher : le bouton, jamais la recherche elle-même.
  const withRemote = (q, ...parts) => {
    remote?.cancel();
    remote = api.canSearchSources() ? remoteSection(q, isAlive) : null;
    return [...parts, remote];
  };
  const input = h('input', {
    type: 'search', placeholder: t('Titre de série'), 'aria-label': t('Rechercher une série'),
    autocomplete: 'off', autocapitalize: 'off', enterkeyhint: 'search', value: lastQuery,
  });
  const out = h('div.search-out');
  let seq = 0;

  async function run(q) {
    lastQuery = q;
    const id = ++seq;
    remote?.cancel(); remote = null;
    if (!q) return idle();
    fill(out, spinner());
    try {
      const res = await api.seriesList({ search: q, size: 60 });
      if (id !== seq) return;
      if (!res.content.length) {
        fill(out, withRemote(q, emptyState(t('Aucun résultat pour « {q} »', { q }), t('Vérifiez l’orthographe ou essayez un autre titre.'))));
        return;
      }
      remember(q);
      fill(out, withRemote(q, h('div.grid', res.content.map(seriesCard))));
    } catch {
      if (id === seq) fill(out, withRemote(q, emptyState(t('Recherche impossible'), t('Le serveur ne répond pas. Réessayez une fois reconnecté.'))));
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

  // Appuyer sur Entrée lance déjà la recherche : le délai de frappe ne la relance pas à l'identique (cela effacerait les résultats des sources).
  input.addEventListener('input', debounce(() => { const q = input.value.trim(); if (q !== lastQuery) run(q); }, 300));
  add(root, 
    h('header.topbar.searchbar',
      h('button.iconbtn', { type: 'button', 'aria-label': t('Retour'), onclick: () => back() }, icon('back')),
      h('form.searchfield', { role: 'search', onsubmit: (e) => { e.preventDefault(); input.blur(); run(input.value.trim()); } },
        icon('search', 18), input)),
    out);

  if (lastQuery) run(lastQuery); else { idle(); input.focus(); }
  return () => { alive = false; remote?.cancel(); };
}
