# API-001 — Cadrage de l'étude « backend Scrollarr »

> Ce document n'est pas l'étude : c'est sa commande. Il fixe la question, les
> contraintes, les directions déjà retenues et le livrable attendu. L'étude
> elle-même sera rédigée dans `docs/design/API-001-etude-backend.md`.
> Rédigé le 14 novembre 2026 sur la base de `main` (version 0.10.0).

## 1. Pourquoi cette étude maintenant

Scrollarr n'a pas de backend : un conteneur nginx sert l'application et relaie
les serveurs de lecture, et deux services facultatifs l'accompagnent (le
notifier et le service Dossiers). Ce choix a tenu jusqu'à la version 0.10, mais
chaque lot récent a buté sur la même limite et l'a contournée :

| Besoin | Contournement actuel | Ce que ça coûte |
| --- | --- | --- |
| Profils, abonnements, historique des tâches partagés entre appareils | Rangés dans le stockage clé-valeur de Suwayomi ou de Komga (`app/js/api.js`, `saveDoc`) | Dépend d'un serveur tiers ; limite de 4 096 caractères par valeur chez Suwayomi ; rien sur une installation « dossiers seuls » |
| Profils sur une installation « dossiers seuls » | Aucun : fonction masquée | Pas de profils, abonnements sur l'appareil seulement |
| Relances automatiques des téléchargements (`JOB-003`) | Déclenchées par l'application ouverte | Rien ne se passe application fermée |
| Suivi automatique d'une série (`COL-008`) | Pas fait | Même limite que ci-dessus |
| Deux appareils qui relancent la même tâche | Jeton de réservation « au mieux » dans l'historique partagé | Pas d'écriture atomique : double relance possible |
| Comptes et mots de passe par profil | Aucun : « les profils ne sont pas des comptes » | N'importe qui ouvre n'importe quel profil |
| Identité des appareils pour les notifications | Le notifier s'appuie sur la session d'un serveur de lecture | Identité commune si Suwayomi n'a pas d'authentification ; impossible en « dossiers seuls » |
| Doublons entre serveurs | Rapprochés par le titre | Pas d'identifiant stable où ranger un rapprochement vérifié |
| Applications iOS et Android | Non commencées | Tout repose sur un proxy de même origine |

L'étude READ-002 a par ailleurs posé une règle : « jamais plus de deux services
satellites ; un troisième besoin côté serveur déclenche la réunion du notifier
et des dossiers en un seul serveur ». Ce troisième besoin est arrivé.

## 2. La question posée

> Scrollarr doit-il se doter d'un backend, lequel, avec quelles
> responsabilités, et par quel chemin y arriver sans casser les installations
> existantes ?

L'étude doit permettre à Julien de trancher en une lecture, puis de faire
exécuter le résultat lot par lot par des agents. Elle doit donc conclure, pas
énumérer.

## 3. Contraintes non négociables

Elles viennent de la roadmap (`docs/ROADMAP.md`, §2.4, §3.3, §10) et des
décisions déjà prises. L'étude ne les rediscute pas ; si l'une d'elles rend une
option impossible, elle le dit et écarte l'option.

1. **Le mode léger reste possible.** Une installation « nginx seul » (ou nginx
   et un service facultatif) doit continuer à fonctionner à chaque version, avec
   les limites qu'elle a aujourd'hui. Le backend ajoute, il ne devient pas
   obligatoire pour lire.
2. **Local d'abord.** Les données restent sur l'installation de l'utilisateur.
   Aucun compte externe, aucun service en ligne requis.
3. **Le backend n'est pas sur le chemin des images.** Les pages et les
   couvertures continuent de passer de nginx au serveur de lecture ; le backend
   ne les relaie pas.
4. **Ne pas refaire Komga ni Suwayomi.** Pas de bibliothèque propre, pas
   d'indexation de fichiers en dehors du service Dossiers existant, pas de
   téléchargement depuis des sources.
5. **La complexité reste en arrière-plan** (règle de `docs/ROADMAP.md` §3.3) :
   pas de nouvel onglet, pas de console d'administration permanente.
6. **Déploiement par Docker Compose sur un petit NAS.** Cible de référence : un
   Synology à processeur Celeron et 4 Go de mémoire, noyau ancien (pas de
   limite de processus par conteneur), utilisateurs sans UID 1000, mise à jour
   par `docker compose pull`. Images `amd64` et `arm64`.
7. **Une sauvegarde = un dossier.** Tout l'état du backend tient dans un volume
   de données, copiable à froid.
8. **Licence MIT**, dépendances réduites au strict nécessaire, chacune
   justifiée.
9. **Aucun secret dans le navigateur ni dans le dépôt** (règle §3.3), et aucun
   chemin physique ni identifiant de serveur tiers exposé comme identifiant
   universel.

## 4. Directions retenues

Ce sont les choix que je recommande et que Julien entend faire appliquer.
L'étude les prend comme hypothèses de travail. Elle a le droit d'en réfuter
une, à condition de le démontrer et de proposer mieux ; à défaut elle les
détaille jusqu'à les rendre exécutables.

### D1 — Un serveur, pas un troisième satellite

Le backend est un service unique, `scrollarr-server`, qui absorbe le notifier
et le service Dossiers comme modules internes, activables séparément. On ne
crée pas de quatrième conteneur. À étudier : la forme de la transition
(les images `scrollarr-notifier` et `scrollarr-folders` continuent-elles
d'exister, pour combien de versions, comment un utilisateur passe de l'une à
l'autre sans perdre `data/notifier` ni `data/folders`).

### D2 — nginx reste devant

nginx continue de servir l'application et de relayer les serveurs de lecture ;
le backend est monté derrière lui sous `/api/`. L'étude compare honnêtement
avec l'alternative « le serveur sert tout et nginx disparaît » (un conteneur de
moins, mais relais, en-têtes et cache à réécrire) et dit pourquoi elle retient
l'une ou l'autre.

### D3 — Node, dans le style de l'existant

Même pile que `notifier/` et `folders/` : Node 22, modules ES, sans framework,
commentaires en français. L'étude ne propose un autre langage que si elle
montre un blocage.

### D4 — Stockage derrière une interface, SQLite seulement si démontré

Une couche de stockage isolée, comme dans le service Dossiers. L'étude compare :
fichiers JSON à écriture atomique (l'existant), le module `node:sqlite` intégré
à Node (vérifier son statut exact dans la version de Node visée : stable,
expérimental, activé par défaut ou non), et `better-sqlite3` (dépendance
native, à construire pour deux architectures). Elle recommande l'un des trois
en s'appuyant sur les besoins réels listés au §5 : écritures concurrentes,
transactions, migrations, taille.

### D5 — Le backend devient propriétaire des données communes à Scrollarr

Profils, abonnements, préférences partagées, historique des tâches, et la
progression des profils secondaires. Les connecteurs gardent ce qui leur est
natif (la progression du profil principal reste celle du serveur de lecture).
C'est la séparation demandée lors de la revue de READ-002. L'étude précise,
donnée par donnée, où elle vit avec et sans backend, et le chemin de migration
depuis les documents aujourd'hui rangés dans Suwayomi et Komga : import au
premier démarrage, période de double écriture ou bascule franche, retour
arrière possible.

### D6 — Les tâches de fond passent côté serveur

Vérification des nouveaux chapitres (déjà faite par le notifier), relances
automatiques, et suivi automatique des séries. Le backend détient pour cela les
identifiants de service des serveurs de lecture, comme le notifier aujourd'hui.
Avant de concevoir le suivi automatique, l'étude vérifie ce que Suwayomi sait
déjà faire seul (mise à jour planifiée de la bibliothèque, téléchargement
automatique des nouveaux chapitres) et s'il suffit de piloter ces réglages.

### D7 — Comptes facultatifs, modèle minimal

L'authentification reste facultative et explicite, sur le modèle de
`FOLDERS_AUTH` : le serveur refuse de démarrer sans choix clair. L'étude
compare deux ou trois modèles et retient le plus petit qui satisfait
`AUTH-001` à `AUTH-003` : par exemple un mot de passe d'instance unique ; des
comptes possédant chacun un ou plusieurs profils ; un compte administrateur et
des profils protégés par code. Elle dit clairement ce que chaque modèle
n'apporte pas (un mot de passe partagé n'est pas une séparation entre
personnes) et comment il cohabite avec l'authentification propre de Suwayomi et
de Komga, que l'utilisateur saisit déjà.

### D8 — Une API versionnée, pensée pour un client qui n'est pas de même origine

`/api/v1`, contrat documenté (`API-002`). Le client web d'aujourd'hui profite
de la même origine ; un client mobile non. L'étude ne conçoit pas les
applications mobiles, mais vérifie que rien dans ses choix ne les empêche :
jetons à durée courte renouvelables et révocables par appareil, adresse du
serveur configurable, contrôle des adresses de serveurs distants contre les
requêtes forgées côté serveur (`AUTH-004`).

### D9 — Le client découvre ce que le serveur sait faire

Comme les connecteurs déclarent leurs capacités, le backend annonce les siennes
(`/api/v1/capabilities` ou équivalent), et l'application n'affiche une fonction
que si elle est disponible. C'est ce qui permet au mode léger de coexister
sans branches de code dispersées.

### D10 — Migration par lots fusionnables, le premier utile à lui seul

Chaque lot laisse `main` publiable et le mode léger intact. Le premier lot doit
apporter quelque chose de visible à un utilisateur réel. Deux candidats, à
départager : (a) profils et abonnements sur une installation « dossiers seuls »,
avec un stockage qui ne dépend plus des serveurs de lecture ; (b) relances et
suivi automatiques application fermée.

## 5. Ce que l'étude doit établir

1. **L'état réel du code**, vérifié fichier par fichier et non repris de ce
   document : où chaque donnée est écrite aujourd'hui (`app/js/api.js`,
   `profiles.js`, `store.js`, `sync.js`, `tasks.js`, `folders/`, `notifier/`),
   quelles règles de fusion existent, quelles limites de taille s'appliquent.
2. **L'option « ne pas faire de backend »**, traitée sérieusement : ce qu'on
   peut encore obtenir en étendant les satellites existants, et ce qui reste
   définitivement hors de portée.
3. **Deux ou trois architectures candidates**, comparées sur les mêmes
   critères : conteneurs à déployer, mémoire, effort de migration, risque pour
   les installations existantes, ce que chacune débloque dans la roadmap
   (phases 4, 5 et 6).
4. **Le modèle de données** : entités, identifiants (stables, opaques,
   indépendants des identifiants natifs), relations entre compte, profil,
   appareil, abonnement, progression, tâche. Il doit pouvoir accueillir plus
   tard le rapprochement vérifié des séries entre serveurs (phase 4) sans être
   refait, mais l'étude ne conçoit pas ce rapprochement.
5. **La synchronisation** : ce que deviennent les règles actuelles (révision et
   identifiant d'appareil, marques de suppression) quand un serveur fait
   autorité ; ce qui se passe hors ligne ; ce qui se passe quand deux appareils
   écrivent en même temps.
6. **L'esquisse de l'API** : ressources, verbes, authentification, erreurs,
   pagination, versionnement. Pas un fichier OpenAPI complet.
7. **Le modèle de menace**, en clair : qui peut atteindre quoi, où sont les
   secrets, ce qui est exposé si l'instance est publiée sur Internet, protection
   contre les requêtes forgées, limitation des tentatives, en-têtes, droits du
   conteneur. À la hauteur de ce qui a été fait pour le service Dossiers.
8. **La migration** : pour chaque type d'installation existante (Suwayomi seul,
   Komga seul, les deux, Dossiers seuls, avec ou sans notifier), ce que
   l'utilisateur doit faire, ce qui est automatique, comment revenir en
   arrière, et ce qui se passe pour un appareil resté sur une ancienne version.
9. **Les tests** : comment chaque lot est couvert (unitaires, intégration du
   service, bout en bout avec le navigateur, conteneur), et ce qui ne pourra
   être validé que sur un vrai NAS.
10. **Le découpage en lots**, ordonné, chacun avec sa taille (S, M, L), son
    critère de sortie vérifiable et ses dépendances.

## 6. Hors périmètre

- Écrire du code, des fichiers Compose ou des migrations.
- Concevoir les applications iOS et Android, le rapprochement des séries entre
  serveurs, ou une offre payante.
- Réécrire l'application web ou changer sa pile.
- Remplacer l'authentification de Suwayomi ou de Komga.

## 7. Méthode imposée

- **Lire le code avant d'écrire.** Toute affirmation sur l'existant cite un
  fichier du dépôt. À lire au minimum : `README.md`, `docs/ROADMAP.md`,
  `docs/fr/*.md`, `docs/design/READ-002-connecteur-dossiers.md` (méthode,
  niveau de détail et règle des deux satellites), les deux autres études de
  `docs/design/`, `app/js/api.js`, `profiles.js`, `store.js`, `sync.js`,
  `tasks.js`, `push.js`, `net.js`, `app/js/connectors/`, `folders/`,
  `notifier/server.js`, `nginx/default.conf.template`, `docker-compose.yml`,
  `deploy/docker-compose.yml`, `.github/workflows/`.
- **Vérifier les affirmations sur des logiciels tiers** dans une source
  primaire, et la citer : statut de `node:sqlite`, comportement de SQLite sur
  un volume réseau, options de Docker et de Compose, capacités de Suwayomi en
  matière de mise à jour et de téléchargement automatiques.
- **Marquer ce qui n'est pas vérifié** comme tel. Ne jamais présenter une
  supposition comme un fait.
- **Signaler les désaccords.** Si une direction du §4 est mauvaise, le dire en
  tête de document, avec la démonstration.
- **Aucune donnée personnelle** : pas de nom de domaine, d'adresse IP,
  d'adresse électronique ni de nom autre que « Julien ».

## 8. Livrable attendu

Un document en français, `docs/design/API-001-etude-backend.md`, de 500 à 800
lignes, orienté décision (tableaux pour les comparaisons, paragraphes courts),
structuré ainsi :

1. Résumé et recommandation, avec la liste des décisions à prendre.
2. État des lieux vérifié.
3. Options comparées, dont « pas de backend ».
4. Architecture recommandée : composants, modèle de données, API,
   synchronisation, authentification, tâches de fond, déploiement.
5. Sécurité.
6. Migration et compatibilité.
7. Tests.
8. Découpage en lots.
9. Risques et questions ouvertes, chacune formulée pour une réponse en une
   ligne, avec la réponse recommandée.
10. Annexes : sources, points non vérifiés, défauts relevés dans le code
    pendant la lecture.

Le document est livré sur une branche `docs/API-001-backend-study`, en un
commit, sans `push` forcé ni modification d'autres fichiers.

## 9. Questions que Julien devra trancher à la lecture de l'étude

Elles sont listées ici pour que l'étude y réponde explicitement, avec une
recommandation.

1. Fait-on le backend maintenant, ou continue-t-on avec les satellites encore
   une ou deux versions ?
2. Le premier lot vise-t-il les profils en « dossiers seuls » ou les tâches de
   fond application fermée ?
3. Les images `scrollarr-notifier` et `scrollarr-folders` sont-elles
   conservées pendant la transition, et jusqu'à quelle version ?
4. Quel modèle de comptes, et l'authentification devient-elle recommandée par
   défaut ?
5. Avec un backend présent, les profils et abonnements quittent-ils
   définitivement Suwayomi et Komga, ou restent-ils dupliqués ?
6. SQLite ou fichiers ?
7. La première version avec backend s'appelle-t-elle 1.0 ?
