# READ-002 — Connecteur « Dossiers » : étude d'architecture

> Document de cadrage, **sans code applicatif**. Version 2, rédigée le 11 novembre 2026 sur la base du dépôt en version 0.7.0.
> Les références `fichier l.N` renvoient au dépôt tel qu'il est sur `main`. Les affirmations sur des logiciels tiers sont sourcées en annexe B ; ce qui n'a pas pu être vérifié y est listé explicitement.

**Révision 2 — ce qui change par rapport à la version 1, et pourquoi.** La revue du propriétaire valide le principe et le service indépendant `scrollarr-folders`, mais demande une révision avant tout développement.

- **V1 réduite au parcours de lecture** (bibliothèque → série → chapitre → lecture → progression → reprise). Miniatures, notifications, nouveautés, métadonnées, cache d'index sur disque sortent de la V1 ; les effets visibles de cette réduction sont listés au §4.5.
- **Le service n'héberge plus ni profils ni abonnements.** Le stockage clé-valeur de la version 1 est supprimé. La progression est tenue par le service dans un modèle commun, rattachée à (profil, série, chapitre) (§4.3, §4.6).
- **L'authentification et le durcissement passent dans le socle**, avant toute intégration à l'application (§4.10, étape A).
- **Invalidation réécrite** : la version 1 se fiait à la date de modification des dossiers parents, ce qui ne détecte pas une modification profonde (§4.8).
- **Réseau** : moindre privilège précisé, avec ce que Compose garantit et ce qu'il ne garantit pas (§4.10).
- **Découpage** en quatre étapes A à D au lieu de huit lots, et quatre tâches techniques suivies à part (§5).
- **Nouveaux constats** faits en relisant le code pour cette révision (annexe A, points 5 à 9), dont deux conditionnent l'étape C.

**Décisions de Julien, 11 novembre 2026.** La version 2 est validée. Les trois décisions ouvertes et toutes les questions du §6 sont tranchées selon les réponses recommandées dans ce document : installation « dossiers seuls » sans profils ni abonnements synchronisés tant qu'il n'existe pas de stockage central ; capacité `chapter.progress.profiles` en dernier sous-lot de l'étape C ; « En cours », « Lus récemment » et les mises à jour récentes conservés en V1. Le développement peut commencer par l'étape A et les tâches techniques suivies.

## 1. Résumé et recommandation

**Recommandation.** Un petit service Node dédié et facultatif, `scrollarr-folders`, calqué sur `notifier/` et placé derrière le proxy nginx sous `/folders/`. Il monte les dossiers de scans **en lecture seule**, ne reçoit jamais de chemin de la part du client, lit les **dossiers d'images et les CBZ/ZIP** sans rien extraire sur disque, et ne conserve qu'**une seule chose** : la progression de lecture. Il refuse de démarrer sans mode d'authentification explicite. Les URL de pages et de couverture reprennent la forme de celles de Komga : `app/sw.js` change de trois lignes.

**Ce que la V1 ne fait pas, dit sans détour.** Sur une installation « dossiers seuls », il n'y a ni profils ni synchronisation des abonnements entre appareils : ces données n'ont aujourd'hui pas d'autre maison que le stockage des serveurs de lecture, et la revue demande que le connecteur n'en devienne pas le propriétaire. La progression, elle, suit l'utilisateur d'un appareil à l'autre.

### Décisions actées par la revue

| Sujet | Décision | Où dans ce document |
| --- | --- | --- |
| Service indépendant | Oui, `scrollarr-folders` | §3 |
| Déploiement | Conteneur dédié derrière nginx | §3.3 |
| Accès aux scans | Montage strictement en lecture seule | §4.10 |
| Formats V1 | Dossiers d'images + CBZ/ZIP | §4.2 |
| Progression | Oui, conservée après redémarrage | §4.6 |
| Profils | Propriété de Scrollarr à terme | §4.3 |
| Abonnements | Propriété de Scrollarr à terme | §4.3 |
| Métadonnées techniques, index des fichiers | Dans le connecteur | §4.8 |
| Authentification | Dès le socle, avant l'intégration | §4.10, étape A |
| Identifiants fondés sur les chemins | Acceptables en V1, opaques, avec abstraction et limites documentées | §4.7 |
| Miniatures, notifications | Plus tard | étape D |
| Stockage | Isolé derrière une interface ; pas de SQLite sans besoin démontré | §4.6 |
| Tests sur NAS | Dès la première étape | §4.11, étape A |
| Réseau | Limité au strict nécessaire | §4.10 |

### Décisions restant à prendre

1. Installation « dossiers seuls » : accepter qu'elle n'ait ni profils ni abonnements synchronisés tant qu'un stockage central n'existe pas (§4.3, question Q1).
2. Progression des profils secondaires sur les séries Dossiers : nouvelle capacité de contrat, ou limitation à l'appareil en V1 (§4.3, Q2).
3. Listes dérivées de la progression retenues en V1 malgré la réduction (§4.5, Q3).

## 2. Besoin et périmètre

**Besoin.** Lire dans Scrollarr des scans déposés dans un dossier du NAS, sans installer ni Suwayomi ni Komga (README l.246 ; ROADMAP l.268).

**Parcours à valider, et rien d'autre :** parcourir les bibliothèques configurées → les séries → les chapitres ; lire un chapitre (dossier d'images ou CBZ/ZIP) dans l'ordre naturel ; voir une couverture simple ; enregistrer la progression ; reprendre après une reconnexion ; retrouver la progression après un redémarrage du service.

| Dans la V1 | Hors V1 (étape D ou jamais) |
| --- | --- |
| Bibliothèques montées en lecture seule ; séries ; chapitres | Toute écriture dans les dossiers |
| Dossiers d'images, CBZ/ZIP ; JPEG, PNG, WebP, GIF, AVIF servis tels quels | CBR/RAR, 7z, PDF, EPUB, SVG, TIFF ; conversion d'images |
| Ordre naturel, numéro de chapitre déduit du nom | Métadonnées (auteur, résumé, genres), `ComicInfo.xml` |
| Couverture : `cover.*` ou première page, telle quelle | Miniatures, images dérivées, dimensions des pages |
| Progression par (profil, série, chapitre), conservée sur disque | Profils, abonnements, préférences : jamais dans ce service |
| Authentification explicite : mot de passe unique, ou aucun sur acquittement | Comptes par utilisateur, droits par bibliothèque |
| Index en mémoire, relu à la demande | Cache d'index sur disque, surveillance temps réel, parcours périodique |
| « En cours » et « récents » déduits de la progression | Nouveaux chapitres, nouvelles séries, « à suivre », notifications |

Deux fonctions de l'application marchent sans rien développer côté service, et ne sont donc ni des objectifs ni des coûts de la V1 : la **lecture hors ligne** (elle met en cache des URL, `app/js/downloads.js` l.80-86) et le **masquage des doublons** entre serveurs (par titre, `app/js/api.js` l.203-218). Elles sont seulement vérifiées en non-régression.

## 3. Options d'architecture

Section conservée pour mémoire : le choix (a) est acté.

### 3.1 Les options

**(a) Service Node dédié `folders/`, proxifié sous `/folders/`** — retenu. Même modèle que `notifier/` : un répertoire, un `Dockerfile`, une image, un profil Compose, un `location` nginx.

**(b) Serveur Scrollarr unique** hébergeant notifier, dossiers, puis le « backend léger » de la roadmap.

**(c) nginx seul** : `autoindex` en JSON (directive `autoindex_format`, annexe B) et fichiers statiques, toute la logique dans le navigateur.

**(d) Ne rien construire : pointer Komga sur le dossier**, dont le connecteur déclare déjà toutes les capacités (`app/js/connectors/readers/komga.js` l.37). Variante : la source locale de Suwayomi (`server.localSourcePath`, annexe B).

**(e) Tout-en-un** : Node dans l'image principale.

### 3.2 Comparaison

| Critère | (a) Service dédié | (b) Serveur unique | (c) nginx seul | (d) Komga | (e) Tout-en-un |
| --- | --- | --- | --- | --- | --- |
| Conteneurs pour « lire des dossiers » | 2 | 2 | 1 | 2 | 1 |
| Avec les notifications en plus | 3 | 2 | 2 | 3 | 1 ou 2 |
| Dossiers d'images | Oui | Oui | Oui | Non listé dans sa documentation | Oui |
| CBZ/ZIP | Oui | Oui | **Non** | Oui (+ CBR, PDF, EPUB) | Oui |
| Progression partagée entre appareils | Oui | Oui | **Non** sans module d'écriture | Oui | Oui |
| Impact sur l'existant | Aucun | Refonte du notifier | Scans montés dans le conteneur exposé | Aucun | Image principale alourdie |
| Cloisonnement | Fort | Faible : l'analyse d'archives côtoie les secrets du notifier | Faible | Celui de Komga | Faible |

- **(c)** ne lit pas les archives, n'a nulle part où écrire la progression, et ferait parcourir toute l'arborescence par le téléphone.
- **(d)** coûte un conteneur Java (processus limité « usually 1gb » par défaut selon la documentation Docker de Komga), un compte et une analyse de bibliothèque ; les dossiers d'images en vrac ne figurent pas dans la liste de ses formats (non vérifié par un essai). **Pour qui a déjà Komga, (d) reste la bonne réponse** ; READ-002 sert à utiliser Scrollarr seul et à lire des dossiers d'images.
- **(b)** n'économise aucun conteneur pour « lire des fichiers » et tranche par la bande la décision « backend léger » que la roadmap laisse ouverte (ROADMAP l.173-174, l.605).
- **(e)** remplacerait ou doublerait le proxy que l'auteur utilise devant ses serveurs réels (README l.231).

**Garde-fou proposé :** jamais plus de deux services satellites. Un troisième besoin serveur déclenche la réunion du notifier et des dossiers. Pour que cela ne coûte rien, le service est écrit comme une bibliothèque (un gestionnaire de requêtes paramétré) plus un fichier de démarrage de quelques lignes.

### 3.3 Déploiement, image et maintenance

| Sujet | Ce que cela donne |
| --- | --- |
| `docker-compose.yml` | Service `folders` sous `profiles: ["folders"]`, comme `notifier` (l.21-36). **Aucun port publié.** Réseau interne dédié (§4.10). |
| Volumes | `/chemin/vers/scans:/libraries/Scans:ro` (un montage par bibliothèque) et `./data/folders:/data`. |
| nginx | Variable `FOLDERS_URL` (vide = absent), `map` vers `$folders_on`, clé `"folders"` dans `/servers.json`, `location ~ ^/folders/(.*)$` sur le modèle de Komga (`nginx/default.conf.template` l.59-71). Pas de `add_header` propre à ce `location`, pour hériter des trois en-têtes de sécurité l.36-38 (règle d'héritage de nginx, annexe B). |
| `Dockerfile` principal | Ajouter `FOLDERS_URL=""` à la ligne `ENV` (l.14). |
| Image publiée | Une entrée de plus dans la matrice de `.github/workflows/docker.yml` (l.24-28) ; base `node:22-alpine` comme le notifier. |
| Dépendances | Une seule (lecture ZIP), verrouillée par `package-lock.json` et installée avec `npm ci`. |
| Synology | `docker compose --profile folders up -d`, ou `COMPOSE_PROFILES=folders` dans `.env` (annexe B ; non vérifié dans l'interface Container Manager). |

Esquisse Compose (configuration, pas du code) :

```yaml
services:
  scrollarr:
    networks: [default, folders_net]     # seul service qui parle au service Dossiers
  folders:
    profiles: ["folders"]
    image: <registre>/scrollarr-folders:latest
    build: ./folders
    restart: unless-stopped
    user: "${FOLDERS_UID:-1000}:${FOLDERS_GID:-1000}"
    read_only: true
    cap_drop: ["ALL"]
    security_opt: ["no-new-privileges:true"]
    mem_limit: 256m
    pids_limit: 64
    tmpfs: ["/tmp"]
    networks: [folders_net]              # pas de réseau par défaut, pas de port publié
    environment:
      FOLDERS_AUTH: ${FOLDERS_AUTH:-}    # obligatoire : « password » ou « none » (§4.10)
      FOLDERS_USER: ${FOLDERS_USER:-}
      FOLDERS_PASSWORD: ${FOLDERS_PASSWORD:-}
    volumes:
      - /chemin/vers/scans:/libraries/Scans:ro
      - ./data/folders:/data
networks:
  folders_net:
    internal: true                       # réseau isolé de l'extérieur
```

## 4. Conception recommandée

### 4.1 Arborescence et conventions

```
/libraries/                      ← racine fixe dans le conteneur
  Scans/                         ← une bibliothèque = un montage (nom choisi dans Compose)
    Titre de la série/           ← une série = un sous-dossier direct de la bibliothèque
      cover.jpg                  ← couverture facultative
      Chapitre 001.cbz           ← un chapitre = une archive…
      Chapitre 002/              ← … ou un dossier contenant directement des images
        001.jpg
      Tome 02/Chapitre 010.cbz   ← niveaux intermédiaires tolérés (profondeur ≤ 3 sous la série)
```

| Règle | Décision |
| --- | --- |
| Périmètre autorisé | Exactement ce qui est monté sous `/libraries`. Aucun chemin fourni par le client. |
| Bibliothèques | Sous-dossiers directs de `/libraries`. Une seule : pas de filtre proposé (comme `readers/suwayomi.js` l.173-174). |
| Titre d'une série | Le nom du dossier, tel quel (Unicode NFC, espaces de bord retirés). |
| Chapitre | Toute archive `.cbz`/`.zip`, et tout dossier contenant **directement** au moins une image. Les dossiers intermédiaires (tomes) ne servent qu'au tri et au titre. |
| Pages | Toutes les images, en tri naturel sur leur chemin ; dans une archive, les sous-dossiers sont aplatis (comme la source locale de Mihon, annexe B). |
| Ordre de lecture | **Toujours le tri naturel des noms** (insensible à la casse, nombres comparés comme des nombres : `Intl.Collator` avec `numeric: true`, déjà utilisé par `app/js/api.js` l.247), après retrait des étiquettes entre crochets en tête de nom. L'utilisateur corrige un ordre en renommant. |
| Numéro de chapitre | Détecté dans le nom : marqueur explicite (`ch`, `chap`, `chapitre`, `chapter`, `c`, `ep`, `#`) suivi d'un nombre, sinon dernier nombre du nom hors parenthèses, crochets et titre de la série. |
| Usage du numéro | Si tous les chapitres ont un numéro et que ces numéros sont strictement croissants dans l'ordre de lecture, ils deviennent `metadata.numberSort` ; sinon `numberSort` = rang 1…n. L'application trie par ce champ (`views/reader.js` l.11, `views/series.js` l.36). |

| Arborescence désordonnée | Comportement |
| --- | --- |
| Images directement dans le dossier de série, sans chapitres | Un chapitre unique portant le nom de la série |
| Images en vrac **et** chapitres dans la même série | Images en vrac ignorées (hors `cover.*`), avec avertissement |
| Archive à la racine d'une bibliothèque | Une série d'un seul chapitre |
| Chapitre vide, archive illisible, profondeur > 3, archive imbriquée, nom non UTF-8 | Ignoré, avec avertissement |
| `@eaDir`, `#recycle`, noms commençant par `.`, `Thumbs.db`, `__MACOSX` | Ignorés en silence |
| Liens symboliques | Non suivis (§4.10) |

Les avertissements sont journalisés et exposés par `GET /api/v1/scan`. Les heuristiques exactes seront figées par un corpus de noms réels dans les tests (question Q5).

### 4.2 Formats

| Format | V1 | Raison |
| --- | --- | --- |
| Dossier d'images | **Oui** | Lecture directe. C'est ce qui distingue ce connecteur de l'option nulle. |
| CBZ / ZIP | **Oui** | Le répertoire central d'un ZIP donne la position de chaque entrée : on sert une page sans décompresser le reste. Décompression fournie par Node (`node:zlib`). |
| CBR / RAR | Non | Format propriétaire ; le code d'extraction officiel est sous licence unRAR, qui interdit de s'en servir pour recréer l'algorithme de compression (clause 2, d'après SPDX ; statut « licence libre » non vérifié). libarchive lit RAR « with some limitations ». Une archive « solide » oblige à décompresser ce qui précède la page voulue. |
| 7z, PDF, EPUB | Non | Accès direct coûteux (7z, non pris en charge par Komga non plus), moteur de rendu natif (PDF), texte recomposable (EPUB). |

**Types d'images.** JPEG, PNG, WebP, GIF, AVIF, servis tels quels, donc sans `fallbackUrl` (`views/reader.js` l.88-91). AVIF : Chrome 85+, Firefox 93+, Safari iOS 16+ (base « Can I use »). Le type est déterminé par les **premiers octets**, jamais par l'extension.

**Lecture des ZIP.** `yauzl` (MIT, v3.4.0, une dépendance transitive). Vérifié dans sa documentation : lecture du répertoire central sans parcourir les en-têtes locaux, ZIP64, méthodes 0 (stocké) et 8 (deflate) uniquement, contrôle par défaut que la taille réelle d'une entrée correspond à la taille annoncée.

**Limites par archive** (valeurs de départ, réglables) : 5 000 entrées ; répertoire central ≤ 8 Mo ; entrée décompressée ≤ 64 Mo avec arrêt du flux au-delà de la taille annoncée ; entrées chiffrées, multi-volumes ou d'une autre méthode refusées. Lecture **en flux** : la mémoire par requête ne dépend pas de la taille de l'archive.

### 4.3 Propriété des données

#### Ce qui existe aujourd'hui

Il n'y a **pas de « Scrollarr central »** : l'application n'a pas de backend (ROADMAP l.30). Ce qui en tient lieu est le stockage clé-valeur des serveurs de lecture (capacité `settings.store` : « meta » de Suwayomi, « client settings » de Komga).

| Donnée | Où elle vit aujourd'hui | Référence |
| --- | --- | --- |
| Liste des profils | Recopiée sur **tous** les serveurs actifs qui ont `settings.store` ; relue sur le premier qui répond, serveur prioritaire d'abord, **en remplacement** de la liste locale | `profiles.js` l.37-40, l.245-253 ; `api.js` l.541-547 |
| Abonnements | Appareil + recopie sur tous les serveurs à stockage ; fusion par révision | `store.js` l.62-79 ; `sync.js` l.48-55 |
| Progression du profil principal | Historique propre de chaque serveur | `api.js` l.323-344 |
| Progression d'un profil secondaire | Documents `scrollarr.p.<profil>.idx` et `.s.<série>`, écrits sur **le serveur propriétaire de la série** uniquement ; fusion par révision | `profiles.js` l.94, l.226 ; `sync.js` |
| Préférences de lecture | Appareil seulement | `store.js` l.12-35 |

#### Cible demandée par la revue

| Donnée | Propriétaire cible | Conséquence pour ce connecteur |
| --- | --- | --- |
| Profils, abonnements, préférences globales | Scrollarr central | Le service ne les stocke **jamais**, même provisoirement |
| Progression | Modèle commun Scrollarr, stockage fourni par le backend | Le service stocke la progression de ses propres chapitres, dans le modèle commun, par (profil, série, chapitre) |
| Index des fichiers, métadonnées du connecteur | Service Dossiers | En mémoire en V1 |

*Ambiguïté relevée.* « Stockage fourni par le backend » peut désigner le backend du connecteur ou le futur backend Scrollarr. La conception ci-dessous tient dans les deux lectures : le modèle est commun et le stockage est derrière une interface (§4.6), donc déplaçable.

#### Première question : le lecteur Dossiers déclare-t-il `settings.store` ?

| Option | Dossiers + Suwayomi/Komga | Dossiers seuls | Coût |
| --- | --- | --- | --- |
| **D1 — Non (recommandé)** | Rien ne change : profils et abonnements restent sur les autres serveurs. Le service n'en est même pas une copie. | Pas de profils ; abonnements propres à chaque appareil ; pas de fusion multi-appareils. La progression du profil principal, elle, est partagée. | Trou fonctionnel assumé sur ce type d'installation jusqu'à l'existence d'un stockage central ; petite adaptation de l'interface (ci-dessous) |
| D2 — Oui, « à titre provisoire » | Le service devient une copie de plus de la liste des profils et des abonnements | Tout fonctionne comme avec Komga | Le service devient de fait le propriétaire sur une installation « dossiers seuls » ; surface d'écriture générique à sécuriser ; un provisoire qui a toutes les chances de durer. **Contraire à la revue.** |
| D3 — Petit stockage central dès maintenant | — | Tout fonctionne | C'est la décision « backend léger » prise par la bande, dans un connecteur ou dans un troisième service. À traiter par API-001 (ROADMAP l.333), pas par READ-002. |

**Recommandation : D1.** Ce qui cesse de fonctionner sur une installation « dossiers seuls », et ce que l'interface montre :

| Fonction | Comportement actuel du code sans aucun serveur à stockage (déduit de la lecture, non exécuté) | À faire à l'étape C |
| --- | --- | --- |
| Créer un profil | Le profil est ajouté à la liste locale **puis** l'enregistrement échoue (`profiles.js` l.42-49) : message « Enregistrement impossible : le serveur ne répond pas. » (`views/profiles.js` l.17-18), et un profil fantôme reste sur l'appareil | Masquer la gestion des profils (`views/more.js` l.123-128) quand aucun serveur actif n'offre de stockage, avec une phrase d'explication |
| Abonnements | Fonctionnent sur l'appareil ; chaque tentative de recopie échoue en silence (`store.js` l.62-79) | Mention « Sur cette installation, les abonnements restent sur cet appareil » |
| Fusion multi-appareils | Sans objet : rien n'est partagé, sauf la progression du profil principal | Rien |
| « Qui lit ? » au démarrage | Ne se déclenche pas : la liste reste réduite au profil principal (`profiles.js` l.245-253) | Rien |

Si Julien veut des profils sur une installation « dossiers seuls », la bonne réponse est de décider le stockage central, pas de faire grossir le connecteur.

#### Seconde question : comment la progression est-elle rattachée au profil ?

Le service enregistre **toujours** la progression sous une clé (profil, série, chapitre). Le profil est un identifiant opaque (`main`, ou l'identifiant créé par `profiles.js` l.43) : le service ne connaît ni les noms ni la liste des profils. Reste à savoir comment l'application s'en sert pour un profil secondaire, sachant qu'aujourd'hui un profil secondaire remplace la progression du serveur par une surcouche tenue dans le navigateur (`api.js` l.161-179) et rangée dans le stockage clé-valeur du serveur propriétaire.

| Option | Principe | Changement côté application | Limite |
| --- | --- | --- | --- |
| P1 — Rien de plus | La surcouche actuelle s'applique ; faute de stockage, elle reste sur l'appareil | Aucun, une fois la tâche T4 faite (§5) | La progression d'un profil secondaire sur une série Dossiers ne suit pas l'utilisateur sur un autre appareil et disparaît avec les données du navigateur |
| **P2 — Capacité « progression par profil » (recommandé)** | Le lecteur annonce qu'il tient la progression par profil ; la façade lui indique le profil actif et n'applique pas la surcouche à ses chapitres | Une capacité (`chapter.progress.profiles`) et deux méthodes (indiquer le profil actif ; oublier un profil supprimé) dans le contrat ; dans `api.js`, un test « ce lecteur gère-t-il les profils ? » aux endroits où la surcouche s'applique (l.164-179, l.283-299, l.323-367). Estimation : 40 à 60 lignes, taille M | Deux mécanismes coexistent dans la façade (surcouche pour Suwayomi et Komga, délégation pour Dossiers). Dernière écriture gagnante par chapitre, comme pour le profil principal, au lieu de la fusion par révision |
| P3 — Stockage restreint aux documents de progression | Le service accepte les documents `scrollarr.p.<profil>.idx` et `.s.<série>` de la surcouche, et rien d'autre | Quelques lignes dans `api.js` (l.501-538) et une capacité | Le service garde un stockage de documents opaques, et deux représentations de la progression (native pour le profil principal, documents pour les autres) |
| P4 — Ranger ces documents sur un autre serveur | Les documents des séries Dossiers iraient dans le stockage de Komga ou Suwayomi | Nommage des clés à revoir dans `profiles.js` | La progression de Dossiers dépend d'un autre serveur : exactement l'incohérence « profil et serveur propriétaire distincts » que la revue demande d'éviter |

**Recommandation : P2**, livré comme dernier sous-lot de l'étape C. C'est le plus petit changement qui atteint la cible : un seul modèle de progression dans le service, aucun stockage générique, et rien à défaire le jour où un stockage central existe. P1 est l'état intermédiaire entre les sous-lots C2 et C3 ; il peut devenir la V1 si Julien préfère la plus petite livraison (Q2).

Dans les deux cas : **un profil n'est pas un compte** (README l.57). Quiconque atteint le service peut lire et modifier la progression de n'importe quel profil, avec ou sans mot de passe partagé.

#### Chemin de migration vers un stockage central

| Donnée | Le jour où un stockage central existe |
| --- | --- |
| Profils, abonnements, préférences | Rien à migrer depuis le service : il ne les a jamais eus. L'import depuis les stockages de Suwayomi et Komga est un chantier général, hors READ-002. |
| Progression | Soit elle reste dans le service (modèle commun, stockage « fourni par le backend » du connecteur), soit elle est importée : le format sur disque est documenté et stable (§4.6), et une route d'export peut être ajoutée à ce moment-là. Les identifiants `f:…` restent des clés valides. |
| Installation « dossiers seuls » | Les profils deviennent disponibles ; l'historique existant est celui du profil `main` ; le service sait déjà tenir les autres. |

### 4.4 API HTTP du service

Chemins vus par le service ; l'application y accède sous `/folders/…`. Les objets sont au modèle commun de l'application, celui de Komga (README l.189). `?profile=` vaut `main` par défaut.

| Méthode et chemin | Réponse | Étape |
| --- | --- | --- |
| `GET /health` | `{ ok, version, auth, libraries: [{ name, state }] }`, sans authentification | A |
| `GET /api/v1/session`, `POST /api/v1/login`, `POST /api/v1/logout` | Session (§4.10) | A |
| `GET /api/v1/libraries` | `[{ id, name }]` | A |
| `GET /api/v1/series?library=&search=&sort=&status=&page=&size=&profile=` | `{ content, last }` | A, `status` en C |
| `GET /api/v1/series/{sid}`, `/series/{sid}/books` | Série ; chapitres dans l'ordre de lecture | A |
| `GET /api/v1/books/{bid}`, `/books/{bid}/next`, `/previous` | Chapitre | A |
| `GET /api/v1/scan`, `POST /api/v1/scan` | État, avertissements ; demander un parcours complet | A |
| `GET /api/v1/books/{bid}/pages` | `[{ number, mediaType }]` | B |
| **`GET /api/v1/books/{bid}/pages/{n}`** | L'image | B |
| **`GET /api/v1/series/{sid}/thumbnail`** | La couverture | B |
| `PATCH` / `DELETE /api/v1/books/{bid}/progress?profile=` | Enregistrer `{ page, completed }` ; remettre à non lu | C |
| `PUT` / `DELETE /api/v1/series/{sid}/progress?profile=` | Tout marquer lu / non lu | C |
| `GET /api/v1/books/inprogress`, `/books/recent` (`?profile=&size=`) | Déduits de la progression | C |
| `DELETE /api/v1/profiles/{pid}/progress` | Oublier la progression d'un profil supprimé | C (P2) |

Supprimé par rapport à la version 1 : stockage clé-valeur, routes de nouveautés, « à suivre », miniature par chapitre.

**Compatibilité avec `app/sw.js`.** Les expressions qui reconnaissent pages et couvertures (l.44-45) acceptent déjà `…/api/v1/books/<id>/pages/<n>` et `…/api/v1/series/<id>/thumbnail`. Changements exacts :

1. l.13 : ajouter `'folders/'` à `SERVERS`. **Obligatoire, pas cosmétique** : sans cela, toute requête GET sous `/folders/` tombe dans le traitement de la coquille (l.53-60) et serait servie depuis le cache de l'application, puis réécrite dedans (l.93-109).
2. l.23 : ajouter `'js/connectors/readers/folders.js'` à `SHELL_FILES`.
3. l.6 : passer `SHELL` à `scrollarr-shell-v12` (l'historique Git montre une incrémentation à chaque changement de la coquille).

Le service worker ressert une page téléchargée en ignorant la chaîne de requête (l.64-67) : rien de discriminant ne doit donc figurer dans la chaîne de requête d'une page. Le paramètre `profile` ne concerne que les réponses JSON.

### 4.5 Correspondance avec `reader-contract.js`, et effets visibles de la réduction

Membres toujours exigés (`reader-contract.js` l.7-15). « Minimum » : ce qui suffit à ne rien casser. « Retenu » : ce que la V1 fait.

| Membre | Minimum acceptable | Retenu en V1 |
| --- | --- | --- |
| `id`, `code`, `label`, `userLabel` | — | `'folders'`, `'f'` (une lettre, l.32), `'Dossiers'`, `'Identifiant'`. Le libellé est affiché tel quel (`views/login.js` l.31, `views/more.js` l.39) : le passer par `t()`. |
| `session`, `login`, `logout` | — | `GET /session` ; repli hors ligne comme Komga (`readers/komga.js` l.45-49) ; 401 → `AuthError`, donc carte de connexion. En mode sans authentification, `login` refuse et `logout` ne fait rien (il peut être appelé par une déconnexion générale, `api.js` l.130-137). |
| `libraries` | — | Les montages ; liste vide s'il n'y en a qu'un |
| `genres` | `[]` | `[]` : le filtre « Genre » n'apparaît pas (`views/library.js` l.76-78) |
| `seriesList` | Titre, recherche, bibliothèque | Idem, plus tri par date du dossier (pour « Mises à jour récentes » et « Ajouts récents », `views/library.js` l.72) et filtre par état de lecture déduit de la progression. Ignorer un filtre proposé à l'écran reviendrait à simuler. |
| `seriesNew` | `{ content: [] }` | `{ content: [] }`, sans appel au service |
| `seriesUpdated` | `{ content: [] }` | Les séries dont le dossier a été modifié le plus récemment (donnée gratuite du parcours, sans état). **Nécessaire** : voir « état vide » ci-dessous. |
| `series`, `seriesBooks` | — | Complets. Nombre de pages connu d'emblée pour un dossier d'images ; pour une archive, seulement après sa première ouverture (il est alors mémorisé avec la progression). |
| `booksLatest` | `{ content: [] }` | `{ content: [] }` |
| `booksOnDeck` | `{ content: [] }` | `{ content: [] }` |
| `booksInProgress`, `booksRecentlyRead` | `{ content: [] }` | Déduits de la progression (les dates y sont déjà). Voir Q3. |
| `book`, `nextBook`, `previousBook`, `bookPages` | — | Complets ; pas de `width`/`height` : la hauteur s'ajuste à l'arrivée de l'image, comme pour Suwayomi (`views/reader.js` l.64) |
| `seriesThumb`, `bookThumb` | — | Une seule image : `bookThumb` renvoie l'URL de la couverture de la série, déduite de l'identifiant du chapitre, comme `readers/suwayomi.js` l.247-248 |

| Capacité (`contract.js` l.15-24) | V1 |
| --- | --- |
| `series.list`, `series.search`, `chapter.list`, `chapter.read` | Oui (recherche sur le titre) |
| `chapter.progress.read`, `chapter.progress.write` | Oui, à partir du sous-lot C2 |
| `settings.store` | **Non** (D1) |
| `chapter.progress.profiles` (nouvelle) | Oui si P2 est retenu, au sous-lot C3 |

**Ce que l'utilisateur voit sur l'accueil** (`views/home.js`) :

| Élément | Alimenté par | Dossiers seuls | Avec Suwayomi/Komga |
| --- | --- | --- | --- |
| Bandeau principal (l.38, l.66-90) | Premier « Reprendre », sinon première « mise à jour » | Le dernier chapitre entamé ; à défaut « Dernière arrivée » = le dossier de série modifié le plus récemment | Inchangé ; un chapitre Dossiers entamé peut y figurer |
| « Reprendre » (l.58) | `booksInProgress` + `booksOnDeck` | Les chapitres entamés. **Pas** de « chapitre suivant » proposé après un chapitre terminé ; l'enchaînement en fin de chapitre dans le lecteur reste (README l.26) | Idem pour les séries Dossiers |
| « Mes abonnements » (l.40-55) | Abonnements + fiche de chaque série | Présents, sur cet appareil uniquement (D1) | Synchronisés par les autres serveurs |
| « Nouveaux chapitres » (l.60) | `booksLatest` | **Absente** (une rangée vide n'est pas affichée, `components.js` l.79-80) | Sans chapitres Dossiers |
| « Nouvelles séries » (l.61) | `seriesNew` | **Absente** | Sans séries Dossiers |
| « Mises à jour récentes » (l.62) | `seriesUpdated` | Séries par date de dossier | Fusionnées par date |
| État vide (l.32-35) | Toutes les listes vides | Sans `seriesUpdated`, une bibliothèque pleine mais jamais lue afficherait « La bibliothèque est vide — Ajoutez des séries dans Komga ». Le texte est à rendre neutre au passage. | — |
| *Ma liste > Récents* (`views/my.js` l.30) | `booksRecentlyRead` | Historique déduit de la progression | Idem |

La reprise fonctionne aussi sans l'accueil : la fiche d'une série montre la progression de chaque chapitre et l'ouvre à la page atteinte (`views/series.js` l.116, `views/reader.js` l.54-57).

**Capacités non honorées par la façade aujourd'hui.** `api.saveProgress` et les actions « marquer comme lu » appellent le connecteur sans vérifier `chapter.progress.write` (`api.js` l.333-334, l.356-367 ; `views/series.js` l.167-177), et `api.can` (l.86) n'a aucun appelant. C'est la tâche T1 (§5). Elle devient utile ici : au sous-lot C1, le lecteur Dossiers est précisément un lecteur sans progression.

**Changements de contrat nécessaires :** aucun pour le profil principal. Un seul si P2 est retenu (une capacité, deux méthodes).

### 4.6 Stockage de la progression

**Modèle commun.** Un enregistrement par (profil, série, chapitre) : page atteinte, terminé ou non, date, nombre de pages connu. Les clés sont des identifiants opaques (§4.7), jamais des chemins.

**Interface de stockage**, seule porte d'entrée du reste du service : lire la progression d'une série pour un profil ; écrire ou effacer celle d'un chapitre ; tout marquer lu ou non lu pour une série ; lister les plus récentes d'un profil ; oublier un profil. Deux réalisations : fichiers (V1) et mémoire (tests). SQLite n'est pas retenu : aucun besoin ne le justifie à ce volume, et le module intégré `node:sqlite` est encore expérimental en Node 22 (annexe B).

| Emplacement dans `/data` | Contenu | À sauvegarder |
| --- | --- | --- |
| `progress/<profil>/<série>.json` | `{ idChapitre: [page, terminé, date, nombrePages] }` | Oui |
| `libraries.json` | Pour chaque bibliothèque : le fait qu'elle a déjà contenu des séries (§4.8) | Oui |
| `secret.key` | Clé de signature des sessions, créée au premier démarrage (comme les clés VAPID du notifier, `notifier/server.js` l.47-52) | Oui |

- **Écritures atomiques** : fichier temporaire, synchronisation sur disque, renommage (modèle de `notifier/server.js` l.40-44). Une écriture à la fois par fichier.
- **Regroupement** : écriture au plus toutes les quelques secondes et à l'arrêt (`SIGTERM`). Perte maximale sur coupure : quelques secondes de lecture.
- **Bornes** : identifiant de profil court et alphanumérique, nombre de profils plafonné, corps ≤ 64 Ko.
- **Jamais de purge automatique** : la progression d'un chapitre disparu est gardée ; elle revient si le fichier revient au même chemin.
- **Sauvegarde** : copier `./data/folders`. Restauration : le remettre en place, service arrêté.
- **Reprise après reconnexion** : rien à ajouter. La façade met en file les enregistrements faits hors ligne et les renvoie au retour du serveur (`api.js` l.315-354).

### 4.7 Identifiants

| Exigence de la revue | Réponse |
| --- | --- |
| Identifiants opaques côté API | Série : 16 chiffres hexadécimaux d'un SHA-256 de « nom de la bibliothèque + chemin relatif ». Chapitre : `<idSérie>.<16 hex>`, sur le modèle de `readers/suwayomi.js` l.23 et l.33. Minuscules et chiffres seulement : `profiles.js` l.92 met les identifiants de série en minuscules, un identifiant sensible à la casse créerait des collisions. |
| Aucun chemin dans l'API | Ni en entrée ni en sortie ; les messages d'erreur n'en contiennent pas non plus. |
| Résolution identifiant → chemin centralisée | Un seul module du service traduit dans les deux sens. Tout le reste (pages, couverture, progression) ne manipule que des identifiants. |
| Comportement au renommage documenté | Renommer ou déplacer un chapitre crée un nouveau chapitre : progression à zéro. Renommer un dossier de série : nouvelle série ; la progression repart et l'abonnement est retiré à la prochaine actualisation (`store.js` l.131, l.139). Le nom côté conteneur (`/libraries/<Nom>`) fait partie de l'identité ; le chemin côté NAS, non. Une copie hors ligne reste lisible (`views/reader.js` l.12-25, déduit de la lecture) mais n'est plus rattachée à la série. |
| Évolution possible vers des identifiants persistants | Le module de résolution pourra consulter une table « empreinte du contenu → identifiant » conservée dans `/data` : un fichier renommé garderait son identifiant. Ni l'API ni le format de la progression ne changent. Étape D, si la gêne est réelle. |

L'empreinte du chemin est déterministe : les identifiants se recalculent à l'identique après un redémarrage, puisque l'index n'est pas conservé sur disque. `folders` est placé **en dernier** dans `READERS` (`connectors/index.js` l.15-18), l'ordre étant la priorité par défaut pour les doublons.

### 4.8 Parcours des dossiers et invalidation

**Principe : relister ce que l'on affiche, vérifier ce que l'on sert.** Aucune décision ne repose sur la date de modification d'un dossier parent. Constaté sur un système de fichiers ext4 pour cette révision : ajouter un fichier en profondeur ne change la date d'aucun dossier ancêtre au-delà du parent direct, et modifier le contenu d'un fichier ne change pas la date de son dossier (annexe B).

**V1 : aucun cache sur disque.** L'index vit en mémoire et se reconstruit au démarrage. Il n'y a donc pas de cache persistant à invalider. Un index conservé n'est envisagé qu'à l'étape D, et seulement si les mesures sur NAS montrent un démarrage trop long.

| Quoi | Quand c'est vérifié | Comment |
| --- | --- | --- |
| Liste des séries d'une bibliothèque | À chaque demande de liste si la dernière lecture a plus de 60 s | Relecture du dossier racine de la bibliothèque (une lecture de répertoire) : ajouts, suppressions et renommages de séries sont vus exactement |
| Chapitres d'une série | À chaque ouverture de la fiche ou d'un chapitre si la dernière lecture a plus de 30 s | Relecture de **tout** le sous-arbre de la série (profondeur ≤ 3) : une modification profonde est vue, quelle que soit la date des dossiers |
| Pages d'un chapitre-dossier | À chaque demande de la liste des pages | Relecture du dossier |
| Archive (liste des entrées gardée en mémoire) | **À chaque requête** qui la touche | Un `stat` ; la liste est jetée si l'un de ces quatre éléments a changé : numéro d'inode, taille, date de modification, date de changement d'état (`ctime`) |
| Image servie | À chaque requête | `ETag` calculé sur les mêmes quatre éléments ; `Cache-Control: no-cache`, donc revalidation systématique et réponse 304 si rien n'a changé |
| Tout | Au démarrage ; sur `POST /api/v1/scan` ; en arrière-plan quand quelqu'un ouvre la bibliothèque et que le dernier parcours complet a plus de 15 min (réglable, 0 = jamais) | Parcours complet ; le nouvel index remplace l'ancien d'un coup, l'ancien répond pendant ce temps ; toutes les listes d'entrées d'archives sont jetées |

**Pourquoi quatre éléments et pas « taille + date ».** Un fichier remplacé par un autre de même taille dont on a restauré la date échappe à « taille + date ». Il n'échappe pas au quadruplet : un remplacement crée un nouvel inode, et une réécriture sur place change `ctime`, que les outils courants ne permettent pas de restaurer. Vérifié localement sur ext4 dans les deux cas. **Limite assumée** : sur un partage réseau monté par le NAS puis transmis au conteneur, inode et `ctime` peuvent ne pas avoir ce comportement (non vérifié) ; le recours est un parcours complet ou un redémarrage.

| Événement | Ce qui se passe |
| --- | --- |
| Chapitre ou série ajouté | Visible à la prochaine relecture du niveau concerné (60 s / 30 s au plus) |
| Supprimé | 404 à la prochaine relecture ; la progression est gardée |
| Renommé ou déplacé | L'ancien identifiant disparaît (404), un nouveau apparaît |
| Fichier remplacé | Détecté à la requête suivante ; les pages changent d'`ETag`. Une copie hors ligne reste l'ancienne version. |
| Fichier disparu entre la liste et l'ouverture | 404, et la série concernée est relue immédiatement |
| Compteur de chapitres dans la grille | Peut dater du dernier parcours complet ou de la dernière ouverture de la série. Seule approximation acceptée. |
| Bibliothèque illisible, ou **vide alors qu'elle a déjà contenu des séries** (`libraries.json`) | État « indisponible » : réponses **503**, jamais 404, jusqu'à ce qu'elle redevienne lisible ou qu'un `POST /scan` confirme qu'elle est vraiment vide |

Ce dernier cas est le plus important. Un volume non monté ou un dossier chiffré verrouillé ressemble à un dossier vide. Or un 404 sur une série fait **supprimer l'abonnement** correspondant (`store.js` l.131, l.139), alors qu'un 503 est traité comme un serveur injoignable (`net.js` l.71) : abonnements conservés, copies hors ligne utilisables.

**Pas de surveillance temps réel ni de parcours périodique.** `fs.watch` repose sur inotify et la documentation de Node le dit peu fiable sur les partages réseau et sous Docker (annexe B). Un parcours périodique peut empêcher les disques de se mettre en veille.

**Couverture simple.** `cover.jpg`/`.jpeg`/`.png`/`.webp` à la racine de la série (convention Mihon, annexe B), sinon première page du premier chapitre, servie telle quelle. Tous les chapitres d'une série partagent cette URL : une fiche de 100 chapitres coûte une image. Poids non maîtrisé si la première page est une longue planche : mesuré à l'étape B, traité à l'étape D.

### 4.9 Démarrage et sortie de veille

L'application abandonne une requête au bout de 15 s et considère alors le serveur comme injoignable pendant 15 s (`net.js` l.19, l.37-45). Un disque qui sort de veille peut prendre plusieurs secondes : la première requête après une longue inactivité risque d'afficher brièvement « serveur injoignable ». À mesurer à l'étape A ; le module lecteur peut allonger le délai des appels concernés, comme le fait `readers/suwayomi.js` l.239 pour les pages.

### 4.10 Sécurité

**Modèle de menace.** Le service est sous la **même origine** que l'application et que les proxys de Komga et Suwayomi : tout contenu actif qu'il servirait s'exécuterait avec leurs sessions, y compris le cookie d'identifiants Suwayomi (README l.127). Les fichiers de la bibliothèque sont des **données non fiables**.

#### Authentification : dans le socle, mode explicite obligatoire

| Configuration | Résultat |
| --- | --- |
| `FOLDERS_AUTH` absent, vide, ou d'une autre valeur que `password` / `none` | **Refus de démarrer**, message d'une ligne |
| `password` sans `FOLDERS_USER` ou sans `FOLDERS_PASSWORD`, ou mot de passe de moins de 12 caractères | Refus |
| `none` alors qu'un identifiant ou un mot de passe est renseigné (ambigu) | Refus |
| Variable `FOLDERS_…` inconnue (faute de frappe) ou limite non numérique | Refus |
| Aucune bibliothèque sous `/libraries`, ou `/data` non inscriptible | Refus |
| `password` valide | Démarre ; tout sauf `/health` exige une session |
| `none` | Démarre ; avertissement journalisé à chaque démarrage ; `/health` indique `auth: "none"` |

**Mode `password`.** Un identifiant et un mot de passe uniques, dans `.env` (comme `SUWAYOMI_PASSWORD` pour le notifier). Session par cookie signé `HttpOnly`, `SameSite=Strict`, `Secure` derrière HTTPS. Il s'insère dans le contrat existant sans le changer : `session()` lève `AuthError`, la carte de connexion s'affiche (`views/login.js` l.41-65), et le cookie de même origine authentifie aussi les images. Tentatives limitées par adresse.

**Ce que ce mot de passe n'est pas.** Il protège l'accès au service ; il ne sépare pas les personnes. Tous ceux qui le connaissent voient tous les scans et peuvent lire ou modifier la progression de tous les profils. Les profils ne sont pas des comptes (README l.57). Une vraie séparation relève du modèle de comptes de la roadmap (AUTH-001 et « modèle exact de comptes », ROADMAP l.335 et l.594).

**Mode `none` : conséquences à documenter dans `README` et `SECURITY.md` dès l'étape A.** Réservé à un réseau local de confiance ou à un VPN, activé volontairement. Quiconque atteint Scrollarr peut alors lister tous les noms de séries et de chapitres, lire toutes les pages, et lire ou modifier toute la progression. Jamais : écrire ou supprimer un fichier, ni atteindre un chemin hors de `/libraries`. Le service ne peut pas vérifier lui-même qu'il n'est pas exposé : derrière un proxy frontal, l'adresse qu'il voit est celle du proxy. **Avant toute exposition hors d'un réseau de confiance : mode `password`, en HTTPS.**

#### Système de fichiers et contenus

| Risque | Parade |
| --- | --- |
| Écriture dans les scans | Montage `:ro` ; aucun appel d'écriture dans le code qui touche `/libraries` (vérifié par test) ; système de fichiers du conteneur en lecture seule. Sur un noyau antérieur à 5.12, les sous-montages d'un montage en lecture seule restent inscriptibles (documentation Docker) : monter un dossier sans sous-montage. |
| Traversée de chemin | Impossible par construction : le client n'envoie que des identifiants et des numéros de page. |
| Liens symboliques | Non suivis au parcours. À l'ouverture : drapeau `O_NOFOLLOW`, puis contrôle que le chemin réel reste sous la racine réelle de la bibliothèque et que le fichier est ordinaire. |
| « Zip-slip » | Sans objet : rien n'est extrait sur disque. |
| Bombes de décompression | Limites du §4.2, lecture en flux plafonnée, une seule entrée par requête. |
| Type trompeur, SVG, HTML | Réponses en `application/json` ou l'un des cinq types d'image, sinon 415. `nosniff` et la CSP du proxy s'appliquent (`default.conf.template` l.36-38) ; le service ajoute `Content-Security-Policy: default-src 'none'; sandbox` et `Cross-Origin-Resource-Policy: same-origin`. |
| Épuisement de ressources | Flux simultanés plafonnés, délais, corps ≤ 64 Ko, un seul parcours à la fois, `mem_limit`, `pids_limit`. |
| Privilèges | Utilisateur non root (`USER node` comme `notifier/Dockerfile` l.13), `cap_drop: ALL`, `no-new-privileges`. |
| Requêtes inter-origines | Toute requête autre que GET exige `Content-Type: application/json` et `X-Requested-With`, que l'application envoie déjà (`net.js` l.55-59) : ces en-têtes imposent une pré-vérification CORS (MDN) à laquelle le service ne répond jamais favorablement. Refus si `Origin` ne correspond pas à l'hôte. Vaut aussi pour la connexion. Ce risque existe **même sur un réseau local**. |

#### Réseau : moindre privilège

| Communication | Nécessaire ? |
| --- | --- |
| nginx (conteneur `scrollarr`) → `folders`, un port | **Oui, la seule** |
| Contrôle de santé | Interne au conteneur (boucle locale) |
| `folders` → Internet, DNS externe | Non |
| `folders` → Suwayomi, Komga, notifier | Non en V1 |
| `folders` → le NAS lui-même | Non |
| Navigateur → `folders` directement | Non : aucun port publié |

| Mesure Compose | Ce que la documentation garantit | Ce qu'elle ne garantit pas |
| --- | --- | --- |
| Réseau dédié `internal: true`, partagé avec `scrollarr` seulement | « an externally isolated network » ; pas de route par défaut, et des règles de pare-feu rejettent le trafic vers ou depuis les autres réseaux | La documentation précise que **l'adresse de passerelle reste joignable**, donc les services de l'hôte qui y écoutent, et que l'hôte peut joindre le conteneur. Un mode de passerelle « isolé » semble exister ; non vérifié. |
| `scrollarr` attaché aux deux réseaux | Un service n'accède qu'aux réseaux qui lui sont explicitement attribués ; résolution par nom sur un réseau défini par l'utilisateur | — |
| Aucun `ports:` pour `folders` | Rien n'est publié sur l'hôte | — |

Attention au commentaire de bas de `docker-compose.yml` (l.38-44), qui propose de remplacer le réseau `default` par un réseau externe partagé : `folders_net` doit rester distinct et ne jamais être externe. **Critère de sortie de l'étape A** : depuis l'intérieur du conteneur, sur le NAS, constater que ni Internet, ni une machine du réseau local, ni un autre conteneur ne répondent, et noter ce qui reste joignable sur la passerelle.

### 4.11 Tests

| Niveau | Contenu | Étape |
| --- | --- | --- |
| Unitaire (Node) | Corpus de noms → ordre et numéros ; identifiants et résolution ; confinement (lien symbolique sortant) ; chaque cas de refus de démarrage ; session, limitation des tentatives, requêtes sans en-têtes ou d'une autre origine | A |
| Unitaire | Archives fabriquées (tailles mensongères, entrée chiffrée, méthode inconnue, répertoire central tronqué, ZIP64, zéro entrée) ; types par premiers octets ; invalidation (ajout profond, renommage, suppression, remplacement à taille et date égales, bibliothèque devenue vide) | B |
| Unitaire | Stockage de la progression : écriture interrompue, redémarrage, profils | C |
| Conteneur (CI) | Image construite ; démarrage avec `:ro` et `read_only` ; tentative d'écriture refusée ; `/health` ; empreinte de la bibliothèque d'essai identique avant et après | A |
| En-têtes nginx (CI) | L'image réelle devant les faux serveurs : en-têtes de sécurité vérifiés sur `/`, `/servers.json`, un chemin proxifié, `/folders/…` (JSON, image, 401, service arrêté) | T2, puis C |
| Bout en bout (Playwright) | Dossiers seuls ; dossiers + faux Komga avec un titre commun ; bibliothèque → série → chapitre → lecture ; progression, rechargement, **redémarrage du service**, coupure puis retour du réseau ; mode mot de passe ; service en panne sans gêner les autres serveurs (CONN-006) | C |
| Service worker | Une réponse JSON sous `/folders/` n'entre jamais dans le cache de la coquille ; page téléchargée resservie service arrêté ; couverture resservie puis rafraîchie | C |
| Non-régression | Les six scripts existants passent inchangés (READ-005) | C |

**Essais sur le NAS**, consignés par écrit à chaque étape (chiffres, versions, constats) :

| Sujet demandé par la revue | Étape A | Étape B | Étape C |
| --- | --- | --- | --- |
| Permissions et ACL | L'utilisateur du conteneur lit le dossier partagé et écrit `/data` | — | — |
| Partages et montages | `:ro` effectif (écriture refusée) ; sous-montages ; versions du noyau et du moteur Docker ; isolation réseau | — | — |
| Dossiers très peuplés | Parcours d'une bibliothèque réelle et d'un dossier de plusieurs milliers d'entrées | Chapitre de plusieurs centaines de pages | — |
| Temps de parcours | À froid et à chaud ; mémoire | Première ouverture d'une longue série | — |
| Disques sortant de veille | Délai de la première réponse, comparé aux 15 s de l'application (§4.9) | Délai de la première page | Reprise de lecture après une nuit |
| Renommages pendant l'utilisation | Série renommée | Chapitre renommé ou remplacé pendant la lecture | Effet sur la progression |
| Archives volumineuses ou malformées | — | Archives réelles de grande taille ; archive tronquée | — |
| Fichiers devenus indisponibles | Dossier partagé démonté ou verrouillé : 503, pas 404 | Fichier supprimé pendant la lecture | Abonnements conservés |

**Bibliothèque d'essai.** Générée par un script (petites images PNG et archives ZIP produites par Node), sans fichier binaire dans le dépôt.

**Mode développement.** `node folders/server.js` sur la bibliothèque d'essai, puis `FOLDERS=http://localhost:8788 SERVERS=folders node dev/mock-servers.mjs`, à l'image de `NOTIFIER` (`dev/mock-servers.mjs` l.11, l.398-401). Le relais actuel met le corps en mémoire et ne transmet que deux en-têtes (l.364-371) : il devra relayer en flux.

## 5. Étapes

Chaque sous-lot est fusionnable seul. Jusqu'à l'étape C, le service n'est pas référencé par l'application.

### A — Socle du service

| Sous-lot | Contenu | Taille | Vérifié |
| --- | --- | --- | --- |
| A1 | Répertoire `folders/` ; lecture et validation de la configuration ; authentification (deux modes, session, limitation) ; garde-fous inter-origines ; `/health` ; `Dockerfile` avec fichier de verrouillage ; service Compose durci, réseau interne ; CI ; texte de sécurité dans `README` et `SECURITY.md` | M | Chaque configuration invalide fait échouer le démarrage (tests) ; sans session, tout est refusé en mode `password` ; test conteneur |
| A2 | Parcours : bibliothèques, séries, chapitres ; conventions de nommage ; identifiants et module de résolution ; liens symboliques ; états « indisponible » ; routes de structure ; générateur de bibliothèque d'essai | M | Tests de nommage, de résolution et de confinement ; structure parcourable avec `curl` |
| A3 | Essais et mesures sur le NAS (colonne « Étape A » du §4.11), consignés | S | Compte rendu chiffré ; décision de poursuivre |

**Critère de sortie (revue) :** le service démarre de manière sécurisée, accède aux bibliothèques en lecture seule et permet de parcourir leur structure.

### B — Lecture des contenus

| Sous-lot | Contenu | Taille | Vérifié |
| --- | --- | --- | --- |
| B1 | Pages des dossiers d'images et des CBZ/ZIP, en flux ; tri naturel des pages ; types par premiers octets ; limites ; erreurs lisibles pour une archive invalide | M | Tests sur archives fabriquées |
| B2 | Couverture simple | S | Couverture d'une série à archives et d'une série à dossiers |
| B3 | Stratégie d'invalidation du §4.8, documentée dans le `README` du service | M | Un test par ligne du tableau des événements |
| B4 | Essais sur le NAS avec des contenus réels (colonne « Étape B ») | S | Compte rendu ; poids des couvertures mesuré |

**Critère de sortie (revue) :** un chapitre peut être parcouru et lu de manière fiable, y compris avec des contenus réels présents sur le NAS.

### C — Intégration dans Scrollarr

Préalables : tâches T1, T2 et T4a ci-dessous.

| Sous-lot | Contenu | Taille | Vérifié |
| --- | --- | --- | --- |
| C1 | `readers/folders.js` (sans progression), registre, nginx et `servers.json`, trois lignes de `sw.js`, libellé traduit, relais du faux serveur ; navigation bibliothèque → série → chapitre → lecture | M | Bout en bout ; en-têtes nginx ; service worker ; scripts existants inchangés |
| C2 | Stockage de la progression (§4.6) et routes ; capacités de progression déclarées ; « en cours », « récents », filtre par état ; adaptations de l'interface pour une installation sans stockage (§4.3) ; texte de l'état vide | M | Reprise après rechargement, après redémarrage du service, après coupure réseau |
| C3 | Progression rattachée au profil (P2) : capacité, délégation dans la façade, oubli d'un profil supprimé | M | Deux appareils, un profil secondaire, une série Dossiers : la progression suit ; `e2e_profiles`, `e2e_merge`, `e2e_sync` inchangés |
| C4 | Essais sur le NAS, téléphone compris (colonne « Étape C ») ; documentation d'installation | S | Parcours complet en mode `password` derrière HTTPS |

**Critère de sortie (revue) :** le parcours de lecture complet fonctionne dans Scrollarr et la progression est conservée.

Aucune version n'est publiée entre C2 et C3, sinon il faut prévoir de renvoyer au service les progressions restées sur les appareils.

### D — Améliorations ultérieures

Aucune ne doit retarder la première version utilisable : dimensions des pages ; miniatures (redimensionnement, dépendance native) ; notifications (source `folders` dans le notifier) ; index conservé sur disque et autres optimisations, si les mesures le justifient ; identifiants persistants ; découverte (nouveaux chapitres, nouvelles séries, « à suivre »), qui suppose de mémoriser une date de première observation ; capacité `library.scan` (ROADMAP l.256) et bouton « Rescanner » ; métadonnées ; CBR ; migration vers un stockage central.

### Tâches techniques suivies à part

Issues de l'annexe A et de la revue (§6). Elles ne font pas partie de READ-002 mais sont à ouvrir comme tâches distinctes.

| Tâche | Contenu | Taille | Lien avec READ-002 |
| --- | --- | --- | --- |
| T1 — Faire respecter `chapter.progress.write` | Façade (`api.js` l.323-344, l.356-367) et vues (`views/series.js` l.167-177) : ne rien enregistrer et ne proposer aucune action de lecture quand la capacité manque. **Test avec un lecteur qui ne la déclare pas.** Trancher aussi `tests/unit_contracts.mjs` l.13, qui accepte aujourd'hui un tel lecteur : soit le cas est pris en charge et testé (recommandé), soit le contrat le refuse. | S | Préalable à C1, dont le lecteur est précisément sans progression |
| T2 — En-têtes de `/servers.json` | Répéter les trois en-têtes de sécurité dans ce `location` (`default.conf.template` l.51-55) : la directive `add_header_inherit` n'existe que depuis nginx 1.29.3, l'image utilise la 1.27 (`Dockerfile` l.2). Ajouter le test automatisé des en-têtes (§4.11). | S | Préalable à C1, qui ajoute un `location` |
| T3 — Fichier de verrouillage du notifier | `package-lock.json` et `npm ci` dans `notifier/Dockerfile` (l.7-8) | S | Indépendant |
| T4 — Progression des profils secondaires quand profil et serveur propriétaire diffèrent | (a) Un document destiné à un serveur sans stockage ne doit plus bloquer l'envoi des autres (annexe A, point 6). (b) Décider P1 ou P2. (c) La liste des profils est remplacée, non fusionnée, par celle du serveur prioritaire (annexe A, point 7). (d) Documents orphelins quand un profil est supprimé pendant qu'un serveur est arrêté. | S pour (a), M pour le reste | (a) est un préalable à C1 ; (b) est le sous-lot C3 |

## 6. Risques et questions ouvertes

### Risques

| N° | Risque | Réponse |
| --- | --- | --- |
| R1 | Glissement vers « un Komga en moins bien » | Périmètre du §2 ; tout ajout passe par l'étape D |
| R2 | Installation « dossiers seuls » perçue comme incomplète (pas de profils) | Dit clairement dans l'interface et la documentation ; se résout par le stockage central, pas par le connecteur |
| R3 | P2 touche la partie la plus délicate de la façade | Dernier sous-lot ; scripts de profils et de synchronisation inchangés comme critère |
| R4 | Lecture seule non récursive sur un noyau ancien ; passerelle joignable depuis un réseau interne | Mesuré et consigné à l'étape A |
| R5 | Droits de lecture sur un dossier partagé Synology | Essai réel à l'étape A |
| R6 | Renommages qui font perdre la progression et l'abonnement | Documenté ; identifiants persistants à l'étape D |
| R7 | Sortie de veille des disques plus longue que le délai de l'application | Mesuré à l'étape A ; délai ajustable dans le module lecteur |
| R8 | Couverture trop lourde sans redimensionnement | Mesuré à l'étape B ; miniatures à l'étape D |
| R9 | Analyse de fichiers non fiables | Aucune dépendance native en V1, limites, flux, conteneur durci |

### Questions pour Julien

Les questions de la version 1 tranchées par la revue ont été retirées (service dédié, nom, formats, renommage, authentification avant l'intégration, couvertures, notifications).

| N° | Question | Réponse recommandée |
| --- | --- | --- |
| Q1 | Installation « dossiers seuls » : accepter qu'elle n'ait ni profils ni abonnements synchronisés tant qu'il n'existe pas de stockage central (D1) ? | Oui. Sinon, décider d'abord le stockage central (API-001) plutôt que d'en loger un dans le connecteur. |
| Q2 | Progression des profils secondaires sur les séries Dossiers : capacité « progression par profil » (P2), ou limitation à l'appareil en V1 (P1) ? | P2, en dernier sous-lot de C. P1 si la plus petite V1 prime. |
| Q3 | La revue range les listes « en cours » parmi ce qui alourdit l'étude. Les garder en V1, déduites de la progression ? | Oui pour « en cours » et « récents » : sans elles, la reprise en un geste depuis l'accueil n'existe pas pour les dossiers. Non pour « à suivre ». |
| Q4 | `seriesUpdated` alimenté par la date des dossiers, pour que l'accueil d'une installation « dossiers seuls » ne dise pas « bibliothèque vide » ? | Oui ; alternative : corriger la condition de l'état vide dans `views/home.js`. |
| Q5 | Peux-tu fournir la liste des noms de dossiers et de fichiers d'une bibliothèque réelle (noms seuls) ? | Oui : elle devient le corpus de tests du nommage. |
| Q6 | Ordre de grandeur de la bibliothèque, et part de dossiers d'images par rapport aux CBZ ? | Sert à fixer les limites et à lire les mesures de l'étape A. |
| Q7 | L'instance est-elle, ou sera-t-elle, joignable depuis Internet ? | Si oui, mode `password` dès le premier essai réel. |
| Q8 | Lecture ZIP : `yauzl` ou lecteur maison sans dépendance ? | `yauzl`, version verrouillée. |
| Q9 | Seuil d'acceptation du démarrage à froid sur le NAS ? | Proposition : moins d'une minute pour la bibliothèque réelle ; au-delà, l'index conservé remonte de l'étape D. |
| Q10 | T1 : prendre en charge un lecteur sans progression, ou l'interdire dans le contrat ? | Le prendre en charge. |

## Annexe A — Constats sur le code actuel

Points 1 à 4 : version 1. Points 5 à 9 : relevés pour cette révision. Tous sont **déduits de la lecture du code, non exécutés**, sauf mention contraire.

1. **`chapter.progress.write` n'est pas vérifiée** par la façade ni par les vues (`api.js` l.333-334, l.356-367 ; `views/series.js` l.167-177) ; `api.can` (l.86) n'a aucun appelant. → T1.
2. **`/servers.json` ne reçoit pas les en-têtes de sécurité** : son `location` définit son propre `add_header` (`default.conf.template` l.53), ce qui annule l'héritage de ceux des lignes 36-38. → T2.
3. **`notifier/Dockerfile` installe sans fichier de verrouillage** (l.7-8). → T3.
4. **La progression d'un profil secondaire est écrite sur le serveur propriétaire de la série** (`profiles.js` l.226) ; seuls la liste des profils et les abonnements sont recopiés partout (`api.js` l.546-547). → T4.
5. **Sans `'folders/'` dans `SERVERS`, le service worker traiterait `/folders/` comme la coquille** (`sw.js` l.53-60, l.93-109) : réponses d'API servies depuis le cache et réécrites dedans.
6. **Un lecteur sans stockage bloquerait la synchronisation des profils secondaires des autres serveurs.** L'envoi parcourt les documents en attente dans l'ordre et s'arrête à la première erreur (`profiles.js` l.205-240) ; un document destiné à un serveur sans `settings.store` échoue toujours (`api.js` l.520-522) et repasse en tête à chaque tentative. → T4a, préalable à C1.
7. **La liste des profils est remplacée, non fusionnée**, par celle du premier serveur qui répond (`profiles.js` l.245-253 ; `api.js` l.541-545). Si le serveur prioritaire était arrêté quand un profil a été créé, sa copie périmée peut faire disparaître ce profil de l'appareil, qui retombe alors sur le profil principal (l.253). → T4c. Une copie supplémentaire dans le service Dossiers aurait multiplié ces occasions : argument de plus pour D1.
8. **Un 404 sur une série supprime l'abonnement** (`store.js` l.131, l.139). D'où l'état « indisponible » en 503 du §4.8.
9. **Créer un profil sans aucun serveur à stockage** laisse un profil fantôme sur l'appareil et affiche une erreur de serveur injoignable (`profiles.js` l.42-49 ; `views/profiles.js` l.17-18). **L'état vide de l'accueil** mentionne Komga quel que soit le serveur (`views/home.js` l.32-35).

## Annexe B — Sources et points non vérifiés

**Vérifié dans la documentation (novembre 2026) :**

| Sujet | Source |
| --- | --- |
| `yauzl` : MIT, v3.4.0, dépendance `pend`, répertoire central, méthodes 0 et 8, ZIP64, `validateEntrySizes` par défaut | README et `package.json` du dépôt GitHub du projet yauzl |
| Licence unRAR, clause 2 | Liste des licences SPDX, entrée « UnRAR License » |
| libarchive : RAR et RAR 5.0 « with some limitations » | README du dépôt GitHub du projet libarchive |
| Komga : CBZ, CBR, EPUB, PDF ; 7z non pris en charge ; processus Java limité « usually 1gb » par défaut | Documentation de Komga : *Introduction*, *FAQ*, *Installation > Docker* |
| Source locale de Mihon : dossiers ou ZIP/CBZ ; dossiers internes d'une archive ignorés ; `cover.jpg` | Documentation de Mihon : *Local source*, *Advanced* |
| Suwayomi : réglage `server.localSourcePath` | Wiki du dépôt de Suwayomi-Server |
| nginx : `autoindex_format json` ; règle d'héritage de `add_header` ; `add_header_inherit` depuis 1.29.3 | Documentation de nginx : `ngx_http_autoindex_module`, `ngx_http_headers_module` |
| Docker : sous-montages d'un montage en lecture seule inscriptibles avant le noyau 5.12 ; récursif par défaut depuis Engine 25.0 | Documentation de Docker : *Bind mounts*, notes de version *Engine 25.0* |
| Compose : `internal: true` crée « an externally isolated network » ; un service n'accède qu'aux réseaux qui lui sont attribués | Documentation de Compose : référence du fichier, *Networks* |
| Réseau interne : pas de route par défaut, règles de pare-feu ; passerelle joignable ; l'hôte peut joindre les conteneurs | Documentation de Docker : référence de `docker network create`, option `--internal` |
| Résolution par nom sur un réseau défini par l'utilisateur | Documentation de Docker : pilote *bridge* |
| Compose : profils, `COMPOSE_PROFILES` surchargeable par `.env` | Documentation de Compose : *Using profiles*, *Pre-defined environment variables* |
| Node 22 : `node:sqlite` « Stability: 1.1 – Active development » ; `fs.watch` fondé sur inotify, peu fiable sur NFS/SMB et sous Docker | Documentation de Node.js 22 : `doc/api/sqlite.md`, `doc/api/fs.md` |
| AVIF : Chrome 85, Firefox 93, Safari iOS 16.0 | Base « Can I use » |
| CORS : un en-tête personnalisé ou `application/json` impose une pré-vérification ; `Cross-Origin-Resource-Policy: same-origin` | MDN : *CORS*, *Cross-Origin-Resource-Policy* |

**Vérifié localement (Node 22.23, système de fichiers ext4) :**

- `fs.constants.O_NOFOLLOW` existe ; `Intl.Collator` avec `numeric: true` trie `ch1 < Ch1.5 < ch2 < ch10` et place `[A] 002` avant `[B] 001` (d'où le retrait des étiquettes entre crochets).
- Ajouter un fichier dans `série/tome/chapitre/` change la date de `chapitre/` mais ni celle de `tome/` ni celle de `série/`.
- Modifier le contenu d'un fichier ne change pas la date de son dossier ; le renommer la change.
- Remplacer un fichier par un autre de même taille : le quadruplet (inode, taille, date de modification, `ctime`) change. Réécrire un fichier sur place puis restaurer sa date : taille et date identiques, quadruplet différent.

**Non vérifié — à ne pas tenir pour acquis :**

- Comportement de l'inode et de `ctime` sur les systèmes de fichiers du NAS et sur un partage réseau monté ; la page de manuel Linux correspondante n'a pas pu être consultée.
- Docker : existence et version d'un mode de passerelle « isolé » pour un réseau interne ; comportement exact du pare-feu Docker sur Synology.
- Synology : versions du moteur Docker et du noyau, prise en charge des profils Compose par Container Manager, ACL pour un utilisateur de conteneur, origine exacte de `@eaDir` et `#recycle` (fils de forum seulement).
- Komga et les dossiers d'images en vrac (absents de sa liste de formats, non essayé). Formats de la source locale de Suwayomi.
- Statut « licence libre » de la licence unRAR ; licences des moteurs de rendu PDF.
- Empreinte mémoire du service, durées de parcours, délai de sortie de veille : à mesurer à l'étape A.
- Tous les constats de l'annexe A (lecture du code, sans exécution), et l'estimation « 40 à 60 lignes » pour P2.
