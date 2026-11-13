# Mise à jour, sauvegarde et retour en arrière

[English](../en/update-backup.md) · **Français** · [Retour au README](../../README.fr.md)

Sauvegardez d'abord, mettez à jour ensuite. Les deux sont courts. Les commandes se lancent dans le dossier qui contient `docker-compose.yml` et `.env`. Sur un NAS Synology, ajoutez `sudo` (voir [Synology](synology.md)).

## Sauvegarder

Ce qu'il faut copier :

| Quoi | Pourquoi |
| --- | --- |
| `.env` | Tous vos réglages, avec les mots de passe et les clés d'API. Gardez la copie privée. |
| `docker-compose.yml`, et `docker-compose.override.yml` si vous en avez fait un | Seulement si vous les avez modifiés. |
| `data/notifier/` | `vapid.json` contient les clés des notifications push. Si vous le perdez, une nouvelle paire de clés est créée et chaque appareil doit désactiver puis réactiver les notifications. `subscriptions.json` liste les appareils abonnés. `seen.json` retient ce qui a déjà été annoncé ; le perdre est sans conséquence (la vérification suivante repart de ce qui existe). |
| `data/folders/` | `progress/` contient la progression de lecture tenue par le service Dossiers. `secret.key` signe les sessions (le perdre déconnecte tout le monde). `libraries.json` retient quelles bibliothèques ont déjà contenu des séries. |

`data/` n'existe que si vous utilisez le notifier push ou le service Dossiers.

Ce que vous n'avez **pas** à copier côté Scrollarr :

- **L'historique de lecture.** Pour le profil principal, c'est l'historique de lecture de Suwayomi ou de Komga. La liste des profils, les abonnements et la progression des autres profils sont stockés dans les mêmes serveurs, dans leur stockage clé-valeur (« meta » pour Suwayomi, « client settings » pour Komga). Sauvegardez Suwayomi et Komga comme l'indique leur propre documentation, et ces données suivent. Avec le seul service Dossiers, l'historique est dans `data/folders/progress/`.
- **Les images de Scrollarr.** Elles se retéléchargent ou se reconstruisent.
- **Les scans.** Ils vous appartiennent et sont montés en lecture seule ; sauvegardez-les comme vous le faites déjà.

Faites la copie. Arrêtez d'abord les services si vous voulez une copie parfaitement figée (le service Dossiers écrit ses fichiers de façon atomique, copier pendant qu'il tourne est donc aussi sans risque) :

```sh
docker compose stop
tar czf ../scrollarr-sauvegarde-$(date +%Y-%m-%d).tar.gz .env docker-compose.yml data
docker compose start
```

(ajoutez `--profile push --profile folders` après `compose` si vous les utilisez ; si `data` n'existe pas encore, retirez-le de la commande `tar`).

## Mettre à jour

### Depuis les images publiées

```sh
docker compose pull
docker compose up -d
```

Avec les services facultatifs, répétez les profils sur les deux commandes :

```sh
docker compose --profile push --profile folders pull
docker compose --profile push --profile folders up -d
```

`.env` et `data/` ne sont pas touchés. Compose ne recrée que les conteneurs dont l'image a changé.

Vérifiez la version qui tourne : *Réglages > À propos* affiche « Scrollarr 0.9.0, lecteur libre pour Suwayomi et Komga, sous licence MIT. » avec votre numéro. Cette commande l'affiche aussi : le fichier qu'elle imprime contient la ligne `export const APP_VERSION = '0.9.0';` (avec votre numéro).

```sh
curl http://192.168.1.10:8380/js/config.js
```

Utilisez `curl`, pas la barre d'adresse du navigateur : dans un navigateur qui fait déjà tourner Scrollarr, l'application répond à toute adresse de page par elle-même, vous ne verriez pas le fichier.

### Depuis un clone

Les images sont construites sur la machine, donc `docker compose pull` ne s'applique pas ici.

```sh
git pull
docker compose up -d --build
```

(avec les options `--profile` pour les services facultatifs). Si `git pull` se plaint de modifications locales, vous avez modifié un fichier suivi comme `docker-compose.yml` : mettez plutôt vos changements dans un `docker-compose.override.yml`.

### Sur les appareils

Chaque appareil garde la version précédente de l'application dans son cache jusqu'à avoir récupéré la nouvelle. Après une mise à jour, rechargez l'application deux fois, ou appuyez sur *Recharger* dans le bandeau « Nouvelle version de Scrollarr installée. » Pour une application sur l'écran d'accueil : fermez-la complètement, puis rouvrez-la. Rien d'autre à faire : réglages, profil et téléchargements sont conservés.

## Figer une version

Par défaut, les images publiées utilisent l'étiquette `latest`, qui avance à chaque version. Pour rester sur une version, indiquez-la dans `.env` :

```
SCROLLARR_VERSION=0.9.0
```

`0.9` ne reçoit que les correctifs de la série 0.9 (les étiquettes qui existent sont `X.Y.Z`, `X.Y`, `latest` : voir [Installation](installation.md#quelles-images-existent)). Le réglage s'applique aux trois images et prend effet avec :

```sh
docker compose pull
docker compose up -d
```

`SCROLLARR_VERSION` n'existe que dans `deploy/docker-compose.yml` (installation depuis les images publiées). Depuis un clone, on fige en choisissant ce qu'on récupère : `git fetch --tags` puis `git checkout v0.9.0`, puis reconstruisez.

Seule la dernière version reçoit les correctifs de sécurité ([SECURITY.md](../../SECURITY.md)) : figez pour rester en place, pas pour y rester longtemps.

## Revenir en arrière

1. Mettez la version précédente dans `.env` : `SCROLLARR_VERSION=0.9.0`, par exemple.
2. `docker compose pull`, puis `docker compose up -d`.
3. Rechargez l'application deux fois sur vos appareils.

Depuis un clone : `git checkout` de l'étiquette précédente, puis `docker compose up -d --build`.

Les services lisent leurs fichiers JSON tels qu'ils les trouvent ; rien dans le code ne convertit les données d'une version à l'autre. Si un service se comporte mal après un retour en arrière, arrêtez-le, restaurez la copie de `data/` faite avant la mise à jour (ci-dessous), puis redémarrez-le. Si les notes d'une version en disent plus, suivez-les.

## Restaurer

Sur la même machine ou une nouvelle, dans le dossier du projet :

```sh
docker compose down
sudo tar xzf /chemin/vers/scrollarr-sauvegarde-AAAA-MM-JJ.tar.gz
docker compose up -d
```

`tar` lancé en administrateur conserve le propriétaire de chaque fichier, ce qui compte pour `data/folders` et `data/notifier` (les services tournent sous un utilisateur numérique, `1000:1000` sauf si vous avez changé `FOLDERS_UID` et `FOLDERS_GID`). Si vous restaurez sans conserver les propriétaires, rendez-leur les dossiers : `sudo chown -R 1000:1000 data/folders data/notifier`.

Une nouvelle machine demande aussi votre proxy inversé et votre certificat ([Synology](synology.md)), et la même adresse dans les navigateurs : chaque navigateur garde ses réglages et ses téléchargements par adresse.

## Ce qu'un appareil garde localement

Rien de tout cela n'est dans une sauvegarde du NAS, et rien ne revient avec une restauration :

- Les réglages de l'interface (thème, langue, réglages du lecteur), les serveurs activés, le profil ouvert sur cet appareil, la façon de traiter les séries en double.
- Une copie des abonnements et des profils, tenue à jour avec les serveurs.
- Les chapitres téléchargés pour la lecture hors ligne (ils n'existent que dans ce navigateur), et les copies des réponses récentes qui permettent de naviguer sans connexion.
- Les recherches récentes et le choix des sources à interroger.
- La progression de lecture faite hors ligne, en attente d'envoi.
- Les cookies de connexion à Suwayomi.

Effacer les données d'un site dans le navigateur, ou retirer l'application de l'écran d'accueil, efface tout cela, téléchargements compris. La progression, les abonnements et les profils reviennent depuis les serveurs ; les téléchargements sont à refaire. Sur iOS, le système peut aussi récupérer l'espace d'une application qui n'est pas installée sur l'écran d'accueil.
