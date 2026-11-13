# Connectors: what each server provides, and how to write one

**English** · [Français](../fr/connectors.md) · [Back to the README](../../README.md)

The first half is for people who run Scrollarr: what each server brings and where it stops. The second half is for developers who want to add a server ("Writing a reader", "Writing a collector").

## For users

Scrollarr talks to a server through a **connector**. There are two roles:

- A **reader** is what you read from: it gives series, chapters, pages and reading progress. Suwayomi, Komga and the folders service are readers.
- A **collector** goes and fetches chapters from their source and puts them on a server. Suwayomi is also a collector. Komga and the folders service are not.

The installation says which servers exist (the addresses in `.env`, see [Configuration](configuration.md)). Each person then picks the ones they use in *Settings > Servers*. The interface only offers what a server can do: an action a server cannot perform is hidden, not faked.

### What each server provides

What the code declares for each (a "capability" is a declared ability, listed in the developer part):

| | Suwayomi | Komga | Folders |
| --- | --- | --- | --- |
| Role | Reader and collector | Reader | Reader |
| Series, chapters, pages, search | Yes | Yes | Yes |
| Reading progress, mark read or unread | Yes, as the server's own history | Yes, as the server's own history | Yes, kept by the service in `data/folders` |
| Profiles and subscriptions shared between devices (key-value store) | Yes ("meta" entries) | Yes ("client settings") | No |
| Progress per profile kept by the server itself | No: the app stores it in the key-value store | No: same | Yes |
| Ask the server to download chapters, follow, cancel, retry | Yes | No | No |
| Search the sources by title and add a series | Yes | No | No |
| Sign-in | None, "basic auth", "simple login" or "UI login", found automatically | Komga account (email and password) | Shared user and password, or none |
| Push notifications (optional notifier) | Yes | Yes, with an API key | No |

### Suwayomi

- **Library.** The manga in your Suwayomi library. Its categories become the library filter, shown only if more than one category holds manga.
- **Chapters.** Read from the server if they are downloaded, otherwise fetched from their source when you open them. That first display can take several seconds and depends on the extension working.
- **Download menu on a series.** Next to the downloads on your device, the menu *Download* offers *Have Suwayomi download the whole series*: the chapters stay on the server and are quick to read afterwards. Their progress is in *Settings > Downloads*, where you can cancel or retry. That screen lists the server's queue and history; chapters saved on your device are in *My list > Downloads*.
- **Search the sources.** On the Search screen, under the library results, *Search the sources of Suwayomi* asks Suwayomi to search the title in the sources (extensions) you choose, three at a time. Nothing is sent to a source until you press it. Results are grouped by source with their cover and language; *Add* puts the series in your Suwayomi library, fetches its chapter list and opens its page. A title already in the library opens its page (*In the library*). A source that fails or is slow shows its own error and the others continue. Sources are chosen with *Choose sources*, kept on the device; by default those in the interface language or multilingual ones are ticked, never those Suwayomi flags 18+ (tick them yourself).
- **Limits.** The search shows the first page of results of each source. A search makes Suwayomi query third-party sites, so it can be slow or fail, and Suwayomi stores every result in its own database, as it does for its own interface. A series added a moment ago may show its author, summary and genres only after Suwayomi's updater has initialised it. Following a series or downloading new chapters automatically is not there yet. This feature is covered by tests against a mock server only; it has not been tried on a real Suwayomi.
- **Sign-in.** Scrollarr tries the four modes in turn. In "basic auth" and "simple login" the credentials travel in a cookie, so use HTTPS ([Security](security.md)).

### Komga

- **Library.** The series, by Komga library. Chapters are the files on disk (CBZ, CBR, PDF).
- **Sign-in.** A Komga account: email and password.
- **Pages.** Images the browser cannot display are converted on the fly by Komga (JPEG). If Komga's option to analyse page dimensions is on for your libraries, Scrollarr reserves the exact height of each page before it loads and resuming is precise. Suwayomi gives no dimensions: the height is adjusted as each image arrives. (The option is named in Komga's own interface; I did not check its exact label.)
- **Reading history.** Komga's own, so Komga's apps see it too. With separate Komga accounts you get separate, protected histories.

### Folders (optional service)

Plain folders of images and CBZ/ZIP archives, with neither Suwayomi nor Komga. Layout, set-up and limits: [Installation](installation.md#optional-the-folders-service) and [folders/README.md](../../folders/README.md) (French).

- It has no key-value store. With *Folders* as the only server, there is no profile management, subscriptions stay on the device that made them, there is no genre filter, and no "New chapters" or "New series" rows on the home screen (it shows *Recently updated*). There is no row suggesting the next chapter of a series in progress.
- Add Suwayomi or Komga beside it and those come back, stored by that server.
- Reading progress is kept by the service: the page reached, whether the chapter is finished, and the date, shared by all devices. Another profile has its own progress on folders series, stored under the profile's identifier.
- Two devices of one profile writing the same chapter: the last write wins (no merge by revision as with Suwayomi and Komga).

### Several servers at once

With two servers active, lists are merged. When a series has the same title on both (typical: Suwayomi downloads, Komga scans the same folder), one is shown. The setting *When a series exists on several servers* in *Settings > Servers* picks which (*Keep the one from Suwayomi*...), or shows both (*Show both*). Matching is by title only: two different series with the same title are taken for one. Reading progress stays specific to each server. The default order of priority is Suwayomi, Komga, Folders.

## Capabilities (for developers)

A connector declares a list of capabilities. The interface offers an action only if a connector declares what it needs. They are defined in `app/js/connectors/contract.js`.

| Capability | Role | Meaning |
| --- | --- | --- |
| `series.list`, `series.search`, `chapter.list`, `chapter.read` | reader | Lists, search, chapters, pages. |
| `chapter.progress.read` | reader | Reading progress is available. |
| `chapter.progress.write` | reader | Progress can be written and chapters marked read or unread (needs the progress methods below). Without it, the interface offers no such action and sends no request. |
| `chapter.progress.profiles` | reader | The server keeps each profile's progress itself (needs `chapter.progress.read` and `.write`, and `setProfile`, `forgetProfile`). |
| `settings.store` | reader | A small key-value store on the server, where profiles, subscriptions and the shared task history are kept. |
| `collect.chapters` | collector | Fetch chapters a reader already shows (`collectChapters`). |
| `collect.tasks` | collector | Report running tasks (`tasks`, `resolveTasks`). |
| `collect.cancel`, `collect.retry` | collector | Cancel, retry a task (each needs `collect.tasks`). |
| `collect.sources` | collector | List where it can search (`sources`). |
| `collect.search` | collector | Search one source by title (`search`; needs `collect.sources`). |
| `collect.add` | collector | Add a result (`add`; needs `collect.search`). |

## Writing a reader

A reader is a module in `app/js/connectors/readers/` with a function `create({ base })` that returns an object. `base` is the proxy prefix (`/myserver`). Series and chapters follow the shape of Komga's objects, which is the common model (see `readers/komga.js`, or `readers/folders.js` for a small one). Identifiers are the server's own; the facade (`app/js/api.js`) prefixes them with the reader's one-letter `code`.

| Member | Role |
| --- | --- |
| `id`, `code`, `label`, `userLabel` | Identifier, one lowercase letter used as prefix, display name, label of the user name field (a key of `app/js/i18n.js`). |
| `capabilities` | Declared abilities, from the reader list above. |
| `session()`, `login(user, password)`, `logout()` | Session. `session()` throws `AuthError` when sign-in is required. |
| `libraries()`, `genres()` | Filters of the library. |
| `seriesList({ libraryId, genre, readStatus, search, sort, page, size })` | Returns `{ content, last }`. |
| `seriesNew(n)`, `seriesUpdated(n)`, `series(id)`, `seriesBooks(id)` | Series, and chapters in reading order. |
| `booksLatest(n)`, `booksOnDeck(n)`, `booksInProgress(n)`, `booksRecentlyRead(n)` | Rows of the home screen and of *My list*. |
| `book(id)`, `bookPages(id)`, `nextBook(id)`, `previousBook(id)` | `bookPages` returns `[{ number, url, mediaType, width?, height?, fallbackUrl? }]`. |
| `seriesThumb(id)`, `bookThumb(id)` | Cover URLs. They must be same-origin paths. |
| `saveProgress(id, page, completed)`, `markBookRead(id)`, `markBookUnread(id)`, `markSeriesRead(id)`, `markSeriesUnread(id)` | Only with `chapter.progress.write`. |
| `getSettings(prefix)`, `setSetting(key, value)`, `deleteSettings(keys)` | Only with `settings.store`. |
| `setProfile(id)`, `forgetProfile(id)` | Only with `chapter.progress.profiles`. The facade tells the reader which profile is open (`'main'` or a secondary profile's id) and does not apply its own per-profile overlay to its chapters. `forgetProfile` is called when a profile is deleted. The reader sends the profile with every progress read and write. |

`validateReader()` in `app/js/connectors/reader-contract.js` checks all this once at startup: a missing method, an unknown capability, or a `code` that is not a single lowercase letter makes the app fail loudly instead of misbehaving later.

To register a reader:

1. Add it to `READERS` in `app/js/connectors/index.js`: `{ id, path, create }`. The order of the list is the default priority for duplicate series, so put a low-priority reader last.
2. In `nginx/default.conf.template`: a `map` that turns its address variable into `"true"` or `"false"`, a `location` that proxies `/<path>/` to the address (copy the one of Komga), and its entry in the JSON of `/servers.json` (the key is the reader's `id`). Do not add an `add_header` inside the `location`: it would remove the security headers that are inherited ([Security](security.md)).
3. The address variable (for example `MYSERVER_URL`) must exist, empty by default: add it to the `ENV` line of the `Dockerfile`, to the `scrollarr` service in `docker-compose.yml` (then run `dev/make-deploy-compose.sh` to refresh `deploy/docker-compose.yml`), to `.env.example` and to [Configuration](configuration.md).
4. In `app/sw.js`: its proxy prefix in `SERVERS`, the shapes of its page and cover URLs in `isPage` and `isThumb` (so that offline reading and thumbnails work), and its file in `SHELL_FILES`.
5. Translate the strings you add in `app/js/i18n.js` (the French text is the key).

## Writing a collector

A collector fetches chapters; it does not have to list a library or serve pages. It lives in `app/js/connectors/collectors/` and follows `collector-contract.js`, checked at startup by `validateCollector()`.

| Member | Role |
| --- | --- |
| `id`, `label` | Identifier and display name. |
| `capabilities` | From the collector rows of the table above. |
| `serves` | Readers whose chapter identifiers it understands (`['suwayomi']`); empty if it shares identifiers with none. |
| `session` | Name of the reader whose session it reuses. Without it, the collector has its own server and provides `session()`, `login()`, `logout()`. |
| `collectChapters(readerId, chapterIds)` | With `collect.chapters`: fetch chapters designated by that reader's identifiers. Needs at least one reader in `serves`. |
| `tasks()`, `resolveTasks(nativeIds)` | With `collect.tasks`: what it is doing now, and what became of tasks it no longer lists. |
| `cancelTask(nativeId)`, `retryTask(nativeId)` | With `collect.cancel`, `collect.retry`. |
| `sources()` | With `collect.sources`: `[{ id, label, language, nsfw, icon }]`. |
| `search(sourceId, query)` | With `collect.search`: search one source by title, returns `{ results, more }`. |
| `add(resultId)` | With `collect.add`: add or follow a result, returns `{ reader, seriesId, complete }`. |

Tasks from every collector are brought to one shape by `app/js/tasks.js`: identifier, collector, series and chapter, state (`queued`, `running`, `done`, `failed`, `cancelled`), progress, creation, start and end dates, error, attempts, and whether it can be cancelled. The app keeps what a collector forgets (dates, finished tasks). *Settings* shows a summary; the detail is on the *Downloads* screen opened from there (running, queue, errors, history, with the cancel and retry each collector supports). The history of finished tasks is shared between devices as one document for the whole installation (not per profile) in the servers' key-value store, merged by task id; *Clear history* leaves markers the other devices respect. Running tasks are not shared: each device asks the collector. Without a server that has the store, the history stays per device.

Searching from a title takes the three search capabilities, each needing the one before. The shapes are documented at the top of `collector-contract.js`, where `normalizeSource`, `normalizeResult`, `normalizeSearch` and `normalizeAdded` check them:

- A **source** is `{ id, label, language, nsfw, icon }`. `nsfw` is the server's own flag. The app does not search such sources unless the user picks them.
- A **result** is `{ id, title, cover, sourceId, sourceLabel, language, inLibrary, reader, seriesId }`. `id` is native to the collector and opaque to the app, which hands it back to `add()`. `cover` and a source `icon` are same-origin paths (through the proxy), never external URLs: the content security policy allows no external image. `reader` and `seriesId` name the matching series of a reader the collector serves, both or neither, and only when `inLibrary`.
- `add()` returns `{ reader, seriesId, complete }`: the series that now exists in the reader, and `complete: false` if it was added but its chapter list could not be fetched yet.
- A collector that shares no identifiers with any reader (Tranga, Mangarr) declares an empty `serves` and returns `reader: null, seriesId: null`. It may still say `inLibrary: true`, but the app then offers no link.
- A search hits third-party sites: the app only runs one on an explicit user action, one source at a time with bounded parallelism (3), and a failing source never fails the others. `search()` throws for that source alone.

Register it in `COLLECTORS` in `app/js/connectors/index.js`: `{ id, path, create }`, where `path` is the proxy prefix (a collector that shares a reader's server reuses its own).

## Tests

- `node tests/unit_contracts.mjs`: the reader and collector contracts, including the cases above.
- `node tests/unit_facade.mjs`: the facade with test-only readers (with and without progress, with per-profile progress).
- `node tests/unit_collect.mjs`: the Suwayomi collector against a stubbed `fetch`, with the exact operations sent.
- `python3 tests/nginx_headers.py`: the security headers on every nginx location (needs `nginx` and `curl`).
- The end-to-end scripts in `tests/` drive the app against the mock servers of `dev/` ([Development](development.md)).

The complete list is in [tests/README.md](../../tests/README.md).
