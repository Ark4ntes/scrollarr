# Scrollarr — Roadmap produit & plan technique

> **Document de pilotage — version 1.1 — 11 novembre 2026**
> Projet : [Ark4ntes/scrollarr](https://github.com/Ark4ntes/scrollarr)
> Vision : lecteur manga/comics auto-hébergé, multi-serveurs, avec
> collecte intégrée et applications iOS/Android.

## État d'avancement (11 novembre 2026, version 0.7.0)

Ce document décrit une cible. Voici où en est réellement le dépôt.

| Item | État | Détail |
| --- | --- | --- |
| CONN-001, CONN-002 | Fait | Contrats séparés pour les lecteurs et les collecteurs, capacités déclarées et vérifiées au démarrage |
| CONN-005 | Fait | Activation, désactivation, priorité, état et bouton « Tester » par serveur |
| CONN-006 | Fait | Une panne d'un serveur ne bloque pas les autres |
| SYNC-001, SYNC-002 | Fait | Fusion entrée par entrée avec révision et identifiant d'appareil (progression, historique, abonnements) |
| QA-001, QA-002, QA-003, DEV-001 | Fait | CI et tests automatisés ; validation fonctionnelle sur les serveurs réels déjà effectuée (lecture, progression et parcours existants) |
| QA-004 | À faire | Validation réelle du cycle de vie des tâches Suwayomi : file, progression, échec, annulation, relance et reconnexion |
| DEV-002, OPS-002 | Fait | Image Docker et contrôles de santé |
| DOC-002, DOC-003, SEC-001 | Fait | Documentation des connecteurs, fichiers de contribution et de sécurité |
| COL-001 | Fait en partie | Contrat des collecteurs : téléchargement de chapitres connus d'un lecteur, tâches, annulation, relance. Il manque la recherche et le suivi d'une série |
| COL-002 | Fait en partie | Collecteur Suwayomi : téléchargement et file d'attente. Pas de recherche chez les sources |
| JOB-001 | Fait en partie | Les tâches suivies survivent au rechargement, par appareil. La file elle-même reste celle du collecteur |
| JOB-002, JOB-004, JOB-005 | Fait | Modèle commun des tâches, états et historique, annulation, écran de suivi ouvert depuis les réglages |
| JOB-003 | Fait en partie | Relance manuelle ; pas de relance automatique avec délai croissant |
| LIB-001 | Fait en partie | Limite documentée : les doublons sont reconnus par leur titre uniquement |
| AUTH-004 | Sans objet pour l'instant | Les adresses des serveurs viennent de l'environnement, jamais d'une saisie utilisateur |

Tous les autres items sont à faire. Les phases 4 à 6 (bibliothèque universelle, comptes, applications mobiles) dépendent de la décision « backend léger » de la section 10 : l'application actuelle fonctionne sans backend, avec un simple nginx.

Les numéros de version des jalons (v1.1, v1.2…) sont ceux de la cible ; le dépôt en est à la version 0.7.0.

---

## 1. Vision produit

Faire de **Scrollarr le point d'entrée unique pour découvrir, organiser,
collecter et lire des mangas, manhwa, manhua et comics**, quelle que
soit la solution qui héberge les bibliothèques ou réalise les
téléchargements.

Principes directeurs :

1. **Local-first et auto-hébergé** : l'installation doit rester
   pleinement utilisable sans compte cloud Scrollarr.
2. **Open source** : le cœur du produit reste libre et utile sans
   abonnement.
3. **Multi-serveurs** : plusieurs bibliothèques et plusieurs
   collecteurs peuvent cohabiter.
4. **Une expérience cohérente** : Web, PWA, iOS et Android utilisent le
   même cœur métier.
5. **Pas de dépendance artificielle** : une fonctionnalité indisponible
   sur un serveur doit être signalée, pas simulée.
6. **Respect des sources et des droits** : les intégrations de collecte
   respectent les API, les conditions d'utilisation et les droits de
   distribution des contenus.

### Public cible

- Utilisateurs de Komga, Suwayomi, Kavita et autres serveurs
  auto-hébergés.
- Utilisateurs qui combinent plusieurs bibliothèques.
- Lecteurs qui souhaitent une expérience mobile moderne.
- Administrateurs qui veulent centraliser la supervision et les
  téléchargements.

### Positionnement

Scrollarr n'a pas vocation à remplacer Komga, Kavita, Suwayomi ou les
outils de collecte. Il orchestre l'expérience utilisateur au-dessus de
ces services.

---

## 2. Périmètre fonctionnel cible

### 2.1 Lecture et bibliothèques

- Bibliothèque unifiée multi-serveurs.
- Recherche, filtres et tri globaux.
- Lecteur vertical optimisé pour mobile.
- Reprise de lecture.
- Historique, favoris, collections et marque-pages.
- Téléchargement et lecture hors ligne.
- Gestion des profils et préférences.

### 2.2 Collecte et acquisition

- Connexion à un ou plusieurs outils de collecte.
- Recherche de séries/chapitres via les outils connectés.
- Suivi des séries.
- Téléchargement manuel ou automatisé selon les règles de
  l'utilisateur.
- File de tâches centralisée.
- Suivi des téléchargements et erreurs.
- Import ou scan dans une bibliothèque de lecture.
- Détection des chapitres manquants.

> Les fonctionnalités de collecte doivent rester configurables et
> respecter les conditions d'utilisation des sources et les droits
> applicables. Aucun téléchargement automatique ne doit être activé sans
> choix explicite de l'utilisateur.

### 2.3 Applications

- Web responsive.
- PWA lorsque pertinente.
- Application iOS via Capacitor.
- Application Android via Capacitor.
- Notifications natives.
- Stockage local sécurisé et gestion hors ligne.

### 2.4 Modèle économique

- Community : fonctionnalités essentielles, auto-hébergement et usage
  local gratuits.
- Supporter : soutien financier facultatif.
- Plus éventuel : services hébergés facultatifs (synchronisation cloud
  chiffrée, sauvegarde distante, confort multi-appareils).
- Ne jamais rendre le cloud obligatoire pour utiliser une installation
  auto-hébergée.

---

## 3. Principes d'architecture

### 3.1 Architecture cible

```text
Web / PWA / iOS / Android
          |
          v
      Scrollarr UI
          |
          v
  Core API / orchestration
  - profils et appareils
  - bibliothèque unifiée
  - progression
  - recherche
  - préférences
  - notifications
  - tâches
      /           \
     v             v
Connecteurs       Connecteurs
de lecture        de collecte
     |             |
Komga             Suwayomi
Suwayomi          Tranga*
Kavita            Mangarr*
Stump*            autres*
Folder*
OPDS*
          |
          v
Docker / stockage / worker / logs / sauvegardes
```

`*` Intégration à étudier : confirmer le projet exact, son API, sa
licence, son activité et ses capacités avant de planifier une
implémentation.

### 3.2 Décisions d'architecture recommandées

| Sujet | Proposition | Statut |
| --- | --- | --- |
| Frontend | Conserver le JavaScript natif existant autant que possible | À confirmer par audit |
| Mobile | Capacitor, base de code partagée | Recommandé |
| Connecteurs | Interfaces séparées lecture / collecte | À adopter |
| Modèle de données | Modèle canonique Scrollarr + identifiants natifs | À adopter |
| Backend | Backend léger optionnel au départ | À arbitrer |
| Base de données | SQLite en première intention si backend nécessaire | À arbitrer |
| File de tâches | Worker + tâches persistantes | À concevoir |
| Déploiement | Docker Compose | À conserver |
| Notifications | Service indépendant, adaptateurs Web Push/APNs/FCM | À faire évoluer |
| Licence | MIT pour le cœur, sous réserve de vérifier les dépendances | À confirmer |

### 3.3 Règles structurantes

- Un identifiant natif de serveur ne doit jamais être utilisé comme
  identifiant universel d'une série.
- Chaque connecteur déclare explicitement ses capacités.
- Une erreur d'un serveur ne doit pas empêcher l'utilisation des
  autres.
- Les secrets ne doivent jamais être stockés en clair dans le frontend
  ou dans le dépôt.
- Les données distantes ne sont pas réputées équivalentes sans
  rapprochement vérifié.
- La progression doit être traçable et résistante aux écritures
  concurrentes.
- Les opérations longues doivent être observables et reprendre après
  redémarrage.
- Toute intégration externe doit avoir des tests de contrat et une
  documentation.
- La complexité reste en arrière-plan : l'interface principale sert à lire
  et à parcourir la bibliothèque. La configuration des serveurs et des
  collecteurs, comme le suivi de la collecte, se trouvent dans les
  réglages et ne s'affichent que lorsque l'utilisateur vient les chercher.

---

## 4. Roadmap priorisée

Les priorités sont :

- **P0 — Bloquant / sécurité / fondation**
- **P1 — Indispensable à la prochaine version**
- **P2 — Important après stabilisation**
- **P3 — Évolution / confort / expérimentation**

Les statuts initiaux sont `À faire`. Les estimations sont indicatives et
devront être recalées après audit du dépôt et des API réelles.

### Phase 0 — Audit, qualité et sécurisation du socle

**Objectif :** établir une version de référence fiable avant d'ajouter
des intégrations.

| ID | Priorité | Item | Critère d'acceptation |
| --- | --- | --- | --- |
| CORE-001 | P0 | Cartographier l'architecture et les flux existants | Schéma à jour des composants, appels API et stockage |
| QA-001 | P0 | Ajouter une suite de tests de non-régression | Parcours principaux Komga/Suwayomi couverts |
| QA-002 | P0 | Définir un environnement de test reproductible | Démarrage local documenté avec données de test |
| SEC-001 | P0 | Auditer le stockage des identifiants et clés API | Aucun secret serveur exposé dans le client ou les logs |
| SEC-002 | P0 | Auditer authentification, sessions et profils | Scénarios d'accès non autorisé testés |
| SYNC-001 | P0 | Fiabiliser les écritures concurrentes de progression | Une écriture concurrente ne provoque pas de perte silencieuse |
| SYNC-002 | P1 | Versionner les mises à jour de progression | Conflits détectés et stratégie documentée |
| LIB-001 | P1 | Documenter les limites actuelles de déduplication | Cas de faux positifs/négatifs recensés |
| OPS-001 | P1 | Tester sauvegarde et restauration | Restauration complète démontrée |
| OPS-002 | P1 | Vérifier healthchecks, logs et redémarrages Docker | Panne/reprise d'un service documentée |

**Livrable :** version de référence stable et rapport d'audit.

### Phase 1 — Architecture des connecteurs

**Objectif :** rendre l'ajout d'un serveur prévisible et testable.

| ID | Priorité | Item | Critère d'acceptation |
| --- | --- | --- | --- |
| CONN-001 | P0 | Définir le contrat commun des connecteurs | Interface et types documentés |
| CONN-002 | P0 | Ajouter un système de capacités | L'UI n'affiche que les actions supportées |
| CONN-003 | P1 | Normaliser erreurs, timeouts et pagination | Comportement cohérent entre connecteurs |
| CONN-004 | P1 | Ajouter tests de contrat des connecteurs | Même suite exécutée pour chaque connecteur |
| CONN-005 | P1 | Améliorer la gestion des serveurs | Test, activation, désactivation, priorité, état |
| CONN-006 | P1 | Isoler les pannes par serveur | Un serveur hors ligne ne bloque pas les autres |

Capacités à prévoir (liste évolutive) :

- `series.list`, `series.search`
- `chapter.list`, `chapter.read`
- `chapter.download`
- `chapter.progress.read`, `chapter.progress.write`
- `library.scan`
- `source.search`, `source.follow`
- `download.status`, `download.cancel`

### Phase 2 — Connecteurs de lecture

**Objectif :** étendre les sources de bibliothèques sans fragiliser les
connecteurs existants.

| ID | Priorité | Item | Critère d'acceptation |
| --- | --- | --- | --- |
| READ-001 | P2 | Connecteur Kavita | Séries, chapitres, images et progression selon API disponible |
| READ-002 | P1 | Connecteur Folder (dossiers du NAS) | Service dédié, montage strictement en lecture seule, parcours autorisé et lecture des formats définis ; architecture et sécurité validées avant implémentation |
| READ-003 | P2 | Connecteur Stump | Fonctions prises en charge documentées et testées |
| READ-004 | P2 | Connecteur OPDS | Navigation catalogue et récupération des ressources supportées |
| READ-005 | P1 | Conserver les tests Komga et Suwayomi | Aucun parcours existant régressé |

**Points de vigilance Folder :** convention de nommage, scans
incrémentaux, fichiers CBZ/ZIP, éventuelle prise en charge CBR/RAR selon
les bibliothèques disponibles, génération de miniatures, chemins
autorisés et permissions.

**Livrable :** bibliothèque de lecture multi-connecteurs.

### Phase 3 — Connecteurs de collecte et gestionnaire de tâches

**Objectif :** connecter les outils qui recherchent, suivent et
téléchargent des chapitres.

| ID | Priorité | Item | Critère d'acceptation |
| --- | --- | --- | --- |
| COL-001 | P0 | Compléter le contrat des collecteurs pour la recherche par titre | Recherche de sources/séries, ajout ou suivi d'une série, téléchargement et statut documentés sans dépendre d'un identifiant de chapitre déjà connu |
| COL-002 | P1 | Connecteur de collecte Suwayomi complet | Recherche dans les sources, ajout/suivi d'une série et téléchargement via les capacités réellement exposées par l'API ; tests de contrat et tests sur instance réelle |
| COL-003 | P1 | Étudier et sélectionner Tranga | Projet/API/licence/activité confirmés |
| COL-004 | P2 | Connecteur Tranga | Tâches et erreurs remontées si API exploitable |
| COL-005 | P2 | Identifier précisément le projet Mangarr visé | URL officielle et API confirmées |
| COL-006 | P2 | Connecteur Mangarr | Capacités réelles couvertes si API exploitable par tests |
| JOB-001 | P0 | Concevoir une file de tâches persistante | Les tâches survivent au redémarrage |
| JOB-002 | P1 | Ajouter états et historique des tâches | Queues, running, completed, failed, cancelled |
| JOB-003 | P1 | Ajouter une relance automatique avec backoff | Relance bornée, temporisation croissante, respect des états annulés et des capacités du collecteur ; après validation réelle QA-004 |
| JOB-004 | P1 | Ajouter annulation si supportée | L'UI reflète la capacité réelle |
| JOB-005 | P1 | Interface de suivi des tâches de collecte accessible depuis les réglages | Résumé dans Réglages (collecteurs, nombre d'actifs) ; écran secondaire avec en cours, file d'attente, erreurs, historique, relance et annulation ; pas d'onglet dans la navigation principale ni de tableau de bord permanent |
| COL-007 | P1 | Relier collecte et bibliothèque | Après téléchargement, scan/import et vérification |
| COL-008 | P1 | Ajouter règles d'automatisation configurables | Opt-in explicite par série/source/langue |

**Workflow cible :** chapitre manquant détecté → recherche auprès d'un
collecteur autorisé → validation ou règle automatique → tâche
persistante → téléchargement → import/scan bibliothèque → vérification →
notification.

### Phase 4 — Bibliothèque universelle et rapprochement des séries

**Objectif :** représenter une série indépendamment du serveur qui la
stocke.

| ID | Priorité | Item | Critère d'acceptation |
| --- | --- | --- | --- |
| LIB-002 | P1 | Créer l'identifiant universel Scrollarr | Identité stable indépendante des IDs distants |
| LIB-003 | P1 | Associer plusieurs éditions/serveurs à une série | Une série peut avoir plusieurs emplacements |
| LIB-004 | P1 | Normaliser titres et alias | Titres originaux et alternatifs conservés |
| LIB-005 | P1 | Ajouter rapprochement par identifiants externes facultatifs | Source et confiance de l'identifiant enregistrées |
| LIB-006 | P1 | Définir un score de correspondance | Aucun rapprochement incertain fusionné sans contrôle |
| LIB-007 | P2 | Ajouter fusion/séparation manuelle | Action réversible et auditée |
| LIB-008 | P1 | Détecter les chapitres manquants | Règles de numérotation et exceptions documentées |
| LIB-009 | P2 | Choisir une édition/source préférée | Préférence configurable par série |
| LIB-010 | P2 | Ajouter recherche globale avancée | Recherche multi-serveurs paginée et tolérante aux pannes |

**Règle :** progression par édition/chapitre natif conservée. Une
progression logique universelle peut être proposée lorsqu'une
correspondance de chapitres est suffisamment fiable.

### Phase 5 — API, backend léger et authentification mobile

**Objectif :** fournir une interface stable aux clients Web et mobiles.

| ID | Priorité | Item | Critère d'acceptation |
| --- | --- | --- | --- |
| API-001 | P0 | Définir les responsabilités du backend | Pas de duplication inutile des services existants |
| API-002 | P0 | Définir API versionnée pour les clients | Contrat documenté et versionné |
| AUTH-001 | P0 | Concevoir sessions et jetons mobiles | Accès court, renouvellement révocable |
| AUTH-002 | P0 | Associer les appareils aux profils | Révocation individuelle possible |
| AUTH-003 | P0 | Stocker les secrets côté serveur | Aucun secret de connecteur dans le bundle mobile |
| AUTH-004 | P0 | Contrôler les URL des serveurs distants | Protection SSRF et restrictions réseau |
| DATA-001 | P1 | Évaluer SQLite pour données locales | Transactions, migrations et sauvegardes testées |
| DATA-002 | P2 | Préparer une stratégie de migration | Migrations versionnées et réversibles si possible |

Le backend peut rester optionnel pour le mode léger. Les fonctions qui
exigent des tâches persistantes, une authentification multi-appareils ou
une orchestration centralisée devront annoncer clairement cette
dépendance.

### Phase 6 — Applications iOS et Android avec Capacitor

**Objectif :** livrer deux applications natives reposant sur le même
frontend.

| ID | Priorité | Item | Critère d'acceptation |
| --- | --- | --- | --- |
| MOB-001 | P0 | Créer le projet Capacitor | Builds iOS et Android reproductibles |
| MOB-002 | P0 | Adapter configuration et navigation | Retour Android, safe areas iOS, clavier |
| MOB-003 | P0 | Implémenter authentification mobile | Sessions et révocation testées |
| MOB-004 | P1 | Adapter le chargement des images | Authentification et gros chapitres fonctionnels |
| MOB-005 | P1 | Mettre en place stockage hors ligne natif | Téléchargements persistants et quota visible |
| MOB-006 | P1 | Intégrer notifications APNs/FCM | Permission, token, opt-in et désinscription |
| MOB-007 | P1 | Gérer orientation et plein écran | iPhone, Android et tablettes testés |
| MOB-008 | P1 | Ajouter partage et liens profonds | Ouverture d'une série/chapitre depuis un lien |
| MOB-009 | P0 | Préparer conformité stores | Confidentialité, captures, fiche et compte démo |
| MOB-010 | P0 | Réaliser tests appareils réels | Matrice iOS/Android validée |

**Attention :** Capacitor ne garantit pas à lui seul l'acceptation par
Apple. L'application doit apporter une expérience mobile réelle et
suffisamment aboutie.

### Phase 7 — UX, lecture et fonctionnalités différenciantes

| ID | Priorité | Item | Critère d'acceptation |
| --- | --- | --- | --- |
| UX-001 | P1 | Revoir l'accueil | Reprendre, nouveautés, suivis et tâches |
| UX-002 | P1 | Améliorer filtres bibliothèque | Filtres combinables et état persistant |
| UX-003 | P1 | Mode RTL | Sens de lecture configurable |
| UX-004 | P2 | Mode double page tablette | Mise en page adaptée et réglable |
| UX-005 | P2 | Marque-pages | Retrouver une page précise |
| UX-006 | P2 | Collections personnelles | Créer, trier et filtrer |
| UX-007 | P2 | Statistiques de lecture | Données explicables et exportables |
| UX-008 | P2 | Calendrier des sorties | Basé uniquement sur les données disponibles |
| UX-009 | P2 | Préchargement intelligent | Paramètres réseau et mémoire configurables |
| UX-010 | P3 | Recommandations locales | Basées sur bibliothèque et préférences, sans cloud imposé |
| UX-011 | P3 | Widgets et raccourcis mobiles | Reprise rapide de lecture |

### Phase 8 — Exploitation, documentation et écosystème

| ID | Priorité | Item | Critère d'acceptation |
| --- | --- | --- | --- |
| OPS-003 | P1 | Healthchecks par connecteur | État et dernière vérification visibles |
| OPS-004 | P1 | Observabilité des tâches | Logs corrélés par tâche et serveur |
| OPS-005 | P1 | Sauvegarde/restauration documentée | Procédure testée |
| DEV-001 | P1 | CI pour lint, tests et builds | Pipeline bloquant sur échec |
| DEV-002 | P1 | Publier images Docker versionnées | Pipeline déjà présent ; tags semver et `latest` produits à partir d'un tag Git `v*` |
| REL-001 | P1 | Publier la première release v0.7.0 | Créer le tag `v0.7.0`, publier les notes de version et vérifier les images GHCR `0.7.0`, `0.7` et `latest` pour Scrollarr et le notifier |
| DOC-001 | P1 | Guide installation et migration | Installation vierge et upgrade documentés |
| DOC-002 | P1 | Guide création de connecteur | Exemple minimal fonctionnel |
| DOC-003 | P1 | Politique de sécurité et signalement | Processus public documenté |
| EXT-001 | P3 | API publique/extensions | Permissions et versionnement définis |
| BIZ-001 | P3 | Programme Supporter | Dons sans verrouiller le cœur |
| BIZ-002 | P3 | Étudier Scrollarr Plus | Services hébergés facultatifs, coûts et confidentialité évalués |

---

## 5. Définition de « terminé » (Definition of Done)

Une issue n'est terminée que si :

- [ ] Le besoin et le comportement sont documentés.
- [ ] Le code est relu et ne contient pas de secret.
- [ ] Les tests unitaires/intégration pertinents passent.
- [ ] Les connecteurs existants ne régressent pas.
- [ ] Les erreurs et états de chargement sont gérés.
- [ ] L'accessibilité et l'usage mobile sont considérés.
- [ ] La documentation utilisateur ou développeur est mise à jour.
- [ ] Les migrations de données sont testées si nécessaire.
- [ ] La fonctionnalité est vérifiée sur une installation Docker
  propre.
- [ ] Les limitations connues sont indiquées.

## 6. Organisation recommandée dans GitHub

### 6.1 GitHub Projects

Créer un Project nommé **Scrollarr Roadmap** avec les champs :

| Champ | Valeurs |
| --- | --- |
| Status | Backlog, Ready, In progress, Review, Done, Blocked |
| Priority | P0, P1, P2, P3 |
| Epic | CORE, QA, SEC, CONN, READ, COL, JOB, LIB, SYNC, API, AUTH, DATA, MOB, UX, OPS, DEV, DOC, EXT, BIZ |
| Size | XS, S, M, L, XL |
| Target version | 1.1, 1.2, 1.3, 2.0, 2.1 |
| Area | Frontend, Backend, Connector, Mobile, DevOps, Documentation |

### 6.2 Labels

Créer les labels :

- `priority:P0`, `priority:P1`, `priority:P2`, `priority:P3`
- `type:feature`, `type:bug`, `type:tech-debt`, `type:documentation`, `type:security`
- `area:frontend`, `area:backend`, `area:connector`, `area:mobile`, `area:devops`
- `status:blocked`, `good first issue`, `help wanted`

### 6.3 Milestones

| Milestone | Objectif |
| --- | --- |
| v1.1 — Foundation | Audit, sécurité, tests, connecteurs |
| v1.2 — Collectors | Collecte, tâches, automatisations |
| v1.3 — Unified Library | Identité universelle et rapprochement |
| v2.0 — Mobile | iOS, Android et fonctionnalités natives |
| v2.1 — Ecosystem | UX avancée, extensions, supporter |

### 6.4 Modèle d'issue GitHub

Copier ce modèle dans `.github/ISSUE_TEMPLATE/feature.yml` ou l'utiliser
comme description d'issue :

```markdown
## Objectif
Quel problème cette évolution résout-elle ?

## Contexte
Comportement actuel, serveurs concernés, contraintes.

## Proposition
Comportement attendu et solution envisagée.

## Périmètre
- [ ] Frontend
- [ ] Backend
- [ ] Connecteur
- [ ] Mobile iOS
- [ ] Mobile Android
- [ ] Docker / DevOps
- [ ] Documentation

## Critères d'acceptation
- [ ] ...
- [ ] ...
- [ ] ...

## Tests
Scénarios nominaux, erreurs, hors ligne, régression.

## Dépendances
Issues, API ou versions nécessaires.

## Hors périmètre
Ce qui ne doit pas être traité dans cette issue.
```

### 6.5 Convention de branches et commits

Branches :

- `feature/CONN-001-connector-contract`
- `feature/MOB-001-capacitor-bootstrap`
- `fix/SYNC-001-progress-conflict`
- `docs/DOC-001-installation-guide`

Commits :

- `feat(connectors): define connector capability contract`
- `fix(sync): prevent silent progress overwrite`
- `test(komga): cover chapter progress`
- `docs(roadmap): update v1.1 status`

---

## 7. Ordre d'exécution recommandé — backlog à partir de v0.7.0

Ne pas lancer tous les développements en parallèle. L'ordre proposé tient compte de l'état réel du dépôt et des risques encore ouverts.

1. `QA-004` — valider sur une vraie instance Suwayomi le cycle de vie complet des tâches (file, progression, échec, annulation, relance, reconnexion et retour en ligne). `QA-003` reste terminé pour la validation fonctionnelle déjà réalisée sur les serveurs réels.
2. `REL-001` — publier v0.7.0 : le code annonce déjà cette version et le workflow Docker sait publier les tags semver ainsi que `latest` à partir d'un tag `v*` ; il manque le tag/release GitHub et la vérification des images publiées.
3. `READ-002` — faire d'abord un cadrage technique du connecteur Dossiers : service serveur, montage NAS en lecture seule, périmètre des chemins, formats, stockage des métadonnées/progressions et sécurité. Ne commencer le développement qu'après validation de cette architecture.
4. `COL-001` puis `COL-002` — compléter le contrat de recherche par titre, puis implémenter la recherche et l'ajout/suivi de séries dans Suwayomi depuis Scrollarr.
5. `JOB-003` — ajouter la relance automatique avec backoff après validation du comportement réel des états Suwayomi. Cette tâche ne dépend pas fonctionnellement de la recherche par titre, mais elle dépend de la fiabilité de la détection des échecs et des relances.
6. `COL-003` et `COL-005` — étudier Tranga et le projet Mangarr exact en parallèle ; cette recherche peut avancer pendant les lots précédents. Ne pas lancer les connecteurs avant validation de leurs API, licences et maintenance.

`JOB-001` reste partiellement réalisé : l'historique local survit au rechargement, mais il n'existe pas encore de file Scrollarr centralisée et persistante côté serveur. Ne pas engager ce chantier avant d'avoir défini le besoin réel : persistance après redémarrage, partage entre appareils, ou les deux.

`JOB-005` est terminé dans sa forme retenue : résumé dans les réglages et écran secondaire dédié. Aucune entrée de navigation principale ni tableau de bord permanent.

Les développements Dossiers et recherche de collecte peuvent avoir des branches distinctes, mais ils touchent potentiellement aux contrats, capacités et routes communs : paralléliser les études et la conception, puis intégrer les changements de code de façon séquencée.

### Critères de sortie de cette itération

- [ ] Le cycle des tâches Suwayomi est validé sur une instance réelle.
- [ ] La release v0.7.0 et les deux images GHCR sont publiées et vérifiées.
- [ ] L'architecture du service Dossiers est validée avant tout montage de NAS.
- [ ] La recherche par titre respecte les capacités réellement offertes par Suwayomi.
- [ ] Les relances automatiques sont bornées et ne réactivent pas une tâche annulée.

---

## 8. Estimation et pilotage

Estimation indicative de la trajectoire complète : **12 à 16 semaines de
développement à temps plein**, à réviser après l'audit. Cette estimation
n'est pas une promesse de livraison : les API des outils tiers, les
tests sur appareils physiques, les corrections de sécurité et les
validations App Store/Play Store peuvent modifier le calendrier.

| Phase | Estimation indicative |
| --- | --- |
| Audit et socle | 1 semaine |
| Architecture connecteurs | 1 semaine |
| Connecteurs lecture | 1–2 semaines |
| Collecteurs et tâches | 2 semaines |
| Bibliothèque universelle | 1–2 semaines |
| API et authentification | 1–2 semaines |
| Capacitor | 2 semaines |
| UX et fonctionnalités | 2 semaines |
| Tests et publication | 1–2 semaines |

### Règles de pilotage

- Une seule priorité P0/P1 principale par développeur à la fois.
- Les tâches bloquées par une API tierce doivent être identifiées
  comme telles.
- Chaque version doit avoir une liste de critères de sortie.
- Les fonctionnalités expérimentales sont derrière un flag si elles
  peuvent dégrader le produit.
- Mettre à jour le statut et les notes de version à chaque merge
  significatif.
- Réévaluer les estimations à la fin de chaque milestone.

---

## 9. Risques et points à valider

| Risque | Réponse prévue |
| --- | --- |
| API tierce instable ou incomplète | Tests de contrat, versionnement et capacités |
| Confusion entre séries homonymes | Score de rapprochement et validation humaine |
| Progression divergente entre serveurs | Progression par édition et fusion prudente |
| Collecte interrompue | File persistante, retry borné et reprise |
| Secrets exposés | Stockage serveur et coffre natif mobile |
| Accès réseau abusif via URL serveur | Protection SSRF et restrictions réseau |
| Refus App Store | Valeur mobile native, conformité et compte démo |
| Coût d'un cloud premium | Cloud facultatif, chiffré et économiquement viable |
| Dépendance à un mainteneur tiers | Connecteurs isolés et désactivables |

À valider avant implémentation :

- URL exacte et API du projet Mangarr visé.
- API, licence et état de maintenance de Tranga.
- Capacités réelles des API Suwayomi et Kavita utilisées.
- Formats pris en charge par le connecteur Folder.
- Besoin réel d'un backend dès la première version.
- Pour le connecteur Dossiers : valider explicitement le service serveur, les chemins exposés, le montage en lecture seule et l'emplacement des métadonnées/progressions avant développement.
- Modèle exact de comptes/profils et partage familial.
- Politique de confidentialité et règles de distribution des applications
  mobiles.

---

## 10. Décisions produit à confirmer

Ces choix sont recommandés, mais doivent être validés avant de figer
l'architecture :

- [ ] Backend Scrollarr léger avec SQLite.
- [ ] Téléchargements automatisés avec validation et possibilité de
  téléchargement manuel.
- [ ] Données local-first, restant sur l'installation de
  l'utilisateur.
- [ ] Synchronisation cloud proposée en option uniquement.
- [ ] Développement : consolider le socle avant de prioriser le
  mobile.
- [ ] Cœur open source sans compte externe obligatoire.
- [ ] Premium limité à des services ou fonctions de confort
  facultatifs.

## 11. Liens utiles

- Dépôt : https://github.com/Ark4ntes/scrollarr
- Capacitor : https://capacitorjs.com/docs
- Kavita : https://wiki.kavitareader.com/
- Stump : https://github.com/stumpapp/stump
- OPDS : https://specs.opds.io/
- Apple App Review Guidelines :
  https://developer.apple.com/app-store/review/guidelines/
- Google Play Console : https://play.google.com/console/

---

**Document vivant :** mettre à jour les cases, statuts, versions cibles,
estimations et décisions à chaque revue de roadmap. Les issues GitHub
restent la source de vérité pour le suivi opérationnel ; ce document
décrit la vision, l'architecture et l'ordre de réalisation.
