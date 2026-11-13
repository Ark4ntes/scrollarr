# Scrollarr on a Synology NAS

**English** · [Français](../fr/synology.md) · [Back to the README](../../README.md)

A start-to-finish guide for DSM 7 with Container Manager and an SSH session. The generic steps are in [Installation](installation.md); this page adds what is specific to a NAS.

What this page is based on: the code of Scrollarr, and problems met on a real DS920+ by the project owner (listed in "Seen on a real DS920+" at the end). I could not open DSM while writing it. **Every DSM menu name below is written from memory of DSM 7 or from the earlier README and is not verified**; the list is at the end of the page. If a menu is called something else on your version, the intent of the step is what counts.

## What you need

- DSM 7 with the Container Manager package installed (Package Center).
- SSH enabled for your administrator account (in the Control Panel, *Terminal & SNMP*; menu name not verified).
- Suwayomi and/or Komga already running, with their ports published on the NAS (Suwayomi usually on 4567, Komga on 25600).
- The NAS address, here `192.168.1.10`. Use yours.

In the examples, commands start with `sudo`: on DSM, Docker commands need administrator rights.

## 1. Create the folder

Container Manager creates a shared folder named `docker`. Put the project in its own sub-folder, `/volume1/docker/scrollarr`:

```sh
ssh your-admin-account@192.168.1.10
cd /volume1/docker
sudo mkdir -p scrollarr
cd scrollarr
```

You can also create the folder in File Station. Everything below happens in this folder: `docker-compose.yml`, `.env` and, later, `data/`.

## 2. Get the files

Once a release is published, fetch the two files you need:

```sh
sudo curl -O https://raw.githubusercontent.com/Ark4ntes/scrollarr/main/deploy/docker-compose.yml
sudo curl -o .env https://raw.githubusercontent.com/Ark4ntes/scrollarr/main/.env.example
```

Until the first release (see [Installation](installation.md#which-images-exist)), build from the sources. DSM does not ship `git` as far as I know, so download the repository as a ZIP on your computer, unzip it, and upload the content of the folder into `/volume1/docker/scrollarr` with File Station. Rename `.env.example` to `.env`. Hidden files (starting with a dot) may not show in File Station by default; if you cannot see `.env.example`, copy it from the SSH session instead: `sudo cp .env.example .env`.

Files uploaded this way can end up with restrictive modes: see "Files fetched with restrictive modes" at the end.

## 3. Edit `.env`

Open `.env` with an editor (`sudo vi .env`, or edit it on your computer and upload it again) and set at least:

```
SUWAYOMI_URL=http://192.168.1.10:4567
KOMGA_URL=
```

Use the NAS address and the port Suwayomi (or Komga) publishes. Leave empty the server you do not use: the file ships with a placeholder `http://ADRESSE_DU_NAS:4567` that never answers. Then keep the file private, it will hold passwords:

```sh
sudo chmod 600 .env
```

## 4. Start

Published images:

```sh
sudo docker compose up -d
```

From the sources:

```sh
sudo docker compose up -d --build
```

Check it:

```sh
sudo docker compose ps
```

`scrollarr` should be `running`, then `healthy` after about 30 seconds. Open `http://192.168.1.10:8380` from a computer or phone on your network: you should see the sign-in screen or the home screen.

Container Manager's *Project* screen can create the same project from this folder (menu names not verified). I have not checked whether it reads `.env`; SSH is the path described and tested here.

If `docker compose` is not recognized, the Docker on your DSM is older than the Compose plugin. Update Container Manager rather than rewriting the files (not verified on DSM versions other than 7).

## 5. HTTPS with the reverse proxy and a certificate

Without HTTPS, offline downloads, installation on the home screen and push notifications are not available ([why](installation.md#why-https)). DSM can do the HTTPS part for you.

1. Choose a host name for Scrollarr, for example `scrollarr.example.com`, that points to your NAS (a DNS record, or the DDNS name your NAS already has).
2. Get a certificate for that name. DSM can obtain a Let's Encrypt certificate (Control Panel, *Security*, *Certificate*; menu names not verified).
3. Create a reverse proxy rule (Control Panel, *Login Portal*, *Advanced*, *Reverse Proxy*; menu names not verified):
   - Source: protocol HTTPS, host name `scrollarr.example.com`, port 443.
   - Destination: protocol HTTP, host name `localhost`, port 8380 (or your `SCROLLARR_PORT`).
4. Assign the certificate to that rule (in the certificate settings, choose the certificate for the `scrollarr.example.com` service; menu names not verified).
5. Open `https://scrollarr.example.com`. You should see Scrollarr, with a padlock.

Two things to know:

- Scrollarr's folders service adds the `Secure` flag to its session cookie only when the request carries `X-Forwarded-Proto: https`. I could not check that DSM's reverse proxy sends this header.
- Scrollarr lets Suwayomi take up to 180 seconds to answer (a chapter that is not downloaded is first fetched from its source). The proxy of DSM has timeouts of its own, which I did not check; if such chapters only fail through the HTTPS name, look at the timeouts of the rule.

From inside your home network, the HTTPS name must lead to the NAS. If your router does not send the traffic back inside, add a local DNS record for the name that points to `192.168.1.10`.

## 6. Keep it on the local network only (access control profile)

If you reach Scrollarr from home only, do not leave the HTTPS name open to the Internet. DSM's reverse proxy can restrict who passes with an access control profile (Control Panel, *Login Portal*, *Advanced*, *Access Control Profile*; menu names not verified):

1. Create a profile that allows your local range (for example `192.168.1.0/24`) and refuses everything else.
2. Select this profile in the reverse proxy rule of Scrollarr (in the rule's settings; menu names not verified).

A device outside the range then gets an HTML error page from the proxy. Scrollarr treats it as an unreachable server (the card says *Unreachable*): this is expected, not a bug. To read from outside, use a VPN to your network.

Also:

- Do not forward port 8380 on your router. Only the HTTPS name should be reachable, and the profile limits who gets through it.
- The profile protects Scrollarr's name only. The ports of Suwayomi and Komga stay reachable on your network as they were. If a Suwayomi without authentication is on your network, anyone on the network can already use it directly.
- Why this matters: [Security](security.md).

## 7. The folders service on a NAS

Follow [Installation](installation.md#optional-the-folders-service) for the layout and the settings. What is specific to DSM:

**The scans.** `FOLDERS_SCANS_PATH` is a path on a volume, for example `/volume1/path/to/scans`. It must be the folder that directly contains your series. The service ignores the `@eaDir` and `#recycle` folders that DSM creates. The share is mounted read-only: the service cannot modify your scans.

**The user.** The container runs as a number, `FOLDERS_UID:FOLDERS_GID`, `1000:1000` by default. DSM has no user 1000 (its users start higher), which does not prevent the container from running. It matters in two places:

1. The user must be able to **read** your scans. If the scans are readable by "others" on the share, 1000 works. If not, either give read permission on the shared folder to a DSM user, or run the service as a user that can already read it. To find the numbers of a DSM user:
   ```sh
   id your-dsm-user
   ```
   It prints something like `uid=1026(...) gid=100(users)`. Put those numbers in `.env` as `FOLDERS_UID` and `FOLDERS_GID`. Yours will differ.
2. The user must **own** the data folder:
   ```sh
   sudo mkdir -p data/folders
   sudo chown 1026:100 data/folders
   ```
   Use the same two numbers as in `.env` (`1000:1000` if you kept the defaults).

Start and check:

```sh
sudo docker compose --profile folders up -d
sudo docker exec scrollarr-folders id
sudo docker exec scrollarr-folders ls /libraries/Scans
sudo docker logs scrollarr-folders
```

`id` shows the user the service runs as, `ls` must list your series, and the log must say `Parcours terminé : N séries, M chapitres...` with numbers that match your library. If `ls` prints `Permission denied`, the user cannot read the share: adjust the permissions of the shared folder (Control Panel, *Shared Folder*, *Edit*, *Permissions*; menu names not verified) for that user.

**Encrypted shared folder.** If the share is locked after a restart, the service sees an empty or unreadable folder. It then answers "unavailable" (error 503) rather than "not found", so Scrollarr keeps your subscriptions and downloads and shows the server as unreachable. Unlock the share and the library comes back.

## Seen on a real DS920+

These were met by the project owner on a DS920+. Each one has a symptom, a cause and a fix.

### Files fetched with restrictive modes

- **Symptom:** a Scrollarr (or notifier, or folders) container built from sources you uploaded or extracted on the NAS shows a "403 Forbidden" page, or a service stops at start with a "permission denied" error on its own files.
- **Cause:** an archive extracted on a NAS, a strict `umask`, or ACLs can give the files modes such as `600` and `700` (readable by their owner only). The image build copies the files with those modes, and the web server and the services do not run as root, so they cannot read them.
- **Fix:** none needed since version 0.9: the three Dockerfiles make the copied files readable by everyone (`chmod -R a+rX`), and `tests/container_perms.sh` checks it with sources set to modes 600 and 700. With an older build, update the sources and rebuild (`sudo docker compose up -d --build`).

### "Container name already in use"

- **Symptom:** `docker compose up -d` fails with `Conflict. The container name "/scrollarr" is already in use by container ...`.
- **Cause:** the containers have fixed names (`scrollarr`, `scrollarr-notifier`, `scrollarr-folders`). If you renamed or moved the project folder, Compose treats it as a new project and tries to create containers whose names are taken by the ones of the old project.
- **Fix:** in the old folder, run `sudo docker compose down` (with the same `--profile` flags you used to start). Without the old folder, remove the containers by name: `sudo docker rm -f scrollarr scrollarr-notifier scrollarr-folders` (names that do not exist are reported and ignored). Removing a container does not delete `./data`. Then start again from the new folder.

### "Your kernel does not support PIDs limit"

- **Symptom:** when the folders service starts, Docker prints a warning that begins with "Your kernel does not support PIDs limit".
- **Cause:** the folders service asks for a limit of 64 processes (`pids_limit: 64`). The kernel of the NAS cannot apply that limit.
- **Fix:** none. It is harmless: the limit is not applied, the service runs. The other protections of that service (read-only filesystem, no capabilities, memory limit, internal network) are separate settings that the warning does not mention.

### User 1000 does not exist on DSM

- **Symptom:** you wonder whether the default `FOLDERS_UID=1000` and `FOLDERS_GID=1000` can work.
- **Cause:** DSM has no user 1000. A container can run as any number, so the service starts anyway.
- **Fix:** nothing to change if the scans are readable by "others" and `data/folders` belongs to 1000:1000 (`sudo chown 1000:1000 data/folders`). Set `FOLDERS_UID` and `FOLDERS_GID` when the scans are only readable by a given DSM user or group: see section 7. The same applies to `data/notifier`, because the notifier runs as the `node` user of its image (1000): `sudo mkdir -p data/notifier && sudo chown 1000:1000 data/notifier`.

### `FOLDERS_SCANS_PATH` one level too high

- **Symptom:** the folders service finds a handful of "series" named like your collections, each with hundreds of chapters; in the log, `Parcours terminé` shows a few series and a huge number of chapters.
- **Cause:** the path points to a folder that groups several collections (for example `/volume1/path/to` instead of `/volume1/path/to/scans`). Each direct sub-folder is taken for one series.
- **Fix:** point `FOLDERS_SCANS_PATH` to the folder that directly contains the series, then `sudo docker compose --profile folders up -d`. The layout is in [Installation](installation.md#folder-layout).

### The browser keeps the previous version

- **Symptom:** after an update, the app looks unchanged, or *Settings > About* shows the old version.
- **Cause:** each device keeps the app files in its cache and fetches the new ones in the background. The new version is shown after the next load.
- **Fix:** reload the app twice, or press *Reload* on the banner "A new version of Scrollarr is installed." For a home-screen app, close it completely and open it again.

### Offline reading unavailable over plain HTTP

- **Symptom:** in a series, the *Download* button is missing, or its menu offers no download to the device and says "Offline reading is unavailable at this address: browsers only allow it over HTTPS...". The same sentence appears in *Settings* (under *Offline reading*) and in *My list* (*Downloads* tab).
- **Cause:** you opened Scrollarr at `http://192.168.1.10:8380`. Browsers allow offline storage only on HTTPS.
- **Fix:** open Scrollarr through your HTTPS name (section 5). Using the NAS address in a browser is fine for a quick check, not for downloads.

## DSM menu names not verified

All of these come from memory of DSM 7 and from the earlier README. None was checked against a DSM while writing this page:

- Package Center and the *Container Manager* package, and its *Project* screen.
- Control Panel, *Terminal & SNMP* (SSH).
- Control Panel, *Login Portal*, *Advanced*, *Reverse Proxy* (rule creation, assigning a profile to a rule).
- Control Panel, *Login Portal*, *Advanced*, *Access Control Profile*.
- Control Panel, *Security*, *Certificate* (Let's Encrypt, assigning a certificate to a service).
- Control Panel, *Shared Folder*, *Edit*, *Permissions*.
- File Station.

Everything else (commands, file names, variables, messages quoted) comes from the repository.
