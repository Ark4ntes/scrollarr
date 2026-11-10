// Règles de fusion entre appareils. Fonctions pures : elles ne dépendent ni
// du navigateur ni du réseau, et sont testées telles quelles dans tests/unit_sync.mjs.
//
// Chaque entrée synchronisée (progression d'un chapitre, ligne d'historique,
// abonnement) porte un numéro de révision et l'identifiant de l'appareil qui
// l'a écrite. Modifier une entrée, c'est prendre la révision connue + 1.
//
//  - L'ordre ne dépend pas des horloges : un appareil dont l'heure est fausse
//    ne peut ni écraser à tort ni être ignoré à tort.
//  - Deux appareils qui modifient la même entrée sans s'être vus produisent la
//    même révision : l'identifiant d'appareil départage alors, de la même
//    façon partout. Le résultat est arbitraire mais identique sur tous les
//    appareils ; rien ne permet de savoir laquelle des deux est « la vraie ».
//  - La date reste enregistrée, pour l'affichage et le tri de l'historique.

/** Compare deux estampilles (révision, appareil) : > 0 si la première l'emporte. */
export function compareStamp(revA, devA, revB, devB) {
  if ((revA || 0) !== (revB || 0)) return (revA || 0) - (revB || 0);
  if ((devA || '') === (devB || '')) return 0;
  return (devA || '') > (devB || '') ? 1 : -1;
}

// Progression d'un chapitre : [page, terminé, date, effacé, révision, appareil].
// Les entrées écrites avant l'introduction des révisions n'ont que 3 ou 4
// cases : elles valent révision 0 et sont départagées par leur date.
function compareEntry(a, b) {
  return compareStamp(a[4], a[5], b[4], b[5]) || (a[2] || 0) - (b[2] || 0) || (a[3] || 0) - (b[3] || 0) || (a[0] || 0) - (b[0] || 0);
}
/** Fusion de deux documents de série : pour chaque chapitre, l'entrée qui l'emporte. */
export function mergeSeries(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) if (!out[k] || compareEntry(v, out[k]) > 0) out[k] = v;
  return out;
}

// Ligne d'historique : { b, s, st, nm, n, p, tot, c, t, v (révision), d (appareil) }.
const compareRecent = (x, y) => compareStamp(x.v, x.d, y.v, y.d) || (x.t || 0) - (y.t || 0) || (x.p || 0) - (y.p || 0);
/** Fusion de deux index : historique réuni et borné ; les compteurs sont recalculés ensuite par l'appelant. */
export function mergeIdx(a = {}, b = {}, max = 40) {
  const s = { ...(a.s || {}) };
  for (const [k, v] of Object.entries(b.s || {})) if (!s[k] || v[2] > s[k][2]) s[k] = v;
  const byId = new Map();
  for (const e of [...(a.r || []), ...(b.r || [])]) if (!byId.has(e.b) || compareRecent(e, byId.get(e.b)) > 0) byId.set(e.b, e);
  const r = [...byId.values()].sort((x, y) => (y.t - x.t) || (x.b < y.b ? -1 : 1)).slice(0, max);
  return { s, r };
}

// Abonnements : { items: { idSérie: { id, title, seen, added, rev, dev, del ? } } }.
const compareFav = (x, y) => compareStamp(x.rev, x.dev, y.rev, y.dev) || (y.del || 0) - (x.del || 0) || (x.added || 0) - (y.added || 0);
/** Fusion de deux listes d'abonnements, entrée par entrée. Un désabonnement laisse une marque. */
export function mergeFavs(a, b) {
  const items = { ...(a?.items || {}) };
  for (const [id, v] of Object.entries(b?.items || {})) if (!items[id] || compareFav(v, items[id]) > 0) items[id] = v;
  return { updatedAt: Math.max(a?.updatedAt || 0, b?.updatedAt || 0), items };
}

let device;
/** Identifiant stable de cet appareil (navigateur), sans rapport avec la personne. */
export function deviceId() {
  if (device) return device;
  try {
    device = localStorage.getItem('scrollarr.device');
    if (!device) { device = Math.random().toString(36).slice(2, 10); localStorage.setItem('scrollarr.device', device); }
  } catch { device = Math.random().toString(36).slice(2, 10); }
  return device;
}
