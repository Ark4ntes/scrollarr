// Suivi des téléchargements demandés aux collecteurs. Écran secondaire, ouvert
// depuis les réglages : la collecte reste en arrière-plan tant qu'on ne vient
// pas la regarder ici.
import * as api from '../api.js';
import { h, toast, fmtAgo, add, fill, emptyState } from '../ui.js';
import { t } from '../i18n.js';
import { topbar } from '../components.js';

const GROUPS = [
  { key: 'running', title: 'En cours', states: ['running'] },
  { key: 'queued', title: 'File d’attente', states: ['queued'] },
  { key: 'failed', title: 'Erreurs', states: ['failed'] },
  { key: 'history', title: 'Historique', states: ['done', 'cancelled'] },
];
const STATE = { queued: 'En attente', running: 'En cours', done: 'Terminé', failed: 'Échec', cancelled: 'Annulé' };

export async function collect(root) {
  const body = h('div.collect');
  let alive = true;
  let timer = 0;

  const act = (run, ok, ko) => async (e) => {
    e.currentTarget.disabled = true;
    try { await run(); toast(t(ok)); } catch { toast(t(ko)); }
    api.refreshTasks().catch(() => {});
  };

  function row(task) {
    const active = task.state === 'queued' || task.state === 'running';
    const when = task.finishedAt || task.startedAt || task.createdAt;
    const meta = [
      task.collectorLabel,
      task.state === 'running' && task.progress !== null ? Math.round(task.progress * 100) + ' %' : t(STATE[task.state]),
      task.attempts > 1 ? t('{n} tentatives', { n: task.attempts }) : null,
      active ? null : fmtAgo(new Date(when).toISOString()),
    ].filter(Boolean).join(', ');
    return h('div.task', { 'data-state': task.state },
      h('div.task-main',
        h(task.seriesId ? 'a.task-title' : 'p.task-title', task.seriesId ? { href: `#/series/${task.seriesId}` } : {},
          [task.seriesTitle, task.chapterTitle].filter(Boolean).join(' — ') || task.id),
        h('p.task-meta', meta),
        task.state === 'failed' && task.error ? h('p.task-error', t(task.error)) : null,
        task.state === 'running' && task.progress !== null
          ? h('progress', { max: 1, value: task.progress, 'aria-label': t('Progression') }) : null),
      task.cancellable ? h('button.btn.small', { type: 'button',
        onclick: act(() => api.cancelTask(task.id), 'Téléchargement annulé', 'Annulation impossible.') }, t('Annuler')) : null,
      task.retryable ? h('button.btn.small', { type: 'button',
        onclick: act(() => api.retryTask(task.id), 'Téléchargement relancé', 'Relance impossible.') }, t('Relancer')) : null);
  }

  function paint() {
    const list = api.tasks();
    if (!list.length) {
      return fill(body, emptyState(t('Aucun téléchargement'),
        t('Depuis la fiche d’une série, demandez au serveur de télécharger des chapitres : leur avancement s’affichera ici.')));
    }
    fill(body, GROUPS.map((g) => {
      const items = list.filter((x) => g.states.includes(x.state));
      if (!items.length) return null;
      return h('section.panel', { 'data-group': g.key },
        h('h2', t(g.title), h('small.count', String(items.length))),
        h('div.tasks', items.map(row)),
        g.key === 'history' || (g.key === 'failed' && !list.some((x) => x.state === 'done' || x.state === 'cancelled'))
          ? h('button.btn.small', { type: 'button', onclick: act(() => api.clearTaskHistory(), 'Historique effacé', 'L’action a échoué.') }, t('Effacer l’historique'))
          : null);
    }));
  }

  // Suivi tant que l'écran est affiché ; plus rapproché quand quelque chose est en cours.
  async function poll() {
    if (!alive) return;
    const list = await api.refreshTasks().catch(() => api.tasks());
    if (alive) timer = setTimeout(poll, list.some((x) => x.state === 'queued' || x.state === 'running') ? 2000 : 15000);
  }

  add(root, topbar(t('Téléchargements'), { fallback: '/more' }),
    h('p.note.collect-note', t('Chapitres que le serveur récupère chez la source. Ils restent sur le serveur : pour lire sans connexion, utilisez « Télécharger » sur la fiche d’une série.')),
    body);
  paint();
  api.taskEvents.addEventListener('change', paint);
  poll();
  return () => { alive = false; clearTimeout(timer); api.taskEvents.removeEventListener('change', paint); };
}
