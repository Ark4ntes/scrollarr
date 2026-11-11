# READ-002 — Connecteur « Dossiers » : étude d'architecture

> Document de cadrage, **sans code applicatif**. Rédigé le 11 novembre 2026 sur la base du dépôt en version 0.7.0.
> Objet : permettre à Julien de valider (ou non) l'architecture et la sécurité du connecteur Dossiers **avant** tout développement, comme l'exigent `docs/ROADMAP.md` (ligne READ-002, §7 point 3, §9).
> Les références `fichier l.N` renvoient au dépôt tel qu'il est sur `main`. Les affirmations sur des logiciels tiers sont sourcées en annexe B ; ce qui n'a pas pu être vérifié y est listé explicitement.

## 1. Résumé et recommandation

**Recommandation.** Construire un **petit service Node dédié, facultatif, calqué sur `notifier/`**, placé derrière le proxy nginx existant sous `/folders/`. Il monte les dossiers de scans **en lecture seule**, ne reçoit jamais de chemin de la part du client (uniquement des identifiants opaques), lit les **dossiers d'images et les CBZ/ZIP** sans rien extraire sur disque, et range la progression et les petits documents de l'application dans un **volume de données séparé**. Son API reprend la forme des URL de Komga pour les pages et les couvertures : le module lecteur côté application reste une simple traduction d'appels, `app/sw.js` change de trois lignes, et **aucun changement du contrat `reader-contract.js` n'est nécessaire**.

Ce service ne fait pas de Scrollarr une application à plusieurs services : une installation « dossiers seuls » tourne avec **deux conteneurs** (nginx + ce service), exactement comme une installation « Komga seul » aujourd'hui. La règle proposée pour l'avenir est écrite au §3.4 : pas de troisième service satellite.

**Décisions à prendre par Julien** (détail et réponse recommandée au §6) :

1. Faire le connecteur, ou s'en tenir à « pointer Komga sur le dossier » (option nulle, §3.1 d).
2. Service dédié maintenant (option a), ou serveur Scrollarr unique dès maintenant (option b).
3. Le service **porte un état** (progression, profils, abonnements) dans `./data/folders`, ou reste sans état (progression par appareil seulement).
4. Formats de la v1 : dossiers d'images + CBZ/ZIP, rien d'autre.
5. Convention d'arborescence : `bibliothèque / série / chapitre`, ordre = tri naturel des noms.
6. Identifiants fondés sur le chemin : renommer un fichier fait repartir sa progression à zéro en v1.
7. Authentification : choix explicite obligatoire au démarrage ; mode mot de passe exigé avant toute exposition hors du réseau local.
8. Couvertures servies telles quelles en v1 (pas de redimensionnement, donc pas de dépendance native).

## 2. Besoin et périmètre

**Besoin.** Lire dans Scrollarr des scans déposés dans un dossier du NAS, sans installer ni Suwayomi ni Komga (README l.246 ; ROADMAP l.268). Critère d'acceptation de la roadmap : service dédié, montage strictement en lecture seule, parcours autorisé, formats définis, architecture et sécurité validées avant implémentation.

**À qui cela sert vraiment.** L'auteur utilise déjà Suwayomi et Komga (README l.231) : pour lui, l'option nulle ne coûte rien. La valeur du connecteur est ailleurs : (1) rendre Scrollarr utilisable **seul** par quelqu'un qui n'a que des dossiers ; (2) lire les **dossiers d'images en vrac**, que la documentation de Komga ne liste pas parmi ses formats (annexe B) ; (3) éviter une JVM pour ce seul usage.

| Dans la v1 | Explicitement hors v1 |
| --- | --- |
| Une ou plusieurs bibliothèques montées en lecture seule | Toute écriture dans les dossiers (renommage, suppression, import, téléversement) |
| Séries = sous-dossiers ; chapitres = sous-dossiers d'images ou archives CBZ/ZIP | CBR/RAR, 7z, PDF, EPUB (voir §4.2) |
| Images JPEG, PNG, WebP, GIF, AVIF servies telles quelles | Conversion d'images à la volée, SVG, TIFF, JPEG XL |
| Progression du profil principal, profils secondaires, abonnements, hors-ligne, fusion avec les autres serveurs | Métadonnées (auteur, résumé, genres), `ComicInfo.xml`, `details.json` |
| Authentification facultative par identifiant et mot de passe uniques | Comptes par utilisateur, droits par bibliothèque |
| Détection des nouveaux chapitres à la demande | Surveillance temps réel du disque, notifications push (lot ultérieur) |
| Couvertures : `cover.*` ou première page, non redimensionnées | Miniatures générées et mises en cache (lot ultérieur) |

## 3. Options d'architecture

### 3.1 Les options

**(a) Service Node dédié `folders/`, proxifié sous `/folders/`.** Même modèle que `notifier/` : un répertoire, un `Dockerfile`, une image publiée, un profil Compose, un `location` nginx. Le conteneur n'a que deux montages (bibliothèques en lecture seule, données en écriture), aucun secret tiers, aucun besoin de sortie réseau.

**(b) Serveur Scrollarr unique et facultatif (`scrollarr-server`)**, qui hébergerait le notifier, les dossiers, puis ce que la roadmap attend d'un « backend léger » (phase 5 : API, jetons, tâches). Un seul conteneur facultatif quelles que soient les fonctions activées.

**(c) nginx seul.** Monter les scans dans le conteneur nginx, activer `autoindex` au format JSON (directive `autoindex_format`, annexe B) et servir les images en statique ; toute la logique passe dans le navigateur.

**(d) Ne rien construire : pointer Komga sur le dossier.** Le connecteur Komga existe et déclare toutes les capacités (`app/js/connectors/readers/komga.js` l.37). Variante : la « source locale » de Suwayomi (réglage `server.localSourcePath`, annexe B).

**(e) Tout-en-un : Node dans l'image principale** (à côté de nginx, ou à sa place). Mentionnée parce que c'est la seule façon d'avoir un seul conteneur ; écartée ci-dessous.

### 3.2 Comparaison

| Critère | (a) Service dédié | (b) Serveur unique | (c) nginx seul | (d) Komga | (e) Tout-en-un |
| --- | --- | --- | --- | --- | --- |
| Conteneurs pour « lire des dossiers » | 2 | 2 | 1 | 2 | 1 |
| Conteneurs avec les notifications en plus | 3 | 2 | 2 | 3 | 1 ou 2 |
| Dossiers d'images | Oui | Oui | Oui | Non listé dans sa doc | Oui |
| CBZ/ZIP | Oui | Oui | **Non** (nginx ne lit pas une archive) | Oui (+ CBR, PDF, EPUB) | Oui |
| Ordre de lecture, numéros | Côté service, testé | Idem | Côté navigateur, une requête par dossier | Oui | Oui |
| Progression partagée entre appareils | Oui (volume de données) | Oui | **Non** sans module d'écriture | Oui | Oui |
| Listes d'accueil (nouveautés, à suivre) | Index en mémoire | Idem | Parcours complet par le navigateur | Oui | Oui |
| Couvertures | Telles quelles, puis lot « miniatures » | Idem | Possibles pour les dossiers, impossibles pour les archives | Fournies par Komga | Idem (a) |
| Impact sur les installations existantes | Aucun | Refonte du notifier, renommage d'image | Image principale modifiée, scans montés dans le conteneur exposé | Aucun | Image principale alourdie pour tous |
| Cloisonnement | Fort : pas de secret, pas de sortie réseau | Faible : l'analyse d'archives côtoie la clé Komga, le mot de passe Suwayomi et la clé VAPID du notifier | Faible : le conteneur exposé voit les fichiers | Celui de Komga | Faible |
| Effort | M + M + M (§5) | (a) + refonte du notifier | Faible côté serveur, élevé et fragile côté client | Nul | Élevé, risque de régression du proxy |

**Pourquoi (c) ne tient pas.** L'approche fonctionne pour des dossiers d'images et rien d'autre. Pour les archives, il faudrait lire le ZIP depuis le navigateur par requêtes partielles et fabriquer les pages dans le service worker : la complexité irait dans la partie la plus fragile de l'application, et les téléchargements hors ligne (`app/js/downloads.js` l.80-86, qui mettent en cache des URL) seraient à réécrire. Pour la progression, il n'y a nulle part où écrire sans ajouter un module d'écriture à nginx (WebDAV : présence dans l'image officielle non vérifiée, et aucune validation de ce qui est écrit). Les listes d'accueil imposeraient au téléphone de parcourir toute l'arborescence, une requête par dossier. Enfin les scans seraient montés dans le conteneur qui est exposé et qui relaie tous les serveurs. Écrire cette logique en njs (JavaScript embarqué dans nginx, module présent dans l'image officielle actuelle, annexe B) reviendrait à créer un backend dans un environnement d'exécution moins bien outillé.

**Ce que coûte (d) à l'utilisateur.** Un conteneur Java de plus (la documentation Docker de Komga indique un processus limité « usually 1gb » par défaut, annexe B), un compte à créer, une bibliothèque à déclarer et à analyser, et une arborescence au goût de Komga. Les 7z ne sont pas pris en charge (FAQ de Komga) et les dossiers d'images en vrac ne figurent pas dans la liste de ses formats : s'ils ne sont effectivement pas lus (non vérifié par un essai), ils sont à empaqueter en CBZ au préalable. En échange : CBR, PDF, EPUB, miniatures, dimensions des pages, comptes. **Si les seuls utilisateurs visés ont déjà Komga, (d) est la bonne réponse et READ-002 peut être fermé.** Avec la source locale de Suwayomi, chaque série doit en plus être ajoutée à la bibliothèque depuis l'interface de Suwayomi (README l.47).

**Pourquoi pas (e).** Deux processus dans un conteneur sans superviseur, ou le remplacement de nginx par Node alors que la configuration actuelle (cookie converti en en-tête, délais, en-têtes de sécurité : `nginx/default.conf.template` l.18-21, l.36-38, l.59-86) est celle que l'auteur utilise devant ses serveurs réels (README l.231). Cela contredit aussi l'état assumé par la roadmap : « l'application actuelle fonctionne sans backend, avec un simple nginx » (ROADMAP l.30).

### 3.3 Déploiement, image et maintenance (option a)

| Sujet | Ce que cela donne |
| --- | --- |
| `docker-compose.yml` | Un service `folders` sous `profiles: ["folders"]`, comme `notifier` (l.21-36). Aucun port publié : il n'est joignable que par nginx, sur le réseau de la pile. |
| Volumes | `/chemin/vers/scans:/libraries/Scans:ro` (un montage par bibliothèque) et `./data/folders:/data`. |
| nginx | Variable `FOLDERS_URL` (vide = absent), `map` vers `$folders_on`, clé `"folders"` dans `/servers.json`, `location ~ ^/folders/(.*)$` sur le modèle de Komga (l.59-71). Ne **pas** mettre de `add_header` dans ce `location` : nginx n'hérite des en-têtes du niveau supérieur que si le niveau courant n'en définit aucun (annexe B), et les trois en-têtes de sécurité l.36-38 doivent s'appliquer. |
| `Dockerfile` principal | Ajouter `FOLDERS_URL=""` à la ligne `ENV` (l.14) : les variables doivent exister, même vides. |
| Image publiée | Une entrée de plus dans la matrice de `.github/workflows/docker.yml` (l.24-28) : `scrollarr-folders`, contexte `./folders`, mêmes plateformes `amd64`/`arm64`. Base `node:22-alpine` comme le notifier. |
| Mémoire | Un processus Node sans dépendance native. Ordre de grandeur attendu : quelques dizaines de Mo, **à mesurer au lot 1** ; `mem_limit: 256m` proposé. |
| Synology | `docker compose --profile folders up -d`, ou `COMPOSE_PROFILES=folders` dans `.env` (annexe B ; comportement dans l'interface Container Manager non vérifié). L'utilisateur du conteneur doit pouvoir lire le dossier partagé : prévoir `user: "UID:GID"` dans Compose (voir risque R4). |
| Maintenance | Une dépendance npm (lecture ZIP), verrouillée par `package-lock.json` et installée avec `npm ci`. `notifier/Dockerfile` l.7-8 installe aujourd'hui sans fichier de verrouillage : ne pas reproduire. |

Esquisse du service Compose (configuration, pas du code) :

```yaml
  folders:
    profiles: ["folders"]
    image: <registre>/scrollarr-folders:latest
    build: ./folders
    restart: unless-stopped
    user: "${FOLDERS_UID:-1000}:${FOLDERS_GID:-1000}"
    read_only: true                      # système de fichiers du conteneur en lecture seule
    cap_drop: ["ALL"]
    security_opt: ["no-new-privileges:true"]
    mem_limit: 256m
    pids_limit: 64
    tmpfs: ["/tmp"]
    environment:
      FOLDERS_AUTH: ${FOLDERS_AUTH:-}    # « none » ou « password » : choix obligatoire (§4.8)
    volumes:
      - /chemin/vers/scans:/libraries/Scans:ro
      - ./data/folders:/data
```

### 3.4 Recommandation

**Option (a) maintenant.** Elle répond au besoin avec le plus petit changement, reprend un modèle déjà présent dans le dépôt et dans la CI, ne touche ni au notifier (dont l'envoi réel n'a pas encore été éprouvé, README l.232) ni aux installations existantes, et garde une propriété de sécurité simple à auditer : *ce conteneur ne peut que lire `/libraries` et écrire `/data` ; il ne détient aucun secret d'un autre service et n'a pas besoin d'Internet.*

L'option (b) n'apporte rien pour « lire des fichiers » (deux conteneurs dans les deux cas) ; elle n'en économise un que pour ceux qui activent aussi les notifications. Surtout, elle prend par la bande la décision « backend léger », que la roadmap laisse explicitement à arbitrer (ROADMAP l.173-174, l.605) et conditionne à une définition des responsabilités (API-001, l.333).

**Garde-fou contre la multiplication des services** (à inscrire dans la roadmap si Julien valide) : Scrollarr n'aura jamais plus de deux services satellites. Le jour où un troisième besoin serveur est validé, le notifier et les dossiers sont réunis en un seul serveur (option b). Pour que cette réunion ne coûte rien : le service Dossiers est écrit comme une bibliothèque (un gestionnaire de requêtes paramétré par les dossiers et le volume de données) plus un fichier de démarrage de quelques lignes ; l'API sous `/folders/` et la disposition de `/data` ne changeraient pas. À noter : tant que la v0.7.0 n'est pas publiée (REL-001, ROADMAP l.394), renommer une image ne gêne presque personne ; après, cela devient une migration.

*Si Julien sait déjà qu'il dira oui au backend léger*, la variante raisonnable est de nommer d'emblée le répertoire et l'image `scrollarr-server` en n'y mettant que le module Dossiers, le notifier le rejoignant plus tard. Le contenu des lots du §5 est identique.

## 4. Conception recommandée

### 4.1 Arborescence et conventions

```
/libraries/                      ← racine fixe dans le conteneur
  Scans/                         ← une bibliothèque = un montage (le nom est celui choisi dans Compose)
    Titre de la série/           ← une série = un sous-dossier direct de la bibliothèque
      cover.jpg                  ← couverture facultative
      Chapitre 001.cbz           ← un chapitre = une archive…
      Chapitre 002/              ← … ou un dossier contenant directement des images
        001.jpg
      Tome 02/Chapitre 010.cbz   ← niveaux intermédiaires tolérés (profondeur ≤ 3 sous la série)
```

| Règle | Décision |
| --- | --- |
| Périmètre autorisé | Exactement ce qui est monté sous `/libraries`. Aucun chemin configurable ailleurs, aucun chemin fourni par le client. |
| Bibliothèques | Sous-dossiers directs de `/libraries`. Une seule : pas de filtre proposé (même choix que `readers/suwayomi.js` l.173-174). |
| Titre d'une série | Le nom du dossier, tel quel (normalisé Unicode NFC, espaces de bord retirés). Aucun nettoyage : ce que l'on nomme est ce que l'on voit. La fusion avec les autres serveurs compare déjà les titres sans accents, casse ni ponctuation (`normTitle`, `app/js/net.js` l.121). |
| Chapitre | Toute archive `.cbz`/`.zip`, et tout dossier contenant **directement** au moins une image. Les dossiers intermédiaires (tomes) ne sont pas des chapitres : ils participent seulement au tri et au titre affiché. |
| Pages d'un chapitre | Toutes les images, triées naturellement sur leur chemin complet ; dans une archive, les sous-dossiers sont aplatis (même règle que la source locale de Mihon, annexe B). |
| Ordre de lecture | **Toujours le tri naturel des noms** (insensible à la casse, nombres comparés comme des nombres : `Intl.Collator` avec `numeric: true`, déjà utilisé par `app/js/api.js` l.247), après retrait des étiquettes entre crochets en tête de nom (`[Groupe] …`). L'utilisateur corrige un ordre en renommant. |
| Numéro de chapitre | Détecté dans le nom : marqueur explicite (`ch`, `chap`, `chapitre`, `chapter`, `c`, `ep`, `#`) suivi d'un nombre éventuellement décimal, sinon dernier nombre du nom hors parenthèses, crochets et titre de la série. |
| Usage du numéro | Si **tous** les chapitres de la série ont un numéro et que ces numéros sont strictement croissants dans l'ordre de lecture, ils deviennent `metadata.numberSort` (les trous et les `.5` sont conservés). Sinon `numberSort` = rang 1…n. Le nom d'origine reste le titre du chapitre. Nécessaire car l'application trie par `numberSort` à plusieurs endroits (`views/reader.js` l.11, `views/series.js` l.36). |
| Couverture de série | `cover.jpg`/`.jpeg`/`.png`/`.webp` à la racine de la série (convention Mihon, annexe B), sinon première page du premier chapitre. |
| Couverture de chapitre | En v1 : celle de la série, comme le fait le lecteur Suwayomi (`readers/suwayomi.js` l.247-248). Voir §4.7. |

Arborescences désordonnées :

| Cas | Comportement |
| --- | --- |
| Images directement dans le dossier de série, sans chapitres | Un chapitre unique portant le nom de la série |
| Images en vrac **et** chapitres dans la même série | Les images en vrac sont ignorées (hors `cover.*`), avec un avertissement |
| Archive posée à la racine d'une bibliothèque | Une série d'un seul chapitre, titrée par le nom du fichier |
| Chapitre vide, archive illisible, format non pris en charge | Ignoré, avec un avertissement |
| Au-delà de la profondeur 3, archives imbriquées | Ignoré, avec un avertissement |
| `@eaDir`, `#recycle`, fichiers et dossiers commençant par `.`, `Thumbs.db`, `__MACOSX` | Ignorés en silence (artefacts Synology, Windows, macOS) |
| Liens symboliques | Non suivis (§4.8) |
| Noms qui ne sont pas de l'UTF-8 valide | Ignorés, avec un avertissement |

Les avertissements sont journalisés et exposés par `GET /api/v1/scan` : c'est ce qui permet de comprendre pourquoi un dossier n'apparaît pas. Les heuristiques exactes (marqueurs, cas limites) seront figées par un corpus de noms réels dans les tests unitaires (question Q9).

### 4.2 Formats

| Format | v1 | Raison |
| --- | --- | --- |
| Dossier d'images | **Oui** | Lecture directe, aucun traitement. C'est ce qui distingue ce connecteur de l'option nulle. |
| CBZ / ZIP | **Oui** | Le répertoire central d'un ZIP donne la liste des entrées et leur position : on sert une page sans décompresser le reste. Décompression « deflate » fournie par Node (`node:zlib`). |
| CBR / RAR | Non | Format propriétaire. Le code d'extraction officiel est sous licence unRAR, qui interdit de s'en servir pour recréer l'algorithme de compression (clause 2, d'après SPDX) : une restriction d'usage qu'il faudrait embarquer dans l'image d'un projet MIT (statut « licence libre » non vérifié). `node-unrar-js` (enrobage MIT de ce code compilé) existe ; libarchive (`bsdtar`) lit RAR et RAR 5.0 « with some limitations ». Une archive RAR « solide », par définition, oblige de plus à décompresser ce qui précède pour atteindre une page. À réévaluer sur demande, via libarchive ; d'ici là : convertir en CBZ, ou utiliser Komga. |
| 7z / CB7 | Non | Rare pour des scans ; mêmes problèmes d'accès direct. Komga ne le prend pas en charge non plus (sa FAQ). |
| PDF | Non | Exige un moteur de rendu en images : dépendance native lourde et calcul coûteux sur un petit NAS. Licences des moteurs non vérifiées (annexe B). Komga le fait. |
| EPUB | Non | Texte recomposable : hors du propos d'un lecteur vertical d'images. |

**Types d'images.** JPEG, PNG, WebP, GIF, AVIF, servis tels quels : aucune conversion, donc pas de `fallbackUrl` (prévu par le contrat pour Komga, `views/reader.js` l.88-91). AVIF est lu par Chrome 85+, Firefox 93+, Safari iOS 16+ (base « Can I use »). Le type est déterminé par les **premiers octets** du fichier, jamais par l'extension. Exclus : SVG (peut contenir du script, voir §4.8), TIFF, BMP, JPEG XL.

**Lecture des ZIP.** Bibliothèque recommandée : `yauzl` (MIT, v3.4.0, une dépendance transitive). Vérifié dans sa documentation : elle lit le répertoire central sans parcourir les en-têtes locaux, gère ZIP64, ne décode que les méthodes 0 (stocké) et 8 (deflate), contrôle par défaut que la taille réelle d'une entrée correspond à la taille annoncée (`validateEntrySizes`), et permet une lecture par plage d'octets pour les entrées stockées. Alternative sans dépendance : un lecteur maison de 200 à 250 lignes au-dessus de `node:zlib` (question Q8).

**Limites par archive** (valeurs de départ, réglables par variables d'environnement) : 5 000 entrées ; répertoire central ≤ 8 Mo ; entrée décompressée ≤ 64 Mo, avec arrêt du flux dès que la taille annoncée est dépassée ; entrées chiffrées, multi-volumes ou compressées autrement que 0/8 refusées (le chapitre est signalé comme non pris en charge). Tout est lu **en flux** : la mémoire par requête est de l'ordre de la taille d'un tampon, quelle que soit la taille de l'archive. Quelques archives restent ouvertes dans un petit cache (8 par défaut) pour ne pas relire le répertoire central à chaque page.

### 4.3 API HTTP du service

Chemins vus par le service ; l'application y accède sous `/folders/…`. Les objets renvoyés sont déjà au modèle commun de l'application, celui de Komga (README l.189) : le module lecteur ne transforme rien.

| Méthode et chemin | Réponse |
| --- | --- |
| `GET /health` | `{ ok, version, series, books, scanning }` — contrôle de santé Docker |
| `GET /api/v1/session` | `{ name }`, ou 401 en mode mot de passe sans session |
| `POST /api/v1/login`, `POST /api/v1/logout` | Mode mot de passe uniquement |
| `GET /api/v1/libraries` | `[{ id, name }]` |
| `GET /api/v1/series?library=&status=&search=&sort=&page=&size=` | `{ content, last }` |
| `GET /api/v1/series/new?size=`, `/series/updated?size=` | `{ content }` |
| `GET /api/v1/series/{sid}`, `/series/{sid}/books` | Série ; chapitres dans l'ordre de lecture |
| `GET /api/v1/books/latest`, `/ondeck`, `/inprogress`, `/recent` (`?size=`) | `{ content }` |
| `GET /api/v1/books/{bid}`, `/books/{bid}/next`, `/previous` | Chapitre (404 s'il n'y a pas de voisin) |
| `GET /api/v1/books/{bid}/pages` | `[{ number, mediaType, width?, height? }]` |
| **`GET /api/v1/books/{bid}/pages/{n}`** | L'image (ETag, `Cache-Control: private`) |
| **`GET /api/v1/series/{sid}/thumbnail`**, `/books/{bid}/thumbnail` | L'image de couverture |
| `PATCH` / `DELETE /api/v1/books/{bid}/progress` | Enregistrer `{ page, completed }` / remettre à non lu |
| `PUT` / `DELETE /api/v1/series/{sid}/progress` | Tout marquer lu / non lu |
| `GET /api/v1/settings?prefix=`, `PATCH /api/v1/settings`, `DELETE /api/v1/settings` | Stockage clé-valeur |
| `GET /api/v1/scan`, `POST /api/v1/scan` | État et avertissements du dernier parcours ; demander un parcours |

**Compatibilité avec `app/sw.js`.** Les deux expressions qui reconnaissent les pages et les couvertures (l.44-45) acceptent déjà `…/api/v1/books/<id>/pages/<n>` et `…/api/v1/(books|series)/<id>/thumbnail` : les chemins en gras ci-dessus ont été choisis pour cela. Changements exacts dans `sw.js` :

1. l.13 : ajouter `'folders/'` à la liste `SERVERS` ;
2. l.23 : ajouter `'js/connectors/readers/folders.js'` à `SHELL_FILES` ;
3. l.6 : passer `SHELL` à `scrollarr-shell-v12` (l'historique Git montre une incrémentation à chaque changement de la coquille).

Rien d'autre. Les téléchargements hors ligne fonctionnent sans modification : `downloads.js` met en cache l'URL de chaque page (l.80-86) et le service worker la ressert en ignorant la chaîne de requête (l.64-67) ; il ne faut donc **rien mettre de discriminant dans la chaîne de requête** d'une page. Une URL de page reste stable tant que le chapitre ne change pas de chemin.

**Cache HTTP.** Pages et couvertures portent un `ETag` (taille, date de modification et, pour une entrée ZIP, son CRC déjà présent dans le répertoire central) et répondent 304. C'est important pour les couvertures : le service worker les redemande en arrière-plan à chaque affichage (`sw.js` l.70-80) ; un `max-age` d'un jour laisse le cache du navigateur répondre sans réveiller le NAS.

### 4.4 Correspondance avec `reader-contract.js`

Membres toujours exigés (`reader-contract.js` l.7-15) :

| Membre | Comment il est satisfait |
| --- | --- |
| `id`, `code`, `label` | `'folders'`, `'f'` (une lettre minuscule, l.32 ; `s` et `k` sont pris), `'Dossiers'`. Le libellé est affiché tel quel (`views/login.js` l.31, `views/more.js` l.39) : le passer par `t()` pour l'interface anglaise. |
| `userLabel` | `'Identifiant'`. Sans objet en mode sans authentification, mais exigé non nul. |
| `capabilities` | Les sept capacités de lecteur (voir plus bas). |
| `session()` | `GET /session`. Hors ligne : même repli que Komga sur la dernière session connue (`readers/komga.js` l.45-49), pour que les chapitres téléchargés s'ouvrent. 401 → `AuthError`, donc carte de connexion. |
| `login()`, `logout()` | Mode mot de passe : `POST /login`, `POST /logout`. Mode sans authentification : `login` n'est jamais appelé (l'état `auth` ne se produit pas) et refuse ; `logout` peut l'être par une déconnexion générale (`api.js` l.130-137) et ne fait rien. |
| `libraries()` | `GET /libraries` ; liste vide s'il n'y a qu'une bibliothèque. |
| `genres()` | `[]` : aucune métadonnée en v1. La façade réunit déjà les genres des autres serveurs (`api.js` l.240-243). |
| `seriesList(…)` | `GET /series` ; tri, recherche (même normalisation que `normTitle`), filtre par état de lecture et pagination côté service. Un filtre par genre renvoie une liste vide. |
| `seriesNew`, `seriesUpdated`, `series`, `seriesBooks` | Routes homonymes. `created` et `lastModified` reposent sur la date de première observation (§4.7). |
| `booksLatest`, `booksOnDeck`, `booksInProgress`, `booksRecentlyRead` | Routes homonymes. « À suivre » : même règle que le lecteur Suwayomi (`readers/suwayomi.js` l.210-227). |
| `book`, `nextBook`, `previousBook` | Routes homonymes ; 404 → `null` comme `readers/komga.js` l.25-28. |
| `bookPages` | `GET /books/{id}/pages`, puis `url` = chemin de la page. `mediaType` commence par `image/` (exigé par `downloads.js` l.74). `width`/`height` quand ils sont connus (lot 6) ; sinon la hauteur s'ajuste à l'arrivée de l'image, comme pour Suwayomi (`views/reader.js` l.64). |
| `seriesThumb`, `bookThumb` | Constructeurs d'URL synchrones. En v1, `bookThumb` renvoie l'URL de la couverture de la série, déduite de l'identifiant du chapitre (§4.6). |

Capacités (`contract.js` l.15-24) :

| Capacité | v1 | Remarque |
| --- | --- | --- |
| `series.list`, `chapter.list`, `chapter.read` | Oui | |
| `series.search` | Oui | Recherche sur le titre uniquement |
| `chapter.progress.read`, `chapter.progress.write` | Oui | `saveProgress`, `markBookRead/Unread`, `markSeriesRead/Unread` (l.17) |
| `settings.store` | Oui | `getSettings`, `setSetting`, `deleteSettings` (l.18) |

**Pourquoi tout déclarer.** La façade ne sait pas, aujourd'hui, se passer de `chapter.progress.write` : `api.saveProgress` appelle `c.saveProgress` sans vérifier la capacité (`api.js` l.333-334), de même que les actions « marquer comme lu » (l.356-367), que `views/series.js` l.167-177 affiche toujours. `api.can()` existe (l.86) mais aucune vue ne l'appelle. Seule `settings.store` est réellement honorée : les serveurs qui ne l'ont pas sont écartés (l.501-509), et s'il n'en reste aucun, `saveDoc` échoue avec « Serveur non disponible » (l.520-522). Conséquences pour un lecteur qui ne déclarerait pas `settings.store` : s'il est le seul serveur actif, les abonnements restent sur l'appareil sans message (`store.js` l.62-79) et l'enregistrement de la liste des profils échoue (`profiles.js` l.37-40) ; dans tous les cas, la progression d'un profil secondaire sur ses séries ne quitte jamais l'appareil (`profiles.js` l.226). Déduit de la lecture du code, non exécuté.

**Membres qui ne « collent » pas à des dossiers :** `userLabel`, `login`, `logout` (pas de comptes) et `genres` (pas de métadonnées). Tous se satisfont par une valeur neutre. **Aucun changement de contrat n'est nécessaire.** Le seul ajout envisageable plus tard est la capacité `library.scan`, déjà prévue par la roadmap (l.256), pour un bouton « Rescanner » dans *Réglages > Serveurs*.

### 4.5 Progression et état

**Principe.** Pour l'application, le service Dossiers se comporte comme Komga : il tient l'historique du profil principal et offre un stockage clé-valeur. Les règles existantes s'appliquent telles quelles.

| Donnée | Dossiers seul | Dossiers + Suwayomi et/ou Komga |
| --- | --- | --- |
| Progression du profil principal | Dans le service (`saveProgress`). La file hors ligne de la façade (`api.js` l.315-354) fonctionne sans changement. | Inchangé : chaque serveur garde la progression de ses propres chapitres (README l.45). |
| Liste des profils, abonnements | Dans le stockage clé-valeur du service. | Écrits sur **tous** les serveurs qui ont `settings.store` (`api.js` l.546-547), lus sur le premier qui répond en commençant par le serveur prioritaire (l.541-545). Le service devient une copie de plus. |
| Progression d'un profil secondaire | Documents `scrollarr.p.<profil>.idx` et `.s.<série>` dans le stockage du service. | Ces documents vont sur **le serveur auquel la série appartient**, pas sur tous (`profiles.js` l.94 et l.226). Ceux des séries Dossiers vont donc dans le service, ceux de Komga dans Komga. |
| Conflits entre appareils | Dernière écriture gagnante pour le profil principal (comme Komga et Suwayomi) ; fusion par révision pour les profils secondaires et les abonnements (`sync.js`), sans rien changer. | Idem |

Le stockage clé-valeur du service est **global à l'installation**, comme les « meta » de Suwayomi et à la différence des réglages par utilisateur de Komga : c'est cohérent avec des profils qui ne sont pas des comptes (README l.57), mais voir le risque R6.

**Alternative écartée : service sans état.** Ne déclarer ni progression ni stockage supprimerait tous les points d'écriture, mais la progression ne suivrait plus l'utilisateur d'un appareil à l'autre, ce qui est la promesse centrale du produit, et il faudrait d'abord corriger la façade (voir §4.4).

**Sur disque.** Le volume `/data` est distinct des bibliothèques et seul inscriptible :

| Emplacement | Contenu | À sauvegarder |
| --- | --- | --- |
| `/data/state/progress/<série>.json` | Progression du profil principal : `{ idChapitre: [page, terminé, date] }`, un fichier par série | Oui |
| `/data/state/kv/<empreinte>.json` | Un fichier par clé, nommé par l'empreinte de la clé (jamais par la clé), contenant la clé et la valeur | Oui |
| `/data/state/seen.json` | Date de première observation de chaque chapitre (§4.7) | Oui |
| `/data/state/secret.key` | Clé de signature des sessions, créée au premier démarrage (comme les clés VAPID du notifier, `notifier/server.js` l.47-52) | Oui |
| `/data/cache/` | Index des dossiers et des archives, plus tard les miniatures | Non, se reconstruit |

- **Écritures atomiques** : fichier temporaire puis renommage, comme `notifier/server.js` l.40-44, avec synchronisation sur disque avant le renommage. Une seule écriture à la fois par fichier.
- **Regroupement** : la progression est tenue en mémoire et écrite au plus toutes les quelques secondes, puis à l'arrêt (`SIGTERM`). Perte maximale en cas de coupure : quelques secondes de lecture.
- **Bornes** : clé conforme au format déjà produit par la façade (minuscules, chiffres, points, tirets ; 200 caractères), valeur ≤ 16 Ko (la façade découpe déjà à 3 500 caractères, `api.js` l.484-489), nombre de clés et taille totale plafonnés.
- **Jamais de purge automatique** : une bibliothèque momentanément absente (volume non monté, dossier chiffré verrouillé) ressemble à un dossier vide. Le service garde alors l'index précédent marqué « indisponible » et ne touche ni à la progression ni aux dates.
- **Sauvegarde** : copier `./data/folders/state`. Restauration : le remettre en place, service arrêté.
- **Pourquoi pas SQLite** : la roadmap l'envisage « en première intention si backend nécessaire » (l.174). Le module intégré `node:sqlite` est encore expérimental en Node 22 (« Stability: 1.1 – Active development », annexe B) et l'alternative est une dépendance native. Des fichiers JSON suffisent à ce volume ; l'accès au stockage est isolé dans un module pour pouvoir basculer quand DATA-001 sera tranché.

### 4.6 Identifiants

| Approche | Stable si l'on renomme ou déplace ? | Coût | Verdict |
| --- | --- | --- | --- |
| Chemin encodé (base64) | Non | Nul, mais identifiants longs et sensibles à la casse : `profiles.js` l.92 met les identifiants de série en minuscules pour former ses clés, ce qui créerait des collisions | Écarté |
| **Empreinte du chemin** | Non | Nul ; déterministe, se recalcule à l'identique même si `/data` est perdu | **v1** |
| Empreinte du contenu | Oui | Lire tout ou partie de chaque fichier au premier parcours (lent sur disques rotatifs) ; fragile pour un dossier d'images ; doublons à gérer | Écarté en v1 |
| Empreinte du chemin + reconnaissance des renommages | Oui, tant que `/data` est conservé | Table de correspondance à tenir et à tester | Lot ultérieur |

**Proposition v1.** Série : 16 chiffres hexadécimaux d'un SHA-256 de « nom de la bibliothèque + chemin relatif de la série ». Chapitre : `<idSérie>.<16 hex du chemin relatif du chapitre>`, sur le modèle `manga.chapitre` du lecteur Suwayomi (`readers/suwayomi.js` l.23, l.33). Côté application : `f:0123…cdef` et `f:0123…cdef.89ab…4567`. Minuscules et chiffres uniquement, compatibles avec les routes en fragment d'URL et avec les clés de `profiles.js`.

Conséquences à accepter :

- **Renommer ou déplacer un chapitre** crée un nouveau chapitre : progression à zéro. La copie hors ligne reste lisible depuis les téléchargements (`views/reader.js` l.12-25 se rabat sur la copie de l'appareil si le serveur refuse) mais n'est plus rattachée à la fiche de la série ; elle est à supprimer et retélécharger.
- **Renommer un dossier de série** : nouvelle série, donc progression et abonnement perdus pour cette série (l'abonnement garde le titre, `store.js` l.103).
- **Le nom côté conteneur** (`/libraries/<Nom>`) fait partie de l'identité : changer le chemin côté NAS est sans effet, renommer `<Nom>` change tous les identifiants.
- La progression d'un chapitre disparu n'est pas effacée : si le fichier revient au même chemin, elle revient.

**Doublons avec les autres serveurs.** Rien à changer : la façade masque une série dont le titre normalisé existe déjà sur un serveur plus prioritaire (`api.js` l.203-218), limite connue (README l.234). Placer `folders` **en dernier** dans `READERS` (`connectors/index.js` l.15-18), l'ordre de la liste étant la priorité par défaut : si le même dossier est aussi vu par Komga ou Suwayomi, c'est leur version, dont la progression est partagée avec leurs autres clients, qui s'affiche.

### 4.7 Parcours des dossiers, cache, couvertures, nouveautés

**Index en mémoire, à deux niveaux.**

| Niveau | Contenu | Quand | Coût |
| --- | --- | --- | --- |
| Arborescence | Bibliothèques, séries, chapitres (nom, taille, date) | Au démarrage, puis revalidation | Une lecture de répertoire par dossier ; pas d'ouverture de fichier |
| Détail d'un chapitre | Liste des pages, nombre de pages, plus tard dimensions | À la première ouverture de la série ou du chapitre | Une lecture en fin d'archive par CBZ |

Le détail est conservé dans `/data/cache` et réutilisé tant que chemin, taille et date de modification n'ont pas changé. Sans cela, lire le nombre de pages de milliers d'archives au démarrage coûterait une recherche disque par fichier, soit plusieurs minutes à froid sur des disques rotatifs (**estimation, à mesurer au lot 1 sur le NAS**). Les écrans d'accueil et de bibliothèque sont servis depuis la mémoire, sans accès disque.

**Invalidation.** La date de modification d'un dossier change quand on y ajoute, retire ou renomme une entrée directe. La revalidation relit donc seulement les dossiers dont la date a changé. Déclencheurs : démarrage ; requête de liste si la dernière vérification a plus de 60 secondes ; `POST /scan`.

**Pas de surveillance temps réel ni de parcours périodique par défaut.** `fs.watch` repose sur inotify sous Linux et la documentation de Node le dit peu fiable sur les partages réseau et sous Docker (annexe B) ; il faut de plus une surveillance par dossier, ce qui bute sur les limites du noyau avec des milliers de dossiers. Un parcours périodique peut empêcher les disques du NAS de se mettre en veille. Option `FOLDERS_SCAN_MINUTES` (0 par défaut) pour ceux qui le veulent.

**Nouveaux chapitres.** La date de fichier ne convient pas : un fichier copié garde souvent sa date d'origine. Le service note donc la **date de première observation** de chaque chapitre (`seen.json`). Au tout premier parcours d'une bibliothèque, elle est initialisée à la date du fichier pour que tout n'apparaisse pas comme nouveau. Elle alimente `created`, « nouveaux chapitres » et « mises à jour récentes ». Le badge « UP » des abonnements compare des nombres de chapitres (`store.js` l.103) et fonctionne donc sans date.

**Notifications push (lot ultérieur).** Ajouter au notifier une troisième source qui interroge `GET /api/v1/books/latest`, avec les identifiants `f:…`. Deux points : chaque interrogation déclenche une revalidation, donc un accès disque toutes les `POLL_MINUTES` ; et le notifier identifie aujourd'hui l'appelant grâce à la session d'un serveur de lecture (`notifier/server.js` l.226-233, l.256-257), ce qui n'existe pas pour une installation « dossiers seuls sans authentification ».

**Couvertures.**

| Option | Dépendance | Coût | Verdict |
| --- | --- | --- | --- |
| Servir `cover.*` ou la première page telle quelle | Aucune | Une grille de 30 séries télécharge 30 images en pleine taille ; lourd si la première page est une longue planche | **v1**, à mesurer |
| Redimensionner avec `sharp` et mettre en cache dans `/data/cache/thumbs` | Native (libvips). Binaires précompilés pour Linux x64 et arm64, glibc et musl ; Node ≥ 20.9 ; licence Apache-2.0 (annexe B) | Calcul ponctuel sur le NAS, image Docker plus lourde, décodage d'images non maîtrisées par du code natif | Lot ultérieur, en dépendance facultative |
| Redimensionnement en JavaScript pur | Aucune dépendance native | Lent et gourmand en mémoire | Écarté |

En v1, tous les chapitres d'une série partagent l'URL de la couverture de la série : la fiche d'une série de 100 chapitres ne coûte qu'une image, mise en cache une fois. Des miniatures par chapitre n'ont de sens qu'avec le redimensionnement. Seuil proposé pour déclencher le lot « miniatures » : poids médian des couvertures supérieur à 300 Ko environ sur une bibliothèque réelle.

**Dimensions des pages (lot 6).** Lire largeur et hauteur dans l'en-tête de chaque image (quelques kilo-octets, sans décodage) permet au lecteur de réserver la hauteur exacte, ce que le README présente comme un atout de Komga (l.137). `image-size` (MIT, sans dépendance, lecture d'en-têtes seulement) le fait ; son dépôt GitHub est archivé au profit d'un autre hébergement, ce qui penche pour un petit module maison limité aux cinq formats.

### 4.8 Sécurité

**Modèle de menace.** Le service est sous la **même origine** que l'application et que les proxys de Komga et Suwayomi. Tout contenu actif qu'il servirait s'exécuterait avec les sessions de ces serveurs, y compris le cookie d'identifiants Suwayomi (README l.127). Les fichiers de la bibliothèque sont des **données non fiables** : ils viennent d'Internet.

| Risque | Parade |
| --- | --- |
| Écriture dans les scans | Montage `:ro` ; aucun appel d'écriture dans le code qui touche `/libraries` (vérifié par test) ; système de fichiers du conteneur en lecture seule. **Attention** : sur un noyau antérieur à 5.12, les sous-montages d'un montage en lecture seule restent inscriptibles (documentation Docker, annexe B) : monter un dossier qui ne contient pas d'autre point de montage. Version du noyau du NAS à vérifier (R3). |
| Traversée de chemin | Structurellement impossible par l'API : le client n'envoie que des identifiants (`[0-9a-f.]`) et des numéros de page, résolus dans l'index. Aucun paramètre n'est un chemin. |
| Liens symboliques sortant de la bibliothèque | Non suivis au parcours. À l'ouverture : drapeau `O_NOFOLLOW`, puis contrôle que le chemin réel (`realpath`) reste sous la racine réelle de la bibliothèque et que le fichier ouvert est bien un fichier ordinaire. |
| « Zip-slip » | Sans objet : rien n'est jamais extrait sur disque. Un nom d'entrée ne sert qu'au tri et au filtrage par extension. |
| Bombes de décompression | Limites du §4.2, lecture en flux avec plafond d'octets, contrôle de taille de `yauzl` ; une seule entrée décompressée par requête. |
| Type de contenu trompeur, SVG, HTML | Le service ne répond qu'en `application/json` ou avec l'un des cinq types d'image, déterminé par les premiers octets ; sinon 415. Jamais de `image/svg+xml` ni de `text/html`. `X-Content-Type-Options: nosniff` et la CSP du proxy s'appliquent (`default.conf.template` l.36-38), plus `Content-Security-Policy: default-src 'none'; sandbox` et `Cross-Origin-Resource-Policy: same-origin` posés par le service (ce dernier empêche l'inclusion des images par un autre site). |
| Épuisement de ressources | Flux de pages simultanés plafonnés (8), délais par requête, corps ≤ 64 Ko, un seul parcours à la fois avec peu d'accès disque parallèles, `mem_limit` et `pids_limit` dans Compose. |
| Privilèges | Utilisateur non root (`USER node` comme `notifier/Dockerfile` l.13, surchargé par `user:`), `cap_drop: ALL`, `no-new-privileges`, aucun port publié, aucune sortie réseau nécessaire. |
| CSRF sur les écritures | Toute requête autre que GET doit porter `Content-Type: application/json` et `X-Requested-With`, que l'application envoie déjà (`net.js` l.55-59). Ces deux en-têtes imposent une pré-vérification CORS (MDN), à laquelle le service ne répond jamais favorablement. En complément : refus si `Origin` ne correspond pas à l'hôte, cookie de session `SameSite=Strict`. Ce risque existe **même sur un réseau local** : une page web quelconque ouverte sur le téléphone peut viser l'adresse du NAS. |
| Force brute sur le mot de passe | Tentatives limitées par adresse dans le service, et `limit_req` nginx sur `/folders/api/v1/login`. Pas de limitation serrée sur les pages : un chapitre en charge des dizaines d'un coup. |
| Fuite d'informations | Les réponses d'erreur ne contiennent jamais de chemin ; `/health` ne donne que des compteurs. |
| Stockage clé-valeur détourné | Bornes du §4.5 (taille par valeur, nombre de clés, taille totale). |

**Authentification.** Aujourd'hui Scrollarr n'ajoute aucune authentification : il s'appuie sur celle du serveur de lecture (`SECURITY.md` l.18). Un service de dossiers n'en a pas.

| Option | Ce qui protège | Commentaire |
| --- | --- | --- |
| Aucune, avec avertissement | Le réseau (LAN, VPN) ou le proxy placé devant | Même posture qu'un Suwayomi sans authentification (README l.126). Acceptable **uniquement** si l'instance n'est pas joignable d'Internet. |
| **Identifiant et mot de passe uniques** (`FOLDERS_USER`, `FOLDERS_PASSWORD`) | Session par cookie `HttpOnly` signé | S'insère dans le contrat existant sans rien changer : `session()` lève `AuthError`, la carte de connexion s'affiche (`views/login.js` l.41-65), et le cookie de même origine authentifie aussi les balises `<img>`, comme pour Komga. Le mot de passe vit dans `.env`, comme `SUWAYOMI_PASSWORD` pour le notifier. |
| Contrôle d'accès du proxy frontal (liste d'adresses, portail d'authentification, VPN) | Extérieur à Scrollarr | Déjà conseillé par `SECURITY.md` l.27 ; complémentaire. |
| Authentification propre à Scrollarr (AUTH-001 et suivants) | Phase 5 de la roadmap | N'existe pas encore ; le service devra s'y brancher le moment venu. |
| S'appuyer sur la session d'un autre serveur, comme le notifier | Komga ou Suwayomi | Inutilisable quand les dossiers sont le seul lecteur. |

**Recommandation : pas de valeur par défaut.** Le service **refuse de démarrer** tant que `FOLDERS_AUTH` ne vaut pas `password` (avec identifiant et mot de passe) ou `none`, ce dernier choix étant un acquittement explicite. Une bibliothèque de scans ouverte par inadvertance sur Internet est le scénario le plus coûteux de ce projet, y compris sur le plan légal pour l'utilisateur.

**Ce qui est exposé si l'instance est publiée sans authentification :** les noms de toutes les séries et de tous les chapitres, toutes les pages, l'historique de lecture et les profils en lecture **et en écriture**, et un petit espace de stockage anonyme (borné). Jamais : l'écriture ou la suppression de fichiers, ni un chemin hors de `/libraries`.

### 4.9 Tests, CI et mode développement

| Niveau | Contenu | Où |
| --- | --- | --- |
| Unitaire (Node, sans navigateur) | Corpus de noms → ordre et numéros attendus ; identifiants ; confinement (lien symbolique sortant créé pendant le test) ; archives fabriquées (tailles mensongères, entrée chiffrée, méthode inconnue, répertoire central tronqué, noms en `../`, ZIP64, zéro entrée) ; reconnaissance des types par premiers octets ; bornes du stockage ; écriture interrompue | `tests/unit_folders_*.mjs`, sur le modèle de `tests/unit_sync.mjs` |
| Contrat | `validateReader(createFolders(…))` | `tests/unit_contracts.mjs` |
| Bout en bout (Playwright) | Dossiers seuls ; dossiers + faux Komga avec un titre commun (doublon masqué) ; lecture, reprise après rechargement, marquer lu ; profil secondaire ; téléchargement puis lecture service arrêté ; service en panne sans gêner les autres serveurs (CONN-006) ; connexion en mode mot de passe | `tests/e2e_folders.py`, étapes ajoutées à `.github/workflows/ci.yml` |
| Non-régression | Les six scripts existants passent inchangés (READ-005) | CI |
| Conteneur | Construction de l'image ; démarrage avec la bibliothèque d'essai montée `:ro` et `read_only: true` ; `/health` ; lecture d'une page ; empreinte de la bibliothèque identique avant et après | Étape Docker de la CI |
| Statique | Ajouter `folders/` à la liste de `tests/check_syntax.sh` (l.7-8) | CI |

**Bibliothèque d'essai.** Générée par un script (petites images PNG et archives ZIP produites par Node, sans fichier binaire dans le dépôt), avec les cas désordonnés du §4.1.

**Mode développement.** `node folders/server.js` sur la bibliothèque d'essai, puis `FOLDERS=http://localhost:8788 SERVERS=folders node dev/mock-servers.mjs`, à l'image de la variable `NOTIFIER` (`dev/mock-servers.mjs` l.11, l.398-401). Le relais actuel met tout le corps en mémoire et ne transmet que deux en-têtes (l.364-371) : il devra relayer en flux et transmettre les en-têtes utiles. `/servers.json` du faux serveur (l.387-389) reçoit la clé `folders`.

## 5. Découpage en lots

Chaque lot est fusionnable seul. Jusqu'au lot 4, le service n'est pas référencé par l'application : aucun risque pour l'existant.

| Lot | Contenu | Taille | Vérifié en fin de lot |
| --- | --- | --- | --- |
| 0 | Validation de ce document, réponses du §6, mise à jour de la roadmap | S | Décisions écrites |
| 1 | Squelette `folders/` : configuration, refus de démarrer sans `FOLDERS_AUTH`, parcours, conventions de nommage, identifiants, routes de liste en lecture ; `Dockerfile`, service Compose, CI ; générateur de bibliothèque d'essai | M | Tests unitaires de nommage et de confinement ; test conteneur en lecture seule ; **mesures sur le NAS** : durée du parcours, mémoire, droits de lecture |
| 2 | Pages : dossiers d'images et CBZ/ZIP, reconnaissance des types, limites, cache HTTP ; couvertures telles quelles | M | Tests unitaires sur archives fabriquées ; parcours manuel avec `curl` |
| 3 | État : progression, listes dérivées (à suivre, en cours, récents, compteurs, filtre par état), stockage clé-valeur, écritures atomiques, parades CSRF | M | Tests unitaires ; arrêt brutal pendant une écriture sans fichier corrompu ; bibliothèque inchangée |
| 4 | Intégration : `readers/folders.js`, registre, nginx et `servers.json`, trois lignes de `sw.js`, libellé traduit, relais du faux serveur, `e2e_folders.py` | M | Tous les tests existants et les nouveaux ; essai sur le NAS avec les dossiers seuls puis avec les trois serveurs |
| 5 | Authentification par mot de passe, limitation des tentatives ; `README`, `README.fr.md`, `SECURITY.md` | M | Parcours de connexion de bout en bout ; cookie absent = 401 sur pages et API. **Condition de publication d'une version** |
| 6 | Dimensions des pages | S | Reprise de lecture précise sur un long chapitre |
| 7 | Miniatures redimensionnées (dépendance facultative) et cache | M | Poids d'une grille de bibliothèque avant et après ; image construite pour `amd64` et `arm64` |
| 8 | Source `folders` dans le notifier ; parcours périodique facultatif | S | Arrivée d'un chapitre détectée en mode simulé (`PUSH_DRY_RUN`) |

**Volontairement laissé pour plus tard :** tolérance aux renommages ; CBR via libarchive ; métadonnées (`ComicInfo.xml`, `details.json`) ; capacité `library.scan` et bouton « Rescanner » ; avertissements de parcours visibles dans les réglages ; SQLite ; réunion avec le notifier dans un serveur unique ; comptes et droits par bibliothèque.

**Complément utile, indépendant de READ-002 (S) :** faire respecter `chapter.progress.write` par la façade et les vues (§4.4), pour que CONN-002 soit vrai aussi pour un futur lecteur en lecture seule (OPDS, par exemple).

## 6. Risques et questions ouvertes

### Risques

| N° | Risque | Réponse |
| --- | --- | --- |
| R1 | Glissement de périmètre vers « un Komga en moins bien » (CBR, PDF, métadonnées) | Tenir le périmètre du §2 ; renvoyer vers Komga pour le reste |
| R2 | Couvertures trop lourdes sans redimensionnement | Mesurer au lot 2 ; lot 7 si le seuil du §4.7 est dépassé |
| R3 | Lecture seule non récursive sur un noyau ancien | Vérifier `uname -r` et `docker version` sur le NAS ; monter un dossier sans sous-montage |
| R4 | Droits de lecture sur un dossier partagé Synology (identifiants d'utilisateur, ACL) | Essai réel au lot 1 ; documenter `user:` |
| R5 | Renommages qui font perdre la progression | Documenté ; lot ultérieur si la gêne est réelle |
| R6 | Stockage clé-valeur global : avec plusieurs comptes Komga, un nouvel utilisateur peut hériter d'abonnements lus dans la copie du service. Existe déjà avec les « meta » de Suwayomi | Documenter ; à traiter avec le modèle de comptes (ROADMAP l.594) |
| R7 | Parcours lent ou réveil des disques | Index à deux niveaux, pas de parcours périodique par défaut, mesures au lot 1 |
| R8 | Analyse de fichiers non fiables | Aucune dépendance native en v1, limites, flux, conteneur durci |

### Questions pour Julien

| N° | Question | Réponse recommandée |
| --- | --- | --- |
| Q1 | Fait-on le connecteur, sachant que « pointer Komga sur le dossier » marche déjà pour qui a Komga ? | Oui, si l'objectif est que Scrollarr soit utilisable seul et lise les dossiers d'images ; sinon fermer READ-002 |
| Q2 | Service dédié (a) ou serveur unique (b) dès maintenant ? | (a), avec la règle « jamais plus de deux services satellites » |
| Q3 | Nom du répertoire et de l'image : `folders` / `scrollarr-folders`, ou `server` / `scrollarr-server` ? | `scrollarr-folders`, sauf si le backend léger est déjà acquis |
| Q4 | Le service garde-t-il la progression et les profils dans `./data/folders` ? | Oui |
| Q5 | Formats v1 limités aux dossiers d'images et aux CBZ/ZIP ? | Oui |
| Q6 | L'instance est-elle, ou sera-t-elle, joignable depuis Internet ? | Si oui : le lot 5 passe avant toute mise en service réelle |
| Q7 | Accepter qu'un renommage fasse repartir la progression à zéro en v1 ? | Oui |
| Q8 | Lecture ZIP : `yauzl` (une dépendance éprouvée) ou lecteur maison sans dépendance ? | `yauzl`, version verrouillée |
| Q9 | Peux-tu fournir la liste des noms de dossiers et de fichiers d'une bibliothèque réelle (noms seuls, anonymisés au besoin) ? | Oui : elle devient le corpus de tests du nommage |
| Q10 | Ordre de grandeur de la bibliothèque (séries, chapitres) et part de dossiers d'images par rapport aux CBZ ? | Sert à fixer les limites et à décider du lot 7 |
| Q11 | Le service doit-il lire le dossier de téléchargement de Suwayomi, déjà vu par Suwayomi et Komga ? | Non par défaut : cela ne produit que des doublons masqués. Le viser sur des dossiers que les autres ne voient pas |
| Q12 | Place de `folders` dans la priorité par défaut des serveurs ? | Dernier |
| Q13 | Couvertures non redimensionnées en v1 ? | Oui, avec mesure au lot 2 |
| Q14 | Les notifications push pour les dossiers font-elles partie de la première version publiée ? | Non (lot 8) |

## Annexe A — Constats annexes sur le code actuel

Relevés en préparant cette étude ; sans rapport direct avec la décision, mais utiles.

1. **`chapter.progress.write` n'est pas vérifiée** par la façade ni par les vues (`api.js` l.333-334, l.356-367 ; `views/series.js` l.167-177) ; `api.can` (l.86) n'a aucun appelant. Le test `tests/unit_contracts.mjs` l.13 accepte pourtant un lecteur qui ne la déclare pas.
2. **`/servers.json` ne reçoit pas les en-têtes de sécurité** : son `location` définit son propre `add_header` (`default.conf.template` l.53), ce qui annule l'héritage de ceux des lignes 36-38 selon la règle documentée par nginx. Sans gravité pour un JSON statique.
3. **`notifier/Dockerfile` installe sans fichier de verrouillage** (l.7-8) : les versions des dépendances ne sont pas reproductibles d'une construction à l'autre.
4. **La progression d'un profil secondaire est écrite sur le serveur propriétaire de la série**, pas sur tous les serveurs (`profiles.js` l.226) ; seuls la liste des profils et les abonnements sont répliqués partout (`api.js` l.546-547).

## Annexe B — Sources et points non vérifiés

**Vérifié dans la documentation (novembre 2026) :**

| Sujet | Source |
| --- | --- |
| `yauzl` : licence MIT, v3.4.0, dépendance `pend`, répertoire central, méthodes 0 et 8, ZIP64, `validateEntrySizes` activé par défaut, lecture par plage des entrées stockées | README et `package.json` du dépôt GitHub du projet yauzl |
| Licence unRAR, clause 2 | Liste des licences SPDX, entrée « UnRAR License » |
| `node-unrar-js` : enrobage MIT du code unrar officiel compilé | README du dépôt GitHub du projet node-unrar-js |
| libarchive : lecture RAR et RAR 5.0 « with some limitations », 7-Zip, programme `bsdtar` | README du dépôt GitHub du projet libarchive |
| Komga : formats CBZ, CBR, EPUB, PDF ; 7z non pris en charge ; processus Java limité « usually 1gb » par défaut ; `/config` sur disque local | Documentation de Komga : pages *Introduction*, *FAQ*, *Installation > Docker* |
| Source locale de Mihon : série/chapitre, dossiers ou ZIP/CBZ, RAR/CBR, EPUB ; dossiers internes d'une archive ignorés ; `cover.jpg` ; `details.json` | Documentation de Mihon : guides *Local source* et *Advanced* |
| Suwayomi : réglage `server.localSourcePath` | Wiki du dépôt de Suwayomi-Server, page *Configuring Suwayomi-Server* |
| `sharp` : Apache-2.0 ; binaires précompilés Linux x64/arm64 glibc et musl ; Node-API v9 (Node ≥ 20.9) | README du dépôt GitHub de sharp ; page *Installation* de sa documentation |
| `image-size` : MIT, sans dépendance, lit les en-têtes seulement ; dépôt GitHub archivé | README du dépôt GitHub du projet image-size |
| nginx : `autoindex_format json` (depuis 1.7.9) ; règle d'héritage de `add_header` ; paquets de modules dynamiques (`image-filter`, `njs`…) | Documentation de nginx : `ngx_http_autoindex_module`, `ngx_http_headers_module`, *Linux packages* ; `Dockerfile` Alpine du dépôt de l'image Docker officielle de nginx (branche principale) |
| Docker : sous-montages d'un montage en lecture seule inscriptibles avant le noyau 5.12 ; lecture seule récursive par défaut depuis Engine 25.0 sur noyau ≥ 5.12 | Documentation de Docker : *Bind mounts*, notes de version *Engine 25.0* |
| Compose : profils, variable `COMPOSE_PROFILES` (surchargeable par `.env`) | Documentation de Docker Compose : *Using profiles with Compose*, *Pre-defined environment variables* |
| Node 22 : `node:sqlite` « Stability: 1.1 – Active development », ajouté en 22.5.0, sans drapeau depuis 22.13.0 mais toujours expérimental ; `fs.watch` récursif sous Linux depuis 19.1.0, fondé sur inotify, peu fiable sur NFS/SMB et sous Docker | Documentation de Node.js 22 : `doc/api/sqlite.md` et `doc/api/fs.md`, branche `v22.x` du dépôt officiel |
| AVIF : Chrome 85, Firefox 93, Safari iOS 16.0, Safari macOS 16.4 | Base « Can I use », entrée AVIF |
| CORS : types de contenu « simples » ; un en-tête personnalisé ou `application/json` impose une pré-vérification. `Cross-Origin-Resource-Policy: same-origin` | MDN : *CORS*, *Cross-Origin-Resource-Policy* |

**Vérifié localement (Node 22.23) :** `fs.constants.O_NOFOLLOW` existe ; `Intl.Collator` avec `numeric: true` trie `ch1 < Ch1.5 < ch2 < ch10` ; il place `[A] 002` avant `[B] 001`, d'où le retrait des étiquettes entre crochets au §4.1.

**Non vérifié — à ne pas tenir pour acquis :**

- Komga et les dossiers d'images en vrac : absents de la liste de formats de sa documentation, non confirmé par un essai. Limites de Komga sur RAR5 ou les archives solides : non retrouvées dans sa documentation.
- Formats acceptés par la source locale de **Suwayomi** (seule celle de Mihon a été lue) et structure de son dossier de téléchargement.
- Licences et contraintes des moteurs de rendu PDF (MuPDF, Poppler, PDF.js côté serveur).
- Présence du module WebDAV dans l'image nginx officielle ; liste des modules pour la version 1.27 précisément (le `Dockerfile` consulté est celui de la branche principale).
- Synology : version du moteur Docker et du noyau, prise en charge des profils Compose par l'interface Container Manager, comportement des ACL pour un utilisateur de conteneur, limites inotify, origine exacte des dossiers `@eaDir` et `#recycle` (constatés dans de nombreux fils de forum, pas dans une documentation officielle).
- Empreinte mémoire du service et durées de parcours sur disques rotatifs : estimations, à mesurer au lot 1.
- Poids d'installation de `sharp` et son impact sur la taille de l'image.
- Comportement du lecteur quand un chapitre téléchargé a changé d'identifiant : déduit de la lecture de `views/reader.js` l.12-25, non exécuté.
