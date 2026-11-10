# Scrollarr

**English** · [Français](README.fr.md)

A continuous vertical reader for your self-hosted manga library: scroll through a chapter in one gesture, roll into the next one, and pick up exactly where you stopped. Installable web app (PWA), no third-party account, no telemetry. MIT licensed.

Scrollarr connects to [Suwayomi](https://github.com/Suwayomi/Suwayomi-Server), to [Komga](https://komga.org), or to both at once. Other servers can be added as connectors.

Independent project, not affiliated with Suwayomi, Komga or any commercial reading service.

| Home | Series | Reader | End of chapter |
| --- | --- | --- | --- |
| ![Home](docs/screenshots/home.png) | ![Series page](docs/screenshots/series.png) | ![Reader](docs/screenshots/reader.png) | ![End of chapter](docs/screenshots/next-chapter.png) |

| Merged library | Servers | Offline | Profiles |
| --- | --- | --- | --- |
| ![Library](docs/screenshots/library.png) | ![Servers](docs/screenshots/servers.png) | ![Offline downloads](docs/screenshots/offline.png) | ![Profiles](docs/screenshots/profiles.png) |

*Screenshots taken with the demo library shipped in `dev/`.*

## What it does

- **Vertical strip reading**: pages stacked with no gap (or with one, your choice), loaded as you approach and released once far behind, so long volumes stay light.
- **Bars that get out of the way** while you scroll and come back on tap; page slider; auto-scroll at an adjustable speed; screen kept awake.
- **Resume and progress**: the current page is saved on the server, so it is shared with its other clients (Suwayomi's web UI, Mihon, Komga's reader…). Offline, progress is queued and sent later.
- **Chaining**: a "next chapter" card at the end, with the first pages of the next chapter preloaded.
- **Home**: one-tap resume, new chapters, new series, recent updates.
- **Library**: filter by library or category, genre and reading status; sort; search.
- **Subscriptions**: follow a series and an "UP" badge flags chapters that arrived since your last visit. The list is copied to your servers so it follows you across devices.
- **Offline**: download chapters to the device and read them without a connection.
- **Push notifications** (optional service) when a chapter arrives in a series you follow.
- Light and dark themes, English and French interface.

### One server, or several

The installation declares which servers are available; each person then picks the ones they use in *Settings > Servers*.

| | Suwayomi | Komga |
| --- | --- | --- |
| What is shown | The manga in your Suwayomi library, by category | Series, by library |
| Chapters | Downloaded on the server, or read live from the source | Files on disk (CBZ, CBR, PDF) |
| Authentication | None, basic auth, simple login or UI login: detected automatically | Komga account |
| Extras | Ask the server to download chapters | On-the-fly conversion of images the browser cannot display |

With two servers active, lists are merged. When a series has the same title on both (typical case: Suwayomi downloads, Komga scans the same folder), only one is shown; the setting *When a series exists on several servers* picks which one, or shows both. Reading progress stays specific to each server.

Scrollarr does not browse Suwayomi's sources or add manga to its library: that is done in Suwayomi's own interface.

### Profiles

Several people can share one installation without sharing their history: *Settings > Profile > Manage profiles*.

- The **main** profile uses the server's own history, so it stays in sync with Suwayomi's or Komga's interface.
- Every **other profile** has its own progress and subscriptions. They are stored on the server (Suwayomi "meta", Komga "client settings") without touching the server's history, and follow the profile across devices.
- When several profiles exist, a new device asks "Who is reading?" once, then remembers.

Profiles are not accounts: there is no password and anyone can open any profile. They do not protect access to the server either (see *Security*). With Komga, separate Komga accounts already give separate, protected histories.

## How it is built

```
browser ──► nginx (scrollarr container)
              ├── /             static files of the app (app/ folder)
              ├── /suwayomi/    proxy to Suwayomi
              ├── /komga/       proxy to Komga
              ├── /servers.json servers configured on this installation
              └── /notify/      proxy to the notifier (optional)
```

The app is plain JavaScript in ES modules with no build step: what is in `app/` is what gets served. The proxy puts every server under the same origin as the app, so its session also works for loading images.

| Folder | Role |
| --- | --- |
| `app/` | The application (HTML, CSS, JS, service worker) |
| `app/js/connectors/` | Connectors, split by role: `readers/` (what you read) and `collectors/` (what fetches chapters) |
| `nginx/` | Web server and proxy configuration |
| `notifier/` | Small Node service that sends push notifications |
| `dev/` | Mock servers for development, compatibility checker |

## Installation

Requirements: Docker, at least one running server (Suwayomi or Komga), and an **HTTPS** address for Scrollarr. Over plain HTTP the app still reads, but browsers disable installation to the home screen, offline downloads and notifications.

1. Copy the repository to your machine, for example `/volume1/docker/scrollarr`.
2. Create the settings file:
   ```sh
   cp .env.example .env
   ```
   Set `SUWAYOMI_URL` and/or `KOMGA_URL` to the address of each server as seen from the container (for example `http://192.168.1.10:4567`). Leave empty the one you do not use.
3. Start it:
   ```sh
   docker compose up -d
   ```
   The app answers on port `8380` (change it with `SCROLLARR_PORT`). After editing `.env`, recreate the container with `docker compose up -d --force-recreate`.
4. Publish it over HTTPS with your reverse proxy. On a Synology NAS: *Control Panel > Login Portal > Advanced > Reverse Proxy*, source `https://scrollarr.example.com:443`, destination `http://localhost:8380`, then assign the certificate under *Security > Certificate*.
5. Open the address. If a server requires authentication, Scrollarr shows its sign-in form; otherwise you land directly on the home screen.

If a server card says it is not responding, the container cannot reach the address in `.env`: `localhost` points to the container itself, and a container name only resolves if both stacks share a Docker network (see the comment at the bottom of `docker-compose.yml`).

### Before deploying: check compatibility with your Suwayomi

From any machine on the network with Node 20 or later:

```sh
node dev/check-suwayomi.mjs http://192.168.1.10:4567
```

The script replays Scrollarr's read queries against your server and reports any it rejects. It changes nothing.

### Security

- A Suwayomi **without authentication** stays without authentication behind Scrollarr, which relays its whole API: anyone who can reach Scrollarr can read and modify the library and the server's settings. Do not expose it to the internet as is; turn on Suwayomi's authentication or keep Scrollarr behind a VPN.
- In basic auth or simple login mode, Suwayomi expects the credentials on every request. Scrollarr keeps them in a browser cookie that the proxy turns into a header, so always serve Scrollarr over HTTPS. UI login mode (renewable token) avoids keeping the password.
- Scrollarr stores no password on the server side.

### On your phone

- **iPhone / iPad**: open the address in Safari, then *Share > Add to Home Screen*. Notifications and durable storage for downloads only exist for the app installed this way.
- **Android**: Chrome offers *Install app* in its menu.

### Komga tip

Keep *Analyze page dimensions* enabled on your libraries (it is by default). Scrollarr then reserves the exact height of each page before it loads, which makes resuming precise. Suwayomi does not provide dimensions: the height is adjusted as each image arrives.

## Push notifications (optional)

1. In `.env`: set `VAPID_SUBJECT` to a contact address. For Komga, create an API key (*My account > API keys*) and put it in `KOMGA_API_KEY`. For a protected Suwayomi, set `SUWAYOMI_USER` and `SUWAYOMI_PASSWORD`.
2. Start with the `push` profile:
   ```sh
   docker compose --profile push up -d --build
   ```
3. In Scrollarr: *Settings > Notifications*, turn the option on, then *Send a test*.

The notifier polls each server every `POLL_MINUTES` minutes and sends one notification per followed series, even when several chapters arrive together. Its keys and the list of subscribed devices are kept in `data/notifier/`.

## Development

The app has no dependencies:

```sh
node dev/mock-servers.mjs
# http://localhost:8380 — Komga: demo@scrollarr.local / demo
```

The demo server imitates Suwayomi and Komga with a generated library.

| Variable | Effect |
| --- | --- |
| `SERVERS=suwayomi` | "Configure" a single server (`suwayomi`, `komga`, or both) |
| `SUWA_AUTH=none\|basic\|simple\|ui` | Authentication mode of the mock Suwayomi (credentials `demo` / `demo`) |
| `NOTIFIER=http://127.0.0.1:8787` | Relay `/notify/` to a local notifier |

`POST /suwayomi/__mock/add-chapter?manga=2` and `POST /komga/__mock/add-book?series=S004` simulate a new chapter.

Useful entry points:

- `app/js/api.js`: the facade the screens call; routes to connectors and merges lists.
- `app/js/connectors/readers/`: `komga.js` (REST), `suwayomi.js` (GraphQL). `collectors/suwayomi.js` asks Suwayomi to download chapters. Both Suwayomi modules share `suwayomi-client.js` (session, requests) and `suwayomi-queries.js`.
- `app/js/profiles.js`: profiles and their history.
- `app/js/views/reader.js`: the reader.
- `app/js/i18n.js`: translations (French strings are the keys; add a dictionary for a new language).
- `app/css/app.css`: colours and type are variables at the top of the file.

Code comments are currently in French.

### Writing a connector

A connector is a `create({ base })` function returning an object. `base` is the proxy prefix (`/myserver`). Series and chapters follow the shape of Komga's objects, which serves as the common model; ids are the server's own, the facade takes care of prefixing them.

| Member | Role |
| --- | --- |
| `id`, `code`, `label`, `userLabel` | Identifier, one-letter prefix, display name, label of the username field |
| `capabilities` | What the server can do, from the reader list in `app/js/connectors/contract.js`; the interface only offers what is declared |
| `session()`, `login(user, password)`, `logout()` | Session; `session()` throws `AuthError` when sign-in is required |
| `libraries()`, `genres()` | Library filters |
| `seriesList({ libraryId, genre, readStatus, search, sort, page, size })` | Returns `{ content, last }` |
| `seriesNew(n)`, `seriesUpdated(n)`, `series(id)`, `seriesBooks(id)` | Series, and chapters in reading order |
| `booksLatest(n)`, `booksOnDeck(n)`, `booksInProgress(n)`, `booksRecentlyRead(n)` | Rows of the home screen and of "My list" |
| `book(id)`, `bookPages(id)`, `nextBook(id)`, `previousBook(id)` | `bookPages` returns `[{ number, url, mediaType, width?, height?, fallbackUrl? }]` |
| `seriesThumb(id)`, `bookThumb(id)` | Cover URLs |
| `saveProgress(id, page, completed)`, `markBookRead/Unread(id)`, `markSeriesRead/Unread(id)` | Progress |
| `getSettings(prefix)`, `setSetting(key, value)`, `deleteSettings(keys)` | Small key-value store on the server (subscriptions, profiles) |

The contract is checked at startup by `validateReader()` in `app/js/connectors/reader-contract.js`: an incomplete connector fails loudly instead of misbehaving later.

Then register it under `READERS` in `app/js/connectors/index.js`, add its proxy and its `servers.json` entry in `nginx/default.conf.template`, and the URL patterns of its pages and covers in `app/sw.js` (offline reading).

### Writing a collector

A collector fetches chapters; it does not have to list a library or serve pages. It lives in `app/js/connectors/collectors/` and follows `collector-contract.js`, checked at startup by `validateCollector()`.

| Member | Role |
| --- | --- |
| `id`, `label` | Identifier and displayed name |
| `capabilities` | From the collector list in `contract.js` (`collect.chapters`, `collect.tasks`, `collect.cancel`) |
| `serves` | Readers whose chapter identifiers it understands (`['suwayomi']`); empty if it shares identifiers with none |
| `session` | Name of the reader whose session it reuses. Without it, the collector has its own server and provides `session()`, `login()`, `logout()` |
| `collectChapters(readerId, chapterIds)` | With `collect.chapters`: fetch chapters designated by that reader's identifiers |
| `tasks()`, `resolveTasks(nativeIds)` | With `collect.tasks`: what the collector is doing now, and what became of tasks it no longer lists |
| `cancelTask(nativeId)` | With `collect.cancel` |

Tasks from every collector are brought to one shape by `app/js/tasks.js`: identifier, collector, series and chapter, state (`queued`, `running`, `done`, `failed`, `cancelled`), progress, creation, start and end dates, error, attempts, and whether it can be cancelled. The app keeps what a collector forgets (dates, finished tasks). They are listed in Settings, under "Downloads on the server". This history is kept per device, and dates the collector does not provide are the moment the app noticed the change.

Register it under `COLLECTORS` in `app/js/connectors/index.js`. There is no way yet to start a collection from a title: a collector that works from a title search rather than a reader's identifiers (Tranga, for instance) will need a new capability, and screens to go with it.

## Project status and known limits

- **Automated checks**: full journeys (Suwayomi only, Komga only, both together, Suwayomi's four authentication modes, offline, profiles) pass in Chrome against the mock servers in `dev/`. The nginx configuration was run in front of those mocks for a basic journey (sign-in to both servers, library, reading).
- **On real servers**: used by its author with Suwayomi-Server 2.3 and Komga (reading, progress, profiles). Not yet tried on Safari iOS. `dev/check-suwayomi.mjs` lets you check compatibility with your Suwayomi version.
- Actually delivering notifications (beyond subscribing and detecting new chapters) has not been exercised.
- A Suwayomi chapter that is not downloaded is fetched from the source when opened: the first display can take several seconds and depends on the extension working.
- Duplicates across servers are matched by title only.
- Devices sharing a secondary profile are merged entry by entry (chapter progress, history, subscriptions). Each entry carries a revision number and the identifier of the device that wrote it, so the result does not depend on device clocks. When two devices change the same entry without having seen each other, one of the two is kept — the same one on every device — but nothing can tell which was really the latest.
- Subscriptions of the main profile are merged the same way; its reading progress is the server's own and follows the server's rules.
- On iOS, storage for downloads is decided by the system and may be reclaimed if the app is not installed on the home screen.
- No paged (right-to-left) reading: Scrollarr is deliberately a vertical reader.

## Roadmap

- A "folders" connector: read plain folders of images dropped on the server, without Suwayomi or Komga.
- Connectors for other servers (Kavita…).
- iOS and Android apps by wrapping this code with [Capacitor](https://capacitorjs.com); same-origin sessions will then have to become tokens, with images loaded through `fetch`.
- Browsing Suwayomi's sources and adding a manga to the library from Scrollarr.
- Double-page mode on tablets in landscape.

## License

MIT, see [LICENSE](LICENSE). The Big Shoulders Display typeface is distributed under the SIL OFL 1.1 (`app/fonts/OFL.txt`).
