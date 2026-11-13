# COL-003 / COL-005 — Étude des collecteurs Tranga et « Mangarr »

> Étude de cadrage, **sans code**. Rédigée le 13 novembre 2026 sur la base de `main` (contrat : `app/js/connectors/collector-contract.js`, collecteur de référence : `collectors/suwayomi.js`, modèle de tâches : `app/js/tasks.js`).
> Chaque affirmation sur un logiciel tiers renvoie à une source numérotée [n] (section « Sources »). Ce qui n'a pas pu être vérifié est marqué **non vérifié**. Les pages GitHub ont été lues par un outil de lecture de pages : les dates de dernier commit y sont souvent absentes.

## 1. Résumé et recommandation

| Sujet | Verdict | Ordre |
| --- | --- | --- |
| Tranga (COL-003 / COL-004) | **Plus tard** : projet réel, actif, API REST documentée par OpenAPI, mais **sans authentification** et sans identifiants communs avec un lecteur. Connecteur de taille **M**, utile seulement après l'extension du contrat (COL-001) et COL-002. | 1er des deux, après COL-001 et COL-002 |
| « Mangarr » (COL-005 / COL-006) | **Ne pas écrire de connecteur maintenant** : le nom désigne au moins dix projets sans lien entre eux ; il faut que Julien désigne celui qu'il vise. Le seul candidat crédible aujourd'hui est `Asion001/Mangarr` (OpenAPI, clés d'API), mais il est jeune et sans étoiles. | 2e, uniquement après désignation |
| Autre collecteur meilleur en premier ? | **Non** : Kaizoku est archivé ; Suwayomi (COL-002) reste la première cible. | — |

**En trois phrases.** Ne lancer aucun connecteur avant COL-001 (recherche, ajout/suivi) : ni Tranga ni les « Mangarr » ne partagent d'identifiants avec un lecteur, donc ils ne peuvent pas déclarer `collect.chapters` avec le contrat actuel. Quand le contrat sera étendu, Tranga est la meilleure première cible externe (API versionnée, états et progression des tâches, arrêt d'une tâche), à condition de l'exposer derrière le proxy avec une authentification, car l'API n'en a aucune. Pour « Mangarr », demander à Julien quel dépôt il vise (§5) avant toute autre dépense.

## 2. Tableau comparatif

| | Tranga | Mangarr `Asion001` | Mangarr `maia-kitty` | Mangarr `KiranTheRam` |
| --- | --- | --- | --- | --- |
| Dépôt | `C9Glax/tranga` [1] | `Asion001/Mangarr` [10] | `maia-kitty/mangarr` [12] | `KiranTheRam/mangarr` [8] |
| Licence | GPL-3.0 [1] | AGPL-3.0 ou ultérieure [10] | MIT [12] | GPL-3.0 [8] |
| Étoiles (13/11/2026) | 389 [1] | 0 [10] | 0 [12] | 3 [8] |
| Activité | Issues jusqu'au 4 oct. 2026 [3] ; dernière version GitHub : 1.5, juin 2023 [2] | Préversion « build-299 » publiée le 28 oct. (année non affichée) [11] ; 243 commits [10] | 14 commits, dates non affichées [12] | 85 commits, dates non affichées [8] |
| Déploiement | `glax/tranga-api` port 6531 + site + PostgreSQL [4] | `ghcr.io/asion001/mangarr`, UI 8787, API Komga 25600 (optionnelle) [10] | Compose, UI 8206 + Suwayomi 8207 [12] | `kirantheram/mangarr`, port 6996 [8] |
| Authentification | **Aucune** [5] | Comptes + clé `X-Api-Key` [10] | Clé `X-Api-Key` [12] | Clé `X-Api-Key` [8] |
| API documentée | OpenAPI `API_v2.json`, `/swagger` [1][6] | OpenAPI sur `/api/docs` [10] | `/api/v1`, détail dans `docs/HOW-IT-WORKS.md` (non lu) [12] | `/api/v1`, pas de doc liée [8] |
| Source des fichiers | Connecteurs de sites propres [1] | 23 sites + Suwayomi [10] | Sources compatibles Mihon via Suwayomi [12] | Scrapers/API propres + Nyaa/qBittorrent [8] |
| Format sur disque | `.cbz`, un dossier par série [1] | `/data/manga/<langue>/<Série>/*.cbz` + `ComicInfo.xml`, `series.json` [10] | **non vérifié** | `Titre/Titre - Vol. 01 Ch. 0021.cbz` [8] |
| Taille du connecteur | **M** | **M/L** (non vérifiable avant lecture de `/api/docs`) | **non évaluable** | **non évaluable** |

Les trois autres « Mangarr » les plus visibles sont décrits au §4.

## 3. Tranga

**Identité et état.**
- `C9Glax/tranga`, « Monitor and download Manga automatically in a Docker-Container », titre du README « Tranga v2 » [1]. 389 étoiles, 48 forks, 24 issues ouvertes [1][3]. Non archivé [1][7]. Mainteneur principal : le propriétaire du dépôt ; **nombre de contributeurs non vérifié**.
- **Dernière version GitHub : 1.5 (20 juin 2023)** ; les cinq versions listées datent toutes de juin 2023 [2]. La v2 ne passe donc pas par les « Releases » : la distribution se fait par l'image `latest` et par des branches (`main`, `cuttingedge`, `testing`, `oldstable`) [1]. **Cadence réelle de publication de la v2 : non vérifiée.**
- Activité de la v2 : issues récentes jusqu'au 4 oct. 2026 (#676, scraper cassé) ; issue épinglée « Transition from v1 to v2 » (#405, juin 2025) [3]. **Date du dernier commit non vérifiée** : la page de commits est interdite aux robots et un agrégateur tiers renvoie des données périmées (octobre 2024, 143 étoiles) [7], contredites par la page du dépôt.
- Risque de fond : les issues récentes sont surtout des sites de lecture qui cassent (« Tranga broke ») [3]. C'est inhérent au scraping, pas propre à Tranga.

**Licence.** GPL-3.0 [1]. Scrollarr (MIT) n'incorpore ni ne lie le code de Tranga : il parle à son API HTTP, dans un processus et un conteneur séparés. L'usage courant admet que ce n'est pas une œuvre combinée, **mais je n'ai pas pu consulter la FAQ de la FSF** (page non récupérée) : point **non vérifié par source**, à confirmer si le risque compte. À éviter : copier du code de Tranga, ou embarquer son image dans celle de Scrollarr.

**Déploiement.** Compose officiel : `glax/tranga-api:latest` (port 6531, volumes `./Manga` → `/Manga` et `./settings`), `glax/tranga-website:latest` (port 9555), `postgres:17` [4]. Le dépôt publie aussi le port 5432 et un mot de passe en clair dans l'exemple : à ne pas recopier [4].

**Authentification.** **Aucune** : `Program.cs` n'appelle ni `AddAuthentication` ni `AddAuthorization` ; l'OpenAPI n'a pas de `securitySchemes` [5][6]. Toute personne qui atteint le port peut ajouter des séries, régler des paramètres ou supprimer des mangas. Conséquence : le chemin proxy `/tranga/` doit être protégé côté nginx ou DSM, et ne jamais être exposé seul.

**CORS.** L'API active une politique `AllowAll` (toute origine, ou une origine configurée) [5]. Sans importance pour Scrollarr, qui passe par le proxy nginx du même domaine ; le versionnement se lit dans l'URL `/v2/…` et peut aussi se lire dans l'en-tête `X-Version` [5].

**API utile (extraits de l'OpenAPI) [6].**

| Capacité | Point d'accès | Remarque |
| --- | --- | --- |
| Recherche | `GET /v2/Search/{MangaConnectorName}/{Query}` ; `GET /v2/Search` (par URL) | Recherche par site, un site à la fois |
| Ajout / suivi | `PATCH /v2/Manga/{MangaId}/DownloadFrom/{MangaConnectorName}/{IsRequested}` | Marquer une série « à télécharger » ; la série doit exister dans le cache après la recherche (**ordre exact non vérifié**) |
| Chapitres | `POST /v2/Chapters/Manga/{MangaId}`, `PATCH …/Chapters/{ChapterId}/DownloadFrom/…` | Demande ciblée possible |
| Tâches | `GET /v2/Worker`, `GET /v2/Worker/State/{State}`, `GET /v2/Worker/{WorkerId}` | `state` : Failed, Cancelled, Created, Waiting, Running, Completed ; `progress` 0–1 ; `currentStep`, `totalSteps`, `progressDescription` |
| Annulation | `POST /v2/Worker/{WorkerId}/Stop` | Réponses 200, 202, 404, 412 |
| Relance | **Aucun point dédié trouvé** ; `POST /v2/Manga/ForceRecheck/…` relance la vérification des chapitres en échec | Relance par tâche **non vérifiée** (la fin de l'OpenAPI a été lue en partie) |
| Fichiers | Bibliothèques `GET/PUT /v2/FileLibrary` | Un chemin de base par bibliothèque |

**Où vont les fichiers et quel lecteur les sert.** Un `.cbz` par chapitre, dans un dossier par série, sous `/Manga` [1]. Tranga peut déclencher un scan dans Komga ou Kavita (`PUT /v2/LibraryConnector/Komga|Kavita`) [1][6]. Lecteur naturel : **Komga** sur ce dossier, ou le futur service Dossiers de Scrollarr (READ-002). **Les identifiants de Tranga sont des clés opaques de 16 à 64 caractères** [6] : aucune relation directe avec ceux de Komga ; le rapprochement ne peut se faire que **par titre** (risque d'homonymes, déjà dans les risques de la feuille de route).

**Écarts et risques.**
- Pas d'authentification (voir plus haut) : c'est le point bloquant pour l'exposition.
- L'API v2 est jeune ; une issue mentionne une erreur 500 sur une recherche répétée (#535) [3].
- Les « workers » incluent sans doute d'autres travaux que des téléchargements de chapitres (mise à jour de couvertures, #571 [3]) : **types de workers non vérifiés** ; il faudra filtrer.
- Dépendance PostgreSQL et FlareSolverr facultatif [1][4].

**Taille : M.** Un client HTTP simple, états et progression directement exploitables, annulation présente. Le coût vient de la recherche à un site à la fois, du rapprochement par titre, de la protection d'accès et de l'extension du contrat.

## 4. « Mangarr » : candidats trouvés

Une recherche web sur « Mangarr » renvoie au moins dix dépôts distincts [9]. Leur point commun est le nom, jamais le code.

| Dépôt | Nature | Licence | Statut observé | Crédible ? |
| --- | --- | --- | --- | --- |
| `Asion001/Mangarr` [10] | « Sonarr du manga » : suivi, files, historique, API OpenAPI, API compatible Komga | AGPL-3.0+ | 243 commits, 14 issues ouvertes, préversion du 28 oct. [10][11] ; pas de version stable | **Oui, à surveiller** |
| `Kha-kis/manga-arr` (et fork `LiQiuDGG/manga-arr`) [13][14] | Gestionnaire façon Sonarr via Prowlarr/Torznab/Newznab, qBittorrent, Suwayomi | AGPL-3.0 | 650 commits ; 1.2.0 stable, 1.3.0 en qualification [13] ; compatibilité Sonarr `/api/v1`, `/api/v3` **non vérifiée** | Possible, mais orienté torrents/Usenet |
| `maia-kitty/mangarr` [12] | « Sonarr pour manga » via Suwayomi, écrit surtout avec un assistant IA ; ruptures sans migration annoncées | MIT | 14 commits | Trop jeune |
| `KiranTheRam/mangarr` [8] | Gestionnaire, sources propres, API `/api/v1` | GPL-3.0 | 85 commits, 3 étoiles | Peu probable |
| `donderjoekel/Mangarr` [15] | Téléchargeur « *arr » par sources | MIT | **Archivé le 30 avr. 2025** | Non |
| `nuxencs/mangarr` [16] | Outil en ligne de commande qui produit des `.cbz` | MIT | 104 commits, pas d'API documentée | Non (pas d'API HTTP) |
| `devbrian/Mangarr` [17] | Fork de Sonarr pour manga (.NET) | GPL-3.0 | Compilation depuis les sources seulement | Non |
| `opentomedb/mangarr` [18] | Fork de Readarr, API Readarr | GPL-3.0 | 2 commits, bêta | Non |
| `PatrickPedersen/mangarr` [19] | Suivi, un CBZ croissant par série via Suwayomi | AGPL-3.0 | 12 commits, 0 étoile | Non |
| `gavinmcfall/mangarr` [20] | Organisateur de dossiers pour Kavita ; ne télécharge pas | non indiquée | 81 commits | Non (pas un collecteur) |

**Constat.** Aucun projet ne s'impose : le plus visible (`donderjoekel`) est archivé ; les actifs ont 0 à 3 étoiles. **Je n'ai pas pu déterminer lequel la feuille de route vise** : la ligne COL-005 demande justement de l'identifier. Il est aussi **non vérifié** que le nom désigne, pour Julien, un de ces dépôts plutôt que sa propre pile Docker de téléchargement (hors dépôt, donc hors de cette étude).

**`Asion001/Mangarr`, le seul à regarder de près.**
- Ses sources de fichiers : 23 sites intégrés et Suwayomi ; il écrit des CBZ avec `ComicInfo.xml` et `series.json` sous `/data/manga/<langue>/<Série>/` et prévient Komga ou Kavita pour un nouveau scan [10].
- Il sert lui-même une **API compatible Komga** sur le port 25600 (désactivée par défaut) [10] : si elle est assez fidèle, le **lecteur Komga de Scrollarr** pourrait lire sa bibliothèque et les identifiants seraient communs (`serves: ['komga']`). **Fidélité non vérifiée.**
- Authentification : comptes, OpenID Connect facultatif, clé `X-Api-Key` ; `MANGARR_AUTH_DISABLED` existe pour un usage derrière un proxy [10].
- API : OpenAPI sur `/api/docs` ; **les points de recherche, d'ajout, de file, d'annulation et de relance ne figurent pas dans le README** et n'ont pas été lus [10]. C'est pourquoi la taille est donnée « M/L » sans plus.
- Stabilité : images `X.Y.Z`, mais `main` livre « les nouvelles fonctions et les nouveaux bogues » ; lire le guide de mise à jour entre versions [10]. Licence AGPL : n'impose rien à un client HTTP MIT (même réserve que pour Tranga, **non vérifiée par source**).

## 5. Correspondance avec le contrat des collecteurs

| Élément du contrat | Suwayomi (référence) | Tranga | Asion001/Mangarr |
| --- | --- | --- | --- |
| `serves` | `['suwayomi']` | **`[]`** : clés opaques, Komga indirect | `['komga']` possible si l'API Komga est fidèle (**non vérifié**) |
| `collect.chapters` | `collectChapters(readerId, ids)` | **Impossible** : le contrat exige au moins un lecteur dans `serves` (`validateCollector`) | idem, sauf s'il sert Komga |
| `collect.tasks` | file de téléchargement | `GET /v2/Worker` : états, progression, étapes | **non vérifié** |
| `resolveTasks` | contrôle `isDownloaded` | Relire `GET /v2/Worker/{id}` ; durée de conservation des workers **non vérifiée** | **non vérifié** |
| `collect.cancel` | `Dequeue` | `POST …/Stop` | **non vérifié** |
| `collect.retry` | `Dequeue` + `Enqueue` | Pas de point dédié trouvé | **non vérifié** |
| `session`, `login` | Réutilise le lecteur | Serveur propre, sans compte : `login` sans objet | `X-Api-Key` : un champ secret à stocker côté serveur |

Les états de Tranga se projettent sur `tasks.js` sans perte : Created/Waiting vers `queued`, Running vers `running`, Completed vers `done`, Failed vers `failed`, Cancelled vers `cancelled` ; `progress` est déjà entre 0 et 1.

**Ce qui manque dans le contrat** (déjà prévu par COL-001, confirmé par cette étude) :
1. Une capacité de **recherche par titre** (`collect.search`) renvoyant des séries identifiées chez le collecteur ; Tranga cherche site par site.
2. Une capacité d'**ajout/suivi d'une série** (`collect.follow`), sans identifiant de chapitre de lecteur.
3. Des tâches **sans lecteur** : `normalize` accepte déjà `reader` nul, mais `collect.chapters` suppose un lecteur ; il faut autoriser un collecteur sans `serves` s'il n'a pas cette capacité.
4. Une **correspondance par titre** entre série collectée et série du lecteur (score + validation humaine, voir les risques de la feuille de route) ; c'est COL-007.
5. Un type de tâche **« série suivie »** en plus de `chapter.download` (`KIND` ne contient qu'un type).
6. Un champ d'**authentification** propre au collecteur (clé d'API) et une consigne de protection du chemin proxy.

## 6. Questions ouvertes pour Julien

1. **Quel « Mangarr » vise COL-005 ?** Un des dépôts du §4, ou la pile personnelle ? Sans réponse, COL-005/006 restent bloqués.
2. Veut-on un collecteur qui **sert un lecteur existant** (fichiers lus par Komga ou le futur service Dossiers) ou un collecteur autonome ?
3. Accepte-t-on d'exposer Tranga derrière le proxy **avec une authentification ajoutée côté nginx** (l'API n'en a pas) ?
4. Tranga demande PostgreSQL en plus de son API : acceptable sur le NAS, ou Suwayomi suffit-il ?
5. Faut-il attendre COL-002 sur instance réelle avant de toucher au contrat (recommandé : oui) ?
6. Préférence de licence : un collecteur AGPL (`Asion001`, `Kha-kis`) est-il acceptable comme dépendance de déploiement documentée ?

## 7. Autres collecteurs

- **Kaizoku** (`oae/kaizoku`) : **archivé le 3 févr. 2025**, MIT, 681 étoiles ; son auteur recommande Suwayomi + Komf [21]. Un fork `kaizoku-next` est lui aussi archivé (9 oct. 2025) [22]. **Non retenu.**
- **Suwayomi** reste la meilleure première cible : c'est COL-002, déjà en cours.
- Aucun autre collecteur actif avec API documentée n'a été trouvé par les sources consultées : **non exhaustif**.

## 8. Ce qui n'a pas pu être vérifié

- Date du dernier commit et cadence de publication de Tranga v2 ; nombre de contributeurs.
- Fin de l'OpenAPI de Tranga (types de workers, relance, conservation des workers), CORS effectif selon la configuration.
- Tout le détail de l'API de `Asion001/Mangarr` (`/api/docs` non lu), fidélité de son API Komga, dates de ses commits.
- Contenu de `docs/HOW-IT-WORKS.md` (maia-kitty) et compatibilité Sonarr de `Kha-kis/manga-arr`.
- Analyse de licence GPL/AGPL pour un client HTTP MIT : conclusion usuelle, mais la FAQ de la FSF n'a pas pu être consultée.

## Sources (consultées le 13 novembre 2026)

1. https://github.com/C9Glax/tranga (README, licence, étoiles, issues)
2. https://github.com/C9Glax/tranga/releases
3. https://github.com/C9Glax/tranga/issues
4. https://raw.githubusercontent.com/C9Glax/tranga/main/docker-compose.yaml
5. https://raw.githubusercontent.com/C9Glax/tranga/main/API/Program.cs
6. https://raw.githubusercontent.com/C9Glax/tranga/main/API/openapi/API_v2.json
7. https://awesome.ecosyste.ms/api/v1/projects/github.com%2FC9Glax%2Ftranga (agrégateur, données périmées)
8. https://github.com/KiranTheRam/mangarr
9. Recherche web « Mangarr github repository manga Sonarr-like » (liste des candidats)
10. https://github.com/Asion001/Mangarr et https://raw.githubusercontent.com/Asion001/Mangarr/main/README.md
11. https://github.com/Asion001/mangarr/releases/tag/build-299
12. https://github.com/maia-kitty/mangarr
13. https://github.com/Kha-kis/manga-arr
14. https://github.com/LiQiuDGG/manga-arr
15. https://github.com/donderjoekel/Mangarr
16. https://github.com/nuxencs/mangarr
17. https://github.com/devbrian/Mangarr
18. https://github.com/opentomedb/mangarr
19. https://github.com/PatrickPedersen/mangarr
20. https://github.com/gavinmcfall/mangarr
21. https://github.com/oae/kaizoku
22. https://github.com/ElryGH/kaizoku-next (la page affiche le dépôt `impishlucy/kaizoku-next`)
