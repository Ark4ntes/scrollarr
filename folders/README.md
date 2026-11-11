# scrollarr-folders

Petit service Node qui lit des dossiers de scans montés **en lecture seule** : dossiers d'images et archives CBZ/ZIP. Il n'écrit jamais dans les scans, ne reçoit jamais de chemin de la part du client (seulement des identifiants opaques) et n'extrait rien sur disque. Étude d'architecture : `docs/design/READ-002-connecteur-dossiers.md` (les renvois `§` ci-dessous y pointent). Installation, variables d'environnement et sécurité : `README.md` à la racine du dépôt.

Ce document décrit ce que fait le service quand il **lit les contenus** et comment il **détecte les changements** dans les dossiers.

## Routes de lecture

Chemins vus par le service ; l'application y accède sous `/folders/…`. Toutes exigent une session en mode `password`.

| Route | Réponse |
| --- | --- |
| `GET /api/v1/books/{bid}/pages` | `[{ number, mediaType }]`, numéros à partir de 1. `mediaType` est **indicatif** : il vient de l'extension, car la liste ne lit aucun contenu. |
| `GET /api/v1/books/{bid}/pages/{n}` | L'image, telle quelle. Son `Content-Type` vient des premiers octets du fichier. |
| `GET /api/v1/series/{sid}/thumbnail` | La couverture de la série, telle quelle. |
| `GET /api/v1/books/{bid}/thumbnail` | La même image : un chapitre n'a pas de couverture propre. |

Les formes d'URL sont celles que reconnaissent déjà les expressions de `app/sw.js` (pages et couvertures). Un numéro de page hors de `1…N`, mal formé, ou un identifiant inconnu donne 404 sans rien révéler du disque.

**Pages.** Un chapitre est un dossier d'images ou une archive. Les pages sont toutes les images, en tri naturel sur leur chemin (`2.png` avant `10.png` ; dans une archive, les sous-dossiers sont aplatis). Sont ignorés en silence : les noms commençant par `.`, `@eaDir`, `#recycle`, `Thumbs.db`, `__MACOSX` (à n'importe quel niveau d'une archive), et tout ce qui n'est pas une image par son extension. Un dossier-chapitre ne contient que ses images directes ; si le chapitre est le dossier de la série lui-même, `cover.*` n'est pas une page.

**Nombre de pages d'une archive.** Il n'est connu qu'après la première ouverture de l'archive (liste des pages ou lecture d'une page) : `media.pagesCount` vaut `null` jusqu'alors, puis le nombre est mémorisé tant que la taille et la date de l'archive ne changent pas. Un dossier d'images donne son nombre dès le parcours. Le calcul lit le répertoire central de l'archive, jamais le contenu des entrées.

**Couverture.** `cover.jpg`, `.jpeg`, `.png` ou `.webp` à la racine du dossier de la série (le premier dans l'ordre naturel s'il y en a plusieurs) ; sinon la première page du premier chapitre. Rien n'est redimensionné : le poids est celui de l'image d'origine (à mesurer, procédure `docs/qa/READ-002-B4-essais-nas.md`). Un `cover.*` qui n'est pas une image donne 415 : il n'y a pas de repli.

## Types et limites

Le type est décidé par les **premiers octets** (64 au plus) : JPEG, PNG, WebP, GIF, AVIF. Tout le reste (SVG, HTML, texte, exécutable, fichier vide) est refusé en **415**, quel que soit le nom du fichier. Chaque réponse porte `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox` et `Cross-Origin-Resource-Policy: same-origin`.

| Limite | Valeur | Contrôlée | Réponse |
| --- | --- | --- | --- |
| Entrées du répertoire central | 5 000 | avant de lire la moindre entrée (ZIP64 compris) | 422 `archive exceeds the reading limits` |
| Taille cumulée du répertoire central | 8 Mio | pendant sa lecture | 422 idem |
| Longueur d'un nom | 1 024 octets | à la lecture du répertoire | 422 idem |
| Profondeur de dossiers dans l'archive | 8 | idem | 422 idem |
| Image (entrée d'archive ou fichier d'un dossier) | 64 Mio | avant d'envoyer le premier octet | 413 `image too large` |
| Taux de compression d'une entrée | 200 (au-delà de 1 Mio décompressé) | avant de lire l'entrée | 413 `image compression ratio too high` |
| Taille réelle d'une entrée | celle du répertoire central | pendant la lecture : le flux s'arrête au-delà, et une entrée plus courte que prévu fait échouer la réponse | 422 si l'erreur survient avant le premier octet ; sinon la connexion est coupée (corps plus court que `Content-Length`) |
| Archives gardées ouvertes | 16 (les plus récemment utilisées) | | |
| Client qui ne lit plus | 60 s d'inactivité | | connexion fermée |

Une seule entrée est lue par requête. La mémoire par requête ne dépend ni de la taille de l'archive ni de celle de l'image : le fichier est lu par blocs, au rythme du client.

**Archives refusées** (422, message sans chemin) :

| Cas | Message |
| --- | --- |
| Pas un ZIP, nom d'entrée dangereux (`..`, chemin absolu, lettre de lecteur, `\` qui remonte), deux entrées de même nom, octet nul dans un nom, tailles qui se contredisent | `archive invalid` |
| Fin d'archive introuvable (téléchargement coupé), répertoire central amputé, données au-delà de la fin du fichier | `archive truncated or corrupt` |
| Une image est chiffrée (chiffrement classique, fort ou AES) | `archive encrypted` |
| Une image utilise une compression autre que stockée ou deflate, ou l'archive est multi-volume | `archive uses an unsupported feature (compression method or multi-volume)` |
| Limites du répertoire (tableau ci-dessus) | `archive exceeds the reading limits` |

Une entrée chiffrée ou compressée autrement n'est un problème que si c'est une **image** : une note texte chiffrée est ignorée comme tout fichier non image. Un nom dangereux, au contraire, fait refuser toute l'archive : une archive de lecture n'en contient jamais. Rien n'est extrait, donc la traversée de chemin est sans objet ; le refus sert à ne pas lire une archive truffée. Une archive refusée reste refusée jusqu'à ce que le fichier change.

## Invalidation (§4.8)

**Principe : relister ce que l'on affiche, vérifier ce que l'on sert.** Aucune décision ne repose sur la date de modification d'un dossier parent, qui ne change pas quand on modifie un fichier en profondeur. Il n'y a **aucun cache sur disque** : l'index vit en mémoire et se reconstruit au démarrage (ce qui est écrit dans `/data` : la clé des sessions et l'indicateur « cette bibliothèque a déjà contenu des séries »).

| Quoi | Quand c'est vérifié | Comment |
| --- | --- | --- |
| Liste des séries d'une bibliothèque | À chaque demande de liste si la dernière lecture a plus de 60 s | Relecture du dossier racine : ajouts, suppressions et renommages de séries sont vus exactement |
| Chapitres d'une série | À l'ouverture de la fiche ou d'un chapitre si la dernière lecture a plus de 30 s | Relecture de **tout** le sous-arbre de la série (3 niveaux sous la série) : une modification profonde est vue, quelle que soit la date des dossiers |
| Pages d'un chapitre-dossier | À chaque demande de la liste ou d'une page | Relecture du dossier |
| Archive (liste des pages gardée en mémoire) | **À chaque requête** qui la touche | Un `lstat` ; la liste est jetée (et le fichier rouvert) si l'un de ces quatre éléments a changé : numéro d'inode, taille, date de modification, date de changement d'état (`ctime`) |
| Image servie | À chaque requête | `ETag` calculé sur les mêmes quatre éléments (plus, pour une entrée d'archive, sa position, son CRC et son nom) ; `Cache-Control: private, no-cache`, donc revalidation à chaque affichage et réponse 304 sans corps si rien n'a changé. `Last-Modified` et `If-Modified-Since` fonctionnent aussi ; `If-None-Match` l'emporte. Pas de requêtes `Range` : l'image est toujours envoyée entière. |
| Tout | Au démarrage ; sur `POST /api/v1/scan` ; en arrière-plan quand quelqu'un ouvre la bibliothèque et que le dernier parcours complet a plus de `FOLDERS_RESCAN_MINUTES` (15 par défaut, 0 = jamais) | Parcours complet ; le nouvel index remplace l'ancien d'un coup (l'ancien répond pendant ce temps) ; **toutes les listes d'archives sont jetées** |

**Pourquoi quatre éléments.** Un fichier remplacé par un autre de même taille dont on a restauré la date échappe à « taille + date ». Il n'échappe pas au quadruplet : un remplacement crée un nouvel inode, et une réécriture sur place change `ctime`, que les outils courants (`cp -p`, `rsync -t`, `touch -r`) ne restaurent pas. Conséquence voulue : un simple changement de droits (`chmod`) change aussi `ctime`, donc l'archive est relue et l'`ETag` change ; le coût est une relecture du répertoire central.

**Limite assumée.** Sur un partage réseau monté par le NAS puis transmis au conteneur, l'inode et `ctime` peuvent ne pas se comporter ainsi (non vérifié, à mesurer à l'étape B4). Le recours est un parcours complet (`POST /api/v1/scan`) ou un redémarrage.

### Ce qui se passe, événement par événement

| Événement | Ce qui se passe |
| --- | --- |
| Chapitre ou série ajouté | Visible à la prochaine relecture du niveau concerné (60 s ou 30 s au plus) |
| Supprimé | 404 à la prochaine relecture. La progression (étape C) est gardée : l'identifiant redevient valide si le fichier revient au même chemin |
| Renommé ou déplacé | L'ancien identifiant disparaît (404), un nouveau apparaît : progression à zéro |
| Fichier remplacé | Détecté à la requête suivante, sans attendre aucun délai ; les pages changent d'`ETag`. Une copie hors ligne reste l'ancienne version |
| Fichier disparu entre la liste et l'ouverture | 404, et la série concernée est relue immédiatement (chapitre, page ou couverture) |
| Compteur de chapitres dans la grille | Peut dater du dernier parcours complet ou de la dernière ouverture de la série. Seule approximation acceptée |
| Bibliothèque illisible, ou **vide alors qu'elle a déjà contenu des séries** | État « indisponible » : **503** (listes, séries, chapitres, pages, couvertures), jamais 404, jusqu'à ce qu'elle redevienne lisible ou qu'un `POST /api/v1/scan` confirme qu'elle est vraiment vide. Une erreur d'entrée-sortie sur un fichier isolé donne aussi 503 |

Un 404 sur une série fait supprimer l'abonnement correspondant dans l'application ; un 503 est traité comme un serveur injoignable : abonnements et copies hors ligne sont conservés. C'est pourquoi un volume non monté ou un dossier chiffré verrouillé, qui ressemblent à un dossier vide, ne doivent jamais répondre 404.

Pas de surveillance temps réel (`fs.watch` est peu fiable sur les partages réseau et sous Docker) ni de parcours périodique (il peut empêcher les disques de se mettre en veille).

## Lecture de fichiers : garde-fous

- **Ouverture** en lecture seule avec `O_NOFOLLOW`, après confinement du chemin réel sous la racine de la bibliothèque (`ids.js` est le seul module qui connaît à la fois identifiants et chemins). Un lien symbolique n'est jamais suivi.
- **Aucune écriture** : ni extraction, ni fichier temporaire, ni cache. Le test `tests/unit_folders_library.mjs` vérifie statiquement qu'aucun module qui touche les bibliothèques n'appelle de fonction d'écriture et que le seul point d'ouverture de fichier est en lecture seule ; `tests/integration_folders_pages.mjs` vérifie que `/data` et le dossier temporaire sont inchangés après une lecture complète.
- **Dépendance unique** : [`yauzl`](https://github.com/thejoshwolfe/yauzl) 3.4.0 (MIT, avec `pend`), version exacte verrouillée par `package-lock.json`, installée avec `npm ci`. Elle lit le répertoire central sans parcourir les fichiers, gère ZIP64, ne décompresse que les méthodes 0 et 8, et vérifie que la taille réelle d'une entrée est celle qui est annoncée. Ce qu'elle ne fait **pas** (donc fait ici) : refuser les entrées chiffrées au listage (seul le chiffrement fort l'est), signaler une méthode inconnue avant l'ouverture de l'entrée, vérifier les CRC, détecter les doublons, limiter le nombre d'entrées. Mettre à jour : changer la version dans `package.json`, `npm install --save-exact`, relancer toutes les suites.

## Développement

```sh
cd folders && npm ci
node ../dev/make-folders-fixture.mjs /tmp/folders-demo
FOLDERS_AUTH=none FOLDERS_LIBRARIES_DIR=/tmp/folders-demo/libraries FOLDERS_DATA_DIR=/tmp/folders-demo/data node server.js
```

Tests : voir `tests/README.md` (`unit_folders_*.mjs`, `integration_folders*.mjs`, `container_folders.sh`).
