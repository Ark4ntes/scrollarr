# Security

**English** · [Français](../fr/security.md) · [Back to the README](../../README.md)

This page explains, in plain words, who can reach what once Scrollarr runs, and what you must decide before you put it on the Internet. To report a vulnerability, see the end of the page.

## The short version

- Scrollarr adds **no login of its own**. It passes requests through to your servers.
- Anyone who can open Scrollarr's address gets whatever your servers give to someone who is not signed in.
- A Suwayomi **without authentication** gives everything. Do not expose such an instance to the Internet.
- Profiles are **not accounts**: no password, and anyone can open any profile.
- Use HTTPS, and keep Scrollarr on your home network or behind a VPN unless every server behind it asks for a sign-in.

## Who can reach what

The Scrollarr container is a web server and a proxy. It serves the app, and it relays each server's whole API under its own address (`/suwayomi/`, `/komga/`, `/folders/`). The browser only ever talks to Scrollarr.

| Behind Scrollarr | Someone who reaches Scrollarr and has no account can... |
| --- | --- |
| Suwayomi without authentication | Read the library, and also change it and the server's settings, since the proxy relays the full API. |
| Suwayomi with authentication | Nothing useful without the credentials. |
| Komga | Reach Komga's own sign-in. What happens next is decided by Komga and its accounts. |
| Folders service, `password` mode | Reach the sign-in; nothing else without the shared user name and password. |
| Folders service, `none` mode | List every series and chapter name, read every page, and read or change all reading progress. Never write or delete a file, never reach a path outside the mounted libraries. |

Two consequences:

- A server's address cannot be changed by a visitor. The addresses come from the environment of the container (`SUWAYOMI_URL`, `KOMGA_URL`, `FOLDERS_URL`), never from what a user types, so the proxy cannot be pointed at other hosts.
- Putting Scrollarr on the Internet exposes the **whole** API of every server it relays, not only the app. If one of them has no authentication, that is an open door.

What to do: turn on Suwayomi's authentication, or keep Scrollarr off the Internet (local network, VPN, or a reverse proxy that restricts who can pass; see [Synology](synology.md#6-keep-it-on-the-local-network-only-access-control-profile)).

## Sign-in and HTTPS

**Suwayomi.** Its "basic auth" and "simple login" modes expect the credentials on every request, images included. Scrollarr therefore stores them in a cookie, `scrollarr_suwa_basic`, which the proxy turns into an `Authorization` header. The cookie holds the user name and password in the reversible "Basic" form (encoded, not encrypted). It is created by the page, so it is not `HttpOnly`; it is `SameSite=Strict`, limited to the app's path, lasts a year, and is marked `Secure` when the page is served over HTTPS. Serve Scrollarr over HTTPS, always. The "UI login" mode (renewable token) avoids keeping the password: Scrollarr keeps the access token in a cookie (`suwayomi-server-token`) and a refresh token in the browser's `localStorage`. Scrollarr tries the modes in turn, so you do not have to tell it which one your Suwayomi uses. *Sign out* in *Settings > Servers* deletes these.

**Komga.** The app signs in with your email and password once; Komga sets its own session cookie.

**Folders service in `password` mode.** One shared user name and password (`FOLDERS_USER`, `FOLDERS_PASSWORD`, at least 12 characters). Everything except `/health` needs a session: a signed cookie, `HttpOnly`, `SameSite=Strict`, `Secure` when the request says it came over HTTPS (`X-Forwarded-Proto: https`, which your reverse proxy must send), valid `FOLDERS_SESSION_HOURS` hours (720 by default). Changing the user name or password signs everyone out. After `FOLDERS_LOGIN_ATTEMPTS` failed sign-ins (5) in `FOLDERS_LOGIN_WINDOW_SECONDS` seconds (900), the service answers error 429. The count is per address *as the Scrollarr container sees it*; behind a reverse proxy, that is the proxy's address, so failed attempts from different people add up (this follows from the code, I have not tried it).

**Notifier.** It holds, in its environment, the Komga API key and, if Suwayomi is protected, the Suwayomi credentials. It accepts a subscription only from a caller whose own cookies are accepted by one of your servers. Its `/vapid` and `/health` answers are public.

## What a shared password does not give

The folders service's password protects **access to the service**. It does not separate people:

- Everyone who knows it sees all the scans.
- Everyone who knows it can read and change the reading progress of **every profile**, because a profile is only a name.
- Anyone who can reach Scrollarr with the service in `none` mode needs no password at all.

For separate, protected histories, use Komga with one account per person.

## The `none` mode of the folders service

You must ask for it explicitly (`FOLDERS_AUTH=none`), and the service logs a warning every time it starts. Use it only on a trusted local network or behind a VPN. The service cannot check that it is not exposed: behind a proxy, the address it sees is the proxy's. Before you expose Scrollarr beyond a trusted network, switch to `password`, over HTTPS.

## Protections of the folders service

- The scans are mounted read-only, and the service never writes to them, never extracts an archive to disk, never follows a symbolic link, and never receives a path from the client (only opaque identifiers).
- Only images are served, recognised by their first bytes (JPEG, PNG, WebP, GIF, AVIF), never by the file name. Anything else (SVG included) is refused.
- Archives are read in place, with limits on entries, sizes and compression ratio. Hostile or oversized archives are refused with a readable error.
- Requests other than `GET` must carry the header `X-Requested-With` and `Content-Type: application/json`, and a request whose `Origin` does not match the host is refused. This applies on a local network too.
- It runs with a read-only filesystem, no Linux capabilities, `no-new-privileges`, 256 MB of memory, and on an internal Docker network of its own: no port is published, only the Scrollarr container reaches it. (The main container and the notifier have no such restrictions.)

## Headers sent by Scrollarr

The main container sends these on every answer (and repeats them on `/servers.json`):

| Header | Value |
| --- | --- |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `same-origin` |
| `Content-Security-Policy` | `default-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'` |

The policy means the page loads nothing from other sites (no external image, script, font or request) and cannot be put in a frame: covers and icons go through the proxy. Scrollarr has no telemetry. `/servers.json` is sent with `Cache-Control: no-store`.

Scrollarr does not send `Strict-Transport-Security`: HTTPS is done by your reverse proxy, which is where to turn it on.

## What the app stores in the browser

| Where | What |
| --- | --- |
| `localStorage` | Settings, the profile open on the device, which servers are on, a copy of the subscriptions and profiles, recent searches, a random device identifier, offline progress waiting to be sent, the Suwayomi refresh token. |
| IndexedDB and Cache Storage | Downloaded chapters (their pages are images stored in the browser), copies of recent answers from your servers, the app files, up to 700 thumbnails. |
| Cookies | The sign-in cookies described above. |

Nothing of this leaves the device except to your own servers. Clearing the site's data erases it. Whoever uses your browser profile can read the downloaded chapters, and the Suwayomi cookie if you use that mode. Profiles do not change this.

## Hardening checklist

- Serve Scrollarr over HTTPS.
- Do not forward Scrollarr's port (8380) from your router. Publish only the HTTPS name, and restrict who can reach it if you can.
- Enable authentication on Suwayomi. Use Komga's accounts. Use `password` mode for the folders service.
- Choose a long password for the folders service.
- Keep `.env` private (`chmod 600 .env`). It holds your passwords and API keys. It is listed in `.gitignore`: never commit it.
- Keep Scrollarr up to date. Only the latest release receives security fixes ([update guide](update-backup.md)).

## Report a vulnerability

Do not open a public issue. Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. The policy is in [SECURITY.md](../../SECURITY.md).
