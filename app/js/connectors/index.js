// Registre des connecteurs. L'ordre de cette liste est la priorité par défaut
// quand une même série existe sur plusieurs serveurs.
//
// Pour ajouter un serveur : écrire un module qui renvoie un objet de même
// forme que komga.js ou suwayomi.js (voir « Écrire un connecteur » dans le
// README), l'ajouter ici, puis déclarer son proxy dans nginx et servers.json.
import { createKomga } from './komga.js';
import { createSuwayomi } from './suwayomi.js';

export const CONNECTORS = [
  { id: 'suwayomi', path: 'suwayomi', create: createSuwayomi },
  { id: 'komga', path: 'komga', create: createKomga },
];
