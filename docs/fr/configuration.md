# Configuration

[English](../en/configuration.md) · **Français** · [Retour au README](../../README.fr.md)

Tout ce qui se règle, et l'endroit où Scrollarr range ce qu'il stocke. Les réglages sont dans un fichier `.env`, à côté de `docker-compose.yml`. Après l'avoir modifié, recréez les conteneurs pour qu'ils le relisent :

```sh
docker compose up -d --force-recreate
```

(ajoutez `--profile push` et `--profile folders` si vous utilisez ces services). Une variable vide ou absente prend la valeur par défaut indiquée ci-dessous.

## Variables d'environnement

Les tableaux suivent les conteneurs : « Scrollarr » est le conteneur principal, « Notifier » et « Service Dossiers » sont les services facultatifs. Les variables marquées **Compose** ne sont lues que par Docker Compose, qui s'en sert dans `docker-compose.yml` ; aucun conteneur ne les reçoit sous ce nom.

### Scrollarr (le conteneur principal)

| Variable | Défaut | Effet |
| --- | --- | --- |
| `SUWAYOMI_URL` | vide | Adresse de Suwayomi vue depuis le conteneur, sans barre oblique finale (`http://192.168.1.10:4567`). Vide : Suwayomi n'est pas configuré et n'apparaît pas dans l'application. Le notifier lit la même variable. |
| `KOMGA_URL` | vide | Idem pour Komga (`http://192.168.1.10:25600`). Le notifier lit la même variable. |
| `FOLDERS_URL` | vide | Adresse du service Dossiers : `http://folders:8788` pour l'utiliser, vide sinon. Le service Dossiers lui-même ne la lit pas. |
| `SCROLLARR_PORT` (**Compose**) | `8380` | Port de la machine qui mène à Scrollarr. Dans le conteneur, il écoute toujours sur 80. |
| `SCROLLARR_VERSION` (**Compose**) | `latest` | Étiquette des trois images. Uniquement dans `deploy/docker-compose.yml` (installation depuis les images publiées) ; le `docker-compose.yml` d'un clone construit les images localement. |

Les trois adresses doivent exister dans l'environnement du conteneur, même vides : l'image met les trois à vide, et Compose les transmet. Une adresse renseignée mais fausse fait apparaître ce serveur comme injoignable.

### Notifier (profil `push`)

| Variable | Défaut | Effet |
| --- | --- | --- |
| `SUWAYOMI_URL` | vide | Suwayomi à surveiller (partagée avec le conteneur principal, voir ci-dessus). |
| `SUWAYOMI_USER`, `SUWAYOMI_PASSWORD` | vide | Seulement si Suwayomi demande une authentification. |
| `KOMGA_URL`, `KOMGA_API_KEY` | vide | Komga à surveiller : l'adresse et une clé d'API créée dans Komga. Les deux sont nécessaires pour Komga. |
| `VAPID_SUBJECT` | `mailto:admin@localhost` | Contact exigé par le protocole Web Push, sous la forme `mailto:vous@exemple.fr`. |
| `POLL_MINUTES` | `10` | Minutes entre deux vérifications des nouveaux chapitres. La plus petite valeur prise en compte est 0,05. |
| `DATA_DIR` | `/data` | Dossier de ses clés et abonnements. Compose y monte `./data/notifier` ; ne la changez pas. |
| `PORT` | `8787` | Port dans le conteneur. Le conteneur principal l'attend sur 8787 : ne la changez pas. |
| `PUSH_DRY_RUN` | non définie | `1` écrit les notifications dans le journal au lieu de les envoyer. Sert aux tests. |

Le notifier s'arrête au démarrage si ni `SUWAYOMI_URL`, ni le couple `KOMGA_URL` et `KOMGA_API_KEY` ne sont renseignés.

### Service Dossiers (profil `folders`)

Compose transmet les trois premières depuis `.env` et fixe les deux dernières. Le service refuse de démarrer au moindre problème et affiche une ligne qui commence par `Configuration invalide :`. Il refuse aussi toute variable commençant par `FOLDERS_` qui n'est pas listée dans cette section : ne lui donnez donc pas `FOLDERS_URL`, `FOLDERS_SCANS_PATH`, `FOLDERS_UID` ni `FOLDERS_GID` (par exemple avec `env_file`).

| Variable | Défaut | Effet |
| --- | --- | --- |
| `FOLDERS_AUTH` | aucun : obligatoire | `password` ou `none`. Pas de valeur par défaut : le service ne démarre pas sans l'une des deux. |
| `FOLDERS_USER` | vide | Identifiant, obligatoire avec `password`, doit être vide avec `none`. |
| `FOLDERS_PASSWORD` | vide | Mot de passe, 12 caractères au moins, obligatoire avec `password`, doit être vide avec `none`. |
| `FOLDERS_TRUST_PROXY` | `0` ; Compose met `1` | `1` fait prendre l'adresse du client dans la dernière entrée de `X-Forwarded-For` (pour la limite de tentatives de connexion). |
| `FOLDERS_COOKIE_PATH` | `/` ; Compose met `/folders/` | Chemin du cookie de session. |

Les suivantes sont lues par le service, mais `docker-compose.yml` ne les transmet pas. Pour en changer une, ajoutez-la sous `environment:` du service `folders`, par exemple dans un `docker-compose.override.yml`.

| Variable | Défaut | Valeurs admises | Effet |
| --- | --- | --- | --- |
| `FOLDERS_PORT` | `8788` (fixé par l'image) | 1 à 65535 | Port d'écoute. Si vous le changez, changez aussi `FOLDERS_URL`. |
| `FOLDERS_RESCAN_MINUTES` | `15` | 0 à 10080 | Quand quelqu'un ouvre la bibliothèque et que le dernier parcours complet est plus ancien que cette durée, un parcours complet part en arrière-plan. `0` : jamais. |
| `FOLDERS_SESSION_HOURS` | `720` | 1 à 8760 | Durée d'une connexion. Changer l'identifiant ou le mot de passe déconnecte tout le monde. |
| `FOLDERS_LOGIN_ATTEMPTS` | `5` | 1 à 100 | Connexions échouées admises par adresse dans la fenêtre ci-dessous. |
| `FOLDERS_LOGIN_WINDOW_SECONDS` | `900` | 10 à 86400 | Fenêtre de la limite ci-dessus. Une fois la limite atteinte, le service répond par l'erreur 429 jusqu'à la fin de la fenêtre. |
| `FOLDERS_PROGRESS_FLUSH_SECONDS` | `3` | 0 à 60 | Au plus une écriture par fichier de progression dans cet intervalle. `0` : écriture immédiate. Un arrêt brutal peut faire perdre les dernières secondes. |
| `FOLDERS_LIBRARIES_DIR` | `/libraries` | un dossier | Où les bibliothèques sont montées dans le conteneur. Chaque sous-dossier direct est une bibliothèque. |
| `FOLDERS_DATA_DIR` | `/data` | un dossier | Où le service garde ses données. Compose y monte `./data/folders`. |

Les nombres doivent être entiers et dans l'intervalle, sinon le service ne démarre pas.

### Aussi lues par Compose seulement

Ces deux réglages ne concernent que le conteneur Dossiers.

| Variable | Défaut | Effet |
| --- | --- | --- |
| `FOLDERS_SCANS_PATH` | `./scans` | Dossier de la machine qui contient **directement** vos séries. Monté en lecture seule sous `/libraries/Scans`. |
| `FOLDERS_UID`, `FOLDERS_GID` | `1000`, `1000` | Utilisateur et groupe du conteneur Dossiers. Ils doivent pouvoir lire les scans et posséder `data/folders`. |

## Ports

| Port | Où | Publié sur la machine ? |
| --- | --- | --- |
| 8380 (`SCROLLARR_PORT`) → 80 | Scrollarr (nginx) | Oui. C'est le seul port. |
| 8787 | Notifier | Non. Scrollarr l'atteint sous `/notify/`. |
| 8788 | Service Dossiers | Non. Scrollarr l'atteint sous `/folders/`, par le réseau interne `folders_net`. |

Les routes de Scrollarr : `/` (l'application), `/suwayomi/`, `/komga/` et `/folders/` (proxys vers vos serveurs ; ils répondent 404 quand l'adresse est vide), `/notify/` (proxy vers le notifier) et `/servers.json` (les serveurs configurés sur cette installation).

## Profils Compose et conteneurs

| Profil | Démarre | Nom du conteneur |
| --- | --- | --- |
| aucun (toujours) | l'application | `scrollarr` |
| `push` | le notifier | `scrollarr-notifier` |
| `folders` | le service Dossiers | `scrollarr-folders` |

Mettez le drapeau de profil sur chaque commande `docker compose` qui doit inclure le service : `docker compose --profile push --profile folders up -d`. Une commande sans ce drapeau laisse ce service en dehors du projet.

Les noms de conteneurs sont fixes. Deux projets sur une même machine ne peuvent pas les utiliser en même temps (voir [Dépannage](troubleshooting.md)).

Le conteneur Dossiers tourne avec un système de fichiers en lecture seule, sans aucune capacité Linux, avec `no-new-privileges`, 256 Mo de mémoire, 64 processus, et sur le seul réseau interne `folders_net`. Le conteneur principal est aussi sur `default`, ce qui lui permet de joindre vos autres serveurs.

## Volumes et fichiers

| Sur la machine | Dans le conteneur | Sert à |
| --- | --- | --- |
| `./data/notifier` | `/data` (notifier) | `vapid.json` (clés push), `subscriptions.json`, `seen.json` |
| `./data/folders` | `/data` (Dossiers) | `secret.key` (signe les sessions), `libraries.json`, `progress/` (un fichier JSON par série et par profil) |
| `FOLDERS_SCANS_PATH` | `/libraries/Scans`, lecture seule | vos scans |
| `.env` | (lu par Compose) | tous les réglages, mots de passe compris |

Créez vous-même `data/notifier` et `data/folders` et donnez-les à l'utilisateur sous lequel le conteneur tourne (voir [Installation](installation.md)). Si Docker les crée, ils appartiennent à root et le service ne peut pas y écrire.

Pour développer l'application, `docker-compose.dev.yml` monte `app/` et le modèle nginx en lecture seule dans le conteneur principal (voir [Développement](development.md)).

## Ce qui est stocké, et où

| Quoi | Où |
| --- | --- |
| Progression du profil **principal** | Dans Suwayomi ou Komga, comme leur propre historique de lecture. Avec le seul service Dossiers, dans `data/folders/progress/main/`. |
| Liste des profils, abonnements, progression des autres profils | Dans le stockage clé-valeur de chaque serveur actif qui en a un (entrées « meta » de Suwayomi, « client settings » de Komga), sous des clés commençant par `scrollarr.`. Le service Dossiers n'en a pas. |
| Progression d'un autre profil sur une série *Dossiers* | Dans `data/folders/progress/<identifiant du profil>/`. |
| Historique partagé des téléchargements terminés | Le même stockage clé-valeur, en un seul document pour toute l'installation. |
| Clés et abonnements push | `data/notifier/` |
| Thème, langue, réglages du lecteur, serveurs activés, profil ouvert sur l'appareil, copie des abonnements | Le navigateur de chaque appareil (`localStorage`). |
| Chapitres téléchargés | Le navigateur de l'appareil qui les a téléchargés (Cache Storage et IndexedDB). |
| Copies des dernières réponses, pour parcourir sans connexion | Le navigateur (IndexedDB). |
| Connexion à Suwayomi | Cookies du navigateur, et un jeton de renouvellement dans `localStorage` pour le mode « UI login ». |
| Connexion à Komga et à Dossiers | Cookies de session posés par ces serveurs. |

Scrollarr ne stocke aucun mot de passe côté serveur. Détails sur les cookies : [Sécurité](security.md). Ce qu'il faut copier pour sauvegarder une installation : [Mise à jour, sauvegarde et retour en arrière](update-backup.md).
