// Génère une bibliothèque d'essai pour le service folders (READ-002 §4.11) :
// petites images PNG et archives ZIP produites ici, aucun fichier binaire dans le dépôt.
//
//   node dev/make-folders-fixture.mjs <dossier> [--bulk N] [--page LARGEURxHAUTEUR]
//
// Résultat : <dossier>/libraries/{Scans,Autre}/… et <dossier>/outside/ (cible des
// liens symboliques sortants). Lancer ensuite :
//   FOLDERS_AUTH=none FOLDERS_LIBRARIES_DIR=<dossier>/libraries FOLDERS_DATA_DIR=<dossier>/data node folders/server.js
import { mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deflateSync, deflateRawSync, crc32 } from 'node:zlib';
import { fileURLToPath } from 'node:url';

/** PNG d'une couleur donnée : 1×1 par défaut ; plus grand, un dégradé vertical (pour des captures d'écran lisibles). */
export function png(r = 200, g = 80, b = 80, width = 1, height = 1) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(height * (1 + 3 * width)); // filtre 0 puis les pixels de chaque ligne
  for (let y = 0; y < height; y++) {
    const row = y * (1 + 3 * width);
    const k = height === 1 ? 1 : 0.35 + 0.65 * (y / (height - 1));
    for (let x = 0; x < width; x++) raw.set([Math.round(r * k), Math.round(g * k), Math.round(b * k)], row + 1 + 3 * x);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Disposition d'une archive ZIP : [{ at, data }] et taille totale. `files` : { nom: contenu } ou [[nom, contenu]…]
 * (une liste permet deux entrées de même nom). Un contenu est un Buffer ou un objet qui peut mentir ou casser exprès :
 *   data, method (0 stocké, 8 deflate), flags (bit 0 : chiffré), raw (octets déjà « compressés »), crc, usize, csize,
 *   comment (commentaire de l'entrée), gap (trou de N octets avant l'entrée : fichier creux, pour les décalages ZIP64).
 * Options : zip64 (tailles et décalages dans l'extra ZIP64, enregistrement ZIP64 de fin), comment (archive).
 */
export function zipLayout(files, { zip64 = false, comment = '' } = {}) {
  const items = Array.isArray(files) ? files : Object.entries(files);
  const segments = [], central = [];
  let offset = 0;
  for (const [name, spec] of items) {
    const o = Buffer.isBuffer(spec) || typeof spec === 'string' ? { data: Buffer.from(spec) } : spec;
    const data = o.data ?? Buffer.alloc(0);
    const method = o.method ?? 0, flags = o.flags ?? 0;
    const body = o.raw ?? (method === 8 ? deflateRawSync(data) : data);
    const nameBuf = Buffer.from(name), commentBuf = Buffer.from(o.comment ?? '');
    const crc = o.crc ?? crc32(data), usize = o.usize ?? data.length, csize = o.csize ?? body.length;
    offset += o.gap ?? 0;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(csize, 18); local.writeUInt32LE(usize, 22); local.writeUInt16LE(nameBuf.length, 26);
    const extra = Buffer.alloc(zip64 ? 28 : 0);
    if (zip64) { extra.writeUInt16LE(1, 0); extra.writeUInt16LE(24, 2); extra.writeBigUInt64LE(BigInt(usize), 4); extra.writeBigUInt64LE(BigInt(csize), 12); extra.writeBigUInt64LE(BigInt(offset), 20); }
    const head = Buffer.alloc(46); head.writeUInt32LE(0x02014b50, 0); head.writeUInt16LE(zip64 ? 45 : 20, 4); head.writeUInt16LE(zip64 ? 45 : 20, 6);
    head.writeUInt16LE(flags, 8); head.writeUInt16LE(method, 10); head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(zip64 ? 0xffffffff : csize, 20); head.writeUInt32LE(zip64 ? 0xffffffff : usize, 24);
    head.writeUInt16LE(nameBuf.length, 28); head.writeUInt16LE(extra.length, 30); head.writeUInt16LE(commentBuf.length, 32);
    head.writeUInt32LE(zip64 ? 0xffffffff : offset, 42);
    segments.push({ at: offset, data: Buffer.concat([local, nameBuf, body]) });
    central.push(head, nameBuf, extra, commentBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const dir = Buffer.concat(central);
  const tail = [dir];
  if (zip64) {
    const eocd64 = Buffer.alloc(56); eocd64.writeUInt32LE(0x06064b50, 0); eocd64.writeBigUInt64LE(44n, 4); eocd64.writeUInt16LE(45, 12); eocd64.writeUInt16LE(45, 14);
    eocd64.writeBigUInt64LE(BigInt(items.length), 24); eocd64.writeBigUInt64LE(BigInt(items.length), 32); eocd64.writeBigUInt64LE(BigInt(dir.length), 40); eocd64.writeBigUInt64LE(BigInt(offset), 48);
    const locator = Buffer.alloc(20); locator.writeUInt32LE(0x07064b50, 0); locator.writeBigUInt64LE(BigInt(offset + dir.length), 8); locator.writeUInt32LE(1, 16);
    tail.push(eocd64, locator);
  }
  const commentBuf = Buffer.from(comment);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(zip64 ? 0xffff : items.length, 8); end.writeUInt16LE(zip64 ? 0xffff : items.length, 10);
  end.writeUInt32LE(zip64 ? 0xffffffff : dir.length, 12); end.writeUInt32LE(zip64 ? 0xffffffff : offset, 16); end.writeUInt16LE(commentBuf.length, 20);
  tail.push(end, commentBuf);
  const rest = Buffer.concat(tail);
  segments.push({ at: offset, data: rest });
  return { segments, size: offset + rest.length };
}

/** Archive ZIP en mémoire (voir zipLayout). Par défaut : entrées stockées, sans compression. */
export function zip(files, options) {
  const { segments } = zipLayout(files, options);
  return Buffer.concat(segments.map((s) => s.data)); // sans « gap », les segments se suivent
}

/** `page` : [largeur, hauteur] des images (1×1 par défaut ; les tests de navigateur en demandent de plus grandes). */
export function makeFixture(out, { bulk = 0, page = [1, 1] } = {}) {
  const root = resolve(out);
  const lib = join(root, 'libraries');
  const put = (rel, data) => { const f = join(lib, rel); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, data); };
  const pages = (rel, n) => { for (let i = 1; i <= n; i++) put(`${rel}/${String(i).padStart(3, '0')}.png`, png(40 * i % 255, 90, 160, ...page)); };
  const cbz = (rel, n = 3) => put(rel, zip(Object.fromEntries(Array.from({ length: n }, (_, i) => [`${String(i + 1).padStart(3, '0')}.png`, png(40 * i, 120, 60, ...page)]))));

  // Série d'archives, avec une couverture.
  for (const n of [1, 2, 10]) cbz(`Scans/Alpha Quest/Chapitre ${String(n).padStart(3, '0')}.cbz`);
  put('Scans/Alpha Quest/cover.png', png(10, 10, 200, ...page));
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
  const pageAt = args.indexOf('--page');
  const page = pageAt >= 0 ? args.splice(pageAt, 2)[1].split('x').map(Number) : [1, 1];
  if (!args[0]) { console.error('Usage : node dev/make-folders-fixture.mjs <dossier> [--bulk N] [--page LARGEURxHAUTEUR]'); process.exit(1); }
  const f = makeFixture(args[0], { bulk, page });
  console.log(`Bibliothèque d'essai créée : ${f.libraries}`);
}
