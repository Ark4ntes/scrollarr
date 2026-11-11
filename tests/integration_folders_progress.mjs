// Intégration : progression de lecture du service folders en HTTP (READ-002 §4.4, §4.6) : enregistrer, relire,
// marquer lu / non lu, « en cours » et « récents », filtre par état, profils, redémarrage, garde-fous des écritures.
// Lancer avec : node tests/integration_folders_progress.mjs
import assert from 'node:assert/strict';
import { renameSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { suite, fixture, env, passwordEnv, boot, get, post, request, CREDENTIALS, JSON_POST } from './_folders.mjs';

const { test, run } = suite('folders progress over HTTP');
const fx = fixture();
const ENV = env({}, fx);
let app = await boot(ENV, { progressFlushMs: 0 });
const send = (method, path, body = {}, headers = {}) => request(app, method, path, { headers: { ...JSON_POST, ...headers }, body });
const api = async (path) => (await get(app, path)).json;
const find = async (name) => (await api('/api/v1/series?size=100')).content.find((s) => s.name === name);
const books = async (series) => (await api(`/api/v1/series/${series.id}/books`)).content;
const flush = async () => { await app.progress.flush(); };

const beta = await find('Beta Folders');      // dossiers d'images : nombre de pages connu dès le parcours
const alpha = await find('Alpha Quest');      // archives : nombre de pages connu après ouverture
const gamma = await find('Gamma Tomes');
const betaBooks = await books(beta);
const alphaBooks = await books(alpha);
const gammaBooks = await books(gamma);

test('a chapter starts without progress, and a series without any count of read chapters', async () => {
  assert.equal(betaBooks[0].readProgress, undefined);
  assert.equal(beta.booksReadCount, 0);
  assert.equal(beta.booksInProgressCount, 0);
  assert.equal(beta.booksUnreadCount, 3);
});

test('PATCH saves the page; the chapter, the series and the lists then show it', async () => {
  const [b1] = betaBooks;
  const res = await send('PATCH', `/api/v1/books/${b1.id}/progress`, { page: 2, completed: false });
  assert.equal(res.status, 204);
  const book = await api(`/api/v1/books/${b1.id}`);
  assert.equal(book.readProgress.page, 2);
  assert.equal(book.readProgress.completed, false);
  assert.ok(!Number.isNaN(Date.parse(book.readProgress.readDate)));
  const s = await api(`/api/v1/series/${beta.id}`);
  assert.deepEqual([s.booksReadCount, s.booksInProgressCount, s.booksUnreadCount], [0, 1, 2]);
  assert.equal((await books(beta))[0].readProgress.page, 2);
  assert.equal((await api('/api/v1/books/inprogress')).content[0].id, b1.id);
});

test('a page beyond the known page count is brought back to the last page; completed without a page keeps the count', async () => {
  const [b1, b2] = betaBooks;
  await send('PATCH', `/api/v1/books/${b1.id}/progress`, { page: 99, completed: false });
  assert.equal((await api(`/api/v1/books/${b1.id}`)).readProgress.page, b1.media.pagesCount);
  await send('PATCH', `/api/v1/books/${b2.id}/progress`, { completed: true });
  const p = (await api(`/api/v1/books/${b2.id}`)).readProgress;
  assert.deepEqual([p.completed, p.page], [true, b2.media.pagesCount]);
});

test('completed defaults to "page reached the last one" when it is not sent', async () => {
  const b3 = betaBooks[2];
  await send('PATCH', `/api/v1/books/${b3.id}/progress`, { page: b3.media.pagesCount });
  assert.equal((await api(`/api/v1/books/${b3.id}`)).readProgress.completed, true);
  await send('PATCH', `/api/v1/books/${b3.id}/progress`, { page: 1 });
  assert.equal((await api(`/api/v1/books/${b3.id}`)).readProgress.completed, false);
});

test('invalid bodies and identifiers are refused without recording anything', async () => {
  const id = gammaBooks[0].id;
  for (const body of [{}, { page: 0 }, { page: -3 }, { page: 1.5 }, { page: '2' }, { page: 2e9 }, { completed: 'yes', page: 1 }, { completed: false }, { page: null }]) {
    assert.equal((await send('PATCH', `/api/v1/books/${id}/progress`, body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await send('PATCH', '/api/v1/books/0123456789abcdef.0123456789abcdef/progress', { page: 1 })).status, 404);
  assert.equal((await send('PATCH', '/api/v1/books/pas-un-id/progress', { page: 1 })).status, 404);
  assert.equal((await send('PATCH', `/api/v1/books/${id}/progress?profile=../x`, { page: 1 })).status, 400);
  assert.equal((await send('PATCH', `/api/v1/books/${id}/progress?profile=${'a'.repeat(33)}`, { page: 1 })).status, 400);
  assert.equal((await send('PUT', '/api/v1/series/0123456789abcdef/progress')).status, 404);
  assert.equal((await api(`/api/v1/books/${id}`)).readProgress, undefined);
});

test('an archive learns its page count when it is opened, and keeps it with the progress', async () => {
  const [a1] = alphaBooks;
  assert.equal(a1.media.pagesCount, null);
  await get(app, `/api/v1/books/${a1.id}/pages`);
  assert.equal((await api(`/api/v1/books/${a1.id}`)).media.pagesCount, 3);
  await send('PATCH', `/api/v1/books/${a1.id}/progress`, { page: 2 });
  assert.equal((await api(`/api/v1/books/${a1.id}`)).readProgress.page, 2);
});

test('DELETE puts a chapter back to unread', async () => {
  const [b1] = betaBooks;
  assert.equal((await send('DELETE', `/api/v1/books/${b1.id}/progress`)).status, 204);
  assert.equal((await api(`/api/v1/books/${b1.id}`)).readProgress, undefined);
  assert.equal((await send('DELETE', `/api/v1/books/${b1.id}/progress`)).status, 204); // idempotent
});

test('PUT / DELETE on a series mark every chapter read / unread', async () => {
  assert.equal((await send('PUT', `/api/v1/series/${gamma.id}/progress`)).status, 204);
  let s = await api(`/api/v1/series/${gamma.id}`);
  assert.deepEqual([s.booksReadCount, s.booksInProgressCount, s.booksUnreadCount], [4, 0, 0]);
  assert.ok((await books(gamma)).every((b) => b.readProgress.completed));
  assert.equal((await send('DELETE', `/api/v1/series/${gamma.id}/progress`)).status, 204);
  s = await api(`/api/v1/series/${gamma.id}`);
  assert.deepEqual([s.booksReadCount, s.booksInProgressCount, s.booksUnreadCount], [0, 0, 4]);
});

test('"in progress" holds the chapters not finished, "recent" all of them, newest first, with size', async () => {
  await send('DELETE', `/api/v1/series/${beta.id}/progress`);
  await send('DELETE', `/api/v1/series/${alpha.id}/progress`);
  const t0 = Date.now();
  await send('PATCH', `/api/v1/books/${alphaBooks[0].id}/progress`, { page: 2 });
  await new Promise((r) => setTimeout(r, 5));
  await send('PATCH', `/api/v1/books/${betaBooks[0].id}/progress`, { completed: true });
  await new Promise((r) => setTimeout(r, 5));
  await send('PATCH', `/api/v1/books/${gammaBooks[1].id}/progress`, { page: 1 });
  const inProgress = (await api('/api/v1/books/inprogress')).content;
  assert.deepEqual(inProgress.map((b) => b.id), [gammaBooks[1].id, alphaBooks[0].id]);
  const recent = (await api('/api/v1/books/recent')).content;
  assert.deepEqual(recent.map((b) => b.id), [gammaBooks[1].id, betaBooks[0].id, alphaBooks[0].id]);
  assert.ok(recent.every((b) => b.seriesTitle && b.readProgress && Date.parse(b.readProgress.readDate) >= t0));
  assert.deepEqual((await api('/api/v1/books/recent?size=2')).content.map((b) => b.id), [gammaBooks[1].id, betaBooks[0].id]);
  assert.equal((await get(app, '/api/v1/books/recent?size=0')).status, 400);
  assert.equal((await get(app, '/api/v1/books/inprogress?size=abc')).status, 400);
  assert.equal((await get(app, '/api/v1/books/inprogress?profile=../x')).status, 400);
});

test('status filter: UNREAD, IN_PROGRESS and READ, combined with search and library; any other value is a 400', async () => {
  // état : Alpha en cours, Beta (chapitre 1 lu : en cours aussi), Gamma en cours, les autres jamais ouvertes.
  const names = async (q) => (await api(`/api/v1/series?size=100&${q}`)).content.map((s) => s.name);
  assert.deepEqual(await names('status=IN_PROGRESS'), ['Alpha Quest', 'Beta Folders', 'Gamma Tomes']);
  assert.deepEqual(await names('status=READ'), []);
  assert.deepEqual(await names('status=UNREAD'), ['Delta Oneshot', 'Epsilon Mixte', 'Omega', 'Solo Story']);
  await send('PUT', `/api/v1/series/${(await find('Solo Story')).id}/progress`);
  assert.deepEqual(await names('status=READ'), ['Solo Story']);
  assert.deepEqual(await names('status=UNREAD&search=mixte'), ['Epsilon Mixte']);
  assert.deepEqual(await names('status=IN_PROGRESS&search=mixte'), []);
  const libs = await api('/api/v1/libraries');
  const autre = libs.find((l) => l.name === 'Autre').id;
  assert.deepEqual(await names(`status=UNREAD&library=${autre}`), ['Omega']);
  const page = await api('/api/v1/series?status=UNREAD&size=2&page=1');
  assert.deepEqual([page.content.length, page.totalElements, page.last], [1, 3, true]);
  for (const bad of ['status=read', 'status=DONE', 'status=UNREAD,READ', 'status=%27']) assert.equal((await get(app, `/api/v1/series?${bad}`)).status, 400, bad);
  // Un filtre vide reste sans effet.
  assert.equal((await names('status=')).length, 7);
});

test('profiles: another profile starts empty and does not touch the main one; the default is main', async () => {
  const id = betaBooks[1].id;
  await send('PATCH', `/api/v1/books/${id}/progress?profile=p1`, { page: 2 });
  assert.equal((await api(`/api/v1/books/${id}?profile=p1`)).readProgress.page, 2);
  assert.equal((await api(`/api/v1/books/${id}?profile=main`)).readProgress, undefined);
  assert.equal((await api(`/api/v1/books/${id}`)).readProgress, undefined);
  assert.deepEqual((await api('/api/v1/books/inprogress?profile=p1')).content.map((b) => b.id), [id]);
  assert.deepEqual((await api('/api/v1/books/inprogress?profile=p2')).content, []);
  assert.deepEqual((await api('/api/v1/series?status=IN_PROGRESS&profile=p1')).content.map((s) => s.name), ['Beta Folders']);
  const s = await api(`/api/v1/series/${beta.id}?profile=p1`);
  assert.equal(s.booksInProgressCount, 1);
  assert.equal((await api(`/api/v1/series/${beta.id}`)).booksInProgressCount, 0);
});

test('restart: everything is read back from the data folder, and an archive keeps its page count', async () => {
  const a1 = alphaBooks[0].id;
  await send('PATCH', `/api/v1/books/${a1}/progress`, { page: 2 });
  await app.close(); // flush à l'arrêt, comme SIGTERM
  assert.ok(readdirSync(join(fx.data, 'progress', 'main')).length >= 3);
  app = await boot(ENV, { progressFlushMs: 0 });
  const book = await api(`/api/v1/books/${a1}`);
  assert.equal(book.readProgress.page, 2);
  assert.equal(book.media.pagesCount, 3, 'le nombre de pages revient avec la progression, sans rouvrir l\'archive');
  assert.deepEqual((await api('/api/v1/books/inprogress')).content.map((b) => b.id).sort(), [a1, gammaBooks[1].id].sort());
  assert.equal((await api(`/api/v1/books/${betaBooks[1].id}?profile=p1`)).readProgress.page, 2);
});

test('a chapter that disappears keeps its progress, hidden from the lists; it comes back with the file', async () => {
  const chapter = join(fx.libraries, 'Scans', 'Alpha Quest', 'Chapitre 001.cbz');
  const away = `${chapter}.parti`;
  const a1 = alphaBooks[0].id;
  renameSync(chapter, away);
  assert.equal((await get(app, `/api/v1/books/${a1}`)).status, 404);
  assert.equal((await api('/api/v1/books/inprogress')).content.some((b) => b.id === a1), false);
  assert.equal((await get(app, '/api/v1/books/inprogress')).status, 200);
  assert.equal((await send('PATCH', `/api/v1/books/${a1}/progress`, { page: 1 })).status, 404); // rien n'est enregistré pour un chapitre inconnu
  renameSync(away, chapter);
  assert.equal((await api(`/api/v1/books/${a1}`)).readProgress.page, 2);
});

test('writes follow the cross-origin rules: X-Requested-With, JSON Content-Type, Origin', async () => {
  const id = gammaBooks[0].id;
  const url = `/api/v1/books/${id}/progress`;
  const body = JSON.stringify({ page: 1 });
  assert.equal((await request(app, 'PATCH', url, { headers: { 'Content-Type': 'application/json' }, body })).status, 403);
  assert.equal((await request(app, 'PATCH', url, { headers: { 'X-Requested-With': 'x', 'Content-Type': 'text/plain' }, body })).status, 415);
  assert.equal((await request(app, 'PATCH', url, { headers: { 'X-Requested-With': 'x' }, body })).status, 415);
  assert.equal((await request(app, 'PATCH', url, { headers: { ...JSON_POST, Origin: 'https://autre.exemple' }, body })).status, 403);
  for (const method of ['DELETE', 'PUT']) {
    const target = method === 'PUT' ? `/api/v1/series/${gamma.id}/progress` : url;
    assert.equal((await request(app, method, target, { headers: { 'Content-Type': 'application/json' } })).status, 403, method);
    assert.equal((await request(app, method, target, { headers: { ...JSON_POST, Origin: 'null' }, body: '{}' })).status, 403, method);
  }
  assert.equal((await request(app, 'PATCH', url, { headers: { ...JSON_POST, 'Content-Type': 'application/json; charset=utf-8' }, body })).status, 204);
  assert.equal((await request(app, 'PATCH', url, { headers: { ...JSON_POST, Origin: `http://127.0.0.1:${app.port}` }, body })).status, 204);
  // Aucune de ces requêtes refusées n'a rien enregistré, et aucune réponse n'ouvre le CORS.
  const res = await request(app, 'PATCH', url, { headers: { 'Content-Type': 'application/json' }, body });
  assert.ok(!Object.keys(res.headers).some((h) => h.startsWith('access-control-')));
  assert.equal((await request(app, 'OPTIONS', url, { headers: { Origin: `http://127.0.0.1:${app.port}`, 'Access-Control-Request-Method': 'PATCH' } })).status, 405);
});

test('body limit and bad JSON on the progress routes', async () => {
  const url = `/api/v1/books/${gammaBooks[0].id}/progress`;
  assert.equal((await send('PATCH', url, { page: 1, x: 'a'.repeat(70000) })).status, 413);
  assert.equal((await request(app, 'PATCH', url, { headers: JSON_POST, body: '{pas du json' })).status, 400);
  assert.equal((await request(app, 'PATCH', url, { headers: JSON_POST, body: '[1]' })).status, 400);
});

test('no path leaks in what the progress routes answer', async () => {
  const texts = [];
  for (const path of ['/api/v1/books/inprogress', '/api/v1/books/recent', `/api/v1/series/${beta.id}`, '/api/v1/series?status=READ']) texts.push((await get(app, path)).text);
  texts.push((await send('PATCH', `/api/v1/books/${gammaBooks[0].id}/progress`, { page: 'x' })).text);
  for (const text of texts) assert.ok(!text.includes(fx.libraries) && !text.includes(fx.data), text.slice(0, 80));
});

test('(teardown) the main service stops', async () => { await app.close(); });

// ── Mode password : les routes de progression exigent la session ──
const pw = fixture();
const secured = await boot(passwordEnv(pw), { progressFlushMs: 0 });
const cookie = (await post(secured, '/api/v1/login', CREDENTIALS)).headers['set-cookie'][0].split(';')[0];
const first = (await get(secured, '/api/v1/series?size=1', { Cookie: cookie })).json.content[0];
const firstBook = (await get(secured, `/api/v1/series/${first.id}/books`, { Cookie: cookie })).json.content[0];
test('password mode: progress routes answer 401 without a session and work with one', async () => {
  const w = (method, path, headers = {}) => request(secured, method, path, { headers: { ...JSON_POST, ...headers }, body: { page: 1 } });
  for (const [method, path] of [['PATCH', `/api/v1/books/${firstBook.id}/progress`], ['DELETE', `/api/v1/books/${firstBook.id}/progress`],
    ['PUT', `/api/v1/series/${first.id}/progress`], ['DELETE', `/api/v1/series/${first.id}/progress`]]) {
    assert.equal((await w(method, path)).status, 401, `${method} ${path}`);
    assert.equal((await w(method, path, { Cookie: cookie })).status, 204, `${method} ${path} (session)`);
  }
  assert.equal((await get(secured, '/api/v1/books/inprogress')).status, 401);
  assert.equal((await get(secured, '/api/v1/books/recent')).status, 401);
  assert.equal((await get(secured, '/api/v1/books/inprogress', { Cookie: cookie })).status, 200);
});
test('password mode: progress survives a restart of the service', async () => {
  await request(secured, 'PATCH', `/api/v1/books/${firstBook.id}/progress`, { headers: { ...JSON_POST, Cookie: cookie }, body: { page: 2 } });
  await secured.close();
  const again = await boot(passwordEnv(pw), { progressFlushMs: 0 });
  const login = await post(again, '/api/v1/login', CREDENTIALS);
  const c2 = login.headers['set-cookie'][0].split(';')[0];
  assert.equal((await get(again, `/api/v1/books/${firstBook.id}`, { Cookie: c2 })).json.readProgress.page, 2);
  await again.close();
});

run();
