# Sécurité

[English](../en/security.md) · **Français** · [Retour au README](../../README.fr.md)

Cette page explique, en mots simples, qui peut atteindre quoi une fois Scrollarr en marche, et ce qu'il faut décider avant de le mettre sur Internet. Pour signaler une faille, voir la fin de la page.

## L'essentiel

- Scrollarr n'ajoute **aucune connexion à lui**. Il transmet les requêtes à vos serveurs.
- Toute personne qui peut ouvrir l'adresse de Scrollarr obtient ce que vos serveurs donnent à quelqu'un qui n'est pas connecté.
- Un Suwayomi **sans authentification** donne tout. N'exposez pas une telle instance sur Internet.
- Les profils ne sont **pas des comptes** : pas de mot de passe, et chacun peut ouvrir n'importe quel profil.
- Utilisez HTTPS, et gardez Scrollarr sur votre réseau local ou derrière un VPN, sauf si chaque serveur derrière lui demande une connexion.

## Qui peut atteindre quoi

Le conteneur Scrollarr est un serveur web et un proxy. Il sert l'application et relaie toute l'API de chaque serveur sous sa propre adresse (`/suwayomi/`, `/komga/`, `/folders/`). Le navigateur ne parle jamais qu'à Scrollarr.

| Derrière Scrollarr | Quelqu'un qui atteint Scrollarr sans avoir de compte peut... |
| --- | --- |
| Suwayomi sans authentification | Lire la bibliothèque, et aussi la modifier ainsi que les réglages du serveur, puisque le proxy relaie toute l'API. |
| Suwayomi avec authentification | Rien d'utile sans les identifiants. |
| Komga | Atteindre la connexion de Komga. La suite dépend de Komga et de ses comptes. |
| Service Dossiers, mode `password` | Atteindre la connexion ; rien d'autre sans l'utilisateur et le mot de passe partagés. |
| Service Dossiers, mode `none` | Lister le nom de toutes les séries et de tous les chapitres, lire toutes les pages, lire ou modifier toute la progression de lecture. Jamais écrire ni supprimer un fichier, jamais atteindre un chemin hors des bibliothèques montées. |

Deux conséquences :

- Un visiteur ne peut pas changer l'adresse d'un serveur. Les adresses viennent de l'environnement du conteneur (`SUWAYOMI_URL`, `KOMGA_URL`, `FOLDERS_URL`), jamais de ce qu'un utilisateur tape : le proxy ne peut pas être dirigé vers d'autres machines.
- Mettre Scrollarr sur Internet expose **toute** l'API de chaque serveur relayé, pas seulement l'application. Si l'un d'eux n'a pas d'authentification, c'est une porte ouverte.

Que faire : activez l'authentification de Suwayomi, ou gardez Scrollarr hors d'Internet (réseau local, VPN, ou proxy inversé qui restreint qui passe ; voir [Synology](synology.md#6-limiter-laccès-au-réseau-local-profil-de-contrôle-daccès)).

## Connexion et HTTPS

**Suwayomi.** Ses modes « basic auth » et « simple login » attendent les identifiants à chaque requête, images comprises. Scrollarr les range donc dans un cookie, `scrollarr_suwa_basic`, que le proxy transforme en en-tête `Authorization`. Le cookie contient l'utilisateur et le mot de passe sous la forme réversible « Basic » (encodés, pas chiffrés). Il est créé par la page, donc il n'est pas `HttpOnly` ; il est `SameSite=Strict`, limité au chemin de l'application, dure un an et porte l'attribut `Secure` quand la page est servie en HTTPS. Servez toujours Scrollarr en HTTPS. Le mode « UI login » (jeton renouvelable) évite de garder le mot de passe : Scrollarr garde le jeton d'accès dans un cookie (`suwayomi-server-token`) et un jeton de renouvellement dans le `localStorage` du navigateur. Scrollarr essaie les modes à tour de rôle, vous n'avez donc pas à lui dire lequel utilise votre Suwayomi. *Se déconnecter* dans *Réglages > Serveurs* supprime tout cela.

**Komga.** L'application se connecte une fois avec votre e-mail et votre mot de passe ; Komga pose son propre cookie de session.

**Service Dossiers en mode `password`.** Un utilisateur et un mot de passe partagés (`FOLDERS_USER`, `FOLDERS_PASSWORD`, au moins 12 caractères). Tout sauf `/health` demande une session : un cookie signé, `HttpOnly`, `SameSite=Strict`, `Secure` quand la requête indique être arrivée en HTTPS (`X-Forwarded-Proto: https`, que votre proxy inversé doit envoyer), valable `FOLDERS_SESSION_HOURS` heures (720 par défaut). Changer l'utilisateur ou le mot de passe déconnecte tout le monde. Après `FOLDERS_LOGIN_ATTEMPTS` connexions échouées (5) en `FOLDERS_LOGIN_WINDOW_SECONDS` secondes (900), le service répond par l'erreur 429. Le compte se fait par adresse *telle que le conteneur Scrollarr la voit* ; derrière un proxy inversé, c'est l'adresse du proxy, donc les échecs de personnes différentes s'additionnent (cela découle du code, je ne l'ai pas essayé).

**Notifier.** Il garde, dans son environnement, la clé d'API de Komga et, si Suwayomi est protégé, les identifiants de Suwayomi. Il n'accepte un abonnement que d'un appelant dont les propres cookies sont acceptés par l'un de vos serveurs. Ses réponses `/vapid` et `/health` sont publiques.

## Ce qu'un mot de passe partagé ne donne pas

Le mot de passe du service Dossiers protège **l'accès au service**. Il ne sépare pas les personnes :

- Toute personne qui le connaît voit tous les scans.
- Toute personne qui le connaît peut lire et modifier la progression de lecture de **chaque profil**, car un profil n'est qu'un nom.
- Quiconque peut atteindre Scrollarr avec le service en mode `none` n'a besoin d'aucun mot de passe.

Pour des historiques séparés et protégés, utilisez Komga avec un compte par personne.

## Le mode `none` du service Dossiers

Il faut le demander explicitement (`FOLDERS_AUTH=none`), et le service écrit un avertissement dans son journal à chaque démarrage. Ne l'utilisez que sur un réseau local de confiance ou derrière un VPN. Le service ne peut pas vérifier qu'il n'est pas exposé : derrière un proxy, l'adresse qu'il voit est celle du proxy. Avant d'exposer Scrollarr au-delà d'un réseau de confiance, passez en `password`, en HTTPS.

## Protections du service Dossiers

- Les scans sont montés en lecture seule, et le service n'y écrit jamais, n'extrait jamais une archive sur le disque, ne suit jamais un lien symbolique et ne reçoit jamais un chemin du client (uniquement des identifiants opaques).
- Seules des images sont servies, reconnues à leurs premiers octets (JPEG, PNG, WebP, GIF, AVIF), jamais au nom du fichier. Tout le reste (SVG compris) est refusé.
- Les archives sont lues sur place, avec des limites sur le nombre d'entrées, les tailles et le taux de compression. Une archive hostile ou démesurée est refusée avec une erreur lisible.
- Les requêtes autres que `GET` doivent porter l'en-tête `X-Requested-With` et `Content-Type: application/json`, et une requête dont l'`Origin` ne correspond pas à l'hôte est refusée. Cela vaut aussi sur un réseau local.
- Il tourne avec un système de fichiers en lecture seule, sans capacités Linux, `no-new-privileges`, 256 Mo de mémoire, et sur son propre réseau Docker interne : aucun port n'est publié, seul le conteneur Scrollarr l'atteint. (Le conteneur principal et le notifier n'ont pas ces restrictions.)

## En-têtes envoyés par Scrollarr

Le conteneur principal les envoie sur chaque réponse (et les répète sur `/servers.json`) :

| En-tête | Valeur |
| --- | --- |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `same-origin` |
| `Content-Security-Policy` | `default-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'` |

La politique signifie que la page ne charge rien depuis d'autres sites (ni image, ni script, ni police, ni requête externes) et ne peut pas être placée dans un cadre : les couvertures et les icônes passent par le proxy. Scrollarr n'a aucune télémétrie. `/servers.json` est envoyé avec `Cache-Control: no-store`.

Scrollarr n'envoie pas `Strict-Transport-Security` : le HTTPS est fait par votre proxy inversé, c'est là qu'il faut l'activer.

## Ce que l'application stocke dans le navigateur

| Où | Quoi |
| --- | --- |
| `localStorage` | Les réglages, le profil ouvert sur l'appareil, les serveurs activés, une copie des abonnements et des profils, les recherches récentes, un identifiant d'appareil aléatoire, la progression hors ligne en attente d'envoi, le jeton de renouvellement de Suwayomi. |
| IndexedDB et Cache Storage | Les chapitres téléchargés (leurs pages sont des images stockées dans le navigateur), des copies de réponses récentes de vos serveurs, les fichiers de l'application, jusqu'à 700 miniatures. |
| Cookies | Les cookies de connexion décrits plus haut. |

Rien de tout cela ne quitte l'appareil, sauf vers vos propres serveurs. Effacer les données du site l'efface. Quiconque utilise votre profil de navigateur peut lire les chapitres téléchargés, et le cookie Suwayomi si vous utilisez ce mode. Les profils n'y changent rien.

## Liste de durcissement

- Servez Scrollarr en HTTPS.
- Ne redirigez pas le port de Scrollarr (8380) depuis votre routeur. Ne publiez que le nom HTTPS, et restreignez qui peut l'atteindre si vous le pouvez.
- Activez l'authentification de Suwayomi. Utilisez les comptes de Komga. Utilisez le mode `password` pour le service Dossiers.
- Choisissez un mot de passe long pour le service Dossiers.
- Gardez `.env` privé (`chmod 600 .env`). Il contient vos mots de passe et vos clés d'API. Il figure dans `.gitignore` : ne le validez jamais dans Git.
- Gardez Scrollarr à jour. Seule la dernière version reçoit les correctifs de sécurité ([guide de mise à jour](update-backup.md)).

## Signaler une faille

N'ouvrez pas de ticket public. Utilisez le signalement privé de GitHub : ouvrez l'onglet **Security** du dépôt et choisissez **Report a vulnerability**. La politique est dans [SECURITY.md](../../SECURITY.md).
