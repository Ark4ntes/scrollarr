# Développement

[English](../en/development.md) · **Français** · [Retour au README](../../README.fr.md)

Comment faire tourner Scrollarr sur votre ordinateur sans aucun vrai serveur, comment le tester, et comment le projet est organisé. Les règles de contribution (branches, commits, liste de contrôle des demandes de fusion) sont dans [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Ce qu'il vous faut

- Node 20 ou plus récent pour lancer l'application et les serveurs de démonstration. Les tests et le service Dossiers demandent Node 22.
- Pour les tests de bout en bout : Python 3 et Playwright (voir plus bas).
- Docker seulement si vous voulez lancer le vrai conteneur ou ses tests.

L'application n'a ni étape de construction ni dépendance à l'exécution : ce qui est dans `app/` est ce qui est servi.

## Lancer avec les serveurs de démonstration

```sh
node dev/mock-servers.mjs
```

La commande affiche `Scrollarr (démo) : http://localhost:8380  —  demo@scrollarr.local / demo`. Ouvrez cette adresse. Le serveur de démonstration sert l'application et imite Suwayomi et Komga avec une bibliothèque générée, comme le fait nginx en production. Connectez-vous au Komga de démonstration avec `demo@scrollarr.local` et le mot de passe `demo`. Le Suwayomi de démonstration n'a pas d'authentification, sauf si vous la demandez.

Options, en variables d'environnement :

| Variable | Défaut | Effet |
| --- | --- | --- |
| `PORT` | `8380` | Port d'écoute. |
| `SERVERS` | `suwayomi,komga` | Quels serveurs sont « configurés » (`suwayomi`, `komga`, `folders`, séparés par des virgules). |
| `SUWA_AUTH` | `none` | Mode d'authentification du faux Suwayomi : `none`, `basic`, `simple` ou `ui` (identifiants `demo` / `demo`). |
| `SUWA_TOKEN_TTL` | `300` | Durée de vie en secondes du jeton d'accès en mode `ui`. |
| `NOTIFIER` | non défini | Adresse d'un notifier local vers lequel `/notify/` est relayé, par exemple `http://127.0.0.1:8787`. |
| `FOLDERS` | non défini | Adresse d'un vrai service Dossiers vers lequel `/folders/` est relayé, par exemple `http://127.0.0.1:8788` (avec `SERVERS=folders`). |
| `DOWNLOAD_MS` | `0` | Durée par chapitre de la file de téléchargement du faux Suwayomi. Avec `0`, un chapitre demandé est disponible aussitôt. |
| `DOWNLOAD_FAIL` | `0` | Identifiant d'un chapitre qui échoue au premier téléchargement ; un nouvel essai réussit. |
| `DOWNLOAD_FAIL_TIMES` | `1` | Nombre d'échecs du chapitre de `DOWNLOAD_FAIL` avant qu'un nouvel essai réussisse. |
| `SOURCE_SLOW_MS` | `2500` | Délai de la source de démonstration lente dans la recherche chez les sources. |

Exemple : `SERVERS=suwayomi SUWA_AUTH=ui node dev/mock-servers.mjs`.

Raccourcir les délais de relance automatique (tests et développement seulement) : la clé `scrollarr.dev.retry` du `localStorage` du navigateur, posée depuis la console ou par le test avant le chargement de la page, remplace les délais de 1, 5 et 30 minutes, par exemple `localStorage.setItem('scrollarr.dev.retry', JSON.stringify({ delays: [1500, 1500, 1500], jitterMs: 300, claimMs: 5000 }))` (millisecondes ; `delays` fixe aussi le nombre de relances). Aucun écran n'écrit cette clé et une valeur invalide est ignorée. `scrollarr.autoRetry` à `0` coupe les relances automatiques, comme l'interrupteur de l'écran Téléchargements.

Simuler un nouveau chapitre :

```sh
curl -X POST "http://localhost:8380/suwayomi/__mock/add-chapter?manga=2"
curl -X POST "http://localhost:8380/komga/__mock/add-book?series=S004"
```

### Essayer le service Dossiers

```sh
npm ci --omit=dev --prefix folders
node dev/make-folders-fixture.mjs /tmp/folders-demo
FOLDERS_AUTH=none FOLDERS_LIBRARIES_DIR=/tmp/folders-demo/libraries FOLDERS_DATA_DIR=/tmp/folders-demo/data node folders/server.js
curl http://localhost:8788/api/v1/libraries
```

Pour le voir dans l'application, lancez le serveur de démonstration avec `SERVERS=folders FOLDERS=http://127.0.0.1:8788`. `dev/make-folders-fixture.mjs` accepte aussi `--bulk N` (N séries de 3 chapitres, pour mesurer de grandes bibliothèques) et `--page LARGEURxHAUTEUR`.

### Lancer le vrai conteneur sur votre copie de travail

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

`app/` et le modèle nginx sont montés en lecture seule dans le conteneur : une modification apparaît après un rechargement, sans reconstruction (un changement du modèle nginx demande `docker compose restart scrollarr`). Le conteneur principal n'a que quatre capacités Linux : les fichiers montés doivent donc être lisibles par « les autres » (droits 644/755, le défaut habituel). N'oubliez pas le service worker : rechargez deux fois, ou effacez les données du site dans le navigateur.

## Tests

```sh
tests/check_syntax.sh
```

lance `node --check` sur chaque fichier JavaScript, analyse les workflows, vérifie que `deploy/docker-compose.yml` est ce que `dev/make-deploy-compose.sh` produit à partir de `docker-compose.yml`, et analyse chaque requête GraphQL du connecteur Suwayomi (il lance `npm install` dans `tests/graphql/`, il lui faut donc un accès au réseau). Lancez les mêmes tests unitaires que la CI :

```sh
node tests/unit_sync.mjs
node tests/unit_contracts.mjs
node tests/unit_facade.mjs
node tests/unit_profiles.mjs
node tests/unit_profile_name.mjs
```

Les tests de bout en bout pilotent un Chromium sans interface contre les serveurs de démonstration :

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install -r tests/requirements.txt
python -m playwright install chromium
python tests/e2e_servers.py
```

Chaque script affiche des lignes `PASS` ou `FAIL` puis `ALL PASS` ou `SOME FAILED`. Ils utilisent des ports fixes (8391 à 8470) : arrêtez d'abord un serveur de démonstration resté actif. Les tests du service Dossiers demandent `npm ci --omit=dev` dans `folders/`. La liste complète des scripts, avec ce que chacun vérifie et sa durée, est dans [tests/README.md](../../tests/README.md).

## Intégration continue

- `.github/workflows/ci.yml` se lance à chaque envoi et à chaque demande de fusion, en trois tâches : `syntax` (Node 22 : `check_syntax.sh`, les tests unitaires, le test des en-têtes nginx), `e2e` (Playwright et Chromium, tous les scripts de bout en bout, captures d'écran conservées en cas d'échec) et `folders` (les tests du service Dossiers et les trois tests de conteneur, `tests/container_folders.sh`, `tests/container_perms.sh` et `tests/container_hardening.sh`, ce dernier en trois étapes séparées).
- `.github/workflows/docker.yml` construit les trois images pour `amd64` et `arm64`. Il les publie sur `ghcr.io/ark4ntes/` lors d'un envoi sur `main` (étiquette `edge`) et d'une étiquette `v*` (`X.Y.Z`, `X.Y`, `latest`) ; les demandes de fusion ne font que construire. Voir [Installation](installation.md#quelles-images-existent).

## Organisation du projet

| Chemin | Contenu |
| --- | --- |
| `app/` | L'application : `index.html`, `css/app.css` (couleurs et typographie sont des variables en tête), `sw.js` (service worker), `fonts/`, `icons/`, `js/`. |
| `app/js/api.js` | La façade qu'appellent les écrans : aiguille vers les connecteurs, fusionne les listes, file hors ligne. |
| `app/js/connectors/` | `readers/` (ce dans quoi on lit : `komga.js`, `suwayomi.js`, `folders.js`), `collectors/` (ce qui va chercher des chapitres : `suwayomi.js`), les contrats, et le client et les requêtes Suwayomi partagés par ses deux modules. |
| `app/js/views/` | Un fichier par écran (`reader.js`, `series.js`, `home.js`, `more.js` pour les Réglages...). |
| `app/js/profiles.js`, `store.js`, `sync.js` | Profils, abonnements, et les règles qui fusionnent ce que plusieurs appareils ont écrit. |
| `app/js/downloads.js`, `tasks.js` | Stockage hors ligne ; le modèle commun des tâches de collecteur. |
| `app/js/i18n.js` | Traductions. La chaîne française est la clé ; le dictionnaire contient l'anglais. |
| `nginx/` | Modèle de configuration du serveur web et du proxy. |
| `notifier/` | Le service de notifications push (Node, une dépendance). |
| `folders/` | Le service Dossiers (Node, une dépendance) ; son propre [README](../../folders/README.md). |
| `deploy/` | `docker-compose.yml` pour installer depuis les images publiées, généré par `dev/make-deploy-compose.sh`. Ne le modifiez pas à la main. |
| `dev/` | Serveurs de démonstration, générateur de données de test du service Dossiers, `check-suwayomi.mjs`. |
| `tests/` | Tests unitaires, d'intégration, de bout en bout et de conteneur. |
| `docs/` | Ces guides (`en/`, `fr/`), `screenshots/`, `ROADMAP.md`, `design/` et `qa/` (étude et procédures de test sur NAS du service Dossiers). |
| `.github/` | Workflows, modèles de tickets et de demandes de fusion. |

Les commentaires du code sont actuellement en français ; les nouvelles contributions peuvent utiliser l'anglais. Chaque texte visible par l'utilisateur passe par `app/js/i18n.js`.

## Ajouter un serveur ou un collecteur

Voir [Connecteurs](connectors.md#écrire-un-lecteur). Si vous modifiez `docker-compose.yml`, lancez `bash dev/make-deploy-compose.sh` et validez le résultat : `tests/check_syntax.sh` échoue si les deux fichiers divergent.
