# Installation

**English** · [Français](../fr/installation.md) · [Back to the README](../../README.md)

This guide takes you from nothing to a Scrollarr you can open in a browser. For the list of every setting, see [Configuration](configuration.md). On a Synology NAS, read [Synology](synology.md) next to this page.

## Before you start

You need:

- Docker with the Compose plugin (the command `docker compose version` must print a version).
- At least one server that already works: [Suwayomi](https://github.com/Suwayomi/Suwayomi-Server) or [Komga](https://komga.org). The optional folders service (see below) can replace both if you only have folders of scans.
- For the full app, an **HTTPS** address for Scrollarr (the address you type in the browser).

### Why HTTPS

Over plain HTTP, Scrollarr loads and reads. Browsers only allow the following on HTTPS (or on `http://localhost` from the same machine):

- saving chapters on the device for offline reading (Scrollarr then shows "Offline reading is unavailable at this address: browsers only allow it over HTTPS...");
- installing the app on the home screen;
- push notifications;
- the service worker that makes the app open fast and keeps it available offline.

For a Suwayomi that asks for a login, there is a second reason: Scrollarr keeps the credentials in a cookie of your browser (see [Security](security.md)). Send that cookie over HTTPS only.

Scrollarr does not handle certificates. Put a reverse proxy with a certificate in front of it (on a Synology NAS, see [Synology](synology.md)). The proxy sends HTTPS traffic to Scrollarr's port (8380 by default, plain HTTP).

### How the addresses work

The browser only talks to Scrollarr. The Scrollarr container then talks to your servers. The addresses you put in `.env` are therefore the ones **the container** can reach:

```
browser ──► Scrollarr (port 8380) ──► Suwayomi, Komga, folders service
```

- `http://192.168.1.10:4567` works if Suwayomi publishes its port on the machine at 192.168.1.10.
- `http://localhost:4567` does not work: inside the container, `localhost` is the container itself.
- `http://suwayomi:4567` (a container name) only works if Scrollarr and that container share a Docker network. See the comment at the bottom of `docker-compose.yml`.
- No slash at the end, no path (not `/api/graphql`).

## Which images exist

The project is not released yet (version 0.9.0 in the code, no release published). What the repository's Docker workflow (`.github/workflows/docker.yml`) is set up to publish:

| Event | Image tags |
| --- | --- |
| A Git tag starting with `v` (for example `v0.9.0`) | `0.9.0`, `0.9` and `latest` |
| A push to the `main` branch | `edge` (development build, follows `main`) |
| A pull request | built to check it, not published |

The three images are `ghcr.io/ark4ntes/scrollarr`, `ghcr.io/ark4ntes/scrollarr-notifier` and `ghcr.io/ark4ntes/scrollarr-folders`, for `amd64` and `arm64`, and they share one tag. Until a `v` tag exists there is no `latest`: build from a clone (next section but one). Once a release exists, the published images are the simpler route.

## Install from a clone (works today)

```sh
git clone https://github.com/Ark4ntes/scrollarr.git
cd scrollarr
cp .env.example .env
```

Open `.env` in a text editor and set the address of each server you use (see "How the addresses work"):

```
SUWAYOMI_URL=http://192.168.1.10:4567
KOMGA_URL=
```

Leave empty the server you do not use. The file ships with `SUWAYOMI_URL=http://ADRESSE_DU_NAS:4567` (a placeholder): if you only use Komga, empty it, otherwise Scrollarr shows a Suwayomi server that never answers.

Build and start:

```sh
docker compose up -d --build
```

The first build takes a few minutes. Then `docker compose ps` should list `scrollarr` as `running` (and `healthy` after about 30 seconds). Open `http://192.168.1.10:8380`, replacing the address with the machine's own.

## Install from the published images (once a release exists)

No clone needed: two files are enough.

```sh
mkdir scrollarr && cd scrollarr
curl -O https://raw.githubusercontent.com/Ark4ntes/scrollarr/main/deploy/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/Ark4ntes/scrollarr/main/.env.example
```

Edit `.env` as above, then:

```sh
docker compose up -d
```

`SCROLLARR_VERSION` in `.env` chooses the image tag (`latest` by default). To try the development build before the first release, set `SCROLLARR_VERSION=edge`: it follows `main` and can break between two pushes. I could not check from the repository that these images are already published.

To pin a version, see [Update, backup and rollback](update-backup.md).

## Without Compose

The main image alone is enough to read from Suwayomi and Komga. Both variables may be empty (an empty address means "this server is not configured"):

```sh
docker run -d --name scrollarr --restart unless-stopped -p 8380:80 \
  -e SUWAYOMI_URL=http://192.168.1.10:4567 -e KOMGA_URL= \
  ghcr.io/ark4ntes/scrollarr:latest
```

This needs a published `latest` image; from a clone, run `docker build -t scrollarr .` and use `scrollarr` as the image name. The push notifier and the folders service are set up for Compose only (the folders service relies on a dedicated internal network defined in `docker-compose.yml`).

## First launch

Open the address in a browser. You should see one of these:

- **A card per server with a sign-in form.** Komga asks for *Email* and *Password*, Suwayomi and Folders ask for *Username* and *Password*. Type your account and press *Sign in to Komga* (or the server's name). *Do not use this server* is offered when several servers exist.
- **The home screen straight away**, if your server needs no sign-in (a Suwayomi without authentication). If your library is empty, the home screen says "The library is empty" until the server has scanned something.
- **"No server is configured on this installation. Set KOMGA_URL, SUWAYOMI_URL or FOLDERS_URL in the .env file, then restart Scrollarr."** All three addresses are empty.
- **"... is not responding. Check that it is running and reachable."** The container cannot reach the address you gave. See [Troubleshooting](troubleshooting.md).

*Settings > Servers* then lists each server with its state (*Connected*, *Sign-in required*, *Unreachable*, *Offline, using cached data* or *Not used*) and a *Test* button that answers "Suwayomi answers in 12 ms." or "Suwayomi is not responding...". *Settings > About* shows the version.

To install on a phone: on iPhone or iPad, open the address in Safari, then *Share*, then *Add to Home Screen*; notifications and durable storage for downloads exist only for the app installed that way. On Android, Chrome offers to install the app from its menu.

### Check your Suwayomi first (optional)

From a clone, on any machine with Node 20 or later:

```sh
node dev/check-suwayomi.mjs http://192.168.1.10:4567
```

Add a user name and password after the address if Suwayomi asks for authentication. The script sends Scrollarr's read-only queries to your server and prints `OK` or `ÉCHEC` (French for "failed") for each one. It changes nothing.

## Optional: push notifications

The notifier checks your servers and sends a notification when a chapter arrives in a series you subscribed to.

1. In `.env`: set `VAPID_SUBJECT` to a contact address (`mailto:you@example.com`). For Komga, create an API key in Komga (the account menu) and put it in `KOMGA_API_KEY`. For a Suwayomi that asks for authentication, set `SUWAYOMI_USER` and `SUWAYOMI_PASSWORD`. `POLL_MINUTES` (10 by default) sets how often it checks.
2. Create its data folder and give it to the user the container runs as (UID 1000, the `node` user of the image):
   ```sh
   mkdir -p data/notifier
   sudo chown 1000:1000 data/notifier
   ```
3. Start it:
   ```sh
   docker compose --profile push up -d
   ```
   From a clone, use `docker compose --profile push up -d --build`.
4. In Scrollarr, open *Settings > Notifications*, turn on *Notify me when a chapter arrives in a series I subscribe to*, then press *Send a test*.

The notifier needs `SUWAYOMI_URL`, or `KOMGA_URL` together with `KOMGA_API_KEY`; without them it stops at start with a message. It sends one notification per series, even if several chapters arrive together. The first check only records what already exists, so nothing is announced for your existing library. Its keys and the list of subscribed devices are in `data/notifier/`. If it is not started, *Settings > Notifications* says that the notification service is not installed on this server; subscriptions and the UP badge keep working.

## Optional: the folders service

`folders` is a small Node service that lets Scrollarr read manga stored in plain folders on your machine, with neither Suwayomi nor Komga. In the app it is a third server named *Folders*. If you already run Komga, point Komga at the folder instead: it does more. The folders service is for people who want Scrollarr alone, or who keep plain folders of images.

What it reads: image folders and `.cbz` / `.zip` archives (JPEG, PNG, WebP, GIF, AVIF images). It does not read CBR, RAR, 7z, PDF or EPUB.

### Folder layout

`FOLDERS_SCANS_PATH` must be the folder that **directly** contains your series:

```
/path/to/scans/                 the folder you put in FOLDERS_SCANS_PATH
  Series name/                  each direct sub-folder is one series
    cover.jpg                   optional cover (.jpg, .jpeg, .png, .webp)
    Chapter 1/                  a chapter is a folder of images...
      001.jpg
    Chapter 2.cbz               ...or a CBZ/ZIP archive
    Volume 2/Chapter 10.cbz     intermediate folders are allowed (3 levels below the series)
  Another series/
```

Rules the service applies:

- The reading order is the natural order of the names (`Chapter 2` before `Chapter 10`). To fix an order, rename.
- Without a `cover.*` file, the cover is the first page of the first chapter.
- Images placed directly in a series folder with no chapter form one chapter named like the series. If there are loose images **and** chapters, the loose images are ignored (with a warning in the logs).
- Names starting with `.`, `@eaDir`, `#recycle`, `Thumbs.db` and `__MACOSX` are ignored. Symbolic links are never followed.
- Renaming or moving a chapter or a series creates a new item, with no reading progress.

If you point one level too high (a folder that groups several collections), each collection is taken for one series, with hundreds of "chapters". Check with the logs below.

### Set it up

In `.env`:

```
FOLDERS_URL=http://folders:8788
FOLDERS_SCANS_PATH=/path/to/scans
FOLDERS_AUTH=password
FOLDERS_USER=reader
FOLDERS_PASSWORD=choose-at-least-12-characters
FOLDERS_UID=1000
FOLDERS_GID=1000
```

The service refuses to start without an explicit `FOLDERS_AUTH`: `password` (a shared user name and password, at least 12 characters) or `none` (no access control at all, for a trusted local network only; `FOLDERS_USER` and `FOLDERS_PASSWORD` must then be empty). What each mode protects is in [Security](security.md).

`FOLDERS_UID` and `FOLDERS_GID` are the user and group the service runs as. They must be able to **read** the scans folder and must **own** the data folder:

```sh
mkdir -p data/folders
sudo chown 1000:1000 data/folders
docker compose --profile folders up -d
```

(from a clone, add `--build`). The scans are mounted read-only: the service can never write to them. Then check the logs (they are in French):

```sh
docker logs scrollarr-folders
```

You should see a line like `Dossiers à l'écoute sur 8788 (authentification : password, bibliothèques : Scans).`, then `Parcours terminé : 42 séries, 610 chapitres, 0 avertissements, 380 ms.` The numbers must match what you expect. A line starting with `Configuration invalide :` explains why the service refused to start (wrong mode, password shorter than 12 characters, unknown `FOLDERS_` variable...).

Reload Scrollarr: *Folders* appears among the servers in *Settings > Servers*. Sign in with `FOLDERS_USER` and `FOLDERS_PASSWORD`.

To add a second library, mount another folder under `/libraries/<Name>` in a `docker-compose.override.yml` next to `docker-compose.yml`:

```yaml
services:
  folders:
    volumes:
      - /path/to/comics:/libraries/Comics:ro
```

Do not mount a folder inside another mounted folder. What the service stores in `data/folders` and how it detects changes: [folders/README.md](../../folders/README.md) (French).

## Health checks

All three images declare a health check. `docker ps` (or Container Manager on a Synology) shows `healthy` or `unhealthy` next to each container: Scrollarr fetches `/servers.json` every 30 seconds, the notifier and the folders service answer on `/health`.

## What next

- Changing a setting or finding what a variable does: [Configuration](configuration.md).
- Something does not work: [Troubleshooting](troubleshooting.md).
- Keeping it up to date and backed up: [Update, backup and rollback](update-backup.md).
