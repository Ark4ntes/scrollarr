// Collecteur Suwayomi-Server : demande au serveur de télécharger des chapitres
// depuis leur source, et suit sa file de téléchargement. Il utilise le même
// serveur et la même session que le lecteur Suwayomi, mais ne dépend pas de
// son code.
import { CAP } from '../contract.js';
import { suwayomiClient } from '../suwayomi-client.js';

const STATES = { QUEUED: 'queued', DOWNLOADING: 'running', FINISHED: 'done', ERROR: 'failed' };
const READER = 'suwayomi';
// La source « Local source » de Suwayomi (id 0, langue « localsourcelang ») lit un dossier du serveur : ce n'est pas un site où chercher.
const LOCAL_SOURCE = { id: '0', lang: 'localsourcelang' };
// Une extension peut mettre longtemps à répondre ; au-delà, on abandonne cette source seule.
const SEARCH_TIMEOUT = 30000;
// Récupérer la liste des chapitres d'une série longue chez la source peut prendre un moment.
const CHAPTERS_TIMEOUT = 90000;

/** Source de Suwayomi vers la forme du contrat. `iconUrl` est un chemin du serveur : on le range sous le proxy. */
export function toSource(base, s) {
  return { id: String(s.id), label: s.name, language: s.lang || null, nsfw: !!s.isNsfw, icon: s.iconUrl ? base + s.iconUrl : null };
}
/** Résultat d'une source. Les couvertures passent par le proxy de Suwayomi, qui va les chercher chez la source. */
export function toResult(base, source, m) {
  return {
    id: String(m.id), title: m.title, cover: m.thumbnailUrl ? `${base}/api/v1/manga/${m.id}/thumbnail` : null,
    sourceId: source.id, sourceLabel: source.label, language: source.language,
    // Un manga « dans la bibliothèque » est une série du lecteur Suwayomi, sous le même numéro.
    inLibrary: !!m.inLibrary, reader: m.inLibrary ? READER : null, seriesId: m.inLibrary ? String(m.id) : null,
  };
}

export function createSuwayomiCollector({ base }) {
  const client = suwayomiClient(base);
  let known = new Map(); // sources vues par sources(), pour nommer celle d'un résultat
  // Une tâche = un chapitre dans la file de Suwayomi ; l'identifiant du chapitre lui sert d'identifiant.
  const describe = (chapter, manga) => ({
    nativeId: String(chapter.id),
    reader: 'suwayomi',
    seriesId: String(chapter.mangaId),
    chapterId: `${chapter.mangaId}.${chapter.id}`, // forme des identifiants du lecteur Suwayomi
    seriesTitle: manga?.title,
    chapterTitle: chapter.name,
  });

  /** Les sources installées sur le serveur, avec leur langue et leur indicateur « adulte ». C'est une lecture locale : aucune source n'est contactée. */
  async function listSources() {
    const { sources } = await client.gql('Sources');
    const list = sources.nodes
      .filter((s) => String(s.id) !== LOCAL_SOURCE.id && s.lang !== LOCAL_SOURCE.lang)
      .map((s) => toSource(base, s))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }) || String(a.language).localeCompare(String(b.language)));
    known = new Map(list.map((s) => [s.id, s]));
    return list;
  }

  return {
    id: 'suwayomi',
    label: 'Suwayomi',
    capabilities: [CAP.COLLECT_CHAPTERS, CAP.COLLECT_TASKS, CAP.COLLECT_CANCEL, CAP.COLLECT_RETRY, CAP.COLLECT_SOURCES, CAP.COLLECT_SEARCH, CAP.COLLECT_ADD],
    serves: [READER],
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

    // ── Chercher par titre, ajouter à la bibliothèque ──

    /** Les sources installées sur le serveur, avec leur langue et leur indicateur « adulte ». C'est une lecture locale : aucune source n'est contactée. */
    sources: listSources,

    /**
     * Cherche dans une source, première page seulement. Suwayomi interroge alors le site de la source : c'est lent et
     * cela peut échouer. `isolated` : une source lente ou cassée ne fait pas passer le serveur pour injoignable.
     */
    async search(sourceId, query) {
      const source = known.get(String(sourceId)) || (await listSources(), known.get(String(sourceId)));
      if (!source) throw new Error(`Source inconnue : ${sourceId}`);
      const { fetchSourceManga } = await client.gql('SourceSearch', { source: String(sourceId), query }, { timeout: SEARCH_TIMEOUT, isolated: true });
      return { results: fetchSourceManga.mangas.map((m) => toResult(base, source, m)), more: !!fetchSourceManga.hasNextPage };
    },

    /**
     * Ajoute le manga à la bibliothèque, puis va chercher sa liste de chapitres chez la source (sans cela la fiche resterait
     * vide). Les chapitres ne sont pas téléchargés : le menu « Télécharger » de la fiche s'en charge, à la demande.
     * Si la liste ne vient pas, la série est quand même ajoutée : on le dit avec `complete: false`.
     */
    async add(resultId) {
      const id = Number(resultId);
      await client.gql('AddToLibrary', { id });
      client.changed();
      let complete = true;
      try { await client.gql('FetchChapters', { id }, { timeout: CHAPTERS_TIMEOUT, isolated: true }); }
      catch { complete = false; }
      client.changed();
      return { reader: READER, seriesId: String(id), complete };
    },
  };
}
