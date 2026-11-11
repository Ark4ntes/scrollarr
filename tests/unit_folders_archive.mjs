// Lecture des archives et des types d'image : archives fabriquées octet par octet,
// hostiles pour la plupart. Chaque limite de READ-002 §4.2 et §4.10 a un test qui l'atteint.
// Lancer avec : node tests/unit_folders_archive.mjs
import assert from 'node:assert/strict';
import { writeFileSync, openSync, writeSync, closeSync, ftruncateSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { suite, tmp, put, readBody, openFds } from './_folders.mjs';
import { png, zip, zipLayout } from '../dev/make-folders-fixture.mjs';
import { ArchiveError, LIMITS } from '../folders/archive.js';
import { HttpError } from '../folders/http.js';
import { createReading } from '../folders/reading.js';
import { sniffImage } from '../folders/sniff.js';

const { test, run } = suite('folders archive');
const dir = tmp();
let seq = 0;
const reading = createReading();
const archive = (buf) => put(dir, `a${seq++}.cbz`, buf);
const target = (path) => ({ kind: 'archive', path });
const pagesOf = async (buf) => reading.pages(target(archive(buf)));
const red = png(200, 0, 0), green = png(0, 200, 0), blue = png(0, 0, 200);

const refusedWith = (code, status = 422) => (e) => {
  assert.ok(e instanceof HttpError, String(e));
  assert.equal(e.status, status);
  if (status === 422) assert.ok(e instanceof ArchiveError && e.code === code, `${e.code ?? e.message}`);
  assert.ok(!e.message.includes('/') && !e.message.includes(dir), 'le message ne contient pas de chemin');
  return true;
};
/** L'archive est refusée dès l'établissement de la liste des pages. */
const listingRefused = (buf, code) => assert.rejects(pagesOf(buf), refusedWith(code));
/** Page 1 refusée avant d'envoyer le moindre octet. */
async function pageRefused(buf, code, status = 422) {
  const path = archive(buf);
  await assert.rejects(async () => { const s = await reading.source(target(path), 1); await s.stream(); }, refusedWith(code, status));
}
const firstPage = async (buf, n = 1) => readBody(await (await reading.source(target(archive(buf)), n)).stream());
const filler = (head, size) => Buffer.concat([head, Buffer.alloc(size - head.length)]);

// ── Types d'image : premiers octets ──
test('sniff: the five image types by magic bytes, nothing else', () => {
  const avif = (brands) => Buffer.concat([Buffer.from([0, 0, 0, 16 + 4 * brands.length]), Buffer.from('ftyp'), Buffer.from(brands[0]), Buffer.alloc(4), ...brands.slice(1).map((b) => Buffer.from(b))]);
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])), 'image/jpeg');
  assert.equal(sniffImage(red), 'image/png');
  assert.equal(sniffImage(Buffer.from('GIF89a....')), 'image/gif');
  assert.equal(sniffImage(Buffer.from('GIF87a....')), 'image/gif');
  assert.equal(sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')])), 'image/webp');
  assert.equal(sniffImage(avif(['avif', 'mif1'])), 'image/avif');
  assert.equal(sniffImage(avif(['mif1', 'miaf', 'avif'])), 'image/avif'); // marque compatible
  assert.equal(sniffImage(avif(['avis'])), 'image/avif');
  for (const [name, bytes] of Object.entries({
    svg: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    xmlSvg: Buffer.from('<?xml version="1.0"?><svg/>'),
    html: Buffer.from('<!doctype html><script>alert(1)</script>'),
    exe: Buffer.from('MZ\x90\x00\x03'), pdf: Buffer.from('%PDF-1.7'), zip: Buffer.from('PK\x03\x04'),
    heic: avif(['heic', 'mif1']), riffWave: Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt ')]),
    truncatedPng: red.subarray(0, 7), empty: Buffer.alloc(0), zeros: Buffer.alloc(64),
  })) assert.equal(sniffImage(bytes), null, name);
});

// ── Pages d'une archive ──
test('pages: natural order over the whole path, folders flattened, noise ignored, directories skipped', async () => {
  const buf = zip({
    'Tome 1/': Buffer.alloc(0), 'Tome 1/10.png': blue, 'Tome 1/2.png': green, 'Tome 1/1.png': red,
    'Tome 2/1.png': red, '__MACOSX/Tome 1/._1.png': red, '.DS_Store': 'x', 'Thumbs.db': 'x', 'Tome 1/Thumbs.db': 'x',
    '.hidden/9.png': red, 'notes.txt': 'texte', 'ComicInfo.xml': '<x/>', 'Tome 1/leisez-moi.TXT': 'x', 'Tome 1/@eaDir/1.png': red,
  });
  const path = archive(buf);
  const pages = await reading.pages(target(path));
  assert.deepEqual(pages.map((p) => p.number), [1, 2, 3, 4]);
  assert.ok(pages.every((p) => p.mediaType === 'image/png'));
  const bodies = [];
  for (let n = 1; n <= 4; n++) bodies.push(await readBody(await (await reading.source(target(path), n)).stream()));
  assert.deepEqual(bodies, [red, green, blue, red]); // Tome 1/1, 1/2, 1/10 puis Tome 2/1
  assert.equal(await reading.source(target(path), 5), null);
  assert.equal(await reading.source(target(path), 0), null);
});
test('the declared type is a hint from the extension; the served type comes from the bytes', async () => {
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20, 1)]);
  const path = archive(zip({ '1.jpg': red, '2.png': jpg }));
  assert.deepEqual((await reading.pages(target(path))).map((p) => p.mediaType), ['image/jpeg', 'image/png']);
  assert.equal((await (await reading.source(target(path), 1)).stream()).mediaType, 'image/png');
  assert.equal((await (await reading.source(target(path), 2)).stream()).mediaType, 'image/jpeg');
});
test('stored and deflated entries both stream correctly', async () => {
  const big = filler(red, 300000);
  const buf = zip({ '1.png': { data: red, method: 8 }, '2.png': green, '3.png': { data: big, method: 8 } });
  assert.deepEqual(await firstPage(buf, 1), red);
  assert.deepEqual(await firstPage(buf, 2), green);
  assert.deepEqual(await firstPage(buf, 3), big);
});
test('an archive with no page, or only non-images, lists zero pages', async () => {
  assert.deepEqual(await pagesOf(zip({ 'a.txt': 'x' })), []);
  assert.deepEqual(await pagesOf(zipLayout([]).segments.map((s) => s.data).reduce((a, b) => Buffer.concat([a, b]))), []);
});
test('ZIP64: entry sizes and offsets in the extra field, end record and locator', async () => {
  const buf = zip({ '1.png': red, '2.png': { data: filler(green, 5000), method: 8 } }, { zip64: true });
  assert.equal((await pagesOf(buf)).length, 2);
  assert.deepEqual(await firstPage(buf, 1), red);
  assert.deepEqual(await firstPage(buf, 2), filler(green, 5000));
});
test('ZIP64: an entry stored beyond 4 GiB in a sparse file is read at its real offset', async () => {
  const path = join(dir, 'sparse.cbz');
  const layout = zipLayout({ '1.png': red, '2.png': { data: green, gap: 5 * 2 ** 30 } }, { zip64: true });
  const fd = openSync(path, 'w');
  try { ftruncateSync(fd, layout.size); for (const s of layout.segments) writeSync(fd, s.data, 0, s.data.length, s.at); } finally { closeSync(fd); }
  const st = statSync(path);
  if (st.blocks * 512 > 64 * 1024 * 1024) { rmSync(path); console.log('SKIP sparse files not supported here'); return; }
  const p = target(path);
  assert.equal((await reading.pages(p)).length, 2);
  assert.deepEqual(await readBody(await (await reading.source(p, 2)).stream()), green);
  rmSync(path);
});

// ── Noms d'entrées ──
test('unsafe names are refused with a readable error: traversal, absolute, drive letter, backslash traversal', async () => {
  for (const name of ['../evil.png', 'a/../../evil.png', '/etc/evil.png', 'C:/evil.png', 'c:evil.png', '..\\evil.png', 'a\\..\\..\\evil.png', '\\abs.png']) {
    await listingRefused(zip({ '1.png': red, [name]: green }), 'invalid');
  }
});
test('a backslash used as a separator (old Windows tools) is read as a folder separator', async () => {
  const path = archive(zip({ 'Tome\\2.png': green, 'Tome\\1.png': red }));
  assert.equal((await reading.pages(target(path))).length, 2);
  assert.deepEqual(await readBody(await (await reading.source(target(path), 1)).stream()), red);
});
test('duplicate names and control characters in names are refused', async () => {
  await listingRefused(zip([['1.png', red], ['2.png', green], ['1.png', blue]]), 'invalid');
  await listingRefused(zip({ '1.png': red, 'a\x00b.png': green }), 'invalid');
  await listingRefused(zip({ '1.png': red, 'a\nb.png': { data: green, flags: 0x800 } }), 'invalid'); // nom UTF-8 ; en CP437 un octet de contrôle devient un simple symbole
});

// ── Limites de la liste ──
test('limit: entry count (5000 accepted, 5001 refused before any entry is read)', async () => {
  const many = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${String(i).padStart(5, '0')}.png`, red]));
  assert.equal(LIMITS.maxEntries, 5000);
  assert.equal((await pagesOf(zip(many(5000)))).length, 5000);
  await listingRefused(zip(many(5001)), 'limit');
});
test('limit: entry count announced by a ZIP64 end record is refused without reading the directory', async () => {
  const buf = zip({ '1.png': red }, { zip64: true });
  const at = buf.indexOf(Buffer.from([0x50, 0x4b, 0x06, 0x06])); // enregistrement ZIP64 de fin
  buf.writeBigUInt64LE(2n ** 40n, at + 32);
  await listingRefused(buf, 'limit');
});
test('limit: central directory of more than 8 MiB', async () => {
  const comment = 'c'.repeat(60000);
  const heavy = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${i}.png`, { data: red, comment }]));
  assert.equal(LIMITS.maxDirectoryBytes, 8 * 1024 * 1024);
  assert.equal((await pagesOf(zip(heavy(100)))).length, 100); // ≈ 6 Mo
  await listingRefused(zip(heavy(150)), 'limit'); // ≈ 9 Mo
});
test('limit: name length and folder depth', async () => {
  assert.equal((await pagesOf(zip({ ['a'.repeat(1000) + '.png']: red }))).length, 1);
  await listingRefused(zip({ ['a'.repeat(1030) + '.png']: red }), 'limit');
  const nested = (levels) => Array.from({ length: levels }, () => 'd').join('/') + '/1.png';
  assert.equal((await pagesOf(zip({ [nested(LIMITS.maxDepth)]: red }))).length, 1);
  await listingRefused(zip({ [nested(LIMITS.maxDepth + 1)]: red }), 'limit');
});

// ── Entrées chiffrées, méthodes inconnues, archives illisibles ──
test('encrypted image entries (traditional, strong, AES) are refused as encrypted; an encrypted note is ignored', async () => {
  const withHeader = Buffer.concat([Buffer.alloc(12), red]); // le chiffrement traditionnel ajoute 12 octets d'en-tête
  await listingRefused(zip({ '1.png': { data: red, flags: 1, raw: withHeader } }), 'encrypted');
  await listingRefused(zip({ '1.png': { data: red, flags: 1, method: 8, raw: withHeader } }), 'encrypted');
  await listingRefused(zip({ '1.png': { data: red, flags: 1 | 0x40 } }), 'encrypted');
  await listingRefused(zip({ '1.png': { data: red, flags: 1, method: 99, raw: red } }), 'encrypted');
  assert.equal((await pagesOf(zip({ '1.png': red, 'secret.txt': { data: Buffer.from('x'), flags: 1, raw: Buffer.alloc(13) } }))).length, 1);
});
test('unsupported compression (bzip2, LZMA, deflate64) and multi-volume archives are refused as unsupported', async () => {
  for (const method of [9, 12, 14]) await listingRefused(zip({ '1.png': { data: red, method, raw: red } }), 'unsupported');
  assert.equal((await pagesOf(zip({ '1.png': red, 'note.txt': { data: Buffer.from('x'), method: 12, raw: Buffer.from('x') } }))).length, 1);
  const multi = zip({ '1.png': red });
  multi.writeUInt16LE(1, multi.length - 22 + 4); // numéro de disque de l'enregistrement de fin
  await listingRefused(multi, 'unsupported');
});
test('truncated archives: end record missing, cut in the middle, central directory cut short', async () => {
  const whole = zip({ '1.png': red, '2.png': green, '3.png': blue });
  await listingRefused(whole.subarray(0, whole.length - 10), 'truncated');
  await listingRefused(whole.subarray(0, whole.length >> 1), 'truncated');
  await listingRefused(whole.subarray(0, 120), 'truncated');
  // Répertoire central amputé de 60 octets, enregistrement de fin conservé (avec des valeurs devenues fausses).
  const end = whole.subarray(whole.length - 22);
  const cut = Buffer.concat([whole.subarray(0, whole.length - 22 - 60), end]);
  await assert.rejects(pagesOf(cut), (e) => e instanceof ArchiveError && ['truncated', 'invalid'].includes(e.code));
});
test('not a ZIP at all: text, a PNG named .cbz, an empty file, trailing garbage', async () => {
  await listingRefused(Buffer.from('ceci n\'est pas une archive'), 'invalid');
  await listingRefused(red, 'invalid');
  await listingRefused(Buffer.alloc(0), 'invalid');
  await listingRefused(Buffer.concat([zip({ '1.png': red }), Buffer.from('xxxx')]), 'invalid');
});
test('sizes that lie: stored entry with mismatching sizes is refused at listing', async () => {
  await listingRefused(zip({ '1.png': { data: red, usize: red.length + 5 } }), 'invalid');
});
test('an entry whose data would end beyond the end of the file is refused as truncated when the page is opened', async () => {
  const path = archive(zip({ '1.png': { data: red, method: 8, raw: deflateRawSync(red), csize: 5000 } })); // annonce 5000 octets compressés, le fichier est plus court
  const source = await reading.source(target(path), 1);
  await assert.rejects(source.stream(), refusedWith('truncated'));
});
test('an entry announcing more than 64 MiB is refused before anything is read, whatever its other fields say', async () => {
  const path = archive(zip({ '1.png': { data: red, csize: 2 ** 31, usize: 2 ** 31, method: 8 } }));
  await assert.rejects(reading.source(target(path), 1), refusedWith('x', 413));
});

// ── Limites de la page ──
test('limit: an entry larger than 64 MiB is refused before reading; just under is served', async () => {
  assert.equal(LIMITS.maxEntryBytes, 64 * 1024 * 1024);
  // Mélange de zéros et de bruit : taux de compression sous la limite pour que seule la taille compte.
  const noise = Buffer.alloc(1024, 0); for (let i = 0; i < noise.length; i += 3) noise[i] = (i * 7919) & 255;
  const makeBig = (size) => { const b = Buffer.alloc(size); for (let o = 0; o < size; o += noise.length) noise.copy(b, o, 0, Math.min(noise.length, size - o)); red.copy(b); return b; };
  const over = makeBig(LIMITS.maxEntryBytes + 1);
  const raw = deflateRawSync(over, { level: 0 }); // « deflate » sans compression : taux ≈ 1, la taille seule déclenche
  await pageRefused(zip({ '1.png': { data: over, method: 8, raw } }), 'x', 413);
  const ok = makeBig(LIMITS.maxEntryBytes);
  const body = await firstPage(zip({ '1.png': { data: ok, method: 8, raw: deflateRawSync(ok, { level: 0 }) } }));
  assert.equal(body.length, ok.length);
  assert.ok(body.equals(ok));
});
test('limit: compression ratio (zip bomb) above 200 for entries over 1 MiB; small ones are not checked', async () => {
  assert.equal(LIMITS.maxRatio, 200);
  await pageRefused(zip({ '1.png': { data: filler(red, 20 * 1024 * 1024), method: 8 } }), 'x', 413);
  assert.equal((await firstPage(zip({ '1.png': { data: filler(red, 512 * 1024), method: 8 } }))).length, 512 * 1024);
});
test('bomb whose central directory lies about the size: the stream stops at the announced size', async () => {
  const bomb = filler(red, 30 * 1024 * 1024);
  const path = archive(zip({ '1.png': { data: bomb, method: 8, usize: 40 } })); // annonce 40 octets, en contient 30 Mo
  const source = await reading.source(target(path), 1);
  assert.equal(source.size, 40);
  await assert.rejects(source.stream(), refusedWith('invalid')); // erreur avant le premier octet envoyé
});
test('announced size larger than the real content: the body fails instead of ending short silently', async () => {
  const path = archive(zip({ '1.png': { data: filler(red, 5000), method: 8, usize: 9000 } }));
  const source = await reading.source(target(path), 1);
  await assert.rejects(async () => readBody(await source.stream()));
});
test('corrupt deflate data is refused with a readable error', async () => {
  const path = archive(zip({ '1.png': { data: red, method: 8, raw: Buffer.alloc(40, 0xff), usize: 100 } }));
  const source = await reading.source(target(path), 1);
  await assert.rejects(async () => readBody(await source.stream()), (e) => e instanceof ArchiveError);
});

// ── Types trompeurs ──
test('SVG, HTML, text and executables named .jpg/.png are refused with 415; a 0-byte image too', async () => {
  const fakes = [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), Buffer.from('<!doctype html><script>1</script>'),
    Buffer.from('texte quelconque'), Buffer.from('MZ\x90\x00'), Buffer.alloc(100)];
  for (const fake of fakes) {
    await pageRefused(zip({ '1.jpg': fake }), 'x', 415);
    await pageRefused(zip({ '1.jpg': { data: fake, method: 8 } }), 'x', 415);
  }
  await pageRefused(zip({ '1.png': Buffer.alloc(0) }), 'x', 415);
});
test('a PNG named .svg or .txt is not a page; a real image named .svg is not served as SVG', async () => {
  assert.equal((await pagesOf(zip({ '1.svg': red, '2.txt': red, '3.png': green }))).length, 1);
});
test('non-image files mixed with pages do not disturb numbering', async () => {
  const path = archive(zip({ '001.png': red, 'extra.nfo': 'x', '002.png': green, 'Credits.html': '<b>', '003.png': blue }));
  assert.equal((await reading.pages(target(path))).length, 3);
  assert.deepEqual(await readBody(await (await reading.source(target(path), 3)).stream()), blue);
});

// ── Ressources ──
test('no more than the cache size of archives stay open (file descriptors are closed)', async () => {
  const before = openFds();
  const paths = Array.from({ length: LIMITS.maxCached * 2 }, (_, i) => archive(zip({ '1.png': filler(red, 100 + i) })));
  for (const p of paths) await reading.pages(target(p));
  if (before !== null) assert.ok(openFds() - before <= LIMITS.maxCached, `${openFds() - before} descripteurs de plus`);
  reading.clear();
  await new Promise((r) => setTimeout(r, 50));
  if (before !== null) assert.ok(openFds() - before <= 1, 'clear() ferme tout');
});
test('opening is read-only and never follows a symbolic link', async () => {
  const { symlinkSync } = await import('node:fs');
  const real = archive(zip({ '1.png': red }));
  const link = join(dir, `lien${seq++}.cbz`);
  symlinkSync(real, link);
  await assert.rejects(reading.pages(target(link)), (e) => e.code === 'ELOOP' || e instanceof ArchiveError);
});

run();
