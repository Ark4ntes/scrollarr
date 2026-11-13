# Installation

[English](../en/installation.md) · **Français** · [Retour au README](../../README.fr.md)

Ce guide vous mène de zéro à un Scrollarr que vous pouvez ouvrir dans un navigateur. La liste de tous les réglages est dans [Configuration](configuration.md). Sur un NAS Synology, lisez aussi [Synology](synology.md).

## Avant de commencer

Il vous faut :

- Docker avec le module Compose (la commande `docker compose version` doit afficher un numéro de version).
- Au moins un serveur qui fonctionne déjà : [Suwayomi](https://github.com/Suwayomi/Suwayomi-Server) ou [Komga](https://komga.org). Le service Dossiers facultatif (plus bas) peut remplacer les deux si vous n'avez que des dossiers de scans.
- Pour profiter de toute l'application, une adresse **HTTPS** pour Scrollarr (celle que vous tapez dans le navigateur).

### Pourquoi HTTPS

En HTTP simple, Scrollarr s'affiche et permet de lire. Les navigateurs ne réservent ceci qu'à HTTPS (ou à `http://localhost` depuis la même machine) :

- enregistrer des chapitres sur l'appareil pour les lire sans connexion (Scrollarr affiche alors « Lecture hors ligne indisponible à cette adresse : le navigateur ne l’autorise qu’en HTTPS... ») ;
- installer l'application sur l'écran d'accueil ;
- les notifications push ;
- le service worker, qui rend l'ouverture rapide et garde l'application disponible hors ligne.

Pour un Suwayomi qui demande une connexion, il y a une deuxième raison : Scrollarr garde l'identifiant dans un cookie de votre navigateur (voir [Sécurité](security.md)). Ce cookie ne doit voyager qu'en HTTPS.

Scrollarr ne gère pas les certificats. Placez devant lui un proxy inverse muni d'un certificat (sur un NAS Synology, voir [Synology](synology.md)). Ce proxy envoie le trafic HTTPS vers le port de Scrollarr (8380 par défaut, en HTTP simple).

### Comment fonctionnent les adresses

Le navigateur ne parle qu'à Scrollarr. C'est ensuite le conteneur Scrollarr qui parle à vos serveurs. Les adresses du fichier `.env` sont donc celles que **le conteneur** peut joindre :

```
navigateur ──► Scrollarr (port 8380) ──► Suwayomi, Komga, service Dossiers
```

- `http://192.168.1.10:4567` fonctionne si Suwayomi publie son port sur la machine d'adresse 192.168.1.10.
- `http://localhost:4567` ne fonctionne pas : dans le conteneur, `localhost` désigne le conteneur lui-même.
- `http://suwayomi:4567` (un nom de conteneur) ne fonctionne que si Scrollarr et ce conteneur partagent un réseau Docker. Voir le commentaire en bas de `docker-compose.yml`.
- Pas de barre oblique à la fin, pas de chemin (pas de `/api/graphql`).

## Quelles images existent

La première version publiée est la 0.9.0. Le workflow Docker du dépôt (`.github/workflows/docker.yml`) publie :

| Événement | Étiquettes d'image |
| --- | --- |
| Une étiquette Git commençant par `v` (par exemple `v0.9.0`) | `0.9.0`, `0.9` et `latest` |
| Un push sur la branche `main` | `edge` (version de développement, suit `main`) |
| Une pull request | construite pour vérification, non publiée |

Les trois images sont `ghcr.io/ark4ntes/scrollarr`, `ghcr.io/ark4ntes/scrollarr-notifier` et `ghcr.io/ark4ntes/scrollarr-folders`, pour `amd64` et `arm64`, avec la même étiquette. Les images publiées sont la voie la plus courte ; construire depuis un clone reste possible (section suivante).

## Installer depuis un clone

```sh
git clone https://github.com/Ark4ntes/scrollarr.git
cd scrollarr
cp .env.example .env
```

Ouvrez `.env` dans un éditeur de texte et renseignez l'adresse de chaque serveur que vous utilisez (voir « Comment fonctionnent les adresses ») :

```
SUWAYOMI_URL=http://192.168.1.10:4567
KOMGA_URL=
```

Laissez vide le serveur que vous n'utilisez pas. Le fichier est livré avec `SUWAYOMI_URL=http://ADRESSE_DU_NAS:4567` (un exemple à remplacer) : si vous n'utilisez que Komga, videz cette ligne, sinon Scrollarr affiche un serveur Suwayomi qui ne répond jamais.

Construisez et démarrez :

```sh
docker compose up -d --build
```

La première construction prend quelques minutes. Ensuite, `docker compose ps` doit montrer `scrollarr` à l'état `running` (puis `healthy` au bout d'environ 30 secondes). Ouvrez `http://192.168.1.10:8380` en remplaçant l'adresse par celle de votre machine.

## Installer depuis les images publiées

Pas de clone nécessaire : deux fichiers suffisent.

```sh
mkdir scrollarr && cd scrollarr
curl -O https://raw.githubusercontent.com/Ark4ntes/scrollarr/main/deploy/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/Ark4ntes/scrollarr/main/.env.example
```

Modifiez `.env` comme ci-dessus, puis :

```sh
docker compose up -d
```

`SCROLLARR_VERSION` dans `.env` choisit l'étiquette des images (`latest` par défaut). Pour essayer la version de développement, mettez `SCROLLARR_VERSION=edge` : elle suit `main` et peut casser d'un push à l'autre.

Pour figer une version, voir [Mise à jour, sauvegarde et retour en arrière](update-backup.md).

## Sans Compose

L'image principale seule suffit pour lire depuis Suwayomi et Komga. Les deux variables peuvent être vides (une adresse vide signifie « ce serveur n'est pas configuré ») :

```sh
docker run -d --name scrollarr --restart unless-stopped -p 8380:80 \
  -e SUWAYOMI_URL=http://192.168.1.10:4567 -e KOMGA_URL= \
  ghcr.io/ark4ntes/scrollarr:latest
```

Cela suppose une image `latest` publiée ; depuis un clone, lancez `docker build -t scrollarr .` et prenez `scrollarr` comme nom d'image. Le notifier et le service Dossiers ne sont décrits qu'avec Compose (le service Dossiers s'appuie sur un réseau interne dédié défini dans `docker-compose.yml`).

## Premier lancement

Ouvrez l'adresse dans un navigateur. Vous devez voir l'un de ces cas :

- **Une carte par serveur avec un formulaire de connexion.** Komga demande *Adresse e-mail* et *Mot de passe*, Suwayomi et Dossiers demandent *Identifiant* et *Mot de passe*. Saisissez votre compte et appuyez sur *Se connecter à Komga* (ou le nom du serveur). *Ne pas utiliser ce serveur* est proposé quand plusieurs serveurs existent.
- **L'accueil tout de suite**, si votre serveur n'exige pas de connexion (un Suwayomi sans authentification). Si votre bibliothèque est vide, l'accueil affiche « La bibliothèque est vide » tant que le serveur n'a rien scanné.
- **« Aucun serveur n’est configuré sur cette installation. Renseignez KOMGA_URL, SUWAYOMI_URL ou FOLDERS_URL dans le fichier .env, puis redémarrez Scrollarr. »** Les trois adresses sont vides.
- **« ... ne répond pas. Vérifiez qu’il est démarré et joignable. »** Le conteneur n'arrive pas à joindre l'adresse indiquée. Voir [Dépannage](troubleshooting.md).

*Réglages > Serveurs* liste ensuite chaque serveur avec son état (*Connecté*, *Connexion requise*, *Injoignable*, *Hors ligne, données en cache* ou *Non utilisé*) et un bouton *Tester* qui répond « Suwayomi répond en 12 ms. » ou « Suwayomi ne répond pas... ». *Réglages > À propos* affiche la version.

Pour installer sur un téléphone : sur iPhone ou iPad, ouvrez l'adresse dans Safari, puis *Partager*, puis *Sur l'écran d'accueil* ; les notifications et la conservation durable des téléchargements n'existent que pour l'application installée ainsi. Sur Android, Chrome propose d'installer l'application depuis son menu.

### Vérifier votre Suwayomi avant (facultatif)

Depuis un clone, sur une machine disposant de Node 20 ou plus :

```sh
node dev/check-suwayomi.mjs http://192.168.1.10:4567
```

Ajoutez un identifiant et un mot de passe après l'adresse si Suwayomi demande une authentification. Le script envoie à votre serveur les requêtes de lecture de Scrollarr et affiche `OK` ou `ÉCHEC` pour chacune. Il ne modifie rien.

## Notifications push (facultatif)

Le notifier surveille vos serveurs et envoie une notification quand un chapitre arrive dans une série à laquelle vous êtes abonné.

1. Dans `.env` : renseignez `VAPID_SUBJECT` avec une adresse de contact (`mailto:vous@exemple.fr`). Pour Komga, créez une clé d'API dans Komga (menu du compte) et placez-la dans `KOMGA_API_KEY`. Pour un Suwayomi qui demande une authentification, renseignez `SUWAYOMI_USER` et `SUWAYOMI_PASSWORD`. `POLL_MINUTES` (10 par défaut) règle la fréquence des vérifications.
2. Créez son dossier de données et donnez-le à l'utilisateur sous lequel le conteneur tourne (UID 1000, l'utilisateur `node` de l'image) :
   ```sh
   mkdir -p data/notifier
   sudo chown 1000:1000 data/notifier
   ```
3. Démarrez-le :
   ```sh
   docker compose --profile push up -d
   ```
   Depuis un clone, utilisez `docker compose --profile push up -d --build`.
4. Dans Scrollarr, ouvrez *Réglages > Notifications*, activez *M’avertir quand un chapitre arrive dans une série à laquelle je suis abonné*, puis appuyez sur *Envoyer un test*.

Le notifier exige `SUWAYOMI_URL`, ou `KOMGA_URL` avec `KOMGA_API_KEY` ; sans cela il s'arrête au démarrage avec un message. Il envoie une notification par série, même si plusieurs chapitres arrivent ensemble. La première vérification ne fait que noter ce qui existe : rien n'est annoncé pour votre bibliothèque actuelle. Ses clés et la liste des appareils abonnés sont dans `data/notifier/`. S'il n'est pas démarré, *Réglages > Notifications* indique que le service de notifications n'est pas installé sur ce serveur ; les abonnements et le badge UP continuent de fonctionner.

## Service Dossiers (facultatif)

`folders` est un petit service Node qui permet à Scrollarr de lire des mangas rangés dans de simples dossiers de votre machine, sans Suwayomi ni Komga. Dans l'application, c'est un troisième serveur nommé *Dossiers*. Si vous avez déjà Komga, pointez plutôt Komga sur le dossier : il en fait davantage. Le service Dossiers s'adresse à qui veut utiliser Scrollarr seul, ou garde de simples dossiers d'images.

Ce qu'il lit : des dossiers d'images et des archives `.cbz` / `.zip` (images JPEG, PNG, WebP, GIF, AVIF). Il ne lit ni CBR, ni RAR, ni 7z, ni PDF, ni EPUB.

### Arborescence attendue

`FOLDERS_SCANS_PATH` doit être le dossier qui contient **directement** vos séries :

```
/chemin/vers/scans/             le dossier indiqué dans FOLDERS_SCANS_PATH
  Nom d'une série/              chaque sous-dossier direct est une série
    cover.jpg                   couverture facultative (.jpg, .jpeg, .png, .webp)
    Chapitre 1/                 un chapitre = un dossier d'images...
      001.jpg
    Chapitre 2.cbz              ...ou une archive CBZ/ZIP
    Tome 2/Chapitre 10.cbz      les dossiers intermédiaires sont admis (3 niveaux sous la série)
  Autre série/
```

Les règles appliquées par le service :

- L'ordre de lecture est le tri naturel des noms (`Chapitre 2` avant `Chapitre 10`). Pour corriger un ordre, renommez.
- Sans fichier `cover.*`, la couverture est la première page du premier chapitre.
- Des images placées directement dans le dossier d'une série, sans chapitre, forment un chapitre unique portant le nom de la série. S'il y a des images en vrac **et** des chapitres, les images en vrac sont ignorées (avec un avertissement dans les journaux).
- Les noms commençant par `.`, `@eaDir`, `#recycle`, `Thumbs.db` et `__MACOSX` sont ignorés. Les liens symboliques ne sont jamais suivis.
- Renommer ou déplacer un chapitre ou une série crée un nouvel élément, sans progression de lecture.

Si vous pointez un niveau trop haut (un dossier qui regroupe plusieurs collections), chaque collection est prise pour une série, avec des centaines de « chapitres ». Vérifiez avec les journaux ci-dessous.

### Mise en place

Dans `.env` :

```
FOLDERS_URL=http://folders:8788
FOLDERS_SCANS_PATH=/chemin/vers/scans
FOLDERS_AUTH=password
FOLDERS_USER=lecteur
FOLDERS_PASSWORD=choisissez-au-moins-12-caracteres
FOLDERS_UID=1000
FOLDERS_GID=1000
```

Le service refuse de démarrer sans `FOLDERS_AUTH` explicite : `password` (un identifiant et un mot de passe partagés, 12 caractères au moins) ou `none` (aucun contrôle d'accès, pour un réseau local de confiance seulement ; `FOLDERS_USER` et `FOLDERS_PASSWORD` doivent alors être vides). Ce que chaque mode protège est expliqué dans [Sécurité](security.md).

`FOLDERS_UID` et `FOLDERS_GID` sont l'utilisateur et le groupe sous lesquels le service tourne. Ils doivent pouvoir **lire** le dossier des scans et **posséder** le dossier de données :

```sh
mkdir -p data/folders
sudo chown 1000:1000 data/folders
docker compose --profile folders up -d
```

(depuis un clone, ajoutez `--build`). Les scans sont montés en lecture seule : le service ne peut jamais y écrire. Vérifiez ensuite les journaux :

```sh
docker logs scrollarr-folders
```

Vous devez voir une ligne comme `Dossiers à l'écoute sur 8788 (authentification : password, bibliothèques : Scans).`, puis `Parcours terminé : 42 séries, 610 chapitres, 0 avertissements, 380 ms.` Les nombres doivent correspondre à ce que vous attendez. Une ligne qui commence par `Configuration invalide :` explique pourquoi le service a refusé de démarrer (mode inconnu, mot de passe de moins de 12 caractères, variable `FOLDERS_` inconnue...).

Rechargez Scrollarr : *Dossiers* apparaît parmi les serveurs de *Réglages > Serveurs*. Connectez-vous avec `FOLDERS_USER` et `FOLDERS_PASSWORD`.

Pour ajouter une deuxième bibliothèque, montez un autre dossier sous `/libraries/<Nom>` dans un fichier `docker-compose.override.yml` placé à côté de `docker-compose.yml` :

```yaml
services:
  folders:
    volumes:
      - /chemin/vers/bd:/libraries/BD:ro
```

Ne montez pas un dossier à l'intérieur d'un autre dossier monté. Ce que le service garde dans `data/folders` et comment il détecte les changements : [folders/README.md](../../folders/README.md).

## Surveillance de santé

Les trois images déclarent une surveillance de santé. `docker ps` (ou Container Manager sur un Synology) affiche `healthy` ou `unhealthy` en face de chaque conteneur : Scrollarr interroge `/servers.json` toutes les 30 secondes, le notifier et le service Dossiers répondent sur `/health`.

## Et ensuite

- Changer un réglage ou savoir à quoi sert une variable : [Configuration](configuration.md).
- Quelque chose ne marche pas : [Dépannage](troubleshooting.md).
- Garder l'installation à jour et sauvegardée : [Mise à jour, sauvegarde et retour en arrière](update-backup.md).
