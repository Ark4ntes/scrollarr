# Scrollarr

[English](README.md) · **Français**

Lecteur vertical continu pour une bibliothèque de mangas auto-hébergée : on fait défiler un chapitre d'un seul geste, on enchaîne sur le suivant, on reprend exactement où l'on s'était arrêté. Application web installable (PWA), sans compte tiers ni télémétrie. Licence MIT.

Scrollarr se branche sur [Suwayomi](https://github.com/Suwayomi/Suwayomi-Server), sur [Komga](https://komga.org), ou sur les deux à la fois. Avec son service Dossiers facultatif, elle sait aussi lire de simples dossiers de scans (dossiers d'images, CBZ/ZIP) sans l'un ni l'autre. D'autres serveurs peuvent être ajoutés sous forme de connecteurs.

Projet indépendant, sans lien avec Suwayomi, Komga ni aucun service de lecture commercial.

| Accueil | Fiche série | Lecteur | Fin de chapitre |
| --- | --- | --- | --- |
| ![Accueil](docs/screenshots/home.png) | ![Fiche série](docs/screenshots/series.png) | ![Lecteur](docs/screenshots/reader.png) | ![Fin de chapitre](docs/screenshots/next-chapter.png) |

| Bibliothèque fusionnée | Serveurs | Hors ligne | Profils |
| --- | --- | --- | --- |
| ![Bibliothèque](docs/screenshots/library.png) | ![Serveurs](docs/screenshots/servers.png) | ![Hors ligne](docs/screenshots/offline.png) | ![Profils](docs/screenshots/profiles.png) |

*Captures réalisées avec la bibliothèque de démonstration fournie dans `dev/` (interface en anglais ; elle existe aussi en français).*

## Ce que fait l'application

- **Lecture en bande verticale** : pages empilées sans marge (ou avec, au choix), chargées à l'approche et libérées quand elles sont loin, pour tenir sur de longs volumes.
- **Barres qui s'effacent** au défilement, reviennent d'un toucher ; curseur de page ; défilement automatique à vitesse réglable ; écran maintenu allumé.
- **Reprise et progression** : la page courante est enregistrée sur le serveur, donc partagée avec ses autres clients (interface de Suwayomi, Mihon, lecteur de Komga…). Hors ligne, la progression est mise en attente puis renvoyée.
- **Enchaînement** : carte « chapitre suivant » en fin de lecture, premières pages du suivant préchargées.
- **Accueil** : reprise en un geste, nouveaux chapitres, nouvelles séries, mises à jour.
- **Bibliothèque** : filtres par bibliothèque ou catégorie, genre, état de lecture ; tri ; recherche.
- **Abonnements** : suivez une série, un badge « UP » signale les chapitres arrivés depuis votre dernière visite. La liste est recopiée sur vos serveurs pour vous suivre d'un appareil à l'autre.
- **Hors ligne** : téléchargez des chapitres sur l'appareil et lisez-les sans connexion.
- **Ajout depuis les sources** (avec Suwayomi) : depuis l'écran de recherche, l'action explicite « Chercher chez les sources » cherche le titre dans les sources de votre Suwayomi et l'ajoute à la bibliothèque ; sa fiche propose ensuite le menu de téléchargement habituel. Rien n'est envoyé à une source tant que vous ne le demandez pas.
- **Notifications push** (service facultatif) quand un chapitre arrive dans une série suivie.
- Thème clair ou sombre, interface en français et en anglais.

### Un serveur, ou plusieurs

L'installation déclare les serveurs disponibles ; chaque personne choisit ensuite, dans *Réglages > Serveurs*, ceux qu'elle utilise.

| | Suwayomi | Komga |
| --- | --- | --- |
| Ce qui est affiché | Les mangas de la bibliothèque Suwayomi, classés par catégorie | Les séries, classées par bibliothèque |
| Chapitres | Téléchargés sur le serveur, ou lus en direct depuis la source | Fichiers présents sur le disque (CBZ, CBR, PDF) |
| Authentification | Aucune, « basic auth », « simple login » ou « UI login » : détectée automatiquement | Compte Komga |
| En plus | Demander au serveur de télécharger des chapitres | Conversion à la volée des images non lisibles par le navigateur |

Avec deux serveurs actifs, les listes sont fusionnées. Quand une série porte le même titre des deux côtés (cas courant : Suwayomi télécharge, Komga scanne le même dossier), une seule est affichée ; le réglage *Quand une série existe sur plusieurs serveurs* choisit laquelle, ou les montre toutes les deux. La progression de lecture reste propre à chaque serveur.

### Profils

Plusieurs personnes peuvent partager la même installation sans partager leur historique : *Réglages > Profil > Gérer les profils*.

- Le profil **principal** utilise l'historique du serveur lui-même ; il reste donc commun avec l'interface de Suwayomi ou de Komga.
- Chaque **autre profil** a sa propre progression et ses propres abonnements. Ils sont rangés sur le serveur (dans les « meta » de Suwayomi ou les « client settings » de Komga), sans toucher à l'historique du serveur, et suivent le profil d'un appareil à l'autre.
- Quand plusieurs profils existent, un nouvel appareil demande « Qui lit ? » à la première ouverture, puis s'en souvient.

Les profils ne sont pas des comptes : il n'y a pas de mot de passe et chacun peut ouvrir tous les profils. Ils ne protègent pas non plus l'accès au serveur (voir *Sécurité*). Avec Komga, des comptes Komga distincts donnent déjà des historiques séparés et protégés.

Scrollarr ne parcourt pas les sources de Suwayomi et n'ajoute pas de manga à sa bibliothèque : cela se fait dans l'interface de Suwayomi.

## Comment c'est construit

```
navigateur ──► nginx (conteneur scrollarr)
                 ├── /            fichiers statiques de l'application (dossier app/)
                 ├── /suwayomi/   proxy vers Suwayomi
                 ├── /komga/      proxy vers Komga
                 ├── /folders/    proxy vers le service Dossiers (facultatif)
                 ├── /servers.json  serveurs configurés sur cette installation
                 └── /notify/     proxy vers le notifier (facultatif)
```

L'application est du JavaScript natif en modules ES, sans étape de compilation : ce qui est dans `app/` est ce qui est servi. Le proxy place chaque serveur sous la même origine que l'application, ce qui permet à sa session de servir aussi au chargement des images.

| Dossier | Rôle |
| --- | --- |
| `app/` | L'application (HTML, CSS, JS, service worker) |
| `app/js/connectors/` | Connecteurs, rangés par rôle : `readers/` (ce qu'on lit) et `collectors/` (ce qui va chercher les chapitres) |
| `nginx/` | Configuration du serveur web et des proxys |
| `notifier/` | Petit service Node qui envoie les notifications push |
| `folders/` | Petit service Node qui lit des dossiers de scans pour le lecteur « Dossiers » (facultatif) |
| `dev/` | Faux serveurs pour développer, script de vérification |

## Installation

Prérequis : Docker, au moins un serveur (Suwayomi ou Komga) qui fonctionne, et une adresse **HTTPS** pour Scrollarr (obligatoire pour l'installation sur l'écran d'accueil, le mode hors ligne et les notifications).

Scrollarr est publié sous forme d'images prêtes à l'emploi : inutile de copier le dépôt. Les trois images (`ghcr.io/ark4ntes/scrollarr`, `scrollarr-notifier` et `scrollarr-folders`, pour `amd64` et `arm64`) portent le même numéro de version et sont publiées à chaque version. Si aucune version n'est encore listée dans les *Releases* du dépôt, construisez les images depuis un clone (voir l'alternative ci-dessous).

1. Créez un dossier sur la machine, par exemple `/volume1/docker/scrollarr`, et téléchargez-y les deux fichiers nécessaires :
   ```sh
   curl -O https://raw.githubusercontent.com/Ark4ntes/scrollarr/main/deploy/docker-compose.yml
   curl -o .env https://raw.githubusercontent.com/Ark4ntes/scrollarr/main/.env.example
   ```
   Modifiez `.env` : renseignez `SUWAYOMI_URL` et/ou `KOMGA_URL`, l'adresse de chaque serveur vue depuis le conteneur (par exemple `http://192.168.1.10:4567`). Laissez vide celui que vous n'utilisez pas. Pour lire de simples dossiers à la place, voir *Service Dossiers* plus bas (`FOLDERS_URL`).
2. Démarrez :
   ```sh
   docker compose up -d
   ```
   L'application répond sur le port `8380` (modifiable avec `SCROLLARR_PORT`).
3. Publiez-la en HTTPS avec votre proxy inverse. Sur un NAS Synology : *Panneau de configuration > Portail de connexion > Avancé > Proxy inversé*, source `https://scrollarr.exemple.fr:443`, destination `http://localhost:8380`, puis associez le certificat dans *Sécurité > Certificat*.
4. Ouvrez l'adresse. Si un serveur demande une authentification, Scrollarr affiche son formulaire ; sinon vous arrivez directement sur l'accueil.

### Mettre à jour

```sh
docker compose pull && docker compose up -d
```

puis rechargez l'application deux fois dans le navigateur (ou acceptez le message de mise à jour) : chaque appareil garde l'ancienne version en cache jusque-là. Ajoutez `--profile push` ou `--profile folders` aux deux commandes si vous utilisez ces services. La version installée s'affiche dans *Réglages > À propos*.

Pour figer une version ou revenir à la précédente, mettez son numéro dans `.env` (`SCROLLARR_VERSION=0.9.0`, ou `0.9` pour ne recevoir que les correctifs de cette série) et relancez `docker compose up -d`. Vos réglages sont dans `.env`, les données des services facultatifs dans `./data` : une mise à jour n'y touche pas.

**Alternative : depuis un clone.** Copiez le dépôt, puis `cp .env.example .env`, renseignez-le comme ci-dessus et lancez `docker compose up -d --build` : les images sont construites localement au lieu d'être téléchargées.

**Sans Compose.** L'image suffit ; les deux variables sont facultatives et vides par défaut (une adresse vide signifie que le serveur n'est pas configuré) :

```sh
docker run -d --name scrollarr --restart unless-stopped -p 8380:80 \
  -e SUWAYOMI_URL=http://192.168.1.10:4567 -e KOMGA_URL= \
  ghcr.io/ark4ntes/scrollarr:latest
```

**Surveillance de santé.** Les deux images en déclarent une : Scrollarr interroge `/servers.json` toutes les 30 secondes, le notifier appelle son point d'accès `/health`. `docker ps` (ou Container Manager sur Synology) affiche `healthy` ou `unhealthy` en face de chaque conteneur.

### Avant de déployer : vérifier la compatibilité avec votre Suwayomi

Depuis n'importe quelle machine du réseau disposant de Node 20 ou plus :

```sh
node dev/check-suwayomi.mjs http://192.168.1.10:4567
```

Le script rejoue les requêtes de lecture de Scrollarr contre votre serveur et indique celles qu'il refuse. Il ne modifie rien.

### Chercher et ajouter depuis les sources de Suwayomi

Sur l'écran de recherche, sous les résultats de la bibliothèque, **Chercher chez les sources de Suwayomi** demande à Suwayomi de chercher le titre dans les sources (extensions) choisies, trois au plus en même temps. Les résultats sont groupés par source, avec leur couverture et leur langue ; « Ajouter » met la série dans votre bibliothèque Suwayomi, récupère sa liste de chapitres et ouvre sa fiche, où s'applique le menu de téléchargement (« Faire télécharger toute la série par Suwayomi »). Un titre déjà dans la bibliothèque ouvre sa fiche. Une source en échec ou lente affiche sa propre erreur sans arrêter les autres. Les sources interrogées se choisissent depuis ce même écran (« Choisir les sources ») et le choix est gardé sur l'appareil ; par défaut, les sources dans la langue de l'interface ou multilingues, et jamais celles que Suwayomi signale 18+ (à cocher vous-même). L'action est absente quand aucun collecteur ne sait chercher (Komga, Dossiers) et remplacée par une explication quand le serveur est injoignable ; rien n'est mis en attente.

À savoir : une recherche fait interroger des sites tiers par Suwayomi, elle peut donc être lente ou échouer, et Suwayomi range chaque résultat dans sa base (hors bibliothèque), comme pour sa propre interface. Une série tout juste ajoutée peut n'afficher auteur, résumé et genres qu'une fois initialisée par la mise à jour de Suwayomi (l'ajout l'y met en file).

Les opérations utilisées, vérifiées dans les sources de Suwayomi-Server (voir `app/js/connectors/suwayomi-queries.js`), identiques de la v2.0.1727 à la v2.4.2366 et à la branche de développement :

| Usage | Opération |
| --- | --- |
| Sources installées (id, nom, langue, icône, indicateur 18+) | `query { sources { nodes { id name lang iconUrl isNsfw } } }` (lecture seule, aucune source n'est contactée) |
| Chercher dans une source, première page | `mutation { fetchSourceManga(input: { source: LongString!, type: SEARCH, page: 1, query }) { hasNextPage mangas { id title thumbnailUrl inLibrary } } }` |
| Ajouter à la bibliothèque | `mutation { updateManga(input: { id, patch: { inLibrary: true } }) { manga { id inLibrary } } }` |
| Récupérer la liste des chapitres chez la source | `mutation { fetchChapters(input: { mangaId }) { chapters { id } } }` |

`dev/check-suwayomi.mjs` rejoue celle qui est en lecture seule ; la recherche et l'ajout ne le sont pas, car ils contactent des sites tiers et écrivent sur le serveur. Pas encore essayé sur un vrai Suwayomi.

### Sécurité

- Un Suwayomi **sans authentification** reste sans authentification derrière Scrollarr : quiconque atteint l'adresse de Scrollarr lit et modifie la bibliothèque. Ne l'exposez pas sur Internet tel quel ; activez l'authentification de Suwayomi ou placez Scrollarr derrière un VPN.
- En mode « basic auth » ou « simple login », Suwayomi attend l'identifiant à chaque requête. Scrollarr le conserve dans un cookie du navigateur, que le proxy convertit en en-tête ; servez donc toujours Scrollarr en HTTPS. Le mode « UI login » (jeton renouvelable) évite de conserver le mot de passe.
- Scrollarr ne stocke aucun mot de passe côté serveur.

### Sur le téléphone

- **iPhone / iPad** : ouvrez l'adresse dans Safari, puis *Partager > Sur l'écran d'accueil*. Les notifications et la conservation durable des téléchargements n'existent que pour l'application ainsi installée.
- **Android** : Chrome propose *Installer l'application* dans son menu.

### Conseil côté Komga

Laissez l'option *Analyser les dimensions des pages* activée sur vos bibliothèques (elle l'est par défaut). Scrollarr réserve alors la hauteur exacte de chaque page avant son chargement, ce qui rend la reprise de lecture précise. Suwayomi ne fournit pas les dimensions : la hauteur est ajustée à l'arrivée de chaque image.

## Notifications push (facultatif)

1. Dans `.env` : renseignez `VAPID_SUBJECT` avec une adresse de contact. Pour Komga, créez une clé d'API (*Mon compte > Clés d'API*) et placez-la dans `KOMGA_API_KEY`. Pour un Suwayomi protégé, renseignez `SUWAYOMI_USER` et `SUWAYOMI_PASSWORD`.
2. Démarrez avec le profil `push` :
   ```sh
   docker compose --profile push up -d
   ```
   (depuis un clone, avant la première version publiée, ajoutez `--build`).
3. Dans Scrollarr : *Réglages > Notifications*, activez l'option, puis *Envoyer un test*.

Le notifier interroge chaque serveur toutes les `POLL_MINUTES` minutes et envoie une notification par série suivie, même si plusieurs chapitres arrivent ensemble. Ses clés et la liste des appareils abonnés sont conservées dans `data/notifier/`.

## Service Dossiers (facultatif)

`folders/` est un petit service Node qui permet à Scrollarr de lire des mangas rangés dans de simples dossiers de votre serveur, **sans Suwayomi ni Komga**. Dans l'application, c'est un troisième lecteur nommé *Dossiers*, placé en dernier dans l'ordre de priorité (quand une série porte le même titre sur un autre serveur, l'autre l'emporte). Il fournit les bibliothèques, séries et chapitres, les pages des dossiers d'images et des archives CBZ/ZIP (lues en flux, jamais extraites sur disque) et une couverture simple par série. Règles de lecture, limites et détection des changements : `folders/README.md` ; conception et décisions : `docs/design/READ-002-connecteur-dossiers.md`.

**Vous avez déjà Komga ?** Pointez plutôt Komga sur le dossier : il fait tout ce que fait le service Dossiers, et davantage. Le service Dossiers s'adresse à qui veut utiliser Scrollarr seul, ou garde de simples dossiers d'images.

Il monte vos scans **en lecture seule**, ne reçoit jamais de chemin du client (seulement des identifiants opaques), ne suit aucun lien symbolique et ne publie aucun port : seul le conteneur Scrollarr pourra le joindre, par un réseau Docker interne dédié.

```sh
mkdir -p data/folders && sudo chown 1000:1000 data/folders    # dossier de données, inscriptible par le service
echo 'FOLDERS_SCANS_PATH=/chemin/vers/scans' >> .env          # le dossier qui contient directement vos séries (voir ci-dessous)
echo 'FOLDERS_URL=http://folders:8788' >> .env                # permet à Scrollarr de joindre le service (vide = non utilisé)
docker compose --profile folders up -d --build
```

`FOLDERS_SCANS_PATH` doit désigner le dossier qui contient **directement** vos séries :

```
/chemin/vers/scans/
  Nom d'une série/        chaque sous-dossier direct est une série
    Chapitre 1/           un chapitre = un dossier d'images…
    Chapitre 2.cbz        …ou une archive CBZ/ZIP
  Autre série/
```

Un niveau trop haut (un dossier qui regroupe plusieurs collections) et chaque collection est prise pour une série. Vérifiez avec `docker compose logs folders` : le service y indique le nombre de séries et de chapitres trouvés.

Ouvrez ensuite Scrollarr : *Dossiers* apparaît parmi les serveurs (*Réglages > Serveurs*). Seul le conteneur Scrollarr atteint le service, par le réseau interne `folders_net` ; `FOLDERS_URL` est la seule chose dont l'application a besoin.

**Le service refuse de démarrer sans mode d'authentification explicite.** Renseignez `FOLDERS_AUTH` dans `.env` :

| `FOLDERS_AUTH` | Comportement |
| --- | --- |
| `password` | Un identifiant et un mot de passe partagés (`FOLDERS_USER`, `FOLDERS_PASSWORD`, 12 caractères au moins). Tout sauf `/health` exige une session (cookie signé `HttpOnly`, `SameSite=Strict`, `Secure` derrière HTTPS). Les tentatives de connexion sont limitées par adresse. |
| `none` | Aucun contrôle d'accès, avec un avertissement journalisé à chaque démarrage. `FOLDERS_USER` et `FOLDERS_PASSWORD` doivent alors être vides. |

Toute autre valeur, un mot de passe absent ou de moins de 12 caractères, une variable `FOLDERS_…` inconnue ou une limite non numérique arrête aussi le service au démarrage, avec un message d'une ligne.

**Conséquences pour la sécurité.**
- Avec `none`, quiconque atteint Scrollarr peut lister tous les noms de séries et de chapitres, lire toutes les pages, et lire ou modifier toute la progression. Il ne peut jamais écrire ni supprimer un fichier, ni atteindre un chemin hors des bibliothèques montées. À réserver à un réseau local de confiance ou à un VPN. Le service ne peut pas vérifier lui-même qu'il n'est pas exposé : derrière un proxy, l'adresse qu'il voit est celle du proxy.
- Le mot de passe partagé protège l'accès au service. Il ne **sépare pas** les personnes : tous ceux qui le connaissent voient tous les scans et peuvent lire ou modifier la progression de tous les profils (les profils ne sont pas des comptes).
- **Avant toute exposition de Scrollarr hors d'un réseau local de confiance : mode `password`, en HTTPS.**
- Les requêtes autres que `GET` doivent porter `X-Requested-With` et `Content-Type: application/json`, et un `Origin` différent de l'hôte est refusé. Cela vaut aussi sur un réseau local.

**Arborescence.** Une bibliothèque est un dossier monté sous `/libraries/<nom>` ; une série est un sous-dossier ; un chapitre est une archive `.cbz`/`.zip` ou un dossier contenant directement des images (les dossiers intermédiaires, comme les tomes, sont tolérés sur 3 niveaux au plus). L'ordre de lecture est le tri naturel des noms (`Chapitre 2` avant `Chapitre 10`). Détails, avertissements et effets d'un renommage : voir l'étude.

**Ce qui manque à une installation « dossiers seuls ».** Les profils et les abonnements sont rangés par les *serveurs* (« meta » de Suwayomi, « client settings » de Komga), et le service Dossiers n'en stocke volontairement aucun. Avec *Dossiers* comme seul serveur :
- pas de gestion des profils (les *Réglages* l'expliquent, et l'écran « Qui lit ? » est remplacé par une explication) ;
- les abonnements restent sur l'appareil qui les a faits : ils ne sont pas partagés entre appareils ;
- pas de filtre par genre, ni de rangées « Nouveaux chapitres » et « Nouvelles séries » (l'accueil montre les « Mises à jour récentes », classées par date du dossier de la série) ;
- pas de rangée « À suivre » (le chapitre suivant d'une série entamée n'est pas proposé).

Ajoutez Suwayomi ou Komga à côté et tout cela revient, rangé par ce serveur. Renommer ou déplacer le dossier d'un chapitre ou d'une série crée un nouvel élément (voir l'étude, §4.7).

**Progression de lecture.** Le service l'enregistre lui-même : elle survit aux redémarrages et elle est partagée par tous les appareils qui ouvrent le même Scrollarr (page atteinte, chapitre terminé, date). Le lecteur reprend où l'on s'est arrêté, l'*Accueil* propose « Reprendre » et les chapitres lus récemment, on peut marquer un chapitre ou une série comme lu ou non lu, et filtrer la bibliothèque par état de lecture. Hors ligne, la progression est mise en attente sur l'appareil puis renvoyée, comme avec les autres serveurs. La progression est tenue par profil. Le profil principal est l'historique commun de l'installation ; un profil secondaire (les profils demandent un serveur qui a un stockage clé-valeur, donc Suwayomi ou Komga à côté de Dossiers) a sa propre progression sur les séries Dossiers, rangée par le service sous l'identifiant du profil : elle suit la personne d'un appareil à l'autre et les autres profils ne la voient pas. Le même profil qui lit une série Suwayomi ou Komga continue de passer par ses documents sur ce serveur, comme avant. Supprimer un profil supprime aussi sa progression dans le service Dossiers (réessayé plus tard si le service est arrêté). Deux appareils d'un même profil qui écrivent le même chapitre : la dernière écriture gagne, il n'y a pas de fusion par révision comme avec Suwayomi et Komga. Le service regroupe les écritures : une écriture par fichier au plus toutes les `FOLDERS_PROGRESS_FLUSH_SECONDS` secondes (3 par défaut, 0 = immédiat, 60 au plus), et une dernière à l'arrêt normal ; un arrêt brutal (`SIGKILL`, coupure de courant) ne peut faire perdre que les dernières secondes.

**Données.** `data/folders/` contient la clé de signature des sessions, un petit fichier qui retient quelles bibliothèques ont déjà contenu des séries, et `progress/` (un petit fichier JSON par série et par profil). Sauvegarde : copier ce dossier. Un fichier de progression illisible est mis de côté sous `<nom>.json.corrupt` (jamais réécrit par-dessus) et la série repart de zéro ; un avertissement, sans aucun chemin, est écrit dans les journaux. Une bibliothèque illisible, ou vide alors qu'elle contenait des séries (partage non monté, dossier chiffré verrouillé), est signalée `unavailable` par `/health` et répond `503`, jamais `404` : avec un `404`, l'application supprimerait vos abonnements.

**Essayer sans NAS.**

```sh
node dev/make-folders-fixture.mjs /tmp/folders-demo
FOLDERS_AUTH=none FOLDERS_LIBRARIES_DIR=/tmp/folders-demo/libraries FOLDERS_DATA_DIR=/tmp/folders-demo/data node folders/server.js
curl localhost:8788/api/v1/libraries
```

## Développer

Aucune dépendance pour l'application :

```sh
node dev/mock-servers.mjs
# http://localhost:8380 — Komga : demo@scrollarr.local / demo
```

Le serveur de démonstration imite Suwayomi et Komga avec une bibliothèque fabriquée.

| Variable | Effet |
| --- | --- |
| `SERVERS=suwayomi` | Ne « configure » que certains serveurs (`suwayomi`, `komga`, `folders`, séparés par des virgules) |
| `SUWA_AUTH=none\|basic\|simple\|ui` | Mode d'authentification du faux Suwayomi (identifiants `demo` / `demo`) |
| `NOTIFIER=http://127.0.0.1:8787` | Relaie `/notify/` vers un notifier local |
| `FOLDERS=http://127.0.0.1:8788` | Relaie `/folders/` vers un vrai service Dossiers (`SERVERS=folders`) ; voir `tests/e2e_folders.py` |

`POST /suwayomi/__mock/add-chapter?manga=2` et `POST /komga/__mock/add-book?series=S004` simulent l'arrivée d'un chapitre.

Points d'entrée utiles :

- `app/js/api.js` : la façade appelée par les écrans ; répartit vers les connecteurs et fusionne les listes.
- `app/js/connectors/readers/` : `komga.js` (REST), `suwayomi.js` (GraphQL). `collectors/suwayomi.js` demande à Suwayomi de télécharger des chapitres. Les deux modules Suwayomi partagent `suwayomi-client.js` (session, requêtes) et `suwayomi-queries.js`.
- `app/js/profiles.js` : les profils et leur historique.
- `app/js/views/reader.js` : le lecteur.
- `app/js/i18n.js` : les traductions (le français sert de clé ; ajoutez un dictionnaire pour une nouvelle langue).
- `app/css/app.css` : les couleurs et la typographie sont des variables en tête de fichier.

Pour lancer le vrai conteneur sur votre copie de travail (`app/` et le modèle nginx montés en lecture seule, les modifications apparaissent sans reconstruire) :

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

### Écrire un connecteur

Un connecteur est une fonction `create({ base })` qui renvoie un objet. `base` est le préfixe du proxy (`/monserveur`). Les séries et chapitres renvoyés suivent la forme des objets de Komga, qui sert de modèle commun ; les identifiants sont ceux du serveur, la façade se charge de les préfixer.

| Membre | Rôle |
| --- | --- |
| `id`, `code`, `label`, `userLabel` | Identifiant, préfixe d'une lettre, nom affiché, libellé du champ identifiant |
| `capabilities` | Ce que le serveur sait faire, parmi les capacités « lecteurs » de `app/js/connectors/contract.js` ; l'interface ne propose que ce qui est déclaré |
| `session()`, `login(user, password)`, `logout()` | Session ; `session()` lève `AuthError` si une connexion est requise |
| `libraries()`, `genres()` | Filtres de la bibliothèque |
| `seriesList({ libraryId, genre, readStatus, search, sort, page, size })` | Renvoie `{ content, last }` |
| `seriesNew(n)`, `seriesUpdated(n)`, `series(id)`, `seriesBooks(id)` | Séries et chapitres dans l'ordre de lecture |
| `booksLatest(n)`, `booksOnDeck(n)`, `booksInProgress(n)`, `booksRecentlyRead(n)` | Rangées de l'accueil et de « Ma liste » |
| `book(id)`, `bookPages(id)`, `nextBook(id)`, `previousBook(id)` | `bookPages` renvoie `[{ number, url, mediaType, width?, height?, fallbackUrl? }]` |
| `seriesThumb(id)`, `bookThumb(id)` | Adresses des couvertures |
| `saveProgress(id, page, completed)`, `markBookRead/Unread(id)`, `markSeriesRead/Unread(id)` | Progression |
| `getSettings(prefix)`, `setSetting(key, value)`, `deleteSettings(keys)` | Petit stockage clé-valeur côté serveur (abonnements, profils) |
| `setProfile(id)`, `forgetProfile(id)` | Seulement avec `chapter.progress.profiles` (qui exige aussi `chapter.progress.read` et `.write`) : le serveur tient lui-même la progression de chaque profil. La façade lui indique le profil ouvert (`'main'` ou l'identifiant d'un profil secondaire) et n'applique pas la surcouche des profils à ses chapitres ; `forgetProfile` est appelé à la suppression d'un profil. Le connecteur joint le profil à chaque lecture et écriture de progression |

Le contrat est vérifié au démarrage par `validateReader()` dans `app/js/connectors/reader-contract.js` : un connecteur incomplet échoue tout de suite au lieu de mal se comporter plus tard.

Il reste à l'inscrire sous `READERS` dans `app/js/connectors/index.js`, à ajouter son proxy et sa ligne `servers.json` dans `nginx/default.conf.template`, et les adresses de ses pages et couvertures dans `app/sw.js` (lecture hors ligne).

### Écrire un collecteur

Un collecteur va chercher des chapitres ; il n'a pas à lister une bibliothèque ni à servir des pages. Il se range dans `app/js/connectors/collectors/` et suit `collector-contract.js`, vérifié au démarrage par `validateCollector()`.

| Membre | Rôle |
| --- | --- |
| `id`, `label` | Identifiant et nom affiché |
| `capabilities` | Parmi les capacités « collecteurs » de `contract.js` (`collect.chapters`, `collect.tasks`, `collect.cancel`, `collect.retry`, `collect.sources`, `collect.search`, `collect.add`) |
| `serves` | Lecteurs dont il comprend les identifiants de chapitre (`['suwayomi']`) ; vide s'il n'en partage avec aucun |
| `session` | Nom du lecteur dont il réutilise la session. Sans cela, le collecteur a son propre serveur et fournit `session()`, `login()`, `logout()` |
| `collectChapters(readerId, chapterIds)` | Avec `collect.chapters` : récupérer des chapitres désignés par les identifiants de ce lecteur |
| `tasks()`, `resolveTasks(nativeIds)` | Avec `collect.tasks` : ce que le collecteur fait en ce moment, et ce que sont devenues les tâches qu'il ne liste plus |
| `cancelTask(nativeId)` | Avec `collect.cancel` |
| `retryTask(nativeId)` | Avec `collect.retry` : relancer une tâche en échec ou annulée |
| `sources()` | Avec `collect.sources` : où il sait chercher, sous la forme `[{ id, label, language, nsfw, icon }]` |
| `search(sourceId, query)` | Avec `collect.search` (exige `collect.sources`) : chercher un titre dans une source, renvoie `{ results, more }` |
| `add(resultId)` | Avec `collect.add` (exige `collect.search`) : ajouter ou suivre un résultat, renvoie `{ reader, seriesId, complete }` |

Les tâches de tous les collecteurs sont ramenées à une seule forme par `app/js/tasks.js` : identifiant, collecteur, série et chapitre, état (`queued`, `running`, `done`, `failed`, `cancelled`), progression, dates de création, de début et de fin, erreur, nombre de tentatives, et possibilité d'annuler. L'application garde ce qu'un collecteur oublie (dates, tâches terminées). Les réglages n'en montrent qu'un résumé (collecteurs, nombre de téléchargements actifs) ; le détail est sur un écran secondaire ouvert depuis là, avec les téléchargements en cours, la file d'attente, les erreurs et l'historique, et les actions d'annulation et de relance que chaque collecteur permet. La collecte n'a jamais d'onglet à elle : elle reste en arrière-plan tant qu'on ne vient pas la regarder. L'historique des tâches terminées est partagé entre appareils : un document unique pour l'installation (pas par profil) dans le stockage clé-valeur des serveurs, fusionné par identifiant de tâche (une tâche terminée l'emporte sur la même tâche encore active ailleurs, sauf si celle-ci est une nouvelle demande ; « Effacer l'historique » laisse des marques que les autres appareils respectent). Les tâches en cours ne sont pas partagées : chaque appareil les reçoit du collecteur. Sans serveur offrant ce stockage, l'historique reste propre à chaque appareil. Les dates que le collecteur ne fournit pas sont celles où l'application a constaté le changement.

Un collecteur peut aussi partir d'un titre plutôt que d'un chapitre qu'un lecteur affiche déjà, avec les trois capacités de recherche, chacune exigeant la précédente. Les formes sont décrites en tête de `collector-contract.js`, où `normalizeSource`, `normalizeResult`, `normalizeSearch` et `normalizeAdded` les vérifient :

- Une **source** est `{ id, label, language, nsfw, icon }`. `nsfw` est l'indication du serveur lui-même ; l'application ne cherche pas dans ces sources tant qu'on ne les a pas choisies.
- Un **résultat** est `{ id, title, cover, sourceId, sourceLabel, language, inLibrary, reader, seriesId }`. `id` est propre au collecteur et opaque pour l'application, qui le rend tel quel à `add()`. `cover` et l'`icon` d'une source sont des chemins de même origine (par le proxy), jamais des adresses externes : la politique de sécurité n'autorise aucune image externe. `inLibrary` dit que le collecteur le tient déjà. `reader` et `seriesId` désignent la série correspondante d'un lecteur que le collecteur sert, tous deux ou aucun, et seulement si `inLibrary`.
- `add()` renvoie `{ reader, seriesId, complete }` : la série qui existe désormais chez le lecteur, et `complete: false` si elle est ajoutée mais que sa liste de chapitres n'a pas encore pu être récupérée.
- Un collecteur qui ne partage aucun identifiant avec un lecteur (Tranga, Mangarr) déclare un `serves` vide et renvoie `reader: null, seriesId: null` partout où Suwayomi renvoie une série du lecteur. Il peut quand même dire `inLibrary: true` (« déjà suivi »), mais la série n'existe chez un lecteur qu'une fois ses fichiers récupérés et scannés, et on ne sait pas laquelle avant. L'application ne propose alors aucun lien.
- Une recherche interroge des sites tiers : l'application n'en lance une que sur une action explicite de l'utilisateur, une source à la fois avec un parallélisme borné, et une source en échec ne fait jamais échouer les autres. `search()` lève une erreur pour cette seule source.

Il s'inscrit sous `COLLECTORS` dans `app/js/connectors/index.js`.

## État du projet et limites connues

- **Vérifié** : les parcours complets (Suwayomi seul, Komga seul, les deux ensemble, les quatre modes d'authentification de Suwayomi, hors ligne, profils) passent dans Chrome contre les faux serveurs de `dev/`. La configuration nginx a été exécutée devant ces faux serveurs pour un parcours de base (connexion aux deux serveurs, bibliothèque, lecture).
- **Sur de vrais serveurs** : utilisé par son auteur avec Suwayomi-Server 2.3 et Komga (lecture, progression, profils). Pas encore essayé sur Safari iOS. `dev/check-suwayomi.mjs` permet de vérifier la compatibilité avec votre version de Suwayomi.
- L'envoi réel des notifications (au-delà de l'abonnement et de la détection des nouveaux chapitres) n'a pas été exécuté.
- Un chapitre Suwayomi non téléchargé est récupéré chez la source à l'ouverture : le premier affichage peut prendre plusieurs secondes, et dépend du bon fonctionnement de l'extension.
- La recherche dans les sources de Suwayomi et l'ajout d'une série (COL-001/COL-002) ne sont couverts que par des tests contre le faux serveur : pas essayés sur un vrai Suwayomi, et seule la première page de résultats de chaque source est affichée. Il n'y a pas encore de suivi ni de téléchargement automatique des nouveaux chapitres.
- Les doublons entre serveurs sont reconnus par leur titre uniquement.
- Les appareils qui partagent un profil secondaire sont fusionnés entrée par entrée (progression des chapitres, historique, abonnements). Chaque entrée porte un numéro de révision et l'identifiant de l'appareil qui l'a écrite : le résultat ne dépend pas de l'heure des appareils. Quand deux appareils modifient la même entrée sans s'être vus, l'une des deux est conservée — la même sur tous les appareils — mais rien ne permet de savoir laquelle était réellement la dernière.
- Les abonnements du profil principal sont fusionnés de la même façon ; sa progression de lecture est celle du serveur et suit les règles du serveur.
- Sur iOS, l'espace alloué aux téléchargements est décidé par le système et peut être repris si l'application n'est pas installée sur l'écran d'accueil.
- Pas de lecture page par page (droite à gauche) : Scrollarr est volontairement un lecteur vertical.

Politique de sécurité : [SECURITY.md](SECURITY.md). Guide de contribution : [CONTRIBUTING.md](CONTRIBUTING.md).

## Suite envisagée

La feuille de route complète et son état actuel figurent dans [docs/ROADMAP.md](docs/ROADMAP.md) (en français).

- Applications iOS et Android en enveloppant ce même code avec [Capacitor](https://capacitorjs.com) ; il faudra alors remplacer les sessions de même origine par des jetons et charger les images par `fetch`.
- Connecteurs pour d'autres serveurs (Kavita…).
- Mode double page sur tablette en paysage.

## Licence

MIT, voir [LICENSE](LICENSE). La police Big Shoulders Display est distribuée sous licence SIL OFL 1.1 (`app/fonts/OFL.txt`).
