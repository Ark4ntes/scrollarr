# Scrollarr

**English** · [Français](README.fr.md)

Scrollarr is a continuous vertical reader for the manga library on your own server: you scroll through a chapter in one gesture, roll into the next one, and pick up exactly where you stopped. It is an installable web app (PWA) with no third-party account and no telemetry. It reads from [Suwayomi](https://github.com/Suwayomi/Suwayomi-Server), from [Komga](https://komga.org), from both at once, or from plain folders of scans through an optional service. MIT licence.

Independent project, not affiliated with Suwayomi, Komga or any commercial reading service.

| Home | Series | Reader | End of chapter |
| --- | --- | --- | --- |
| ![Home](docs/screenshots/home.png) | ![Series page](docs/screenshots/series.png) | ![Reader](docs/screenshots/reader.png) | ![End of chapter](docs/screenshots/next-chapter.png) |

| Merged library | Sign-in to the servers | Offline downloads | Profiles |
| --- | --- | --- | --- |
| ![Library](docs/screenshots/library.png) | ![Servers](docs/screenshots/servers.png) | ![Offline downloads](docs/screenshots/offline.png) | ![Profiles](docs/screenshots/profiles.png) |

*Screenshots taken with the demo library shipped in `dev/`.*

## What it does

- **Vertical reading.** Pages stacked with no gap (or one, your choice), loaded as you approach and released behind you. Bars that fade while you scroll, page slider, auto-scroll, screen kept awake. A "next chapter" card at the end, with the next pages preloaded.
- **Resume and progress.** The page you reached is saved on the server, so its other apps see it. Offline, progress waits and is sent later.
- **Offline.** Save chapters on the device and read them with no connection (HTTPS needed).
- **Profiles.** Several people share one installation with separate progress and subscriptions. They are not accounts: no password.
- **Several servers.** Suwayomi, Komga and Folders can be used together; lists are merged and duplicates by title are shown once.
- **Library and subscriptions.** Filter by category, genre and reading status, search, follow a series: an "UP" badge flags new chapters, and the list follows you across devices. Optional push notifications.
- **Folders.** Read plain folders of images and CBZ/ZIP archives with neither Suwayomi nor Komga.
- **Collection from Suwayomi's sources.** From the Search screen, look a title up in the sources of your Suwayomi and add it to its library. Nothing is sent to a source until you ask.
- **Downloads follow-up.** Ask Suwayomi to download chapters, then follow, cancel or retry them from *Settings > Downloads*.
- Light and dark themes, English and French interface.

## How it fits together

```
browser ──► Scrollarr (nginx, port 8380)
              ├── /           the app (static files)
              ├── /suwayomi/  proxy to your Suwayomi
              ├── /komga/     proxy to your Komga
              ├── /folders/   proxy to the folders service (optional)
              └── /notify/    proxy to the push notifier (optional)
```

The browser talks to Scrollarr only. Scrollarr puts each server under its own address, so a server's session also loads its images. The app is plain JavaScript with no build step. It adds no login of its own: whoever can reach Scrollarr gets what your servers give to someone who is not signed in. Read [Security](docs/en/security.md) before you expose it.

## Quick start

You need Docker with Compose, a running Suwayomi or Komga, and (for the full app) an HTTPS address, see [Installation](docs/en/installation.md). The project is not released yet, so build from a clone:

```sh
git clone https://github.com/Ark4ntes/scrollarr.git && cd scrollarr
cp .env.example .env
# edit .env: SUWAYOMI_URL=http://192.168.1.10:4567 (or KOMGA_URL=...), the other one empty
docker compose up -d --build
```

Open `http://192.168.1.10:8380` (your machine's address, port 8380). You should see a sign-in screen or the home screen. Once a version is released, you will be able to skip the clone and use the published images: [Installation](docs/en/installation.md#install-from-the-published-images-once-a-release-exists).

Next steps:

- Put it behind HTTPS (reverse proxy and certificate): without it, offline downloads, home-screen installation and notifications are unavailable. On a Synology NAS: [Synology NAS](docs/en/synology.md).
- On a phone: on iPhone or iPad open the address in Safari and use *Share*, then *Add to Home Screen*; on Android, Chrome offers to install the app from its menu.
- Something wrong? [Troubleshooting](docs/en/troubleshooting.md).

### Keep it up to date

```sh
git pull && docker compose up -d --build           # installed from a clone
docker compose pull && docker compose up -d        # installed from published images
```

Then reload the app twice on each device. Back up `.env` and `data/` first: [Update, backup, rollback](docs/en/update-backup.md).

## Supported servers

What each connector declares (details and limits in [Connectors](docs/en/connectors.md)):

| | Suwayomi | Komga | Folders (optional service) |
| --- | --- | --- | --- |
| Read series, chapters, pages; search | Yes | Yes | Image folders, `.cbz`, `.zip` |
| Reading progress | Server's own history | Server's own history | Kept by the service |
| Profiles and subscriptions across devices | Yes | Yes | No |
| Ask the server to download chapters; follow tasks | Yes | No | No |
| Search the sources by title and add a series | Yes | No | No |
| Sign-in | None, basic, simple login or UI login | Komga account | Shared password, or none |
| Push notifications (optional) | Yes | Yes, with an API key | No |

Other servers (Kavita...) are planned, not available.

## Guides

| Guide | What is in it |
| --- | --- |
| [Installation](docs/en/installation.md) | Prerequisites and HTTPS, install from a clone or published images, optional services, first launch |
| [Configuration](docs/en/configuration.md) | Every variable, ports, volumes, profiles, what is stored where |
| [Synology NAS](docs/en/synology.md) | DSM 7 start to finish, reverse proxy, local-only access, pitfalls met on a DS920+ |
| [Update, backup, rollback](docs/en/update-backup.md) | Update, pin a version, roll back, what to back up, restore |
| [Security](docs/en/security.md) | Who can reach what, authentication, headers, what the browser stores |
| [Troubleshooting](docs/en/troubleshooting.md) | Symptom, cause, fix; logs; which version runs |
| [Connectors](docs/en/connectors.md) | What each server provides; writing a reader or a collector |
| [Development](docs/en/development.md) | Demo servers, tests, CI, project layout |

Also: [SECURITY.md](SECURITY.md) (report a vulnerability), [CONTRIBUTING.md](CONTRIBUTING.md), [docs/ROADMAP.md](docs/ROADMAP.md) (French).

## Project status and known limits

Version 0.9.0, not released: no release is published yet. Images are published when a `v` tag exists (see [Installation](docs/en/installation.md#which-images-exist)).

- **Tested.** Full journeys (Suwayomi only, Komga only, both, Suwayomi's four authentication modes, offline, profiles, folders) pass in Chrome against the mock servers of `dev/` in CI. nginx was run in front of those mocks. The author uses it with real Suwayomi and Komga servers for reading, progress and profiles.
- **Not tried.** Safari on iOS. Delivery of push notifications (subscribing and detecting new chapters work in tests; the sending itself was never run). Searching the sources and adding a series was only tested against the mock server, not a real Suwayomi, and shows the first page of results per source.
- A Suwayomi chapter that is not downloaded is fetched from its source when opened: the first display can take several seconds.
- There is no automatic follow or download of new chapters yet.
- Duplicates across servers are recognised by title only.
- Two devices changing the same entry of a shared profile without having seen each other: one of the two is kept, the same on every device, but nothing says which was last.
- On iOS, the system decides how much storage downloads may use, and may reclaim it if the app is not on the home screen.
- The folders service reads image folders and CBZ/ZIP only (no CBR, RAR, 7z, PDF), and a folders-only installation has no profile management.
- No paged (right-to-left) reading: Scrollarr is deliberately a vertical reader.
- Planned, not available: connectors for other servers (Kavita...), iOS and Android apps, a double-page mode for tablets. See the [roadmap](docs/ROADMAP.md).

## Licence

MIT, see [LICENSE](LICENSE). The Big Shoulders Display typeface is distributed under the SIL OFL 1.1 (`app/fonts/OFL.txt`).
