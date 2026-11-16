import * as api from '../api.js';
import { CAP } from '../connectors/contract.js';
import * as store from '../store.js';
import * as downloads from '../downloads.js';
import { h, icon, cover, toast, sheet, actionSheet, fmtDate, chapterNo, chapterTitle, add, fill, debounce } from '../ui.js';
import { t } from '../i18n.js';
import { seriesTitle, bookProgress } from '../components.js';
import { back, refresh, go } from '../router.js';

const ORDER_KEY = 'scrollarr.order';
const STATUS = { ENDED: 'Terminée', ONGOING: 'En cours de parution', ABANDONED: 'Abandonnée', HIATUS: 'En pause' };

/** Chapitre à ouvrir quand on appuie sur le bouton principal. */
export function nextToRead(books) {
  if (!books.length) return null;
  const opened = books.filter((b) => b.readProgress);
  if (!opened.length) return { book: books[0], kind: 'start' };
  if (books.every((b) => b.readProgress?.completed)) return { book: books[0], kind: 'again' };
  // On repart du dernier chapitre ouvert, pas du premier chapitre non lu : on
  // peut avoir pris une série en cours de route sans marquer le début comme lu.
  const last = opened.reduce((a, b) => ((b.readProgress.readDate || '') >= (a.readProgress.readDate || '') ? b : a));
  if (!last.readProgress.completed) return { book: last, kind: 'resume' };
  const after = books.slice(books.indexOf(last) + 1).find((b) => !b.readProgress?.completed);
  if (after) return { book: after, kind: after.readProgress ? 'resume' : 'continue' };
  return { book: last, kind: 'caughtUp' };
}

async function loadSeries(id) {
  await downloads.load();
  try {
    const [s, books] = await Promise.all([api.series(id), api.seriesBooks(id)]);
    return { s, books, offline: false };
  } catch (e) {
    // Hors ligne et jamais consultée : on reconstruit la fiche à partir des téléchargements.
    const recs = downloads.all().filter((r) => r.seriesId === id);
    if (!(e instanceof api.OfflineError) || !recs.length) throw e;
    const books = recs.map((r) => r.book).sort((a, b) => (a.metadata?.numberSort ?? 0) - (b.metadata?.numberSort ?? 0));
    return { s: { id, name: recs[0].seriesTitle, booksCount: books.length, metadata: { title: recs[0].seriesTitle, genres: [] } }, books, offline: true };
  }
}

export async function series(root, { id }) {
  const { s, books, offline } = await loadSeries(id);
  if (!offline) store.markSeen(s);
  const title = seriesTitle(s);
  let desc = localStorage.getItem(ORDER_KEY) === 'desc';

  // Doublons : la ligne « Aussi sur… » ou l'avis d'une copie masquée, remplis dès que la façade a répondu.
  const dup = h('div.dup', { hidden: true });
  let alive = true;

  // ── En-tête ──
  const authors = [...new Set((s.booksMetadata?.authors || [])
    .filter((a) => ['writer', 'penciller', 'artist', 'author'].includes((a.role || '').toLowerCase()))
    .map((a) => a.name))].slice(0, 3);
  const readCount = books.filter((b) => b.readProgress?.completed).length;
  const facts = [
    books.length === 1 ? t('1 chapitre') : t('{n} chapitres', { n: books.length }),
    readCount ? t('{n} lus', { n: readCount }) : null,
    STATUS[s.metadata?.status] ? t(STATUS[s.metadata.status]) : null,
    // Avec plusieurs serveurs, on précise d'où vient la série.
    api.multi() ? api.serverLabel(id) : null,
  ].filter(Boolean);
  // Un lecteur sans suivi de lecture ne propose aucune action « lu / non lu ».
  const tracks = api.can(id, CAP.PROGRESS_WRITE);
  // Regrouper n'a de sens que si plusieurs serveurs sont utilisés et que les doublons sont masqués.
  const canGroup = !offline && api.multi() && api.dedupe();
  const onServer = !offline && api.canServerDownload(id);
  const collector = onServer ? api.serverDownloadLabel(id) : '';

  const favBtn = h('button.btn', { type: 'button', onclick: () => {
    const on = store.toggleFavorite(s);
    paintFav();
    toast(on ? t('Abonné à {title}', { title }) : t('Abonnement retiré'));
  } });
  const paintFav = () => {
    const on = store.isFavorite(id);
    favBtn.classList.toggle('on', on);
    favBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    fill(favBtn, icon(on ? 'check' : 'plus', 18), on ? t('Abonné') : t('S’abonner'));
  };
  paintFav();

  const summaryText = s.metadata?.summary || s.booksMetadata?.summary || '';
  const summary = summaryText
    ? h('p.summary.clamp', { onclick: (e) => e.currentTarget.classList.toggle('clamp') }, summaryText)
    : null;

  add(root, 
    h('section.shero',
      h('div.shero-bg', { 'aria-hidden': 'true' }, cover(api.seriesThumb(id))),
      h('div.shero-tone', { 'aria-hidden': 'true' }),
      h('div.shero-bar',
        h('button.iconbtn.glass', { type: 'button', 'aria-label': t('Retour'), onclick: () => back('/library') }, icon('back')),
        offline || !(tracks || canGroup) ? null : h('button.iconbtn.glass', { type: 'button', 'aria-label': t('Autres actions'), onclick: seriesMenu }, icon('more'))),
      h('div.shero-main',
        h('div.shero-cover', cover(api.seriesThumb(id))),
        h('div.shero-text',
          h('h1', title),
          authors.length ? h('p.shero-authors', authors.join(', ')) : null,
          h('ul.facts', facts.map((f) => h('li', f)))))),
    h('div.sactions', favBtn,
      (downloads.supported() || onServer) && !offline
        ? h('button.btn', { type: 'button', onclick: downloadMenu }, icon('download', 18), t('Télécharger')) : null),
    dup,
    (s.metadata?.genres || []).length ? h('div.chips.wrap.static', s.metadata.genres.map((g) => h('span.chip', g))) : null,
    summary);

  // ── Liste des chapitres ──
  const list = h('ol.eps');
  const rows = new Map();

  function statusOf(b) {
    const d = downloads.get(b.id);
    if (!d) return null;
    if (d.status === 'done') return h('span.dl.done', { title: t('Disponible hors ligne') }, icon('download', 16));
    if (d.status === 'downloading') return h('span.dl', `${d.done}/${d.total || '…'}`);
    if (d.status === 'queued') return h('span.dl', t('En attente'));
    return h('span.dl.err', t('Échec'));
  }

  function rowEl(b) {
    const pct = bookProgress(b);
    const li = h('li.ep' + (pct === 1 ? '.read' : ''),
      h('a.ep-link', { href: `#/read/${b.id}` },
        h('div.ep-img', cover(api.bookThumb(b.id)), pct > 0 && pct < 1 ? h('i.ep-bar', { style: { width: pct * 100 + '%' } }) : null),
        h('div.ep-body',
          h('p.ep-title', chapterTitle(b)),
          h('p.ep-sub', h('span', fmtDate(b.metadata?.releaseDate || b.created)),
            b.media?.pagesCount ? h('span', t('{n} pages', { n: b.media.pagesCount })) : null),
          statusOf(b)),
        h('span.ep-no', '#' + chapterNo(b))),
      h('button.iconbtn.ep-more', { type: 'button', 'aria-label': t('Actions pour {title}', { title: chapterTitle(b) }), onclick: () => chapterMenu(b) }, icon('more', 20)));
    rows.set(b.id, li);
    return li;
  }

  function paintList() {
    rows.clear();
    fill(list, ...(desc ? [...books].reverse() : books).map(rowEl));
  }
  paintList();

  const orderBtn = h('button.textbtn', { type: 'button', onclick: () => {
    desc = !desc;
    localStorage.setItem(ORDER_KEY, desc ? 'desc' : 'asc');
    orderBtn.lastChild.textContent = desc ? t('Du plus récent') : t('Du plus ancien');
    paintList();
  } }, icon('sort', 18), h('span', desc ? t('Du plus récent') : t('Du plus ancien')));

  add(root, 
    h('div.eps-head', h('h2', t('Chapitres')), orderBtn),
    books.length ? list : h('p.note', t('Aucun chapitre lisible pour l’instant.')));

  // ── Bouton principal, collé en bas ──
  const next = nextToRead(books);
  if (next) {
    const n = chapterNo(next.book);
    const label = {
      resume: t('Reprendre le chapitre {n}', { n }),
      continue: t('Lire le chapitre {n}', { n }),
      start: t('Commencer au chapitre {n}', { n }),
      again: t('Relire depuis le début'),
      caughtUp: t('À jour · relire le chapitre {n}', { n }),
    }[next.kind];
    add(root, h('div.cta', h('a.btn.primary.wide', { href: `#/read/${next.book.id}` }, icon('play', 18), label)));
  }

  // ── Menus ──
  async function act(fn, done) {
    try { await fn(); if (done) toast(done); refresh(); }
    catch (e) { toast(e instanceof api.OfflineError ? t('Serveur injoignable. Réessayez une fois reconnecté.') : t('L’action a échoué.')); }
  }

  function seriesMenu() {
    actionSheet(title, [
      tracks ? { icon: 'check', label: t('Marquer toute la série comme lue'), run: () => act(() => api.markSeriesRead(id)) } : null,
      tracks ? { icon: 'refresh', label: t('Remettre toute la série à non lue'), run: () => act(() => api.markSeriesUnread(id)) } : null,
      canGroup ? { icon: 'library', label: t('Regrouper avec une autre série…'), run: groupSheet } : null,
    ]);
  }

  // ── Doublons ──
  const me = { id, title };
  const reasonText = (r) => (r === 'manual' ? t('Regroupée à la main') : t('Même titre'));

  function groupToast(r, other) {
    const stays = r.visible;
    toast(t('Regroupées : « {title} » ({server}) reste affichée.', { title: stays.title, server: stays.serverLabel }),
      { action: t('Défaire'), onAction: () => { r.undo(); toast(t('Regroupement annulé.')); refresh(); }, duration: 7000 });
    if (stays.id !== id) go(`/series/${stays.id}`); else refresh();
  }
  const refusal = (r) => {
    if (r.reason === 'same-server' && r.with?.length) return t('{server} a déjà une série dans ce groupe : « {title} ».', { server: r.with[0].serverLabel, title: r.with[0].title });
    if (r.reason === 'differs') return t('Une autre décision dit que ces séries sont différentes. Retirez-la d’abord dans les Réglages.');
    if (r.reason === 'full') return t('Trop de décisions manuelles. Retirez-en dans les Réglages.');
    return t('L’action a échoué.');
  };

  function groupSheet() {
    sheet(t('Regrouper avec une autre série'), (body, close) => {
      const input = h('input', { type: 'search', value: title, placeholder: t('Titre de série'), 'aria-label': t('Rechercher une série'), autocomplete: 'off', autocapitalize: 'off', enterkeyhint: 'search' });
      const out = h('div.group-out');
      let seq = 0;
      async function run() {
        const q = input.value.trim();
        const n = ++seq;
        if (!q) return fill(out);
        fill(out, h('p.note', t('Recherche…')));
        let found;
        try { found = await api.matchCandidates(me, q); } catch { found = null; }
        if (n !== seq) return;
        if (!found) return fill(out, h('p.note', t('Recherche impossible')));
        if (!found.length) return fill(out, h('p.note', t('Aucun résultat')));
        fill(out, h('ul.src-list', found.map((c) => h('li', h('button.src-item', { type: 'button', onclick: () => pick(c) },
          h('div.src-cover', cover(api.seriesThumb(c.id))),
          h('div.src-text', h('p.src-title', c.title), h('p.src-sub', c.serverLabel)))))));
      }
      async function pick(c) {
        close();
        try {
          const r = await api.groupWith(me, c);
          if (!r.ok) return toast(refusal(r), { duration: 6000 });
          groupToast(r, c);
        } catch { toast(t('L’action a échoué.')); }
      }
      input.addEventListener('input', debounce(run, 300));
      body.append(
        h('p.note.sheet-note', t('Choisissez la même série chez un autre serveur. Une seule s’affiche : celle du serveur prioritaire. La progression, les chapitres et la couverture ne sont pas fusionnés.')),
        h('form.searchfield', { role: 'search', onsubmit: (e) => { e.preventDefault(); input.blur(); run(); } }, icon('search', 18), input),
        out);
      run();
    });
  }

  async function notSame(shown, copy) {
    try {
      const r = await api.separate(shown, copy);
      toast(t('« {title} » ({server}) n’est plus regroupée avec « {other} ».', { title: copy.title, server: copy.serverLabel || api.serverLabel(copy.id), other: shown.title }),
        { action: t('Défaire'), onAction: () => { r.undo(); toast(t('Décision annulée.')); refresh(); }, duration: 7000 });
      refresh();
    } catch { toast(t('L’action a échoué.')); }
  }

  function copiesSheet(info) {
    sheet(t('Aussi sur {servers}', { servers: [...new Set(info.hides.map((c) => c.serverLabel))].join(', ') }), (body, close) => {
      body.append(h('p.note.sheet-note', t('Ces séries sont regroupées avec celle-ci : seule celle du serveur prioritaire s’affiche dans la bibliothèque. Leur progression, leurs chapitres et leur couverture ne sont pas fusionnés avec les siens.')));
      for (const c of info.hides) {
        body.append(h('div.copy',
          h('div.src-item',
            h('div.src-cover', cover(api.seriesThumb(c.id))),
            h('div.src-text', h('p.src-title', c.title), h('p.src-sub', `${c.serverLabel} · ${reasonText(c.reason)}`))),
          h('div.copy-actions',
            h('a.btn.small', { href: `#/series/${c.id}`, onclick: close }, t('Ouvrir')),
            h('button.btn.small', { type: 'button', onclick: () => { close(); notSame(me, c); } }, t('Ce n’est pas la même série')))));
      }
    });
  }

  async function paintDuplicates() {
    let info;
    try { info = await api.copies(id, title); } catch { return; }
    if (!alive) return;
    if (info.hiddenBy) {
      const by = info.hiddenBy;
      fill(dup, h('p.note', t('Cette série est regroupée avec « {title} » ({server}), qui s’affiche à sa place.', { title: by.title, server: by.serverLabel })),
        h('div.copy-actions',
          h('a.btn.small', { href: `#/series/${by.id}` }, t('Voir « {title} »', { title: by.title })),
          h('button.btn.small', { type: 'button', onclick: () => notSame(by, { id, title, serverLabel: api.serverLabel(id) }) }, t('Ce n’est pas la même série'))));
      dup.hidden = false;
    } else if (info.hides.length) {
      const servers = [...new Set(info.hides.map((c) => c.serverLabel))].join(', ');
      fill(dup, h('button.textbtn', { type: 'button', onclick: () => copiesSheet(info) }, t('Aussi sur {servers}', { servers }), icon('next', 16)));
      dup.hidden = false;
    }
  }
  if (!offline && api.multi()) { paintDuplicates(); api.syncMatches(false).catch(() => {}); }

  function chapterMenu(b) {
    const d = downloads.get(b.id);
    actionSheet(chapterTitle(b), [
      offline || !api.can(b.id, CAP.PROGRESS_WRITE) ? null : b.readProgress?.completed
        ? { icon: 'refresh', label: t('Marquer comme non lu'), run: () => act(() => api.markBookUnread(b.id)) }
        : { icon: 'check', label: t('Marquer comme lu'), run: () => act(() => api.markBookRead(b.id)) },
      d
        ? { icon: 'trash', label: t('Supprimer le téléchargement'), danger: true, run: () => downloads.remove(b.id) }
        : downloads.supported() && !offline
          ? { icon: 'download', label: t('Télécharger ce chapitre'), run: () => queue([b]) } : null,
      onServer && !b.onServer
        ? { icon: 'library', label: t('Faire télécharger par {server}', { server: collector }), run: () => keepOnServer([b]) } : null,
    ]);
  }

  function queue(list) {
    const todo = list.filter((b) => !downloads.isDone(b.id));
    if (!todo.length) return toast(t('Ces chapitres sont déjà téléchargés.'));
    todo.forEach((b) => downloads.enqueue(b, title).catch(() => toast(t('Le téléchargement n’est pas disponible sur ce navigateur.'))));
    toast(todo.length === 1 ? t('Téléchargement lancé') : t('{n} téléchargements lancés', { n: todo.length }));
  }

  function keepOnServer(list) {
    const todo = list.filter((b) => !b.onServer);
    if (!todo.length) return toast(t('Ces chapitres sont déjà sur le serveur.'));
    api.serverDownload(todo.map((b) => b.id)).then(
      () => toast(todo.length === 1 ? t('Demandé à {server}. Le chapitre restera sur le serveur, pas sur cet appareil.', { server: collector })
        : t('{n} chapitres demandés à {server}. Ils resteront sur le serveur, pas sur cet appareil.', { n: todo.length, server: collector }), { duration: 5000 }),
      () => toast(t('L’action a échoué.')));
  }

  function downloadMenu() {
    const unread = books.filter((b) => !b.readProgress?.completed);
    const from = next ? books.indexOf(next.book) : 0;
    const have = downloads.all().filter((r) => r.seriesId === id).length;
    const local = downloads.supported();
    const missing = onServer ? books.filter((b) => !b.onServer).length : 0;
    actionSheet(t('Télécharger'), [
      { note: local ? t('Sur cet appareil, pour lire sans connexion :') : t(downloads.unsupportedText()) },
      local ? { icon: 'download', label: t('Les 5 prochains chapitres'), run: () => queue(books.slice(from, from + 5)) } : null,
      local && unread.length && unread.length !== books.length
        ? { icon: 'download', label: t('Tous les chapitres non lus'), hint: String(unread.length), run: () => queue(unread) } : null,
      local ? { icon: 'download', label: t('Toute la série'), hint: String(books.length), run: () => queue(books) } : null,
      missing ? { note: t('Sur le serveur : {server} récupère les chapitres chez la source. Ils se lisent plus vite, mais seulement quand le serveur est joignable.', { server: collector }) } : null,
      missing
        ? { icon: 'library', label: t('Faire télécharger toute la série par {server}', { server: collector }), hint: String(missing), run: () => keepOnServer(books) } : null,
      have ? { icon: 'trash', label: t('Supprimer les téléchargements de cette série'), hint: String(have), danger: true, run: () => downloads.removeSeries(id) } : null,
    ]);
  }

  // Les lignes suivent l'avancement des téléchargements.
  const onDl = (e) => {
    const li = rows.get(e.detail);
    const b = li && books.find((x) => x.id === e.detail);
    if (!b) return;
    const body = li.querySelector('.ep-body');
    body.querySelector('.dl')?.remove();
    const st = statusOf(b);
    if (st) add(body, st);
  };
  downloads.events.addEventListener('change', onDl);
  return () => { alive = false; downloads.events.removeEventListener('change', onDl); };
}
