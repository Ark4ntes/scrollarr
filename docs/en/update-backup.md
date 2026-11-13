# Update, backup and rollback

**English** · [Français](../fr/update-backup.md) · [Back to the README](../../README.md)

Back up first, then update. Both are short. Commands run in the folder that holds `docker-compose.yml` and `.env`. On a Synology NAS, add `sudo` (see [Synology](synology.md)).

## Back up

What to copy:

| What | Why |
| --- | --- |
| `.env` | All your settings, with the passwords and API keys. Keep the copy private. |
| `docker-compose.yml`, and `docker-compose.override.yml` if you made one | Only if you changed them. |
| `data/notifier/` | `vapid.json` holds the push keys. If you lose it, a new key pair is created and every device must turn notifications off and on again. `subscriptions.json` lists the subscribed devices. `seen.json` remembers what was already announced; losing it is harmless (the next check starts from what exists). |
| `data/folders/` | `progress/` holds the reading progress kept by the folders service. `secret.key` signs the sessions (losing it signs everyone out). `libraries.json` remembers which libraries have held series. |

`data/` only exists if you use the push notifier or the folders service.

What you do **not** need to copy from Scrollarr:

- **Reading history.** For the main profile, it is the reading history of Suwayomi or Komga. The profile list, the subscriptions and the progress of the other profiles are stored in the same servers, in their key-value store (Suwayomi "meta", Komga "client settings"). Back up Suwayomi and Komga as their own documentation says, and these come with them. With only the folders service, the history is in `data/folders/progress/`.
- **Scrollarr's images.** They can be pulled or rebuilt.
- **The scans.** They belong to you and are mounted read-only; back them up the way you already do.

Make the copy. Stop the services first if you want a perfectly still copy (the folders service writes its files atomically, so copying while it runs is also safe):

```sh
docker compose stop
tar czf ../scrollarr-backup-$(date +%Y-%m-%d).tar.gz .env docker-compose.yml data
docker compose start
```

(add `--profile push --profile folders` after `compose` if you use them; if `data` does not exist yet, leave it out of the `tar` command).

## Update

### From the published images

```sh
docker compose pull
docker compose up -d
```

With the optional services, repeat the profiles on both commands:

```sh
docker compose --profile push --profile folders pull
docker compose --profile push --profile folders up -d
```

`.env` and `data/` are not touched. Compose recreates only the containers whose image changed.

Check the version that runs: *Settings > About* shows "Scrollarr 0.9.0, an open-source reader for Suwayomi and Komga, MIT licensed." with your number. This command also shows it: the file it prints contains the line `export const APP_VERSION = '0.9.0';` (with your number).

```sh
curl http://192.168.1.10:8380/js/config.js
```

Use `curl`, not the browser's address bar: in a browser that already runs Scrollarr, the app answers every page address with the app itself, so you would not see the file.

### From a clone

The images are built on the machine, so `docker compose pull` does not apply here.

```sh
git pull
docker compose up -d --build
```

(with `--profile` flags for the optional services). If `git pull` complains about local changes, you edited a tracked file such as `docker-compose.yml`: keep your changes in a `docker-compose.override.yml` instead.

### On the devices

Each device keeps the previous version of the app in its cache until it has fetched the new one. After an update, reload the app twice, or press *Reload* on the banner "A new version of Scrollarr is installed." A home-screen app: close it completely, then open it again. Nothing else to do: settings, profile and downloads are kept.

## Pin a version

By default the published images use the tag `latest`, which moves with each release. To stay on a version, set it in `.env`:

```
SCROLLARR_VERSION=0.9.0
```

`0.9` receives only the fixes of the 0.9 series (the tags that exist are `X.Y.Z`, `X.Y`, `latest`: see [Installation](installation.md#which-images-exist)). The setting applies to the three images and takes effect with:

```sh
docker compose pull
docker compose up -d
```

`SCROLLARR_VERSION` exists only in `deploy/docker-compose.yml` (installation from published images). From a clone, you pin by choosing what you check out: `git fetch --tags` then `git checkout v0.9.0`, then rebuild.

Only the latest release receives security fixes ([SECURITY.md](../../SECURITY.md)): pin to stay put, not to stay for long.

## Roll back

1. Put the previous version in `.env`: `SCROLLARR_VERSION=0.9.0`, for example.
2. `docker compose pull`, then `docker compose up -d`.
3. Reload the app twice on your devices.

From a clone: `git checkout` the previous tag, then `docker compose up -d --build`.

The services read their JSON files as they find them; nothing in the code converts data from one version to another. If a service misbehaves after a rollback, stop it, restore the copy of `data/` made before the update (below), and start it again. If the notes of a release say more, follow them.

## Restore

On the same machine or a new one, in the project folder:

```sh
docker compose down
sudo tar xzf /path/to/scrollarr-backup-YYYY-MM-DD.tar.gz
docker compose up -d
```

`tar` run as the administrator keeps the owner of each file, which matters for `data/folders` and `data/notifier` (the services run as a numeric user, `1000:1000` unless you changed `FOLDERS_UID` and `FOLDERS_GID`). If you restore without keeping the owners, give the folders back: `sudo chown -R 1000:1000 data/folders data/notifier`.

A new machine also needs your reverse proxy and certificate ([Synology](synology.md)), and the same address in the browsers: each browser keeps its settings and downloads per address.

## What a device keeps locally

None of this is in a backup of the NAS, and none of it follows a restore:

- Settings of the interface (theme, language, reader settings), which servers are switched on, the profile open on this device, the way duplicate series are handled.
- A copy of the subscriptions and of the profiles, kept in step with the servers.
- The chapters downloaded for offline reading (they live in this browser only), and the copies of recent answers that let you browse without a connection.
- Recent searches and the choice of sources to search.
- Reading progress made offline, waiting to be sent.
- The sign-in cookies for Suwayomi.

Clearing a site's data in the browser, or removing the home-screen app, erases all of it, including the downloads. Progress, subscriptions and profiles come back from the servers; the downloads must be made again. On iOS, the system can also reclaim the storage of an app that is not installed on the home screen.
