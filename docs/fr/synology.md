# Scrollarr sur un NAS Synology

[English](../en/synology.md) · **Français** · [Retour au README](../../README.fr.md)

Un guide complet pour DSM 7 avec Container Manager et une session SSH. Les étapes générales sont dans [Installation](installation.md) ; cette page ajoute ce qui est propre à un NAS.

Sur quoi cette page repose : le code de Scrollarr, et les problèmes rencontrés sur un vrai DS920+ par le propriétaire du projet (listés dans « Vu sur un vrai DS920+ » en fin de page). Je n'ai pas pu ouvrir DSM en l'écrivant. **Tous les noms de menus DSM ci-dessous sont écrits de mémoire de DSM 7 ou repris de l'ancien README, et ne sont pas vérifiés** ; la liste est en fin de page. Si un menu porte un autre nom sur votre version, c'est l'intention de l'étape qui compte.

## Ce qu'il vous faut

- DSM 7 avec le paquet Container Manager installé (Centre de paquets).
- SSH activé pour votre compte administrateur (dans le Panneau de configuration, *Terminal et SNMP* ; nom de menu non vérifié).
- Suwayomi et/ou Komga déjà en marche, avec leurs ports publiés sur le NAS (Suwayomi en général sur 4567, Komga sur 25600).
- L'adresse du NAS, ici `192.168.1.10`. Prenez la vôtre.

Dans les exemples, les commandes commencent par `sudo` : sur DSM, les commandes Docker demandent les droits d'administrateur.

## 1. Créer le dossier

Container Manager crée un dossier partagé nommé `docker`. Rangez le projet dans son propre sous-dossier, `/volume1/docker/scrollarr` :

```sh
ssh votre-compte-admin@192.168.1.10
cd /volume1/docker
sudo mkdir -p scrollarr
cd scrollarr
```

Vous pouvez aussi créer le dossier dans File Station. Tout ce qui suit se passe dans ce dossier : `docker-compose.yml`, `.env` puis, plus tard, `data/`.

## 2. Récupérer les fichiers

Dès qu'une version est publiée, récupérez les deux fichiers nécessaires :

```sh
sudo curl -O https://raw.githubusercontent.com/Ark4ntes/scrollarr/main/deploy/docker-compose.yml
sudo curl -o .env https://raw.githubusercontent.com/Ark4ntes/scrollarr/main/.env.example
```

Si vous préférez construire les images vous-même depuis les sources (voir [Installation](installation.md#installer-depuis-un-clone)) : à ma connaissance, DSM ne fournit pas `git` : téléchargez le dépôt en ZIP sur votre ordinateur, décompressez-le, puis envoyez le contenu du dossier dans `/volume1/docker/scrollarr` avec File Station. Renommez `.env.example` en `.env`. Les fichiers cachés (dont le nom commence par un point) peuvent ne pas apparaître dans File Station par défaut ; si vous ne voyez pas `.env.example`, copiez-le depuis la session SSH : `sudo cp .env.example .env`.

Les fichiers envoyés ainsi peuvent se retrouver avec des droits restrictifs : voir « Fichiers récupérés avec des droits restrictifs » en fin de page.

## 3. Modifier `.env`

Ouvrez `.env` avec un éditeur (`sudo vi .env`, ou modifiez-le sur votre ordinateur et renvoyez-le) et renseignez au moins :

```
SUWAYOMI_URL=http://192.168.1.10:4567
KOMGA_URL=
```

Prenez l'adresse du NAS et le port que Suwayomi (ou Komga) publie. Laissez vide le serveur que vous n'utilisez pas : le fichier est livré avec un exemple `http://ADRESSE_DU_NAS:4567` qui ne répond jamais. Gardez ensuite le fichier privé, il contiendra des mots de passe :

```sh
sudo chmod 600 .env
```

## 4. Démarrer

Images publiées :

```sh
sudo docker compose up -d
```

Depuis les sources :

```sh
sudo docker compose up -d --build
```

Vérifiez :

```sh
sudo docker compose ps
```

`scrollarr` doit être `running`, puis `healthy` au bout d'environ 30 secondes. Ouvrez `http://192.168.1.10:8380` depuis un ordinateur ou un téléphone de votre réseau : vous devez voir l'écran de connexion ou l'accueil.

L'écran *Projet* de Container Manager peut créer le même projet à partir de ce dossier (noms de menus non vérifiés). Je n'ai pas vérifié s'il lit `.env` ; la voie décrite et éprouvée ici est SSH.

Si `docker compose` n'est pas reconnu, le Docker de votre DSM est plus ancien que le module Compose. Mettez Container Manager à jour plutôt que de réécrire les fichiers (non vérifié sur d'autres versions que DSM 7).

## 5. HTTPS avec le proxy inversé et un certificat

Sans HTTPS, les téléchargements hors ligne, l'installation sur l'écran d'accueil et les notifications push ne sont pas disponibles ([pourquoi](installation.md#pourquoi-https)). DSM peut se charger de la partie HTTPS.

1. Choisissez un nom d'hôte pour Scrollarr, par exemple `scrollarr.exemple.fr`, qui pointe vers votre NAS (un enregistrement DNS, ou le nom DDNS que votre NAS a déjà).
2. Obtenez un certificat pour ce nom. DSM sait obtenir un certificat Let's Encrypt (Panneau de configuration, *Sécurité*, *Certificat* ; noms de menus non vérifiés).
3. Créez une règle de proxy inversé (Panneau de configuration, *Portail de connexion*, *Avancé*, *Proxy inversé* ; noms de menus non vérifiés) :
   - Source : protocole HTTPS, nom d'hôte `scrollarr.exemple.fr`, port 443.
   - Destination : protocole HTTP, nom d'hôte `localhost`, port 8380 (ou votre `SCROLLARR_PORT`).
4. Associez le certificat à cette règle (dans les réglages des certificats, choisissez le certificat du service `scrollarr.exemple.fr` ; noms de menus non vérifiés).
5. Ouvrez `https://scrollarr.exemple.fr`. Vous devez voir Scrollarr, avec un cadenas.

Deux choses à savoir :

- Le service Dossiers n'ajoute l'attribut `Secure` à son cookie de session que si la requête porte `X-Forwarded-Proto: https`. Je n'ai pas pu vérifier que le proxy inversé de DSM envoie cet en-tête.
- Scrollarr laisse à Suwayomi jusqu'à 180 secondes pour répondre (un chapitre non téléchargé est d'abord récupéré chez sa source). Le proxy de DSM a ses propres délais, que je n'ai pas vérifiés ; si ces chapitres n'échouent que par le nom HTTPS, regardez les délais de la règle.

Depuis l'intérieur de votre réseau, le nom HTTPS doit mener au NAS. Si votre routeur ne renvoie pas le trafic vers l'intérieur, ajoutez un enregistrement DNS local pour ce nom, qui pointe vers `192.168.1.10`.

## 6. Limiter l'accès au réseau local (profil de contrôle d'accès)

Si vous n'accédez à Scrollarr que depuis chez vous, ne laissez pas le nom HTTPS ouvert sur Internet. Le proxy inversé de DSM peut restreindre qui passe grâce à un profil de contrôle d'accès (Panneau de configuration, *Portail de connexion*, *Avancé*, *Profil de contrôle d'accès* ; noms de menus non vérifiés) :

1. Créez un profil qui autorise votre plage locale (par exemple `192.168.1.0/24`) et refuse tout le reste.
2. Sélectionnez ce profil dans la règle de proxy inversé de Scrollarr (dans les réglages de la règle ; noms de menus non vérifiés).

Un appareil hors de la plage reçoit alors une page d'erreur HTML du proxy. Scrollarr la prend pour un serveur injoignable (la carte affiche *Injoignable*) : c'est normal, pas un bogue. Pour lire depuis l'extérieur, passez par un VPN vers votre réseau.

Aussi :

- Ne redirigez pas le port 8380 sur votre routeur. Seul le nom HTTPS doit être joignable, et le profil limite qui passe par lui.
- Le profil ne protège que le nom de Scrollarr. Les ports de Suwayomi et de Komga restent joignables sur votre réseau comme avant. Si un Suwayomi sans authentification est sur votre réseau, tout le monde peut déjà l'utiliser directement.
- Pourquoi c'est important : [Sécurité](security.md).

## 7. Le service Dossiers sur un NAS

Suivez [Installation](installation.md#service-dossiers-facultatif) pour l'arborescence et les réglages. Ce qui est propre à DSM :

**Les scans.** `FOLDERS_SCANS_PATH` est un chemin sur un volume, par exemple `/volume1/chemin/vers/scans`. Ce doit être le dossier qui contient directement vos séries. Le service ignore les dossiers `@eaDir` et `#recycle` que DSM crée. Le partage est monté en lecture seule : le service ne peut pas modifier vos scans.

**L'utilisateur.** Le conteneur tourne sous un numéro, `FOLDERS_UID:FOLDERS_GID`, soit `1000:1000` par défaut. DSM n'a pas d'utilisateur 1000 (ses utilisateurs commencent plus haut), ce qui n'empêche pas le conteneur de fonctionner. Cela compte à deux endroits :

1. L'utilisateur doit pouvoir **lire** vos scans. Si les scans sont lisibles par « les autres » sur le partage, 1000 convient. Sinon, donnez le droit de lecture sur le dossier partagé à un utilisateur DSM, ou faites tourner le service sous un utilisateur qui peut déjà le lire. Pour connaître les numéros d'un utilisateur DSM :
   ```sh
   id votre-utilisateur-dsm
   ```
   La commande affiche quelque chose comme `uid=1026(...) gid=100(users)`. Mettez ces numéros dans `.env` comme `FOLDERS_UID` et `FOLDERS_GID`. Les vôtres seront différents.
2. L'utilisateur doit **posséder** le dossier de données :
   ```sh
   sudo mkdir -p data/folders
   sudo chown 1026:100 data/folders
   ```
   Prenez les deux mêmes numéros que dans `.env` (`1000:1000` si vous avez gardé les valeurs par défaut).

Démarrez et vérifiez :

```sh
sudo docker compose --profile folders up -d
sudo docker exec scrollarr-folders id
sudo docker exec scrollarr-folders ls /libraries/Scans
sudo docker logs scrollarr-folders
```

`id` montre l'utilisateur sous lequel le service tourne, `ls` doit lister vos séries, et le journal doit dire `Parcours terminé : N séries, M chapitres...` avec des nombres qui correspondent à votre bibliothèque. Si `ls` affiche `Permission denied`, l'utilisateur ne peut pas lire le partage : ajustez les permissions du dossier partagé (Panneau de configuration, *Dossier partagé*, *Modifier*, *Permissions* ; noms de menus non vérifiés) pour cet utilisateur.

**Dossier partagé chiffré.** Si le partage est verrouillé après un redémarrage, le service voit un dossier vide ou illisible. Il répond alors « indisponible » (erreur 503) plutôt que « introuvable » : Scrollarr garde vos abonnements et vos téléchargements et montre le serveur comme injoignable. Déverrouillez le partage et la bibliothèque revient.

## Vu sur un vrai DS920+

Ces cas ont été rencontrés par le propriétaire du projet sur un DS920+. Chacun a un symptôme, une cause et une solution.

### Fichiers récupérés avec des droits restrictifs

- **Symptôme :** un conteneur Scrollarr (ou notifier, ou Dossiers) construit à partir de sources que vous avez envoyées ou décompressées sur le NAS affiche une page « 403 Forbidden », ou un service s'arrête au démarrage avec une erreur « permission denied » sur ses propres fichiers.
- **Cause :** une archive décompressée sur un NAS, un `umask` strict ou des ACL peuvent donner aux fichiers des droits comme `600` et `700` (lisibles par leur seul propriétaire). La construction de l'image copie les fichiers avec ces droits, et le serveur web comme les services ne tournent pas sous root : ils ne peuvent pas les lire.
- **Solution :** rien à faire depuis la version 0.9 : les trois Dockerfile rendent les fichiers copiés lisibles par tous (`chmod -R a+rX`), et `tests/container_perms.sh` le vérifie avec des sources aux droits 600 et 700. Avec une construction plus ancienne, mettez les sources à jour et reconstruisez (`sudo docker compose up -d --build`).

### Container name already in use

- **Symptôme :** `docker compose up -d` échoue avec `Conflict. The container name "/scrollarr" is already in use by container ...`.
- **Cause :** les conteneurs ont des noms fixes (`scrollarr`, `scrollarr-notifier`, `scrollarr-folders`). Si vous avez renommé ou déplacé le dossier du projet, Compose le traite comme un nouveau projet et tente de créer des conteneurs dont les noms sont pris par ceux de l'ancien projet.
- **Solution :** dans l'ancien dossier, lancez `sudo docker compose down` (avec les mêmes `--profile` que pour démarrer). Sans l'ancien dossier, supprimez les conteneurs par leur nom : `sudo docker rm -f scrollarr scrollarr-notifier scrollarr-folders` (les noms inexistants sont signalés et ignorés). Supprimer un conteneur n'efface pas `./data`. Redémarrez ensuite depuis le nouveau dossier.

### Your kernel does not support PIDs limit

- **Symptôme :** au démarrage du service Dossiers, Docker affiche un avertissement qui commence par « Your kernel does not support PIDs limit ».
- **Cause :** le service Dossiers demande une limite de 64 processus (`pids_limit: 64`). Le noyau du NAS ne sait pas appliquer cette limite.
- **Solution :** aucune. C'est sans conséquence : la limite n'est pas appliquée, le service fonctionne. Les autres protections de ce service (système de fichiers en lecture seule, aucune capacité, limite de mémoire, réseau interne) sont des réglages distincts que l'avertissement ne mentionne pas.

### L'utilisateur 1000 n'existe pas sur DSM

- **Symptôme :** vous vous demandez si les valeurs par défaut `FOLDERS_UID=1000` et `FOLDERS_GID=1000` peuvent fonctionner.
- **Cause :** DSM n'a pas d'utilisateur 1000. Un conteneur peut tourner sous n'importe quel numéro : le service démarre quand même.
- **Solution :** rien à changer si les scans sont lisibles par « les autres » et si `data/folders` appartient à 1000:1000 (`sudo chown 1000:1000 data/folders`). Renseignez `FOLDERS_UID` et `FOLDERS_GID` quand les scans ne sont lisibles que par un utilisateur ou un groupe DSM précis : voir la section 7. Il en va de même pour `data/notifier`, car le notifier tourne sous l'utilisateur `node` de son image (1000) : `sudo mkdir -p data/notifier && sudo chown 1000:1000 data/notifier`.

### `FOLDERS_SCANS_PATH` pointe un niveau trop haut

- **Symptôme :** le service Dossiers trouve quelques « séries » portant le nom de vos collections, chacune avec des centaines de chapitres ; dans le journal, `Parcours terminé` annonce peu de séries et un nombre énorme de chapitres.
- **Cause :** le chemin désigne un dossier qui regroupe plusieurs collections (par exemple `/volume1/chemin/vers` au lieu de `/volume1/chemin/vers/scans`). Chaque sous-dossier direct est pris pour une série.
- **Solution :** faites pointer `FOLDERS_SCANS_PATH` vers le dossier qui contient directement les séries, puis `sudo docker compose --profile folders up -d`. L'arborescence est décrite dans [Installation](installation.md#arborescence-attendue).

### Le navigateur garde l'ancienne version

- **Symptôme :** après une mise à jour, l'application semble inchangée, ou *Réglages > À propos* affiche l'ancienne version.
- **Cause :** chaque appareil garde les fichiers de l'application en cache et récupère les nouveaux en arrière-plan. La nouvelle version s'affiche au chargement suivant.
- **Solution :** rechargez l'application deux fois, ou appuyez sur *Recharger* dans le bandeau « Nouvelle version de Scrollarr installée. » Pour une application installée sur l'écran d'accueil, fermez-la complètement puis rouvrez-la.

### Lecture hors ligne indisponible en HTTP simple

- **Symptôme :** dans une série, le bouton *Télécharger* est absent, ou son menu ne propose aucun téléchargement sur l'appareil et affiche « Lecture hors ligne indisponible à cette adresse : le navigateur ne l’autorise qu’en HTTPS... ». La même phrase apparaît dans *Réglages* (sous *Lecture hors ligne*) et dans *Ma liste* (onglet *Téléchargements*).
- **Cause :** vous avez ouvert Scrollarr à l'adresse `http://192.168.1.10:8380`. Les navigateurs n'autorisent le stockage hors ligne qu'en HTTPS.
- **Solution :** ouvrez Scrollarr par votre nom HTTPS (section 5). L'adresse du NAS dans un navigateur convient pour un essai rapide, pas pour les téléchargements.

## Noms de menus DSM non vérifiés

Tous viennent de la mémoire de DSM 7 et de l'ancien README. Aucun n'a été comparé à un DSM en écrivant cette page :

- Centre de paquets et le paquet *Container Manager*, avec son écran *Projet*.
- Panneau de configuration, *Terminal et SNMP* (SSH).
- Panneau de configuration, *Portail de connexion*, *Avancé*, *Proxy inversé* (création de règle, association d'un profil à une règle).
- Panneau de configuration, *Portail de connexion*, *Avancé*, *Profil de contrôle d'accès*.
- Panneau de configuration, *Sécurité*, *Certificat* (Let's Encrypt, association d'un certificat à un service).
- Panneau de configuration, *Dossier partagé*, *Modifier*, *Permissions*.
- File Station.

Tout le reste (commandes, noms de fichiers, variables, messages cités) vient du dépôt.
