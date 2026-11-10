# Scrollarr

[English](README.md) · **Français**

Lecteur vertical continu pour une bibliothèque de mangas auto-hébergée : on fait défiler un chapitre d'un seul geste, on enchaîne sur le suivant, on reprend exactement où l'on s'était arrêté. Application web installable (PWA), sans compte tiers ni télémétrie. Licence MIT.

Scrollarr se branche sur [Suwayomi](https://github.com/Suwayomi/Suwayomi-Server), sur [Komga](https://komga.org), ou sur les deux à la fois. D'autres serveurs peuvent être ajoutés sous forme de connecteurs.

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
| `dev/` | Faux serveurs pour développer, script de vérification |

## Installation

Prérequis : Docker, au moins un serveur (Suwayomi ou Komga) qui fonctionne, et une adresse **HTTPS** pour Scrollarr (obligatoire pour l'installation sur l'écran d'accueil, le mode hors ligne et les notifications).

1. Copiez le dépôt sur la machine, par exemple dans `/volume1/docker/scrollarr`.
2. Créez le fichier de réglages :
   ```sh
   cp .env.example .env
   ```
   Renseignez `SUWAYOMI_URL` et/ou `KOMGA_URL` : l'adresse de chaque serveur vue depuis le conteneur (par exemple `http://192.168.1.10:4567`). Laissez vide celui que vous n'utilisez pas.
3. Démarrez :
   ```sh
   docker compose up -d
   ```
   L'application répond sur le port `8380` (modifiable avec `SCROLLARR_PORT`).
4. Publiez-la en HTTPS avec votre proxy inverse. Sur un NAS Synology : *Panneau de configuration > Portail de connexion > Avancé > Proxy inversé*, source `https://scrollarr.exemple.fr:443`, destination `http://localhost:8380`, puis associez le certificat dans *Sécurité > Certificat*.
5. Ouvrez l'adresse. Si un serveur demande une authentification, Scrollarr affiche son formulaire ; sinon vous arrivez directement sur l'accueil.

### Avant de déployer : vérifier la compatibilité avec votre Suwayomi

Depuis n'importe quelle machine du réseau disposant de Node 20 ou plus :

```sh
node dev/check-suwayomi.mjs http://192.168.1.10:4567
```

Le script rejoue les requêtes de lecture de Scrollarr contre votre serveur et indique celles qu'il refuse. Il ne modifie rien.

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
   docker compose --profile push up -d --build
   ```
3. Dans Scrollarr : *Réglages > Notifications*, activez l'option, puis *Envoyer un test*.

Le notifier interroge chaque serveur toutes les `POLL_MINUTES` minutes et envoie une notification par série suivie, même si plusieurs chapitres arrivent ensemble. Ses clés et la liste des appareils abonnés sont conservées dans `data/notifier/`.

## Développer

Aucune dépendance pour l'application :

```sh
node dev/mock-servers.mjs
# http://localhost:8380 — Komga : demo@scrollarr.local / demo
```

Le serveur de démonstration imite Suwayomi et Komga avec une bibliothèque fabriquée.

| Variable | Effet |
| --- | --- |
| `SERVERS=suwayomi` | Ne « configure » qu'un serveur (`suwayomi`, `komga`, ou les deux) |
| `SUWA_AUTH=none\|basic\|simple\|ui` | Mode d'authentification du faux Suwayomi (identifiants `demo` / `demo`) |
| `NOTIFIER=http://127.0.0.1:8787` | Relaie `/notify/` vers un notifier local |

`POST /suwayomi/__mock/add-chapter?manga=2` et `POST /komga/__mock/add-book?series=S004` simulent l'arrivée d'un chapitre.

Points d'entrée utiles :

- `app/js/api.js` : la façade appelée par les écrans ; répartit vers les connecteurs et fusionne les listes.
- `app/js/connectors/readers/` : `komga.js` (REST), `suwayomi.js` (GraphQL). `collectors/suwayomi.js` demande à Suwayomi de télécharger des chapitres. Les deux modules Suwayomi partagent `suwayomi-client.js` (session, requêtes) et `suwayomi-queries.js`.
- `app/js/profiles.js` : les profils et leur historique.
- `app/js/views/reader.js` : le lecteur.
- `app/js/i18n.js` : les traductions (le français sert de clé ; ajoutez un dictionnaire pour une nouvelle langue).
- `app/css/app.css` : les couleurs et la typographie sont des variables en tête de fichier.

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

Le contrat est vérifié au démarrage par `validateReader()` dans `app/js/connectors/reader-contract.js` : un connecteur incomplet échoue tout de suite au lieu de mal se comporter plus tard.

Il reste à l'inscrire sous `READERS` dans `app/js/connectors/index.js`, à ajouter son proxy et sa ligne `servers.json` dans `nginx/default.conf.template`, et les adresses de ses pages et couvertures dans `app/sw.js` (lecture hors ligne).

### Écrire un collecteur

Un collecteur va chercher des chapitres ; il n'a pas à lister une bibliothèque ni à servir des pages. Il se range dans `app/js/connectors/collectors/` et suit `collector-contract.js`, vérifié au démarrage par `validateCollector()`.

| Membre | Rôle |
| --- | --- |
| `id`, `label` | Identifiant et nom affiché |
| `capabilities` | Parmi les capacités « collecteurs » de `contract.js` (`collect.chapters`, `collect.tasks`, `collect.cancel`) |
| `serves` | Lecteurs dont il comprend les identifiants de chapitre (`['suwayomi']`) ; vide s'il n'en partage avec aucun |
| `session` | Nom du lecteur dont il réutilise la session. Sans cela, le collecteur a son propre serveur et fournit `session()`, `login()`, `logout()` |
| `collectChapters(readerId, chapterIds)` | Avec `collect.chapters` : récupérer des chapitres désignés par les identifiants de ce lecteur |
| `tasks()`, `resolveTasks(nativeIds)` | Avec `collect.tasks` : ce que le collecteur fait en ce moment, et ce que sont devenues les tâches qu'il ne liste plus |
| `cancelTask(nativeId)` | Avec `collect.cancel` |

Les tâches de tous les collecteurs sont ramenées à une seule forme par `app/js/tasks.js` : identifiant, collecteur, série et chapitre, état (`queued`, `running`, `done`, `failed`, `cancelled`), progression, dates de création, de début et de fin, erreur, nombre de tentatives, et possibilité d'annuler. L'application garde ce qu'un collecteur oublie (dates, tâches terminées). Elles sont listées dans Réglages, sous « Téléchargements sur le serveur ». Cet historique est propre à chaque appareil, et les dates que le collecteur ne fournit pas sont celles où l'application a constaté le changement.

Il s'inscrit sous `COLLECTORS` dans `app/js/connectors/index.js`. Il n'existe pas encore de moyen de lancer une collecte à partir d'un titre : un collecteur qui part d'une recherche par titre plutôt que des identifiants d'un lecteur (Tranga, par exemple) demandera une nouvelle capacité, et les écrans qui vont avec.

## État du projet et limites connues

- **Vérifié** : les parcours complets (Suwayomi seul, Komga seul, les deux ensemble, les quatre modes d'authentification de Suwayomi, hors ligne, profils) passent dans Chrome contre les faux serveurs de `dev/`. La configuration nginx a été exécutée devant ces faux serveurs pour un parcours de base (connexion aux deux serveurs, bibliothèque, lecture).
- **Sur de vrais serveurs** : utilisé par son auteur avec Suwayomi-Server 2.3 et Komga (lecture, progression, profils). Pas encore essayé sur Safari iOS. `dev/check-suwayomi.mjs` permet de vérifier la compatibilité avec votre version de Suwayomi.
- L'envoi réel des notifications (au-delà de l'abonnement et de la détection des nouveaux chapitres) n'a pas été exécuté.
- Un chapitre Suwayomi non téléchargé est récupéré chez la source à l'ouverture : le premier affichage peut prendre plusieurs secondes, et dépend du bon fonctionnement de l'extension.
- Les doublons entre serveurs sont reconnus par leur titre uniquement.
- Les appareils qui partagent un profil secondaire sont fusionnés entrée par entrée (progression des chapitres, historique, abonnements). Chaque entrée porte un numéro de révision et l'identifiant de l'appareil qui l'a écrite : le résultat ne dépend pas de l'heure des appareils. Quand deux appareils modifient la même entrée sans s'être vus, l'une des deux est conservée — la même sur tous les appareils — mais rien ne permet de savoir laquelle était réellement la dernière.
- Les abonnements du profil principal sont fusionnés de la même façon ; sa progression de lecture est celle du serveur et suit les règles du serveur.
- Sur iOS, l'espace alloué aux téléchargements est décidé par le système et peut être repris si l'application n'est pas installée sur l'écran d'accueil.
- Pas de lecture page par page (droite à gauche) : Scrollarr est volontairement un lecteur vertical.

## Suite envisagée

- Applications iOS et Android en enveloppant ce même code avec [Capacitor](https://capacitorjs.com) ; il faudra alors remplacer les sessions de même origine par des jetons et charger les images par `fetch`.
- Parcourir les sources de Suwayomi et ajouter un manga à la bibliothèque depuis Scrollarr.
- Connecteur « dossiers » : lire directement des dossiers d'images déposés sur le serveur, sans Suwayomi ni Komga.
- Connecteurs pour d'autres serveurs (Kavita…).
- Mode double page sur tablette en paysage.

## Licence

MIT, voir [LICENSE](LICENSE). La police Big Shoulders Display est distribuée sous licence SIL OFL 1.1 (`app/fonts/OFL.txt`).
