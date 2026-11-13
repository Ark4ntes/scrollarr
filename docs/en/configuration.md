# Configuration

**English** · [Français](../fr/configuration.md) · [Back to the README](../../README.md)

Everything you can set, and where Scrollarr keeps what it stores. Settings live in a file named `.env` next to `docker-compose.yml`. After you edit it, recreate the containers so they read it again:

```sh
docker compose up -d --force-recreate
```

(add `--profile push` and `--profile folders` if you use those services). Variables that are empty or missing take the default shown below.

## Environment variables

The tables follow the containers: "Scrollarr" is the main container, "Notifier" and "Folders service" are the optional services. Variables marked **Compose** are only read by Docker Compose, which uses them inside `docker-compose.yml`; no container receives them under that name.

### Scrollarr (the main container)

| Variable | Default | Effect |
| --- | --- | --- |
| `SUWAYOMI_URL` | empty | Address of Suwayomi as seen from the container, no trailing slash (`http://192.168.1.10:4567`). Empty means Suwayomi is not configured and does not appear in the app. The notifier reads the same variable. |
| `KOMGA_URL` | empty | Same for Komga (`http://192.168.1.10:25600`). The notifier reads the same variable. |
| `FOLDERS_URL` | empty | Address of the folders service: `http://folders:8788` to use it, empty otherwise. This is not read by the folders service itself. |
| `SCROLLARR_PORT` (**Compose**) | `8380` | Port on the host that reaches Scrollarr. The container always listens on 80 inside. |
| `SCROLLARR_VERSION` (**Compose**) | `latest` | Image tag for the three images. Only in `deploy/docker-compose.yml` (install from published images); the clone's `docker-compose.yml` builds the images locally. |

The three addresses must exist in the container's environment, even if empty: the image sets all three to empty, and Compose passes them on. An address that is set but wrong makes that server appear as unreachable.

### Notifier (`push` profile)

| Variable | Default | Effect |
| --- | --- | --- |
| `SUWAYOMI_URL` | empty | Suwayomi to watch (shared with the main container, see above). |
| `SUWAYOMI_USER`, `SUWAYOMI_PASSWORD` | empty | Only if Suwayomi asks for authentication. |
| `KOMGA_URL`, `KOMGA_API_KEY` | empty | Komga to watch: the address and an API key created in Komga. Both are needed for Komga. |
| `VAPID_SUBJECT` | `mailto:admin@localhost` | Contact address required by the Web Push protocol, as `mailto:you@example.com`. |
| `POLL_MINUTES` | `10` | Minutes between two checks for new chapters. The smallest value taken is 0.05. |
| `DATA_DIR` | `/data` | Folder for its keys and subscriptions. Compose mounts `./data/notifier` there; do not change it. |
| `PORT` | `8787` | Port inside the container. The main container expects it at 8787: do not change it. |
| `PUSH_DRY_RUN` | unset | `1` writes the notifications to the log instead of sending them. Used by tests. |

The notifier stops at start unless `SUWAYOMI_URL` is set, or both `KOMGA_URL` and `KOMGA_API_KEY`.

### Folders service (`folders` profile)

Compose passes the first three from `.env` and fixes the last two. The service refuses to start on any problem and prints one line starting with `Configuration invalide :`. It also refuses any variable starting with `FOLDERS_` that is not listed in this section, so do not give it `FOLDERS_URL`, `FOLDERS_SCANS_PATH`, `FOLDERS_UID` or `FOLDERS_GID` (for example through `env_file`).

| Variable | Default | Effect |
| --- | --- | --- |
| `FOLDERS_AUTH` | none: required | `password` or `none`. No default: the service does not start without one of the two. |
| `FOLDERS_USER` | empty | User name, required with `password`, must be empty with `none`. |
| `FOLDERS_PASSWORD` | empty | Password, at least 12 characters, required with `password`, must be empty with `none`. |
| `FOLDERS_TRUST_PROXY` | `0`; Compose sets `1` | `1` makes the service take the client address from the last entry of `X-Forwarded-For` (for the login attempt limit). |
| `FOLDERS_COOKIE_PATH` | `/`; Compose sets `/folders/` | Path of the session cookie. |

The next ones are read by the service but `docker-compose.yml` does not pass them. To change one, add it under `environment:` of the `folders` service, for example in a `docker-compose.override.yml`.

| Variable | Default | Allowed | Effect |
| --- | --- | --- | --- |
| `FOLDERS_PORT` | `8788` (set by the image) | 1 to 65535 | Listening port. If you change it, change `FOLDERS_URL` too. |
| `FOLDERS_RESCAN_MINUTES` | `15` | 0 to 10080 | When someone opens the library and the last full scan is older than this, a full scan runs in the background. `0` never does. |
| `FOLDERS_SESSION_HOURS` | `720` | 1 to 8760 | How long a sign-in lasts. Changing the user name or password signs everyone out. |
| `FOLDERS_LOGIN_ATTEMPTS` | `5` | 1 to 100 | Failed sign-ins allowed per address in the window below. |
| `FOLDERS_LOGIN_WINDOW_SECONDS` | `900` | 10 to 86400 | The window for the limit above. After it is reached, the service answers with error 429 until the window ends. |
| `FOLDERS_PROGRESS_FLUSH_SECONDS` | `3` | 0 to 60 | At most one write per progress file in this interval. `0` writes at once. A hard kill can lose the last few seconds. |
| `FOLDERS_LIBRARIES_DIR` | `/libraries` | a folder | Where the libraries are mounted in the container. Each direct sub-folder is one library. |
| `FOLDERS_DATA_DIR` | `/data` | a folder | Where it keeps its data. Compose mounts `./data/folders` there. |

Numbers must be whole numbers inside the range, otherwise the service does not start.

### Also read only by Compose

These two settings only shape the folders container.

| Variable | Default | Effect |
| --- | --- | --- |
| `FOLDERS_SCANS_PATH` | `./scans` | Folder on the host that **directly** contains your series. Mounted read-only as `/libraries/Scans`. |
| `FOLDERS_UID`, `FOLDERS_GID` | `1000`, `1000` | User and group the folders container runs as. They must be able to read the scans and own `data/folders`. |

## Ports

| Port | Where | Published on the host? |
| --- | --- | --- |
| 8380 (`SCROLLARR_PORT`) → 80 | Scrollarr (nginx) | Yes. This is the only port. |
| 8787 | Notifier | No. Reached by Scrollarr under `/notify/`. |
| 8788 | Folders service | No. Reached by Scrollarr under `/folders/`, through the internal network `folders_net`. |

Scrollarr's own routes: `/` (the app), `/suwayomi/`, `/komga/` and `/folders/` (proxies to your servers; they answer 404 when the address is empty), `/notify/` (proxy to the notifier) and `/servers.json` (the servers configured on this installation).

## Compose profiles and containers

| Profile | Starts | Container name |
| --- | --- | --- |
| none (always) | the app | `scrollarr` |
| `push` | the notifier | `scrollarr-notifier` |
| `folders` | the folders service | `scrollarr-folders` |

Use the profile flag on every `docker compose` command that should include the service: `docker compose --profile push --profile folders up -d`. A command without the flag leaves that service out of the project.

The container names are fixed. Two projects on one machine cannot both use them (see [Troubleshooting](troubleshooting.md)).

The folders container runs with a read-only filesystem, no Linux capabilities, `no-new-privileges`, 256 MB of memory, 64 processes, and only the internal network `folders_net`. The main container is also on `default`, which is how it reaches your other servers.

## Volumes and files

| On the host | In the container | Used for |
| --- | --- | --- |
| `./data/notifier` | `/data` (notifier) | `vapid.json` (push keys), `subscriptions.json`, `seen.json` |
| `./data/folders` | `/data` (folders) | `secret.key` (signs sessions), `libraries.json`, `progress/` (one JSON file per series and profile) |
| `FOLDERS_SCANS_PATH` | `/libraries/Scans`, read-only | your scans |
| `.env` | (read by Compose) | all settings, including passwords |

Create `data/notifier` and `data/folders` yourself and give them to the user the container runs as (see [Installation](installation.md)). If Docker creates them, they belong to root and the service cannot write.

To develop on the app, `docker-compose.dev.yml` mounts `app/` and the nginx template read-only into the main container (see [Development](development.md)).

## What is stored where

| What | Where |
| --- | --- |
| Reading progress of the **main** profile | In Suwayomi or Komga, as their own reading history. With only the folders service, in `data/folders/progress/main/`. |
| Profile list, subscriptions, progress of the other profiles | In the key-value store of each active server that has one (Suwayomi "meta" entries, Komga "client settings"), under keys starting with `scrollarr.`. The folders service has no such store. |
| Progress of another profile on a *Folders* series | In `data/folders/progress/<profile id>/`. |
| Shared history of finished downloads | The same key-value store, as one document for the whole installation. |
| Push subscriptions and keys | `data/notifier/` |
| Theme, language, reader settings, which servers are on, the profile open on this device, a copy of the subscriptions | The browser of each device (`localStorage`). |
| Downloaded chapters | The browser of the device that downloaded them (Cache Storage and IndexedDB). |
| Copies of recent answers, for browsing without a connection | The browser (IndexedDB). |
| Sign-in for Suwayomi | Cookies of the browser, and a refresh token in `localStorage` for the "UI login" mode. |
| Sign-in for Komga and Folders | Session cookies set by those servers. |

Scrollarr stores no password on the server side. Details about cookies: [Security](security.md). What to copy to back up an installation: [Update, backup and rollback](update-backup.md).
