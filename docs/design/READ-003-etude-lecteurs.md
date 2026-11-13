# READ-003 — Étude : connecteurs Kavita, Stump et OPDS

> Étude de cadrage, **sans code**. Rédigée le 13 novembre 2026 sur la base de `main`. Les références `fichier` renvoient au dépôt ; les affirmations sur des logiciels tiers sont numérotées [n] et sourcées en annexe.
> Convention : **[non vérifié]** marque ce qui n'a pas pu être confirmé dans une source primaire ; **[déduction]** marque ce qui découle d'une lecture du code de Scrollarr ou d'un raisonnement, pas d'une source tierce. Julien n'utilise aucun des trois serveurs : aucune affirmation de ce document n'a été éprouvée sur une instance réelle.

## 1. Résumé et recommandation

| Ordre | Décision | Taille | Pourquoi, en une ligne |
| --- | --- | --- | --- |
| 1 | **Écrire Kavita** (anciennement READ-001) | M, risque moyen | Plus gros public (12 k étoiles), API documentée par un fichier OpenAPI public, image Docker officielle, démo publique : c'est le seul des trois qu'on peut tester sérieusement sans instance personnelle. |
| 2 | **Reporter Stump** (READ-003) | L, risque élevé | Logiciel annoncé « beta », versions 0.1.x, API principale en GraphQL et API REST réduite aux pages et vignettes : on bâtirait sur du sable. À rouvrir à la 1.0 ou sur demande d'un utilisateur réel. |
| 3 | **OPDS : ne pas écrire de client générique complet.** Au plus, plus tard, un lecteur « OPDS 1.2 + PSE, lecture seule » (READ-004 réduit) | M, risque élevé | Le standard ne dit rien de la progression, des filtres, du tri ni des listes « en cours » ; les serveurs courants (Komga, Kavita, Stump) ont déjà ou auront un connecteur natif. |
| — | **Ne pas faire** : OPDS 2.0 | — | La spécification ne définit ni lecture page à page ni progression ; le brouillon « progression » est séparé et seul Stump l'implémente à notre connaissance. |

Le test sans instance réelle pèse dans cet ordre : Kavita offre un contrat machine-lisible (OpenAPI), une image Docker et une démo ; Stump et OPDS n'offrent ni l'un ni l'autre sous une forme aussi directe. Quel que soit le choix, le connecteur doit être livré avec la mention « testé contre un faux serveur et un conteneur, pas contre une instance de production », comme le fait déjà `docs/en/connectors.md` pour la recherche dans les sources Suwayomi.

## 2. Tableau comparatif

| Critère | Kavita | Stump | OPDS générique |
| --- | --- | --- | --- |
| Statut | GPL-3.0, ~12 k étoiles, mainteneur principal : majora2007, README : « beta jusqu'à la 1.0.0 » [1] | MIT (app Expo en GPL-3.0), ~2,8 k étoiles, README : « beta », « pas de garantie » contre les changements cassants [2] | Standard ; OPDS 1.2 publié le 11/11/2018, OPDS 2.0 « living standard » [9][10] |
| Dernière version vue | v0.9.1.x (page des versions : 2 sept., année non affichée ; le fichier OpenAPI annonce v0.9.1.22) [1][3][4] | v0.1.11, 20 oct. (année non affichée, probablement 2026 [non vérifié]) [5] | sans objet |
| Cadence | Une version majeure tous les 2 à 4 mois (janv., avr./mai, août/sept.) [3] | Versions 0.1.x rapprochées (6 sur ~3 mois) [5] | sans objet |
| Image Docker | `jvmilazz0/kavita` [1] | `aaronleopold/stump` [2] | sans objet |
| Authentification | Clé d'API (en-tête `x-api-key`), JWT + refresh [3][4][6] | Session (cookie), JWT court + refresh, clés d'API, Basic sur OPDS seulement [7] | Basic au minimum (OPDS 1.2) [9] |
| API pour lire | REST, 521 chemins, OpenAPI publié [4] | GraphQL principal ; REST limité (auth, page, vignette, fichier) [7][8] | Flux Atom/JSON, navigation par liens |
| Pages par numéro | Oui, par paramètre de requête [4] | Oui, par chemin (`/media/{id}/page/{n}`) [8] | PSE : `pse:count` et gabarit `{pageNumber}` [11] |
| Progression écrite | Oui, par page et par chapitre [4] | Oui (GraphQL ; OPDS 2.0 `PUT progression`) [8][12] | Non en OPDS 1.2 [9][11] |
| Stockage clé-valeur | Non (préférences à schéma fixe) [4] | Non trouvé en REST ; GraphQL non vérifié [8] | Non |
| Testable sans instance | Bien (OpenAPI, Docker, démo) | Moyen (Docker seulement) | Moyen (flux d'exemple, serveurs tiers en conteneur) |

## 3. Kavita

**Statut.** Dépôt `Kareadita/Kavita`, GPL-3.0, ~12 k étoiles, 3 454 commits sur `develop`, créateur et développeur principal majora2007 [1]. Le README parle de « beta jusqu'à la 1.0.0 » [1], mais le projet publie régulièrement (v0.8.9 en janvier, v0.9.0 fin avril, correctif de sécurité en mai, v0.9.1 en août) [3]. L'année des dates n'est pas affichée par la page : le décalage entre « v0.9.1.4 dernière version » et le fichier OpenAPI « construit contre v0.9.1.22 » [4] suggère que la page lue était en cache [déduction]. La licence GPL-3.0 n'impose rien à Scrollarr, qui parle au serveur par HTTP sans reprendre son code.

**Authentification.** Trois mécanismes : connexion `POST /api/Account/login` qui renvoie un JWT et un jeton de rafraîchissement (`UserDto.token`, `refreshToken`), `POST /api/Account/refresh-token` ; échange d'une clé via `POST /api/Plugin/authenticate` ; clé d'authentification créée par l'utilisateur (expiration optionnelle), envoyée dans `x-api-key` [4][6]. Le jeton d'accès est passé de 10 à 3 jours en v0.9.1 [13]. Conséquence pour le proxy : les balises `<img>` ne peuvent pas envoyer d'en-tête ; l'extrait OpenAPI montre que `Reader/image` accepte un paramètre `apiKey` en requête, mais les routes de couverture (`Image/series-cover`, `chapter-cover`) n'en déclarent aucun [4]. Comment elles s'authentifient pour un client tiers est **[non vérifié]**. Piste, à valider sur conteneur : reprendre le schéma Suwayomi de `nginx/default.conf.template` (cookie posé par l'application, converti par nginx en en-tête `x-api-key` ou `Authorization`), ce qui évite de mettre la clé dans les URL, donc dans les clés de cache du service worker [déduction]. L'application garderait alors un secret de longue durée (clé ou jeton de rafraîchissement) dans un cookie, comme elle garde déjà le mot de passe Suwayomi en mode Basic.

**Préfixe de chemin.** Kavita a un réglage « base URL » (`/api/Settings/base-url`) [4]. Nginx retire `/kavita/` avant de relayer, donc un Kavita installé à la racine fonctionne ; un Kavita configuré avec sa propre base URL exigerait de la remettre dans `proxy_pass` **[non vérifié]**. Les liens renvoyés par l'API (couvertures) sont des identifiants, pas des URL absolues, ce qui évite le problème d'OPDS [déduction].

**Modèle.** Bibliothèque (types Manga, Comic, Book, Image, Light novel, ComicVine) > série > volumes > chapitres ; chapitres sans volume et « spéciaux » (`isSpecial`) listés à part (`SeriesDetailDto.specials`, `chapters`, `volumes`) [4]. Le « chapitre » Kavita est l'unité de lecture (équivalent du `book` de Komga) et porte `pages`, `pagesRead`, `files`. Un tome CBZ est un volume dont les chapitres sont des fichiers ; la réconciliation « ordre de lecture » demande d'aplatir volumes puis chapitres puis spéciaux **[non vérifié sur données réelles]**.

**Pages.** `GET /api/Reader/image?chapterId=…&page=…&apiKey=…` [4]. Le nombre de pages et, avec `includeDimensions=true`, la largeur et la hauteur de chaque page viennent de `GET /api/Reader/chapter-info` (`pages`, `pageDimensions`) [4] : le connecteur pourrait donc réserver la hauteur des pages comme avec Komga. Base 0 ou 1 du paramètre `page` : **[non vérifié]**. Type MIME par page : non fourni **[non vérifié]**.

**Point de rupture dans `app/sw.js`.** La fonction `page()` appelle `caches.match(req.url, { ignoreSearch: true })` et `isPage` attend un chemin qui finit par `/<n>`. Une URL à paramètres (`/api/Reader/image?chapterId=1&page=3`) serait vue comme `/api/Reader/image` : toutes les pages de tous les chapitres tomberaient sur la même entrée de cache, et le mode hors ligne servirait la mauvaise image [déduction, lecture du code]. Solution proposée : nginx expose des chemins à la Komga (`/kavita/api/v1/books/<chapitre>/pages/<n>` et `/kavita/api/v1/series/<id>/thumbnail`) qu'il réécrit vers les routes de Kavita en ajoutant l'authentification ; `isPage` et `isThumb` ne changent alors pas. Cette réécriture dans nginx est le principal travail non trivial, et elle ne se teste qu'avec un nginx réel (voir §8).

**Progression.** `POST /api/Reader/progress` avec `volumeId`, `chapterId`, `pageNum`, `seriesId`, `libraryId` [4] : le connecteur doit donc connaître les quatre identifiants à partir du seul `bookId` que lui donne la façade (appel préalable à `chapter-info`, mis en cache). Il n'y a pas de drapeau « terminé » : un chapitre est lu lorsqu'on atteint sa dernière page, ou via `mark-chapter-read` / `mark-unread` / `mark-multiple-series-read` [4] ; la règle exacte de passage à « lu » est **[non vérifiée]**. Lecture : `GET /api/Reader/get-progress` (numéro de page) ; `ChapterDto.lastReadingProgress` en liste.

**Listes d'accueil.** Nouveautés : `recently-added-v2`, `recently-updated-series` ; « à suivre » : `Series/on-deck` (au niveau série, pas livre) plus `Reader/continue-point` pour obtenir le chapitre [4]. « En cours » et « lus récemment » se déduisent des filtres `ReadProgress` / `ReadingDate` / `ReadLast` de `Series/all-v2` [4] : faisable mais en plusieurs appels.

**Recherche, tri, filtres.** `POST /api/Series/all-v2` avec `PageNumber`/`PageSize` en requête et un `SeriesFilterV2Dto` (`statements` sur 35 champs dont `SeriesName`, `Genres`, `Libraries`, `ReadProgress`, `Formats` ; `sortOptions` : nom, création, dernière modification, progression…) [4] ; la recherche texte rapide est `GET /api/Search/search` [4]. Genres : `GET /api/Metadata/genres` [4].

**Stockage clé-valeur.** Aucun. `UserPreferencesDto` a un schéma fixe (thème, locale, etc.) [4]. Un utilisateur Kavita seul perdrait donc, comme documenté pour l'installation « dossiers seuls » : gestion des profils, abonnements partagés entre appareils (ils restent sur l'appareil qui les a créés), historique partagé des tâches. Détourner une liste de lecture ou une collection pour y ranger du JSON est possible en théorie mais fragile ; **déconseillé**.

**Progression par profil Scrollarr.** Impossible nativement (un compte Kavita = un historique) ; la façade garde sa surcouche locale, comme pour Komga [déduction, `docs/en/connectors.md`].

**Pertinence webtoon.** Le type de bibliothèque « Manga » et le format « Image/Archive » couvrent le manga en CBZ/ZIP [4]. Les formats d'image acceptés par le lecteur web de Kavita, et la conversion à la volée des formats non affichables (WebP/AVIF, comme `?convert=jpeg` chez Komga) : **[non vérifié]**. Les « chapitres » webtoon très hauts (bandes longues) n'ont pas de traitement documenté ; les dimensions fournies par `chapter-info` aident à réserver la hauteur.

**Risques.** (1) L'API série-détail est annoncée comme pouvant changer sans préavis (« Do not rely on this API externally ») [4] : s'appuyer sur `Series/volumes` plutôt. (2) Beta et rythme élevé de versions : prévoir une surveillance de compatibilité comme le dépôt le fait déjà pour d'autres serveurs. (3) Authentification des images et réécriture nginx non éprouvées. **Taille : M** — plus de travail que `komga.js` (trois niveaux d'identifiants, résolution des identifiants pour la progression, aplatissement des volumes, réécriture nginx) mais aucun concept absent du contrat.

## 4. Stump

**Statut.** Dépôt `stumpapp/stump`, MIT (application Expo en GPL-3.0, module `wifi-ssid` en MPL-2.0), ~2,8 k étoiles, 1 746 commits, image `aaronleopold/stump` [2]. Le README dit : « sous développement actif, à traiter comme un **logiciel beta** jusqu'à la 1.0 stable ; je fais de mon mieux pour éviter les changements cassants, mais il n'y a aucune garantie » [2]. Dernière version vue : v0.1.11 (20 oct.), v0.1.10 le 21 sept., v0.1.9 et v0.1.8 le 19 sept., v0.1.7 le 3 sept., v0.1.6 le 2 août [5] (années non affichées). Un agrégateur tiers annonce 339 commits sur douze mois, mais ses chiffres se contredisent sur l'ancienneté du dernier commit : **[non vérifié]** [14]. Nombre de mainteneurs : **[non vérifié]** ; le schéma GraphQL peut bouger à chaque 0.1.x.

**Authentification.** Sessions côté serveur avec cookie (`POST /auth/login`, `create_session` vrai par défaut) ; jetons JWT courts et jeton de rafraîchissement sur demande (`generate_token`) ; clés d'API ; Basic uniquement sur OPDS ; verrouillage du compte après 9 échecs en 24 h [7][8]. Le mode cookie est le plus proche de Komga et traverse le proxy sans en-tête ajouté : points favorables. Le préfixe `/{baseUrl}` existe pour l'intégration KoReader [15] ; son comportement derrière un proxy qui le retire est **[non vérifié]**.

**API.** La documentation décrit GraphQL comme API principale ; REST « réservé aux intégrations et à des choses comme les vignettes » [7]. Dans le code : `GET /media/{id}/page/{n}`, `/media/{id}/thumbnail`, `/media/{id}/file`, `/series/{id}/thumbnail`, `/auth/*`, `/users/{id}/avatar` ; **aucune route REST de liste ou de recherche de séries** [8]. Les listes, recherches, séries, médias, sessions de lecture et progression passent donc par GraphQL (modules `MediaQuery`, `SeriesQuery`, `LibraryQuery`, `ReadingSessionQuery`, `ReadProgressMutation`, `ReadingSessionMutation`) [16]. Leur forme exacte n'a pas été lue : **[non vérifié]**. Préfixe réel des routes REST (`/api/v1` ou `/api/v2`) : **[non vérifié]**, le fichier source s'appelle `api/v2`.

**Pages et vignettes.** URL à chemin, donc compatible avec un cache par URL, mais la forme `…/media/<id>/page/<n>` ne correspond à aucune des deux expressions de `sw.js` (`books/…/pages/<n>`, `manga/…/page/<n>`) : trois lignes à ajouter à `isPage` et `isThumb`, ou une réécriture nginx comme pour Kavita [déduction].

**Progression.** Mutations GraphQL de progression et de session de lecture [16] ; côté OPDS 2.0, `GET`/`PUT /books/{id}/progression` avec 409 si l'horodatage est plus ancien que la session existante [12]. Granularité : page ou pourcentage selon le canal, **[non vérifié]**. La synchronisation KoReader n'enregistre que le pourcentage [15].

**Stockage clé-valeur.** Aucune route REST ; GraphQL `UserQuery`/`UserMutation` existent mais leur contenu n'a pas été lu **[non vérifié]** [16]. Hypothèse prudente : absent, mêmes pertes que Kavita.

**Pertinence webtoon.** Focus bandes dessinées, manga et livres numériques [2] ; rien lu sur les bandes longues.

**Risques.** Maturité (versions 0.1.x, GraphQL), absence de démo publique (le README n'en cite pas [2]), documentation d'API réduite, nombre de mainteneurs inconnu. **Taille : L**, dont une part de découverte du schéma GraphQL. Il faudrait aussi un client GraphQL : `app/js/connectors/suwayomi-client.js` en est un, réutilisable [déduction].

## 5. OPDS générique

**Ce que garantit le standard.** OPDS 1.2 (Atom) : catalogues de navigation et d'acquisition, recherche OpenSearch, liens `next`/`previous` pour la pagination ; Basic sur TLS comme minimum d'authentification ; **aucune relation de progression** [9]. OPDS-PSE 1.0 (2014) : lien `http://vaemendis.net/opds-pse/stream` avec `pse:count` et gabarit `{pageNumber}` (pages de 0 à N-1), formats JPEG, GIF, PNG seulement [11] ; PSE 1.2 (mars 2023) ajoute `pse:lastRead` (numérotation **à partir de 1**) et `pse:lastReadDate`, sans aucun moyen d'écrire la progression [11b]. OPDS 2.0 (JSON, `application/opds+json`) : ni lecture page à page ni progression dans la spécification [10] ; un brouillon distinct « OPDS Progression 1.0 » définit `GET`/`PUT` en `application/opds-progression+json`, avec un pourcentage total et des références optionnelles [17]. Il est présenté comme brouillon ; aucune date lue.

**Ce que les serveurs implémentent.** Komga : flux v1.2 et v2 ; PSE 1.2 côté v1 ; la progression n'apparaît que dans le tableau des clients v2 [18]. Kavita : OPDS et PSE activés par défaut, URL propre à l'utilisateur avec clé d'authentification, entrée « Continue From » ; synchronisation de la progression « selon le client » [19] ; routes `api/Opds/{apiKey}/…` dont `on-deck`, `recently-added`, `search` [4]. Stump : v1.2 avec PSE et v2.0 déclarés [2] ; route de page `/books/{id}/pages/{page}`, progression OPDS 1.2 enregistrée si `enable_opds_progression` est actif [20], v2.0 avec `progression` GET/PUT [12]. Ubooquity : origine de PSE [21] ; reste du paysage (Calibre-Web, etc.) **[non vérifié]**.

**Un client générique peut-il tenir le contrat ?** Non, seulement un sous-ensemble en lecture seule [déduction à partir de `reader-contract.js`].

- Identifiants : un flux n'a pas d'identifiant stable de série ou de livre ; on utiliserait l'URL du flux (encodée), fragile et relative au serveur.
- `seriesList({ sort, genre, readStatus, page })` : le standard n'a ni tri, ni filtre de genre, ni statut de lecture ; la pagination se fait par liens `next`, pas par numéro de page. Il faut parcourir ou se limiter à ce que le serveur expose en sous-flux.
- `booksOnDeck`, `booksInProgress`, `booksRecentlyRead`, `genres` : à rendre vides (le contrat exige les méthodes, pas leur contenu) ; comportement des écrans d'accueil avec des listes vides **[non vérifié, à lire dans `app/js/views/home.js`]**.
- Progression : lecture possible via `pse:lastRead` si le serveur le fournit ; écriture impossible en 1.2. La façade accepte un lecteur sans `chapter.progress.*` (le chapitre se lit, la progression reste locale) [`docs/en/connectors.md`].
- **Préfixe de chemin : point dur.** Les liens d'un flux (page, vignette, flux suivant) sont construits par le serveur à partir de `Host` ; nginx transmet l'hôte de Scrollarr sans le préfixe `/opds/`. Les liens renvoyés pointeraient donc hors du proxy, ou vers la racine de Scrollarr [déduction]. Réécrire le corps XML avec `sub_filter` est possible mais fragile.
- Authentification : Basic, injectable par nginx depuis un cookie (schéma Suwayomi) ; Kavita met la clé dans le chemin (`/api/Opds/{apiKey}/…`) [4], donc dans l'historique et le cache.

**Valeur réelle.** Les trois serveurs étudiés ont déjà ou auront un connecteur natif plus riche ; le gain d'OPDS est la longue traîne (Ubooquity, serveurs maison), ce qui est invérifiable sans ces instances. **Taille : M** (analyseur XML, gestion des variantes) avec une incertitude très forte sur la compatibilité.

## 6. Correspondance avec le contrat

Légende : **N** natif, **C** contournement (plusieurs appels, calcul côté client, réécriture), **X** impossible ou absent. « OPDS » désigne un client générique 1.2 + PSE.

| Membre du contrat | Kavita | Stump | OPDS |
| --- | --- | --- | --- |
| `session`, `login`, `logout` | N (JWT/refresh) ou C (cookie nginx) | N (cookie de session) | C (Basic injecté par nginx) |
| `libraries()` | N (`Library/libraries`) | N (GraphQL, non vérifié) | C (sous-flux racine) |
| `genres()` | N (`Metadata/genres`) | N probable (GraphQL, non vérifié) | X |
| `seriesList` (page, tri, recherche, genre, statut) | N (`Series/all-v2`) | N (GraphQL, non vérifié) | C pour recherche et pages ; X pour tri, genre, statut |
| `seriesNew`, `seriesUpdated` | N | N probable (GraphQL, non vérifié) | C (flux « récents » si exposé) |
| `series(id)` | N (`Series/{id}` + métadonnées) | N (GraphQL) | C (entrée de flux) |
| `seriesBooks` (ordre de lecture) | C (aplatir volumes, chapitres, spéciaux) | N (GraphQL, non vérifié) | C (ordre du flux) |
| `booksLatest` | N (`recently-added-v2`) | N probable | C |
| `booksOnDeck` | C (`on-deck` série, puis `continue-point`) | N probable (« keep reading » OPDS) | X |
| `booksInProgress`, `booksRecentlyRead` | C (filtres `ReadProgress` / `ReadLast`) | C (sessions de lecture, GraphQL) | X |
| `book(id)` | C (`chapter-info` + `Series/volumes`) | N | C |
| `bookPages(id)` (numéro, URL, type, taille) | N pour URL et taille ; type non fourni | N pour URL ; taille non vérifiée | N pour URL et nombre (PSE) ; ni type ni taille |
| `nextBook`, `previousBook` | C (`next-chapter` : demande aussi série et volume) | C probable (ordre de la série) | C (ordre du flux) |
| `seriesThumb`, `bookThumb` | C (chemin réécrit par nginx) | N (`/series/{id}/thumbnail`, `/media/{id}/thumbnail`) | N (lien `image`/`thumbnail` du flux) |
| `saveProgress(id, page, completed)` | C (quatre identifiants requis, pas de drapeau `completed`) | N (GraphQL / OPDS 2.0) | X |
| `markBookRead`, `markBookUnread` | N | N probable | X |
| `markSeriesRead`, `markSeriesUnread` | N (`mark-multiple-series-*`) | C (boucle sur les livres) | X |
| `settings.store` (`getSettings`, `setSetting`, `deleteSettings`) | X | X probable | X |
| `chapter.progress.profiles` | X | X | X |
| URL de page reconnue par `isPage` sans modification | X (paramètres de requête) → C (réécriture nginx) | X (forme différente) → trois lignes | X (URL du serveur quelconque) |

Capacités déclarables : Kavita `series.list`, `series.search`, `chapter.list`, `chapter.read`, `chapter.progress.read`, `chapter.progress.write` ; Stump idem sous réserve du schéma GraphQL ; OPDS `series.list`, `series.search` (si OpenSearch), `chapter.list`, `chapter.read`, et `chapter.progress.read` si `pse:lastRead` est fourni.

## 7. Étapes proposées si la recommandation est suivie

1. **Kavita, étape A (sans nginx réel) :** faux serveur `dev/mock-kavita.mjs` tiré du fichier OpenAPI, connecteur avec les capacités ci-dessus, tests unitaires du contrat et de la façade. Livrable : le connecteur passe `validateReader`.
2. **Kavita, étape B (conteneur) :** réécriture nginx et authentification des images éprouvées contre l'image Docker officielle, avec les dossiers de test déjà générés par `dev/make-folders-fixture.mjs` ; vérification du mode hors ligne.
3. **Ensuite seulement**, selon les retours : Stump (après 1.0 ou sur demande) ; OPDS lecture seule.
4. À chaque fois : ajouter à `READERS` (`app/js/connectors/index.js`), `nginx/default.conf.template`, `Dockerfile`, `docker-compose.yml`, `.env.example`, `docs/en/configuration.md`, `app/sw.js` (`SERVERS`, `SHELL_FILES`), `app/js/i18n.js` ; une lettre de `code` libre (celles de Komga, Suwayomi et Dossiers sont prises) [`docs/en/connectors.md`].

## 8. Tester sans instance réelle

| Candidat | Moyen | Limites |
| --- | --- | --- |
| Kavita | (a) faux serveur `dev/mock-kavita.mjs`, dans la veine de `dev/mock-servers.mjs`, construit sur `openapi.json` (≈ 950 Ko, v0.9.1.22) [4] ; (b) conteneur `jvmilazz0/kavita` en CI avec une bibliothèque générée, création du premier compte et du dépôt de test par l'API **[non vérifié : procédure exacte à écrire]** ; (c) démo publique `demo.kavitareader.com`, identifiants indiqués dans le README [1] | Le faux serveur ne prouve que ce que l'on y a mis ; la démo est un tiers (disponibilité, droit d'écriture de la progression **[non vérifié]**) : à réserver à un essai manuel, pas à la CI. |
| Stump | Conteneur `aaronleopold/stump` [2] ; pas de démo publique citée [2] ; schéma GraphQL à relever sur une instance (introspection **[non vérifié]**) | Il faut d'abord découvrir l'API ; tests fragiles à chaque version 0.1.x. |
| OPDS | Fichiers de flux d'exemple (spécifications) ; flux réels produits par les conteneurs Komga, Kavita et Stump ; test de réécriture de liens derrière nginx | Les différences entre serveurs sont justement le risque : un test passant sur trois conteneurs ne dit rien sur les autres. |

Dans tous les cas, `tests/nginx_headers.py` doit couvrir le nouveau `location` (pas d'`add_header` dans le bloc) et `tests/unit_contracts.mjs` le nouveau lecteur.

## 9. Questions ouvertes pour Julien

1. Accepte-t-on de livrer un connecteur marqué « non essayé sur une instance réelle » (comme la recherche Suwayomi) ? Sinon, quelqu'un de la communauté peut-il tester Kavita ?
2. La perte de `settings.store` (profils, abonnements partagés) est-elle acceptable pour les utilisateurs Kavita seul ? Faut-il pousser plutôt le futur stockage central évoqué dans READ-002 ?
3. Un utilisateur réel de Stump ou d'un serveur OPDS s'est-il manifesté ? Sans demande, le report de Stump et d'OPDS est sûr.
4. Veut-on garder les clés d'API Kavita en cookie côté navigateur (secret de longue durée), ou imposer la connexion par mot de passe avec jeton de rafraîchissement ?
5. Un faux serveur Kavita dans `dev/` et un conteneur Kavita en CI sont-ils acceptables en coût de maintenance ?
6. Faut-il renuméroter la feuille de route (`docs/ROADMAP.md`) : READ-001 conservé en tête, READ-003 reporté, READ-004 réduit à « OPDS 1.2 + PSE lecture seule » ?

## 10. Ce qui n'a pas pu être vérifié

Années des dates de version de Kavita et de Stump ; comportement de la base URL de Kavita derrière un proxy qui retire le préfixe ; authentification des routes de couverture de Kavita ; base 0 ou 1 de `Reader/image` ; règle de passage à « lu » ; formats d'image et conversion côté Kavita ; schéma GraphQL de Stump (requêtes, progression, éventuelles préférences) ; préfixe exact des routes REST de Stump ; mainteneurs de Stump ; ensemble des serveurs qui implémentent PSE hors Komga, Kavita, Stump et Ubooquity ; comportement des écrans d'accueil avec des listes vides ; date et statut exacts du brouillon « OPDS Progression ». La page de Stump sur OPDS (`stumpapp.dev/docs/guides/opds`) n'a pas pu être chargée.

## Annexe — Sources (consultées le 13 novembre 2026)

1. Kavita, dépôt et README : https://github.com/Kareadita/Kavita
2. Stump, dépôt et README : https://github.com/stumpapp/stump et https://raw.githubusercontent.com/stumpapp/stump/main/README.md
3. Kavita, versions : https://www.github.com/Kareadita/Kavita/releases
4. Kavita, fichier OpenAPI (v0.9.1.22, analysé par script) : https://raw.githubusercontent.com/Kareadita/Kavita/develop/openapi.json
5. Stump, versions : https://github.com/stumpapp/stump/releases
6. Kavita, wiki API : https://wiki.kavitareader.com/guides/api/
7. Stump, documentation de l'API : https://www.stumpapp.dev/docs/developer/api
8. Stump, code des routes : https://raw.githubusercontent.com/stumpapp/stump/main/apps/server/src/routers/api/v2/mod.rs, `auth.rs`, `media.rs`, `series.rs`, `user.rs` (même dossier)
9. OPDS 1.2 : https://specs.opds.io/opds-1.2.html
10. OPDS 2.0 : https://specs.opds.io/opds-2.0.md
11. OPDS-PSE 1.0 : https://anansi-project.github.io/docs/opds-pse/specs/v1.0 ; 11b. PSE 1.2 : https://github.com/anansi-project/opds-pse/blob/master/v1.2.md
12. Stump, OPDS 2.0 : https://raw.githubusercontent.com/stumpapp/stump/main/apps/server/src/routers/opds/v2_0.rs
13. Kavita v0.9.1.0, notes de version (via agrégateur) : https://newreleases.io/project/github/Kareadita/Kavita/release/v0.9.1.0
14. Agrégateur d'indicateurs sur Stump (source secondaire) : https://ideaproof.io/open-source/project/stump
15. Stump, intégration KoReader : https://www.stumpapp.dev/docs/guides/integrations/koreader
16. Stump, modules GraphQL : https://raw.githubusercontent.com/stumpapp/stump/main/crates/graphql/src/query/mod.rs et `mutation/mod.rs`
17. OPDS Progression (brouillon) : https://drafts.opds.io/opds-progression-1.0.html
18. Komga, OPDS : https://komga.org/docs/guides/opds
19. Kavita, OPDS : https://wiki.kavitareader.com/guides/features/opds/
20. Stump, OPDS 1.2 : https://raw.githubusercontent.com/stumpapp/stump/main/apps/server/src/routers/opds/v1_2.rs
21. OPDS-PSE, présentation : https://anansi-project.github.io/docs/opds-pse/intro
