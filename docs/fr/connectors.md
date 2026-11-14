# Connecteurs : ce que fournit chaque serveur, et comment en écrire un

[English](../en/connectors.md) · **Français** · [Retour au README](../../README.fr.md)

La première moitié s'adresse à celles et ceux qui font tourner Scrollarr : ce qu'apporte chaque serveur et où il s'arrête. La seconde moitié s'adresse aux développeurs qui veulent ajouter un serveur (« Écrire un lecteur », « Écrire un collecteur »).

## Pour les utilisateurs

Scrollarr parle à un serveur par un **connecteur**. Il y a deux rôles :

- Un **lecteur** est ce dans quoi vous lisez : il fournit les séries, les chapitres, les pages et la progression de lecture. Suwayomi, Komga et le service Dossiers sont des lecteurs.
- Un **collecteur** va chercher des chapitres chez leur source et les range sur un serveur. Suwayomi est aussi un collecteur. Komga et le service Dossiers n'en sont pas.

L'installation dit quels serveurs existent (les adresses de `.env`, voir [Configuration](configuration.md)). Chaque personne choisit ensuite ceux qu'elle utilise dans *Réglages > Serveurs*. L'interface ne propose que ce qu'un serveur sait faire : une action qu'un serveur ne peut pas réaliser est masquée, pas simulée.

### Ce que fournit chaque serveur

Ce que le code déclare pour chacun (une « capacité » est une aptitude déclarée, listée dans la partie développeurs) :

| | Suwayomi | Komga | Dossiers |
| --- | --- | --- | --- |
| Rôle | Lecteur et collecteur | Lecteur | Lecteur |
| Séries, chapitres, pages, recherche | Oui | Oui | Oui |
| Progression de lecture, marquer lu ou non lu | Oui, comme historique propre du serveur | Oui, comme historique propre du serveur | Oui, tenue par le service dans `data/folders` |
| Profils et abonnements partagés entre appareils (stockage clé-valeur) | Oui (entrées « meta ») | Oui (« client settings ») | Non |
| Progression par profil tenue par le serveur lui-même | Non : l'application la range dans le stockage clé-valeur | Non : idem | Oui |
| Demander au serveur de télécharger des chapitres, suivre, annuler, relancer | Oui | Non | Non |
| Chercher chez les sources par titre et ajouter une série | Oui | Non | Non |
| Connexion | Aucune, « basic auth », « simple login » ou « UI login », détectée automatiquement | Compte Komga (e-mail et mot de passe) | Utilisateur et mot de passe partagés, ou aucun |
| Notifications push (notifier facultatif) | Oui | Oui, avec une clé d'API | Non |

### Suwayomi

- **Bibliothèque.** Les mangas de votre bibliothèque Suwayomi. Ses catégories deviennent le filtre de la bibliothèque, affiché seulement si plus d'une catégorie contient des mangas.
- **Chapitres.** Lus depuis le serveur s'ils sont téléchargés, sinon récupérés chez leur source quand vous les ouvrez. Ce premier affichage peut prendre plusieurs secondes et dépend du bon fonctionnement de l'extension.
- **Menu de téléchargement d'une série.** À côté des téléchargements sur votre appareil, le menu *Télécharger* propose *Faire télécharger toute la série par Suwayomi* : les chapitres restent sur le serveur et se lisent vite ensuite. Leur avancement est dans *Réglages > Téléchargements*, où vous pouvez annuler ou relancer. Cet écran liste la file et l'historique du serveur ; les chapitres enregistrés sur votre appareil sont dans *Ma liste > Téléchargements*.
- **Chercher chez les sources.** Sur l'écran de recherche, sous les résultats de la bibliothèque, *Chercher chez les sources de Suwayomi* demande à Suwayomi de chercher le titre chez les sources (extensions) que vous choisissez, trois à la fois. Rien n'est envoyé à une source avant que vous n'appuyiez. Les résultats sont groupés par source avec leur couverture et leur langue ; *Ajouter* met la série dans votre bibliothèque Suwayomi, récupère sa liste de chapitres et ouvre sa page. Un titre déjà dans la bibliothèque ouvre sa page (*Dans la bibliothèque*). Une source en échec ou lente affiche sa propre erreur et les autres continuent. Les sources se choisissent avec *Choisir les sources*, choix gardé sur l'appareil ; par défaut sont cochées celles dans la langue de l'interface ou multilingues, jamais celles que Suwayomi marque 18+ (cochez-les vous-même).
- **Limites.** La recherche montre la première page de résultats de chaque source. Une recherche fait interroger des sites tiers par Suwayomi, elle peut donc être lente ou échouer, et Suwayomi range chaque résultat dans sa propre base, comme pour sa propre interface. Une série ajoutée à l'instant peut n'afficher auteur, résumé et genres qu'après l'initialisation par la mise à jour de Suwayomi. Suivre une série ou télécharger automatiquement les nouveaux chapitres n'existe pas encore. Cette fonction n'est couverte par des tests que contre un serveur factice ; elle n'a pas été essayée sur un vrai Suwayomi.
- **Connexion.** Scrollarr essaie les quatre modes à tour de rôle. En « basic auth » et « simple login », les identifiants voyagent dans un cookie : utilisez HTTPS ([Sécurité](security.md)).

### Komga

- **Bibliothèque.** Les séries, par bibliothèque Komga. Les chapitres sont les fichiers sur disque (CBZ, CBR, PDF).
- **Connexion.** Un compte Komga : e-mail et mot de passe.
- **Pages.** Les images que le navigateur ne sait pas afficher sont converties à la volée par Komga (JPEG). Si l'option de Komga qui analyse les dimensions des pages est activée pour vos bibliothèques, Scrollarr réserve la hauteur exacte de chaque page avant son chargement et la reprise de lecture est précise. Suwayomi ne donne aucune dimension : la hauteur s'ajuste à l'arrivée de chaque image. (L'option porte un nom dans l'interface de Komga ; je n'ai pas vérifié son libellé exact.)
- **Historique de lecture.** Celui de Komga, donc les applications de Komga le voient aussi. Avec des comptes Komga séparés, vous obtenez des historiques séparés et protégés.

### Dossiers (service facultatif)

Des dossiers d'images et des archives CBZ/ZIP, sans Suwayomi ni Komga. Arborescence, mise en place et limites : [Installation](installation.md#service-dossiers-facultatif) et [folders/README.md](../../folders/README.md).

- Il n'a pas de stockage clé-valeur. Avec *Dossiers* comme seul serveur, il n'y a pas de gestion des profils, les abonnements restent sur l'appareil qui les a faits, il n'y a pas de filtre par genre, ni de rangées « Nouveaux chapitres » ou « Nouvelles séries » sur l'accueil (il montre *Mises à jour récentes*). Il n'y a pas de rangée qui propose le chapitre suivant d'une série en cours.
- Ajoutez Suwayomi ou Komga à côté et tout cela revient, stocké par ce serveur.
- La progression de lecture est tenue par le service : la page atteinte, si le chapitre est terminé, et la date, partagées par tous les appareils. Un autre profil a sa propre progression sur les séries de Dossiers, rangée sous l'identifiant du profil.
- Deux appareils d'un même profil qui écrivent le même chapitre : la dernière écriture l'emporte (pas de fusion par révision comme avec Suwayomi et Komga).

### Plusieurs serveurs à la fois

Avec deux serveurs actifs, les listes sont fusionnées. Quand une série porte le même titre sur les deux (cas typique : Suwayomi télécharge, Komga analyse le même dossier), une seule est montrée. Le réglage *Quand une série existe sur plusieurs serveurs* dans *Réglages > Serveurs* choisit laquelle (*Garder celle de Suwayomi*...), ou montre les deux (*Afficher les deux*). La correspondance se fait par titre seulement : deux séries différentes de même titre sont prises pour une. La progression de lecture reste propre à chaque serveur. L'ordre de priorité par défaut est Suwayomi, Komga, Dossiers.

## Capacités (pour les développeurs)

Un connecteur déclare une liste de capacités. L'interface ne propose une action que si un connecteur déclare ce qu'il lui faut. Elles sont définies dans `app/js/connectors/contract.js`.

| Capacité | Rôle | Sens |
| --- | --- | --- |
| `series.list`, `series.search`, `chapter.list`, `chapter.read` | lecteur | Listes, recherche, chapitres, pages. |
| `chapter.progress.read` | lecteur | La progression de lecture est disponible. |
| `chapter.progress.write` | lecteur | La progression peut être écrite et les chapitres marqués lus ou non lus (demande les méthodes de progression ci-dessous). Sans elle, l'interface ne propose aucune telle action et n'envoie aucune requête. |
| `chapter.progress.profiles` | lecteur | Le serveur tient lui-même la progression de chaque profil (demande `chapter.progress.read` et `.write`, et `setProfile`, `forgetProfile`). |
| `settings.store` | lecteur | Un petit stockage clé-valeur sur le serveur, où sont rangés les profils, les abonnements et l'historique partagé des tâches. |
| `collect.chapters` | collecteur | Aller chercher des chapitres qu'un lecteur montre déjà (`collectChapters`). |
| `collect.tasks` | collecteur | Rapporter les tâches en cours (`tasks`, `resolveTasks`). |
| `collect.cancel`, `collect.retry` | collecteur | Annuler, relancer une tâche (chacune demande `collect.tasks`). |
| `collect.sources` | collecteur | Lister où il peut chercher (`sources`). |
| `collect.search` | collecteur | Chercher chez une source par titre (`search` ; demande `collect.sources`). |
| `collect.add` | collecteur | Ajouter un résultat (`add` ; demande `collect.search`). |

## Écrire un lecteur

Un lecteur est un module de `app/js/connectors/readers/` avec une fonction `create({ base })` qui renvoie un objet. `base` est le préfixe du proxy (`/monserveur`). Les séries et les chapitres suivent la forme des objets de Komga, qui est le modèle commun (voir `readers/komga.js`, ou `readers/folders.js` pour un petit exemple). Les identifiants sont ceux du serveur ; la façade (`app/js/api.js`) les préfixe avec le `code` d'une lettre du lecteur.

| Membre | Rôle |
| --- | --- |
| `id`, `code`, `label`, `userLabel` | Identifiant, une lettre minuscule utilisée comme préfixe, nom affiché, libellé du champ nom d'utilisateur (une clé de `app/js/i18n.js`). |
| `capabilities` | Aptitudes déclarées, prises dans la liste des lecteurs ci-dessus. |
| `session()`, `login(user, password)`, `logout()` | Session. `session()` lève `AuthError` quand une connexion est nécessaire. |
| `libraries()`, `genres()` | Filtres de la bibliothèque. |
| `seriesList({ libraryId, genre, readStatus, search, sort, page, size })` | Renvoie `{ content, last }`. |
| `seriesNew(n)`, `seriesUpdated(n)`, `series(id)`, `seriesBooks(id)` | Séries, et chapitres dans l'ordre de lecture. |
| `booksLatest(n)`, `booksOnDeck(n)`, `booksInProgress(n)`, `booksRecentlyRead(n)` | Rangées de l'accueil et de *Ma liste*. |
| `book(id)`, `bookPages(id)`, `nextBook(id)`, `previousBook(id)` | `bookPages` renvoie `[{ number, url, mediaType, width?, height?, fallbackUrl? }]`. |
| `seriesThumb(id)`, `bookThumb(id)` | URL des couvertures. Ce doivent être des chemins de même origine. |
| `saveProgress(id, page, completed)`, `markBookRead(id)`, `markBookUnread(id)`, `markSeriesRead(id)`, `markSeriesUnread(id)` | Seulement avec `chapter.progress.write`. |
| `getSettings(prefix)`, `setSetting(key, value)`, `deleteSettings(keys)` | Seulement avec `settings.store`. |
| `setProfile(id)`, `forgetProfile(id)` | Seulement avec `chapter.progress.profiles`. La façade indique au lecteur quel profil est ouvert (`'main'` ou l'identifiant d'un profil secondaire) et n'applique pas sa propre surcouche par profil à ses chapitres. `forgetProfile` est appelé quand un profil est supprimé. Le lecteur envoie le profil avec chaque lecture et chaque écriture de progression. |

`validateReader()` dans `app/js/connectors/reader-contract.js` vérifie tout cela une fois au démarrage : une méthode manquante, une capacité inconnue ou un `code` qui n'est pas une seule lettre minuscule fait échouer bruyamment l'application au lieu de la laisser mal se comporter plus tard.

Pour enregistrer un lecteur :

1. Ajoutez-le à `READERS` dans `app/js/connectors/index.js` : `{ id, path, create }`. L'ordre de la liste est la priorité par défaut pour les séries en double : mettez un lecteur de faible priorité en dernier.
2. Dans `nginx/default.conf.template` : une `map` qui transforme sa variable d'adresse en `"true"` ou `"false"`, une `location` qui relaie `/<path>/` vers l'adresse (copiez celle de Komga), et son entrée dans le JSON de `/servers.json` (la clé est l'`id` du lecteur). N'ajoutez pas d'`add_header` dans la `location` : cela supprimerait les en-têtes de sécurité hérités ([Sécurité](security.md)).
3. La variable d'adresse (par exemple `MYSERVER_URL`) doit exister, vide par défaut : ajoutez-la à la ligne `ENV` du `Dockerfile`, au service `scrollarr` de `docker-compose.yml` (puis lancez `dev/make-deploy-compose.sh` pour rafraîchir `deploy/docker-compose.yml`), à `.env.example` et à [Configuration](configuration.md).
4. Dans `app/sw.js` : son préfixe de proxy dans `SERVERS`, la forme des URL de ses pages et de ses couvertures dans `isPage` et `isThumb` (pour que la lecture hors ligne et les miniatures fonctionnent), et son fichier dans `SHELL_FILES`.
5. Traduisez les textes que vous ajoutez dans `app/js/i18n.js` (le texte français est la clé).

## Écrire un collecteur

Un collecteur va chercher des chapitres ; il n'a pas à lister une bibliothèque ni à servir des pages. Il vit dans `app/js/connectors/collectors/` et suit `collector-contract.js`, vérifié au démarrage par `validateCollector()`.

| Membre | Rôle |
| --- | --- |
| `id`, `label` | Identifiant et nom affiché. |
| `capabilities` | Prises dans les lignes « collecteur » du tableau ci-dessus. |
| `serves` | Lecteurs dont il comprend les identifiants de chapitres (`['suwayomi']`) ; vide s'il n'en partage avec aucun. |
| `session` | Nom du lecteur dont il réutilise la session. Sans cela, le collecteur a son propre serveur et fournit `session()`, `login()`, `logout()`. |
| `collectChapters(readerId, chapterIds)` | Avec `collect.chapters` : aller chercher des chapitres désignés par les identifiants de ce lecteur. Demande au moins un lecteur dans `serves`. |
| `tasks()`, `resolveTasks(nativeIds)` | Avec `collect.tasks` : ce qu'il fait maintenant, et ce que sont devenues les tâches qu'il ne liste plus. |
| `cancelTask(nativeId)`, `retryTask(nativeId)` | Avec `collect.cancel`, `collect.retry`. |
| `sources()` | Avec `collect.sources` : `[{ id, label, language, nsfw, icon }]`. |
| `search(sourceId, query)` | Avec `collect.search` : chercher chez une source par titre, renvoie `{ results, more }`. |
| `add(resultId)` | Avec `collect.add` : ajouter ou suivre un résultat, renvoie `{ reader, seriesId, complete }`. |

Les tâches de chaque collecteur sont ramenées à une seule forme par `app/js/tasks.js` : identifiant, collecteur, série et chapitre, état (`queued`, `running`, `done`, `failed`, `cancelled`), progression, dates de création, de début et de fin, erreur, tentatives, et si elle peut être annulée. L'application garde ce qu'un collecteur oublie (dates, tâches terminées). *Réglages* montre un résumé ; le détail est sur l'écran *Téléchargements* qu'on y ouvre (en cours, file, erreurs, historique, avec l'annulation et la relance que chaque collecteur gère). L'historique des tâches terminées est partagé entre appareils comme un seul document pour toute l'installation (pas par profil) dans le stockage clé-valeur des serveurs, fusionné par identifiant de tâche ; *Effacer l’historique* laisse des marqueurs que les autres appareils respectent. Les tâches en cours ne sont pas partagées : chaque appareil interroge le collecteur. Sans serveur qui a ce stockage, l'historique reste par appareil.

Les tâches en échec sont relancées automatiquement quand le collecteur sait relancer (`collect.retry`) : trois fois au plus, 1, 5 puis 30 minutes après l'échec, jamais pour une tâche annulée. Le collecteur a déjà fait ses propres tentatives (`attempts`) ; les relances automatiques sont comptées à part (`autoRetries`) et un *Relancer* manuel remet le compte à zéro. L'écran Téléchargements indique « nouvel essai dans N min » ou « nouvel essai automatique épuisé » à côté de l'état, et propose un interrupteur (activé par défaut, gardé sur l'appareil) pour les couper. **Il n'y a pas de serveur à nous : une relance ne part que si Scrollarr est ouvert sur un appareil** (l'écran Téléchargements interroge le collecteur, et les réglages comme une nouvelle demande font aussi un passage) ; un échec que personne ne regarde reste en échec jusqu'à la prochaine ouverture. Pour que deux appareils ouverts ne relancent pas la même tâche, l'appareil écrit une courte réservation, puis la relance en cours, dans l'historique partagé avant d'envoyer, et l'autre attend ; c'est au mieux (le stockage n'a pas d'écriture atomique), et une rare relance en double ne fait que redémarrer le téléchargement une fois.

Chercher à partir d'un titre prend les trois capacités de recherche, chacune demandant la précédente. Les formes sont documentées en tête de `collector-contract.js`, où `normalizeSource`, `normalizeResult`, `normalizeSearch` et `normalizeAdded` les vérifient :

- Une **source** est `{ id, label, language, nsfw, icon }`. `nsfw` est le drapeau propre du serveur. L'application ne cherche pas chez ces sources sauf si l'utilisateur les choisit.
- Un **résultat** est `{ id, title, cover, sourceId, sourceLabel, language, inLibrary, reader, seriesId }`. `id` est propre au collecteur et opaque pour l'application, qui le rend à `add()`. `cover` et l'`icon` d'une source sont des chemins de même origine (par le proxy), jamais des URL externes : la politique de sécurité du contenu n'autorise aucune image externe. `reader` et `seriesId` désignent la série correspondante d'un lecteur que le collecteur dessert, les deux ou aucun, et seulement si `inLibrary`.
- `add()` renvoie `{ reader, seriesId, complete }` : la série qui existe maintenant dans le lecteur, et `complete: false` si elle a été ajoutée mais que sa liste de chapitres n'a pas encore pu être récupérée.
- Un collecteur qui ne partage d'identifiants avec aucun lecteur (Tranga, Mangarr) déclare un `serves` vide et renvoie `reader: null, seriesId: null`. Il peut quand même dire `inLibrary: true`, mais l'application n'offre alors aucun lien.
- Une recherche touche des sites tiers : l'application n'en lance une que sur une action explicite de l'utilisateur, une source à la fois avec un parallélisme borné (3), et une source en échec ne fait jamais échouer les autres. `search()` lève une erreur pour cette seule source.

Enregistrez-le dans `COLLECTORS` dans `app/js/connectors/index.js` : `{ id, path, create }`, où `path` est le préfixe du proxy (un collecteur qui partage le serveur d'un lecteur réutilise celui de ce lecteur).

## Tests

- `node tests/unit_contracts.mjs` : les contrats de lecteur et de collecteur, y compris les cas ci-dessus.
- `node tests/unit_facade.mjs` : la façade avec des lecteurs réservés aux tests (avec et sans progression, avec progression par profil).
- `node tests/unit_collect.mjs` : le collecteur Suwayomi contre un `fetch` simulé, avec les opérations exactes envoyées.
- `python3 tests/nginx_headers.py` : les en-têtes de sécurité sur chaque `location` de nginx (demande `nginx` et `curl`).
- Les scripts de bout en bout de `tests/` pilotent l'application contre les serveurs factices de `dev/` ([Développement](development.md)).

La liste complète est dans [tests/README.md](../../tests/README.md).
