# Development

**English** · [Français](../fr/development.md) · [Back to the README](../../README.md)

How to run Scrollarr on your computer without any real server, how to test it, and how the project is laid out. Rules for contributions (branches, commits, pull request checklist) are in [CONTRIBUTING.md](../../CONTRIBUTING.md).

## What you need

- Node 20 or later to run the app and the demo servers. The tests and the folders service need Node 22.
- For the end-to-end tests: Python 3 and Playwright (see below).
- Docker only if you want to run the real container or its tests.

The app has no build step and no runtime dependency: what is in `app/` is what gets served.

## Run it with the demo servers

```sh
node dev/mock-servers.mjs
```

It prints `Scrollarr (démo) : http://localhost:8380  —  demo@scrollarr.local / demo`. Open that address. The demo server serves the app and imitates Suwayomi and Komga with a generated library, as nginx does in production. Sign in to the demo Komga with `demo@scrollarr.local` and password `demo`. The demo Suwayomi has no authentication unless you ask for it.

Options, as environment variables:

| Variable | Default | Effect |
| --- | --- | --- |
| `PORT` | `8380` | Listening port. |
| `SERVERS` | `suwayomi,komga` | Which servers are "configured" (`suwayomi`, `komga`, `folders`, comma separated). |
| `SUWA_AUTH` | `none` | Authentication mode of the mock Suwayomi: `none`, `basic`, `simple` or `ui` (credentials `demo` / `demo`). |
| `SUWA_TOKEN_TTL` | `300` | Lifetime in seconds of the access token in `ui` mode. |
| `NOTIFIER` | unset | Address of a local notifier to which `/notify/` is relayed, for example `http://127.0.0.1:8787`. |
| `FOLDERS` | unset | Address of a real folders service to which `/folders/` is relayed, for example `http://127.0.0.1:8788` (with `SERVERS=folders`). |
| `DOWNLOAD_MS` | `0` | Time per chapter of the mock Suwayomi's download queue. With `0`, a requested chapter is available at once. |
| `DOWNLOAD_FAIL` | `0` | Id of a chapter that fails the first time it is downloaded; a retry succeeds. |
| `SOURCE_SLOW_MS` | `2500` | Delay of the slow demo source in the source search. |

Example: `SERVERS=suwayomi SUWA_AUTH=ui node dev/mock-servers.mjs`.

Simulate a new chapter:

```sh
curl -X POST "http://localhost:8380/suwayomi/__mock/add-chapter?manga=2"
curl -X POST "http://localhost:8380/komga/__mock/add-book?series=S004"
```

### Try the folders service

```sh
npm ci --omit=dev --prefix folders
node dev/make-folders-fixture.mjs /tmp/folders-demo
FOLDERS_AUTH=none FOLDERS_LIBRARIES_DIR=/tmp/folders-demo/libraries FOLDERS_DATA_DIR=/tmp/folders-demo/data node folders/server.js
curl http://localhost:8788/api/v1/libraries
```

To see it in the app, start the demo server with `SERVERS=folders FOLDERS=http://127.0.0.1:8788`. `dev/make-folders-fixture.mjs` also takes `--bulk N` (N series of 3 chapters, to measure large libraries) and `--page WIDTHxHEIGHT`.

### Run the real container on your working copy

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

`app/` and the nginx template are mounted read-only into the container, so a change shows after a reload without a rebuild (an nginx template change needs `docker compose restart scrollarr`). Remember the service worker: reload twice, or clear the site's data in the browser.

## Tests

```sh
tests/check_syntax.sh
```

runs `node --check` on every JavaScript file, parses the workflows, checks that `deploy/docker-compose.yml` is what `dev/make-deploy-compose.sh` produces from `docker-compose.yml`, and parses every GraphQL query of the Suwayomi connector (it runs `npm install` in `tests/graphql/`, so it needs network access). Run the same unit tests as CI:

```sh
node tests/unit_sync.mjs
node tests/unit_contracts.mjs
node tests/unit_facade.mjs
node tests/unit_profiles.mjs
```

The end-to-end tests drive a headless Chromium against the demo servers:

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install -r tests/requirements.txt
python -m playwright install chromium
python tests/e2e_servers.py
```

Each script prints `PASS` or `FAIL` lines then `ALL PASS` or `SOME FAILED`. They use fixed ports (8391 to 8470): stop a stale demo server first. The tests of the folders service need `npm ci --omit=dev` in `folders/`. The full list of scripts, with what each checks and how long it takes, is in [tests/README.md](../../tests/README.md).

## Continuous integration

- `.github/workflows/ci.yml` runs on every push and pull request, in three jobs: `syntax` (Node 22: `check_syntax.sh`, the unit tests, the nginx headers test), `e2e` (Playwright and Chromium, all end-to-end scripts, screenshots kept if something fails) and `folders` (the folders service tests and the two container tests, `tests/container_folders.sh` and `tests/container_perms.sh`).
- `.github/workflows/docker.yml` builds the three images for `amd64` and `arm64`. It publishes them to `ghcr.io/ark4ntes/` on a push to `main` (tag `edge`) and on a `v*` tag (`X.Y.Z`, `X.Y`, `latest`); pull requests only build. See [Installation](installation.md#which-images-exist).

## Project layout

| Path | Content |
| --- | --- |
| `app/` | The application: `index.html`, `css/app.css` (colours and type are variables at the top), `sw.js` (service worker), `fonts/`, `icons/`, `js/`. |
| `app/js/api.js` | The facade the screens call: routes to connectors, merges lists, offline queue. |
| `app/js/connectors/` | `readers/` (what you read: `komga.js`, `suwayomi.js`, `folders.js`), `collectors/` (what fetches chapters: `suwayomi.js`), the contracts, and the Suwayomi client and queries shared by its two modules. |
| `app/js/views/` | One file per screen (`reader.js`, `series.js`, `home.js`, `more.js` for Settings...). |
| `app/js/profiles.js`, `store.js`, `sync.js` | Profiles, subscriptions, and the rules that merge what several devices wrote. |
| `app/js/downloads.js`, `tasks.js` | Offline storage; the common model of collector tasks. |
| `app/js/i18n.js` | Translations. The French string is the key; the dictionary holds the English. |
| `nginx/` | Template of the web server and proxy configuration. |
| `notifier/` | The push notification service (Node, one dependency). |
| `folders/` | The folders service (Node, one dependency); its own [README](../../folders/README.md) (French). |
| `deploy/` | `docker-compose.yml` for installing from published images, generated by `dev/make-deploy-compose.sh`. Do not edit by hand. |
| `dev/` | Demo servers, fixture generator for the folders service, `check-suwayomi.mjs`. |
| `tests/` | Unit, integration, end-to-end and container tests. |
| `docs/` | These guides (`en/`, `fr/`), `screenshots/`, `ROADMAP.md` (French), `design/` and `qa/` (study and NAS test procedures for the folders service, French). |
| `.github/` | Workflows, issue and pull request templates. |

Code comments are currently in French; new contributions may use English. Every user-facing string goes through `app/js/i18n.js`.

## Adding a server or a collector

See [Connectors](connectors.md#writing-a-reader). If you change `docker-compose.yml`, run `bash dev/make-deploy-compose.sh` and commit the result: `tests/check_syntax.sh` fails if the two files disagree.
