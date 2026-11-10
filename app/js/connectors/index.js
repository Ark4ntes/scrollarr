// Registre des connecteurs, par rôle (voir contract.js).
//
// LECTEURS — l'ordre de la liste est la priorité par défaut quand une même
// série existe sur plusieurs serveurs. Pour en ajouter un : écrire un module
// dans readers/ qui respecte reader-contract.js, l'ajouter ici, puis déclarer
// son proxy dans nginx et servers.json.
//
// COLLECTEURS — pour en ajouter un : écrire un module dans collectors/ qui
// respecte collector-contract.js et l'ajouter ici. `path` est le préfixe de
// son proxy ; un collecteur qui partage le serveur d'un lecteur reprend le sien.
import { createKomga } from './readers/komga.js';
import { createSuwayomi } from './readers/suwayomi.js';
import { createSuwayomiCollector } from './collectors/suwayomi.js';

export const READERS = [
  { id: 'suwayomi', path: 'suwayomi', create: createSuwayomi },
  { id: 'komga', path: 'komga', create: createKomga },
];

export const COLLECTORS = [
  { id: 'suwayomi', path: 'suwayomi', create: createSuwayomiCollector },
];
