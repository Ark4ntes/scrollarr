// Type d'une image d'après ses premiers octets (READ-002 §4.2, §4.10). Jamais
// d'après l'extension : un SVG, un HTML ou un exécutable nommé « .jpg » est refusé.
// Fonctions pures. Les cinq types servis tels quels : JPEG, PNG, WebP, GIF, AVIF.

/** Nombre d'octets nécessaires pour reconnaître tous les types. */
export const SNIFF_BYTES = 64;

const startsWith = (buf, bytes, at = 0) => buf.length >= at + bytes.length && bytes.every((b, i) => buf[at + i] === b);
const ascii = (buf, at, text) => buf.length >= at + text.length && buf.toString('latin1', at, at + text.length) === text;

/** Type MIME de l'image, ou null si ce n'est pas l'un des cinq types autorisés. */
export function sniffImage(buf) {
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (ascii(buf, 0, 'GIF87a') || ascii(buf, 0, 'GIF89a')) return 'image/gif';
  if (ascii(buf, 0, 'RIFF') && ascii(buf, 8, 'WEBP')) return 'image/webp';
  if (ascii(buf, 4, 'ftyp')) {
    // Boîte « ftyp » : marque principale, puis marques compatibles (4 octets chacune, à partir de 16).
    const end = Math.min(buf.length, buf.length >= 4 ? buf.readUInt32BE(0) : 0);
    for (let at = 8; at + 4 <= end; at += at === 8 ? 8 : 4) { // saute la version (4 octets) après la marque principale
      const brand = buf.toString('latin1', at, at + 4);
      if (brand === 'avif' || brand === 'avis') return 'image/avif';
    }
  }
  return null;
}

// Type annoncé dans la liste des pages : indicatif, tiré de l'extension, car la liste ne lit aucun contenu.
const BY_EXTENSION = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };
export const hintFromName = (name) => BY_EXTENSION[name.slice(name.lastIndexOf('.') + 1).toLowerCase()] || 'application/octet-stream';
