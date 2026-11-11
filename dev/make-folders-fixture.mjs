// Génère une bibliothèque d'essai pour le service folders (READ-002 §4.11) :
// petites images PNG et archives ZIP produites ici, aucun fichier binaire dans le dépôt.
//
//   node dev/make-folders-fixture.mjs <dossier> [--bulk N]
//
// Résultat : <dossier>/libraries/{Scans,Autre}/… et <dossier>/outside/ (cible des
// liens symboliques sortants). Lancer ensuite :
//   FOLDERS_AUTH=none FOLDERS_LIBRARIES_DIR=<dossier>/libraries FOLDERS_DATA_DIR=<dossier>/data node folders/server.js
import { mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { fileURLToPath } from 'node:url';

/** PNG 1×1 d'une couleur donnée. */
export function png(r = 200, g = 80, b = 80) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from([0, r, g, b]))), chunk('IEND', Buffer.alloc(0))]);
}

/** Archive ZIP (entrées stockées, sans compression) à partir de { nom: Buffer }. */
export function zip(files) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const nameBuf = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const head = Buffer.alloc(46); head.writeUInt32LE(0x02014b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(20, 6);
    head.writeUInt32LE(crc, 16); head.writeUInt32LE(data.length, 20); head.writeUInt32LE(data.length, 24); head.writeUInt16LE(nameBuf.length, 28); head.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data); central.push(head, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

export function makeFixture(out, { bulk = 0 } = {}) {
  const root = resolve(out);
  const lib = join(root, 'libraries');
  const put = (rel, data) => { const f = join(lib, rel); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, data); };
  const pages = (rel, n) => { for (let i = 1; i <= n; i++) put(`${rel}/${String(i).padStart(3, '0')}.png`, png(40 * i % 255, 90, 160)); };
  const cbz = (rel, n = 3) => put(rel, zip(Object.fromEntries(Array.from({ length: n }, (_, i) => [`${String(i + 1).padStart(3, '0')}.png`, png(40 * i, 120, 60)]))));

  // Série d'archives, avec une couverture.
  for (const n of [1, 2, 10]) cbz(`Scans/Alpha Quest/Chapitre ${String(n).padStart(3, '0')}.cbz`);
  put('Scans/Alpha Quest/cover.png', png(10, 10, 200));
  // Série de dossiers d'images : « Chapitre 10 » doit venir après « Chapitre 2 ».
  for (const n of [1, 2, 10]) pages(`Scans/Beta Folders/Chapitre ${n}`, 2 + (n % 3));
  // Niveaux intermédiaires (tomes), étiquette entre crochets, numéros décimaux.
  cbz('Scans/Gamma Tomes/Tome 01/Chapitre 001.cbz');
  cbz('Scans/Gamma Tomes/Tome 01/Chapitre 002.5.cbz');
  pages('Scans/Gamma Tomes/Tome 02/Chapitre 010', 2);
  cbz('Scans/Gamma Tomes/Tome 02/[Equipe] Chapitre 011.cbz');
  // Images directement dans le dossier de la série : un chapitre unique.
  pages('Scans/Delta Oneshot', 4);
  put('Scans/Delta Oneshot/cover.jpg', png());
  // Images en vrac et chapitres : les images en vrac sont ignorées, avec avertissement.
  put('Scans/Epsilon Mixte/001.png', png()); cbz('Scans/Epsilon Mixte/Chapitre 1.cbz');
  // Archive à la racine d'une bibliothèque : série d'un seul chapitre.
  cbz('Scans/Solo Story.cbz');
  // Entrées ignorées en silence.
  put('Scans/@eaDir/miniature.png', png()); put('Scans/.cache/x.png', png()); put('Scans/Alpha Quest/Thumbs.db', 'x'); put('Scans/__MACOSX/x', 'x');
  // Dossier vide, archive vide, dossier trop profond : avertissements.
  mkdirSync(join(lib, 'Scans/Vide'), { recursive: true });
  put('Scans/Zeta Profond/a/b/c/d/Chapitre 1.cbz', zip({ '001.png': png() }));
  put('Scans/Eta Archive Vide/Chapitre 1.cbz', Buffer.alloc(0));
  // Deuxième bibliothèque.
  cbz('Autre/Omega/Chapitre 1.cbz');

  // Liens symboliques : jamais suivis. Leur cible est hors de la bibliothèque.
  const outside = join(root, 'outside');
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, 'secret.txt'), 'hors bibliothèque');
  pages('../outside/Intrus', 2);
  symlinkSync(outside, join(lib, 'Scans/Lien vers dehors'));
  symlinkSync(outside, join(lib, 'Scans/Alpha Quest/Lien'));

  if (bulk > 0) for (let s = 0; s < bulk; s++) for (let c = 1; c <= 3; c++) pages(`Bulk/Serie ${String(s).padStart(5, '0')}/Chapitre ${c}`, 2);
  return { root, libraries: lib, data: join(root, 'data') };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const bulkAt = args.indexOf('--bulk');
  const bulk = bulkAt >= 0 ? Number(args.splice(bulkAt, 2)[1]) : 0;
  if (!args[0]) { console.error('Usage : node dev/make-folders-fixture.mjs <dossier> [--bulk N]'); process.exit(1); }
  const f = makeFixture(args[0], { bulk });
  console.log(`Bibliothèque d'essai créée : ${f.libraries}`);
}
