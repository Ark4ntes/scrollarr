# Security policy

## Supported versions

Only the latest release of Scrollarr receives security fixes. Please check that you are running it before reporting a problem.

## Reporting a vulnerability

Report security vulnerabilities privately with GitHub's private vulnerability reporting: open the repository's **Security** tab and click **Report a vulnerability**.

Do not open a public issue, pull request or discussion for a vulnerability.

## Security model

Scrollarr is a static web app served together with an nginx reverse proxy. Please read the following before deploying it:

- The proxy relays the full API of each configured server (Suwayomi, Komga) under the same origin as the app.
- Scrollarr adds no authentication of its own. A Suwayomi server without authentication stays without authentication behind Scrollarr: anyone who can reach Scrollarr can read and change its library and its settings.
- Profiles are not accounts. They have no password, and anyone who can open the app can select any profile.
- Server addresses come from the installation's environment (`KOMGA_URL`, `SUWAYOMI_URL`), never from user input. The proxy therefore cannot be pointed at arbitrary hosts.
- In Suwayomi's "basic auth" and "simple login" modes, the credentials are kept in a browser cookie that the proxy converts into an `Authorization` header. This is why HTTPS is required.
- The optional notifier holds a Komga API key and, if the Suwayomi server is protected, Suwayomi credentials. They live in its environment only.
- Scrollarr has no telemetry of its own.

## Hardening advice

- Enable authentication on Suwayomi, or keep Scrollarr behind a VPN or a reverse proxy with access control.
- Always serve Scrollarr over HTTPS.
- Keep `.env` out of version control. It is listed in `.gitignore`, and it holds your server addresses and credentials.
