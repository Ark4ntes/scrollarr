// Collecteur Suwayomi-Server : demande au serveur de télécharger des chapitres
// depuis leur source, et suit sa file de téléchargement. Il utilise le même
// serveur et la même session que le lecteur Suwayomi, mais ne dépend pas de
// son code.
import { CAP } from '../contract.js';
import { suwayomiClient } from '../suwayomi-client.js';

const STATES = { QUEUED: 'queued', DOWNLOADING: 'running', FINISHED: 'done', ERROR: 'failed' };

export function createSuwayomiCollector({ base }) {
  const client = suwayomiClient(base);
  // Une tâche = un chapitre dans la file de Suwayomi ; l'identifiant du chapitre lui sert d'identifiant.
  const describe = (chapter, manga) => ({
    nativeId: String(chapter.id),
    reader: 'suwayomi',
    seriesId: String(chapter.mangaId),
    chapterId: `${chapter.mangaId}.${chapter.id}`, // forme des identifiants du lecteur Suwayomi
    seriesTitle: manga?.title,
    chapterTitle: chapter.name,
  });

  return {
    id: 'suwayomi',
    label: 'Suwayomi',
    capabilities: [CAP.COLLECT_CHAPTERS, CAP.COLLECT_TASKS, CAP.COLLECT_CANCEL, CAP.COLLECT_RETRY],
    serves: ['suwayomi'],
    session: 'suwayomi',

    /** Les identifiants du lecteur Suwayomi ont la forme « idManga.idChapitre ». */
    async collectChapters(readerId, chapterIds) {
      await client.gql('Enqueue', { ids: chapterIds.map((id) => Number(String(id).split('.')[1])) });
      client.changed();
    },

    /** La file de téléchargement, telle que Suwayomi la donne. Il ne fournit ni dates ni historique. */
    async tasks() {
      const { downloadStatus } = await client.gql('Downloads');
      return downloadStatus.queue.map((d) => ({
        ...describe(d.chapter, d.manga),
        state: STATES[d.state] || 'queued',
        progress: d.progress,
        attempts: d.tries,
        // Le message d'erreur n'est exposé que par les versions récentes de Suwayomi : on ne le demande pas.
        error: d.state === 'ERROR' ? 'Échec du téléchargement depuis la source' : null,
        cancellable: true,
      }));
    },

    /**
     * Suwayomi retire de sa file un chapitre terminé, comme un chapitre qu'on
     * en a enlevé : on regarde s'il est bien sur le serveur pour les distinguer.
     */
    async resolveTasks(nativeIds) {
      if (!nativeIds.length) return [];
      const { chapters } = await client.gql('ChaptersState', { ids: nativeIds.map(Number) });
      if (chapters.nodes.some((c) => c.isDownloaded)) client.changed();
      return chapters.nodes.map((c) => ({ ...describe(c, c.manga), state: c.isDownloaded ? 'done' : 'cancelled', attempts: 0 }));
    },

    async cancelTask(nativeId) {
      await client.gql('Dequeue', { ids: [Number(nativeId)] });
    },

    /** Un téléchargement en échec reste dans la file de Suwayomi : on l'en retire avant de le redemander. */
    async retryTask(nativeId) {
      await client.gql('Dequeue', { ids: [Number(nativeId)] });
      await client.gql('Enqueue', { ids: [Number(nativeId)] });
    },
  };
}
