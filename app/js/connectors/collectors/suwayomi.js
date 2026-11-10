// Collecteur Suwayomi-Server : demande au serveur de télécharger des chapitres
// depuis leur source. Il utilise le même serveur et la même session que le
// lecteur Suwayomi, mais ne dépend pas de son code.
import { CAP } from '../contract.js';
import { suwayomiClient } from '../suwayomi-client.js';

export function createSuwayomiCollector({ base }) {
  const client = suwayomiClient(base);
  return {
    id: 'suwayomi',
    label: 'Suwayomi',
    capabilities: [CAP.COLLECT_CHAPTERS],
    serves: ['suwayomi'],
    session: 'suwayomi',

    /** Les identifiants du lecteur Suwayomi ont la forme « idManga.idChapitre ». */
    async collectChapters(readerId, chapterIds) {
      await client.gql('Enqueue', { ids: chapterIds.map((id) => Number(String(id).split('.')[1])) });
      client.changed();
    },
  };
}
