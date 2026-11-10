#!/usr/bin/env node
// Vérifie qu'un vrai Suwayomi-Server comprend les requêtes de Scrollarr.
// N'envoie que des requêtes en lecture : rien n'est modifié sur le serveur.
//
//   node dev/check-suwayomi.mjs http://192.168.1.10:4567 [identifiant mot_de_passe]
import { Q, READ_ONLY } from '../app/js/connectors/suwayomi-queries.js';

const [url, user, password] = process.argv.slice(2);
if (!url) { console.error('Usage : node dev/check-suwayomi.mjs <adresse de Suwayomi> [identifiant mot_de_passe]'); process.exit(2); }
const base = url.replace(/\/$/, '');
const headers = { 'Content-Type': 'application/json' };
if (user) headers.Authorization = 'Basic ' + Buffer.from(`${user}:${password || ''}`).toString('base64');

async function run(op, variables) {
  const res = await fetch(base + '/api/graphql', { method: 'POST', headers, body: JSON.stringify({ operationName: op, query: Q[op], variables }), signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join(' ; '));
  return json.data;
}

const VARS = { Latest: { first: 3 }, InProgress: { first: 3 }, RecentlyRead: { first: 3 }, Metas: { prefix: 'scrollarr.' } };
let failed = 0;
let library = [];
const report = (ok, op, detail) => { if (!ok) failed++; console.log(`${ok ? 'OK    ' : 'ÉCHEC '} ${op.padEnd(13)} ${detail}`); };

for (const op of READ_ONLY) {
  try {
    const data = await run(op, VARS[op]);
    let detail = '';
    if (op === 'About') detail = `${data.aboutServer.name} ${data.aboutServer.version}`;
    if (op === 'Library') { library = data.mangas.nodes; detail = `${library.length} séries dans la bibliothèque`; }
    if (op === 'Categories') detail = `${data.categories.nodes.length} catégories`;
    if (data.chapters) detail = `${data.chapters.nodes.length} chapitres renvoyés`;
    report(true, op, detail);
  } catch (e) {
    report(false, op, e.message);
    if (op === 'Probe' && /unauthori[sz]ed|401/i.test(e.message)) {
      console.log('\nSuwayomi demande une authentification. Relancez avec : node dev/check-suwayomi.mjs <adresse> <identifiant> <mot_de_passe>');
      console.log('(le mode « UI login » n’est pas géré par ce script, seulement par l’application)');
      process.exit(1);
    }
  }
}

// Requêtes qui dépendent d'une série existante.
if (library.length) {
  const manga = library[0];
  for (const [op, variables] of [['Manga', { id: manga.id }], ['Chapters', { mangaId: manga.id }]]) {
    try {
      const data = await run(op, variables);
      const chapters = data.chapters?.nodes;
      report(true, op, chapters ? `${chapters.length} chapitres pour « ${manga.title} »` : `« ${data.manga.title} »`);
      if (chapters?.length) {
        const one = await run('Chapter', { id: chapters[0].id });
        report(true, 'Chapter', `« ${one.chapter.name} »`);
        const thumb = await fetch(`${base}/api/v1/manga/${manga.id}/thumbnail`, { headers });
        report(thumb.ok, 'Couverture', `HTTP ${thumb.status} ${thumb.headers.get('content-type') || ''}`);
      }
    } catch (e) { report(false, op, e.message); }
  }
} else {
  console.log('Bibliothèque vide : les requêtes par série n’ont pas été testées.');
}

console.log(failed ? `\n${failed} requête(s) refusée(s) : copiez ce résultat dans un ticket.` : '\nToutes les requêtes en lecture sont acceptées par ce serveur.');
console.log('Non vérifié ici (elles modifient le serveur) : ouverture des pages, progression, téléchargement, connexion.');
process.exit(failed ? 1 : 0);
