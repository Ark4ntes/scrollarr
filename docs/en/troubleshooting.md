# Troubleshooting

**English** · [Français](../fr/troubleshooting.md) · [Back to the README](../../README.md)

Find the symptom, read the cause, apply the fix. The tables come first; the commands they refer to ("Useful checks") are at the end. Messages in quotes are the ones the app or the services show. The services' logs are in French.

## Servers and connection

| Symptom | Cause | Fix |
| --- | --- | --- |
| A server card says *Unreachable*, or "Suwayomi is not responding. Check that it is running and reachable." | The Scrollarr container cannot reach the address in `.env`. Common reasons: the placeholder `http://ADRESSE_DU_NAS:4567` was not replaced; a typo; `localhost` (it is the container itself); a container name used while the two stacks share no Docker network; a slash or a path at the end of the address; the server is stopped or does not publish its port. | Fix the address (the one **the container** reaches, for example `http://192.168.1.10:4567`, no trailing slash). Empty the variable of a server you do not use. Then `docker compose up -d --force-recreate`. Use "Check an address from inside the container" below to test it. |
| You edited `.env` and nothing changed | The container reads `.env` only when it is created. | `docker compose up -d --force-recreate`, then check with "Check the addresses the container uses". |
| Pages or covers fail, the banner says "Server unreachable: only downloaded chapters can be read." now and then | The proxy answered 502 or 504 (server down or too slow), or the server took more than 15 seconds. After a failure, the app stops asking for 15 seconds. Typical cases: a Suwayomi chapter that is not downloaded (it is first fetched from its source, allowed up to 180 s); disks of a NAS waking up. | Retry after a moment. For Suwayomi, ask the server to download the series (*Download* menu, *Have Suwayomi download the whole series*). Look for 502 and 504 in `docker logs scrollarr`. |
| Outside your network, every server is *Unreachable* | A proxy in front of Scrollarr (for example an access control profile) refuses you with an HTML 403 page; the app reads that as an unreachable server. | Expected if you restricted access ([Synology](synology.md#6-keep-it-on-the-local-network-only-access-control-profile)). Use a VPN, or change the rule. |
| "Wrong username or password." | Wrong credentials. Komga wants your **email**, Suwayomi and Folders a user name. | Retry. For the folders service, the user and password are the ones in `.env`. |
| "Could not sign in (error 429)" on *Folders* | Too many failed sign-ins: 5 per 15 minutes by default. The count is per address as Scrollarr sees it, so behind a reverse proxy everybody shares it. | Wait 15 minutes, or `docker restart scrollarr-folders` (the count is kept in memory). |
| "No server is configured on this installation..." | `SUWAYOMI_URL`, `KOMGA_URL` and `FOLDERS_URL` are all empty. | Fill one in `.env`, then recreate the container. |
| A server you never use shows as unreachable | Its address is still the placeholder. | Empty it in `.env`, recreate. Or switch it off in *Settings > Servers* on each device (*Do not use this server*). |

## Reading, offline mode, updates

| Symptom | Cause | Fix |
| --- | --- | --- |
| The *Download* button is missing, or its menu says "Offline reading is unavailable at this address: browsers only allow it over HTTPS..." | You opened Scrollarr over plain HTTP. Offline storage, home-screen installation and notifications need HTTPS (or `http://localhost`). | Open Scrollarr through an `https://` address ([Installation](installation.md#why-https), [Synology](synology.md#5-https-with-the-reverse-proxy-and-a-certificate)). |
| "This browser cannot save chapters for offline reading." | The browser has no offline storage (some private modes, old browsers). | Use another browser, or the installed app. |
| After an update, the version does not change | Each device keeps the old app files in its cache until it has fetched the new ones. | Reload twice, or press *Reload* on "A new version of Scrollarr is installed." Close and reopen a home-screen app. |
| A chapter shows "This chapter cannot be read here" | The chapter has no pages that Scrollarr can show as images (an EPUB, for example). The message says it shows CBZ, CBR and PDF. | Open the file in Komga, as the message suggests. |
| "Offline: this chapter is not downloaded, some pages may be missing." | You lost the connection while reading a chapter that is not on the device. | Download chapters before going offline (*Download* on the series page). |
| A blank page or "403 Forbidden" with images built from sources you uploaded | The files had restrictive modes when copied into the image. Fixed in the images since 0.9. | Update the sources and rebuild ([Synology](synology.md#files-fetched-with-restrictive-modes)). |

## Profiles, subscriptions, progress

| Symptom | Cause | Fix |
| --- | --- | --- |
| Progress is not saved | Several possible causes: you are offline (progress is queued and sent later); the server was unreachable; for the folders service, `data/folders` is not writable by `FOLDERS_UID:FOLDERS_GID`. | Check the card in *Settings > Servers*. For the folders service: `docker logs scrollarr-folders` shows `Progression non écrite (...)` (it retries) or, at start, `Le dossier de données /data n'est pas inscriptible par cet utilisateur.` Fix with `sudo chown 1000:1000 data/folders` (or your own numbers) and `docker restart scrollarr-folders`. |
| You read as another profile, but Suwayomi's or Komga's own interface shows nothing | Only the **main** profile uses the server's reading history. Another profile keeps its progress in Scrollarr's own documents on the server. | Expected. Read as the main profile if you want the server's history. |
| You look for a profile's progress in `data/folders/progress/` and find nothing under `main` | There, the progress of another profile is under its **identifier**, a random code such as `p3k9x2a`, one folder per profile. The service does not know the names. | Look in the other folders; `main` holds the main profile only. |
| A profile or subscription is different on another device | The profile open on a device, the servers switched on, and the interface settings are kept **per device**. Subscriptions are per profile and copied to every server that stores them (Suwayomi, Komga). With only *Folders*, subscriptions stay on the device. | Choose the same profile on both (*Settings > Profile > Switch profile*), switch on the same servers, reload. Two devices that change the same entry before seeing each other keep one of the two, the same on all devices. |
| The main profile is called "Principal" in the English interface | Version 0.9.0 and earlier stored and showed that French name. Since 0.9.1 it is shown as "Main" in English (the default name is translated when displayed). | Update. A name you chose yourself is never translated. You can rename it: *Settings > Profile > Manage profiles*, then the menu next to it, *Rename*. |
| A subscription vanished | The app removes a subscription only when its series is reported as not found twice, at least 24 hours apart (series deleted on the server, or a folder renamed). | Subscribe again from the series page. |
| "Profiles are not available with this server. Subscriptions stay on this device." | Only *Folders* is switched on: it has no key-value store. | Switch on Suwayomi or Komga too. |

## Folders service

| Symptom | Cause | Fix |
| --- | --- | --- |
| *Folders* does not appear in *Settings > Servers* | `FOLDERS_URL` is empty. | Set `FOLDERS_URL=http://folders:8788` in `.env`, recreate. |
| *Folders* is *Unreachable* | The service is not started (profile missing from the command), or it refused to start. | `docker compose --profile folders up -d`, then `docker logs scrollarr-folders`. A line `Configuration invalide : ...` names the problem (`FOLDERS_AUTH` missing, password shorter than 12 characters...). |
| The library shows zero series | `FOLDERS_SCANS_PATH` points to the wrong folder, or the service user cannot read it. | `docker exec scrollarr-folders ls /libraries/Scans` must list your series. Otherwise fix the path or the permissions ([Synology](synology.md#7-the-folders-service-on-a-nas)). |
| A few "series" with hundreds of chapters | `FOLDERS_SCANS_PATH` is one level too high. | Point it to the folder that directly contains the series ([layout](installation.md#folder-layout)). |
| The library is "unavailable" (`/folders/api/v1/status` shows `"state":"unavailable"`) | The folder cannot be read, or is empty although it once held series: share not mounted, encrypted folder locked. The service answers 503 so that your subscriptions and downloads are kept. | Mount or unlock the share. If you emptied it on purpose, a scan must be requested (see `folders/README.md`). |
| New files do not show up | Lists are re-read at most every 60 seconds (series) and 30 seconds (chapters). A full scan runs in the background every 15 minutes when someone opens the library. | Wait a minute, reopen the series. |
| A renamed chapter lost its progress | A rename creates a new item. | Expected. Put the old name back to get the progress back (it is kept). |
| Pages in the wrong order | The order is the natural sort of the names. | Rename the files or folders. |
| A chapter cannot be opened | The archive is refused (encrypted, truncated, too many entries, a method other than stored/deflate) or an image is not JPEG, PNG, WebP, GIF or AVIF. CBR, RAR, 7z and PDF are not read. | Convert it to a plain CBZ. Limits: `folders/README.md`. |

## Downloads and sources

| Symptom | Cause | Fix |
| --- | --- | --- |
| *Settings > Downloads* is empty ("No download") | It lists only what the **server** is fetching (Suwayomi's download queue), after you ask for it from a series page. | Nothing is wrong. Chapters saved on the device are in *My list > Downloads*. With Komga or Folders only, *Settings* has no *Downloads* line: they have nothing to collect. |
| A failed download says "next try in N min" but nothing happens | Automatic retries are sent only while Scrollarr is open on a device: there is no server of ours to send them, so the countdown runs only while the app is open. They also stop after three tries ("automatic retries used up") and when the switch on the Downloads screen is off. | Open the Downloads screen, or press *Retry* yourself. A source that keeps failing needs a look in Suwayomi itself. |
| A downloaded chapter does not appear in *My list > Downloads* | It was downloaded **by the server**, not onto the device. | Use *Download* on the series page, in the section "On this device, to read without a connection:". |
| The *Search the sources of Suwayomi* button is missing | No collector can search: Suwayomi is not switched on, not signed in, or not reachable; or you use Komga or Folders only. | Switch on Suwayomi in *Settings > Servers*. When Suwayomi is unreachable the Search screen explains it instead. |
| The source search finds nothing | Few sources are ticked. By default only sources in the interface language or multilingual ones are searched, never those flagged 18+. Or no extension is installed in Suwayomi. | Press *Choose sources* and tick more. "No source installed on Suwayomi. Add extensions in its own interface." means Suwayomi has none. |
| One source shows an error | Third-party sites can be slow or refuse. | "This source did not answer in time." or "This source refused the search or is not answering." applies to that source only; the others continue. Press *Search again*. |

## Notifications

| Symptom | Cause | Fix |
| --- | --- | --- |
| "The notification service is not installed on this server..." | The notifier is not running. | `docker compose --profile push up -d` ([Installation](installation.md#optional-push-notifications)). |
| The notifier container keeps restarting | It lacks a server (`SUWAYOMI_URL`, or `KOMGA_URL` with `KOMGA_API_KEY`), or cannot write `data/notifier`. | `docker logs scrollarr-notifier`. Fix `.env`; `sudo chown 1000:1000 data/notifier`. |
| "Notifications are blocked. Allow them for this site in your browser settings." | The browser refused the permission. | Allow notifications for the site in the browser. |
| "This browser does not support notifications. On iPhone, add Scrollarr to the Home Screen first." | iPhone only supports them for the installed app, over HTTPS. | Install the app from Safari, then turn the option on. |
| No notification for your own library when you first turn it on | The first check only records what exists. | Expected: you are notified of chapters that arrive afterwards, for series you subscribed to, within `POLL_MINUTES`. |

## Installation

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Conflict. The container name "/scrollarr" is already in use` | Containers have fixed names; a renamed project folder counts as a new project. | `docker compose down` in the old folder, or `docker rm -f scrollarr scrollarr-notifier scrollarr-folders` ([Synology](synology.md#container-name-already-in-use)). |
| "Your kernel does not support PIDs limit" | The folders service sets a limit of 64 processes the kernel cannot apply. | Harmless ([Synology](synology.md#your-kernel-does-not-support-pids-limit)). |
| `docker compose` is not recognized | Docker without the Compose plugin. | Install the plugin (or an up-to-date Docker). |
| `docker compose pull` fails or does nothing for Scrollarr | You installed from a clone: images are built locally. | `git pull`, then `docker compose up -d --build` ([update guide](update-backup.md#from-a-clone)). |

## Useful checks

**Logs.** The three containers are named `scrollarr`, `scrollarr-notifier` and `scrollarr-folders`:

```sh
docker logs --tail 100 scrollarr
docker logs --tail 100 scrollarr-notifier
docker logs --tail 100 scrollarr-folders
```

Add `-f` to follow them live. The equivalent with Compose is `docker compose logs scrollarr` (add `--profile push` or `--profile folders` before `logs` for the optional services). The main container logs each request with its status, which shows 502 and 504 at once. On a Synology, Container Manager also shows logs (menu names not verified).

**Which version runs.** *Settings > About* shows it. From a terminal:

```sh
curl http://192.168.1.10:8380/js/config.js
```

prints a line `export const APP_VERSION = '0.9.1';`. (Not from the browser's address bar: the app would answer instead of the file.) The folders service's own number (`version` in `/folders/api/v1/status`) is not the release number.

**Services answer.**

```sh
curl http://192.168.1.10:8380/servers.json
curl http://192.168.1.10:8380/notify/health
curl http://192.168.1.10:8380/folders/health
```

The first shows which servers are configured, as `{"komga":false,"suwayomi":true,"folders":false}`. The second answers `{"ok":true,"subscriptions":0}` when the notifier runs (a 404 means it does not). The third answers `{"ok":true}` when the folders service runs, and nothing else: it is the public health probe. To see its version, its mode and the state of each library (`ok`, `scanning` or `unavailable`), open `http://192.168.1.10:8380/folders/api/v1/status` in the browser where you are signed in to the app (in `password` mode, the sign-in cookie is needed).

**Check the addresses the container uses.**

```sh
docker compose exec scrollarr env
```

Look at the three lines `SUWAYOMI_URL=`, `KOMGA_URL=` and `FOLDERS_URL=` in the output.

**Check an address from inside the container.**

```sh
docker compose exec scrollarr wget -O /dev/null http://192.168.1.10:4567/
```

The messages come from the small `wget` of the image. `bad address` means the name does not resolve; `can't connect to remote host` or `Connection refused` means nothing listens there; `server returned error: HTTP/1.1 401` (or any other HTTP code) means the server answered, so the address is right.

**Container state.** `docker compose ps` (with `--profile` flags for optional services). A container that keeps restarting shows `Restarting`; its log gives the reason.

## Still stuck?

Open an issue on the repository and give the Scrollarr version, `docker compose ps`, the relevant lines of the logs and what you expected. Remove passwords and addresses you do not want to share. Vulnerabilities go through the private channel in [SECURITY.md](../../SECURITY.md).
