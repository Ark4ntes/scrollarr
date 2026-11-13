# Dépannage

[English](../en/troubleshooting.md) · **Français** · [Retour au README](../../README.fr.md)

Trouvez le symptôme, lisez la cause, appliquez la solution. Les tableaux viennent d'abord ; les commandes auxquelles ils renvoient (« Vérifications utiles ») sont à la fin. Les messages entre guillemets sont ceux que l'application ou les services affichent. Les journaux des services sont en français.

## Serveurs et connexion

| Symptôme | Cause | Solution |
| --- | --- | --- |
| Une carte de serveur indique *Injoignable*, ou « Suwayomi ne répond pas. Vérifiez qu’il est démarré et joignable. » | Le conteneur Scrollarr n'atteint pas l'adresse inscrite dans `.env`. Causes courantes : le modèle `http://ADRESSE_DU_NAS:4567` n'a pas été remplacé ; une faute de frappe ; `localhost` (c'est le conteneur lui-même) ; un nom de conteneur utilisé alors que les deux piles ne partagent aucun réseau Docker ; une barre oblique ou un chemin à la fin de l'adresse ; le serveur est arrêté ou ne publie pas son port. | Corrigez l'adresse (celle qu'atteint **le conteneur**, par exemple `http://192.168.1.10:4567`, sans barre oblique finale). Videz la variable d'un serveur que vous n'utilisez pas. Puis `docker compose up -d --force-recreate`. Testez avec « Tester une adresse depuis le conteneur » plus bas. |
| Vous avez modifié `.env` et rien n'a changé | Le conteneur ne lit `.env` qu'à sa création. | `docker compose up -d --force-recreate`, puis vérifiez avec « Vérifier les adresses utilisées par le conteneur ». |
| Des pages ou des couvertures échouent, le bandeau « Serveur injoignable : seuls les chapitres téléchargés sont lisibles. » apparaît de temps en temps | Le proxy a répondu 502 ou 504 (serveur arrêté ou trop lent), ou le serveur a mis plus de 15 secondes. Après un échec, l'application cesse de demander pendant 15 secondes. Cas typiques : un chapitre Suwayomi non téléchargé (il est d'abord récupéré chez sa source, avec jusqu'à 180 s) ; les disques d'un NAS qui se réveillent. | Réessayez après un moment. Pour Suwayomi, faites télécharger la série par le serveur (menu *Télécharger*, *Faire télécharger toute la série par Suwayomi*). Cherchez 502 et 504 dans `docker logs scrollarr`. |
| Hors de votre réseau, tous les serveurs sont *Injoignable* | Un proxy devant Scrollarr (par exemple un profil de contrôle d'accès) vous refuse avec une page HTML 403 ; l'application lit cela comme un serveur injoignable. | Attendu si vous avez restreint l'accès ([Synology](synology.md#6-limiter-laccès-au-réseau-local-profil-de-contrôle-daccès)). Utilisez un VPN, ou changez la règle. |
| « Identifiant ou mot de passe incorrect. » | Identifiants erronés. Komga veut votre **e-mail**, Suwayomi et Dossiers un nom d'utilisateur. | Réessayez. Pour le service Dossiers, l'utilisateur et le mot de passe sont ceux de `.env`. |
| « Connexion impossible (erreur 429). » sur *Dossiers* | Trop d'échecs de connexion : 5 en 15 minutes par défaut. Le compte se fait par adresse telle que Scrollarr la voit ; derrière un proxy inversé, tout le monde le partage. | Attendez 15 minutes, ou `docker restart scrollarr-folders` (le compte est gardé en mémoire). |
| « Aucun serveur n’est configuré sur cette installation... » | `SUWAYOMI_URL`, `KOMGA_URL` et `FOLDERS_URL` sont tous vides. | Renseignez-en un dans `.env`, puis recréez le conteneur. |
| Un serveur que vous n'utilisez pas apparaît injoignable | Son adresse est encore le modèle. | Videz-la dans `.env`, recréez. Ou désactivez-le dans *Réglages > Serveurs* sur chaque appareil (*Ne pas utiliser ce serveur*). |

## Lecture, mode hors ligne, mises à jour

| Symptôme | Cause | Solution |
| --- | --- | --- |
| Le bouton *Télécharger* est absent, ou son menu dit « Lecture hors ligne indisponible à cette adresse : le navigateur ne l’autorise qu’en HTTPS... » | Vous avez ouvert Scrollarr en HTTP simple. Le stockage hors ligne, l'installation sur l'écran d'accueil et les notifications demandent HTTPS (ou `http://localhost`). | Ouvrez Scrollarr par une adresse `https://` ([Installation](installation.md#pourquoi-https), [Synology](synology.md#5-https-avec-le-proxy-inversé-et-un-certificat)). |
| « Ce navigateur ne permet pas d’enregistrer des chapitres pour les lire hors ligne. » | Le navigateur n'a pas de stockage hors ligne (certains modes privés, vieux navigateurs). | Utilisez un autre navigateur, ou l'application installée. |
| Après une mise à jour, la version ne change pas | Chaque appareil garde les anciens fichiers de l'application dans son cache jusqu'à avoir récupéré les nouveaux. | Rechargez deux fois, ou appuyez sur *Recharger* dans « Nouvelle version de Scrollarr installée. » Fermez et rouvrez une application d'écran d'accueil. |
| Un chapitre affiche « Ce chapitre ne peut pas être lu ici » | Le chapitre n'a pas de pages que Scrollarr sait afficher en images (un EPUB, par exemple). Le message dit qu'il affiche CBZ, CBR et PDF. | Ouvrez le fichier dans Komga, comme le message le suggère. |
| « Hors ligne : ce chapitre n’est pas téléchargé, des pages peuvent manquer. » | Vous avez perdu la connexion en lisant un chapitre qui n'est pas sur l'appareil. | Téléchargez les chapitres avant de passer hors ligne (*Télécharger* sur la page de la série). |
| Une page blanche ou « 403 Forbidden » avec des images construites depuis des sources que vous avez envoyées | Les fichiers avaient des droits restrictifs quand ils ont été copiés dans l'image. Corrigé dans les images depuis la 0.9. | Mettez les sources à jour et reconstruisez ([Synology](synology.md#fichiers-récupérés-avec-des-droits-restrictifs)). |

## Profils, abonnements, progression

| Symptôme | Cause | Solution |
| --- | --- | --- |
| La progression n'est pas enregistrée | Plusieurs causes possibles : vous êtes hors ligne (la progression est mise en file et envoyée plus tard) ; le serveur était injoignable ; pour le service Dossiers, `data/folders` n'est pas inscriptible par `FOLDERS_UID:FOLDERS_GID`. | Regardez la carte dans *Réglages > Serveurs*. Pour le service Dossiers : `docker logs scrollarr-folders` montre `Progression non écrite (...)` (il réessaie) ou, au démarrage, `Le dossier de données /data n'est pas inscriptible par cet utilisateur.` Corrigez avec `sudo chown 1000:1000 data/folders` (ou vos propres numéros) et `docker restart scrollarr-folders`. |
| Vous lisez avec un autre profil, mais l'interface de Suwayomi ou de Komga n'affiche rien | Seul le profil **principal** utilise l'historique de lecture du serveur. Un autre profil garde sa progression dans les propres documents de Scrollarr sur le serveur. | Attendu. Lisez avec le profil principal si vous voulez l'historique du serveur. |
| Vous cherchez la progression d'un profil dans `data/folders/progress/` et ne trouvez rien sous `main` | Là, la progression d'un autre profil est rangée sous son **identifiant**, un code aléatoire comme `p3k9x2a`, un dossier par profil. Le service ne connaît pas les noms. | Regardez les autres dossiers ; `main` ne contient que le profil principal. |
| Un profil ou un abonnement diffère sur un autre appareil | Le profil ouvert sur un appareil, les serveurs activés et les réglages de l'interface sont gardés **par appareil**. Les abonnements sont par profil et copiés sur chaque serveur qui les stocke (Suwayomi, Komga). Avec *Dossiers* seul, les abonnements restent sur l'appareil. | Choisissez le même profil sur les deux (*Réglages > Profil > Changer de profil*), activez les mêmes serveurs, rechargez. Deux appareils qui modifient la même entrée avant de s'être vus en gardent une des deux, la même partout. |
| Le profil principal s'appelle « Principal » même dans l'interface anglaise | C'est le nom que lui donne l'application, en français. | Vous pouvez le renommer : *Réglages > Profil > Gérer les profils*, puis le menu à côté du profil, *Renommer*. |
| Un abonnement a disparu | L'application ne retire un abonnement que lorsque sa série est signalée introuvable deux fois, à au moins 24 heures d'écart (série supprimée du serveur, ou dossier renommé). | Abonnez-vous de nouveau depuis la page de la série. |
| « Les profils ne sont pas disponibles avec ce serveur. Les abonnements restent sur cet appareil. » | Seul *Dossiers* est activé : il n'a pas de stockage clé-valeur. | Activez aussi Suwayomi ou Komga. |

## Service Dossiers

| Symptôme | Cause | Solution |
| --- | --- | --- |
| *Dossiers* n'apparaît pas dans *Réglages > Serveurs* | `FOLDERS_URL` est vide. | Mettez `FOLDERS_URL=http://folders:8788` dans `.env`, recréez. |
| *Dossiers* est *Injoignable* | Le service n'est pas démarré (profil absent de la commande), ou il a refusé de démarrer. | `docker compose --profile folders up -d`, puis `docker logs scrollarr-folders`. Une ligne `Configuration invalide : ...` nomme le problème (`FOLDERS_AUTH` absent, mot de passe de moins de 12 caractères...). |
| La bibliothèque montre zéro série | `FOLDERS_SCANS_PATH` pointe vers le mauvais dossier, ou l'utilisateur du service ne peut pas le lire. | `docker exec scrollarr-folders ls /libraries/Scans` doit lister vos séries. Sinon corrigez le chemin ou les permissions ([Synology](synology.md#7-le-service-dossiers-sur-un-nas)). |
| Quelques « séries » avec des centaines de chapitres | `FOLDERS_SCANS_PATH` est un niveau trop haut. | Faites-le pointer vers le dossier qui contient directement les séries ([arborescence](installation.md#arborescence-attendue)). |
| La bibliothèque est « indisponible » (`/folders/api/v1/status` montre `"state":"unavailable"`) | Le dossier ne peut pas être lu, ou il est vide alors qu'il a contenu des séries : partage non monté, dossier chiffré verrouillé. Le service répond 503 pour que vos abonnements et téléchargements soient conservés. | Montez ou déverrouillez le partage. Si vous l'avez vidé volontairement, un parcours doit être demandé (voir `folders/README.md`). |
| Les nouveaux fichiers n'apparaissent pas | Les listes sont relues au plus toutes les 60 secondes (séries) et 30 secondes (chapitres). Un parcours complet tourne en arrière-plan toutes les 15 minutes quand quelqu'un ouvre la bibliothèque. | Attendez une minute, rouvrez la série. |
| Un chapitre renommé a perdu sa progression | Un renommage crée un nouvel élément. | Attendu. Remettez l'ancien nom pour retrouver la progression (elle est conservée). |
| Pages dans le mauvais ordre | L'ordre est le tri naturel des noms. | Renommez les fichiers ou les dossiers. |
| Un chapitre ne s'ouvre pas | L'archive est refusée (chiffrée, tronquée, trop d'entrées, méthode autre que stored/deflate) ou une image n'est pas JPEG, PNG, WebP, GIF ou AVIF. CBR, RAR, 7z et PDF ne sont pas lus. | Convertissez-le en CBZ ordinaire. Limites : `folders/README.md`. |

## Téléchargements et sources

| Symptôme | Cause | Solution |
| --- | --- | --- |
| *Réglages > Téléchargements* est vide (« Aucun téléchargement ») | Il ne liste que ce que le **serveur** est en train de récupérer (la file de téléchargement de Suwayomi), après que vous l'avez demandé depuis la page d'une série. | Rien d'anormal. Les chapitres enregistrés sur l'appareil sont dans *Ma liste > Téléchargements*. Avec Komga ou Dossiers seuls, *Réglages* n'a pas de ligne *Téléchargements* : ils n'ont rien à collecter. |
| Un chapitre téléchargé n'apparaît pas dans *Ma liste > Téléchargements* | Il a été téléchargé **par le serveur**, pas sur l'appareil. | Utilisez *Télécharger* sur la page de la série, dans la section « Sur cet appareil, pour lire sans connexion : ». |
| Le bouton *Chercher chez les sources de Suwayomi* est absent | Aucun collecteur ne peut chercher : Suwayomi n'est pas activé, pas connecté ou injoignable ; ou vous n'utilisez que Komga ou Dossiers. | Activez Suwayomi dans *Réglages > Serveurs*. Quand Suwayomi est injoignable, l'écran de recherche l'explique à la place. |
| La recherche dans les sources ne trouve rien | Peu de sources sont cochées. Par défaut, seules les sources dans la langue de l'interface ou multilingues sont interrogées, jamais celles marquées 18+. Ou aucune extension n'est installée dans Suwayomi. | Appuyez sur *Choisir les sources* et cochez-en davantage. « Aucune source installée sur Suwayomi. Ajoutez des extensions dans son interface. » signifie que Suwayomi n'en a aucune. |
| Une source affiche une erreur | Les sites tiers peuvent être lents ou refuser. | « Cette source n’a pas répondu à temps. » ou « Cette source a refusé la recherche ou ne répond pas. » ne concerne que cette source ; les autres continuent. Appuyez sur *Chercher de nouveau*. |

## Notifications

| Symptôme | Cause | Solution |
| --- | --- | --- |
| « Le service de notifications n’est pas installé sur ce serveur... » | Le notifier ne tourne pas. | `docker compose --profile push up -d` ([Installation](installation.md#notifications-push-facultatif)). |
| Le conteneur notifier redémarre en boucle | Il manque un serveur (`SUWAYOMI_URL`, ou `KOMGA_URL` avec `KOMGA_API_KEY`), ou il ne peut pas écrire dans `data/notifier`. | `docker logs scrollarr-notifier`. Corrigez `.env` ; `sudo chown 1000:1000 data/notifier`. |
| « Notifications bloquées. Autorisez-les pour ce site dans les réglages du navigateur. » | Le navigateur a refusé la permission. | Autorisez les notifications pour le site dans le navigateur. |
| « Ce navigateur ne gère pas les notifications. Sur iPhone, ajoutez d’abord Scrollarr à l’écran d’accueil. » | L'iPhone ne les gère que pour l'application installée, en HTTPS. | Installez l'application depuis Safari, puis activez l'option. |
| Aucune notification pour votre propre bibliothèque à la première activation | La première vérification ne fait qu'enregistrer ce qui existe. | Attendu : vous êtes prévenu des chapitres qui arrivent ensuite, pour les séries auxquelles vous êtes abonné, dans les `POLL_MINUTES`. |

## Installation

| Symptôme | Cause | Solution |
| --- | --- | --- |
| `Conflict. The container name "/scrollarr" is already in use` | Les conteneurs ont des noms fixes ; un dossier de projet renommé compte comme un nouveau projet. | `docker compose down` dans l'ancien dossier, ou `docker rm -f scrollarr scrollarr-notifier scrollarr-folders` ([Synology](synology.md#container-name-already-in-use)). |
| « Your kernel does not support PIDs limit » | Le service Dossiers fixe une limite de 64 processus que le noyau ne sait pas appliquer. | Sans conséquence ([Synology](synology.md#your-kernel-does-not-support-pids-limit)). |
| `docker compose` n'est pas reconnu | Docker sans le module Compose. | Installez le module (ou un Docker à jour). |
| `docker compose pull` échoue ou ne fait rien pour Scrollarr | Vous avez installé depuis un clone : les images sont construites localement. | `git pull`, puis `docker compose up -d --build` ([guide de mise à jour](update-backup.md#depuis-un-clone)). |

## Vérifications utiles

**Journaux.** Les trois conteneurs s'appellent `scrollarr`, `scrollarr-notifier` et `scrollarr-folders` :

```sh
docker logs --tail 100 scrollarr
docker logs --tail 100 scrollarr-notifier
docker logs --tail 100 scrollarr-folders
```

Ajoutez `-f` pour les suivre en direct. L'équivalent avec Compose est `docker compose logs scrollarr` (ajoutez `--profile push` ou `--profile folders` avant `logs` pour les services facultatifs). Le conteneur principal journalise chaque requête avec son statut, ce qui montre tout de suite les 502 et 504. Sur un Synology, Container Manager affiche aussi des journaux (noms de menus non vérifiés).

**Quelle version tourne.** *Réglages > À propos* l'affiche. Depuis un terminal :

```sh
curl http://192.168.1.10:8380/js/config.js
```

imprime une ligne `export const APP_VERSION = '0.9.0';`. (Pas depuis la barre d'adresse du navigateur : l'application répondrait à la place du fichier.) Le numéro propre du service Dossiers (`version` dans `/folders/api/v1/status`) n'est pas celui de la version.

**Les services répondent.**

```sh
curl http://192.168.1.10:8380/servers.json
curl http://192.168.1.10:8380/notify/health
curl http://192.168.1.10:8380/folders/health
```

Le premier montre quels serveurs sont configurés, sous la forme `{"komga":false,"suwayomi":true,"folders":false}`. Le deuxième répond `{"ok":true,"subscriptions":0}` quand le notifier tourne (un 404 veut dire qu'il ne tourne pas). Le troisième répond `{"ok":true}` quand le service Dossiers tourne, et rien d'autre : c'est la sonde de santé publique. Pour voir sa version, son mode et l'état de chaque bibliothèque (`ok`, `scanning` ou `unavailable`), ouvrez `http://192.168.1.10:8380/folders/api/v1/status` dans le navigateur où vous êtes connecté à l'application (en mode `password`, le cookie de connexion est nécessaire).

**Vérifier les adresses utilisées par le conteneur.**

```sh
docker compose exec scrollarr env
```

Cherchez dans la sortie les trois lignes `SUWAYOMI_URL=`, `KOMGA_URL=` et `FOLDERS_URL=`.

**Tester une adresse depuis le conteneur.**

```sh
docker compose exec scrollarr wget -O /dev/null http://192.168.1.10:4567/
```

Les messages viennent du petit `wget` de l'image. `bad address` veut dire que le nom ne se résout pas ; `can't connect to remote host` ou `Connection refused` que rien n'écoute à cette adresse ; `server returned error: HTTP/1.1 401` (ou tout autre code HTTP) que le serveur a répondu, donc que l'adresse est la bonne.

**État des conteneurs.** `docker compose ps` (avec les options `--profile` pour les services facultatifs). Un conteneur qui redémarre en boucle affiche `Restarting` ; son journal donne la raison.

## Toujours bloqué ?

Ouvrez un ticket sur le dépôt et indiquez la version de Scrollarr, `docker compose ps`, les lignes utiles des journaux et ce que vous attendiez. Retirez les mots de passe et les adresses que vous ne voulez pas partager. Les failles passent par le canal privé décrit dans [SECURITY.md](../../SECURITY.md).
