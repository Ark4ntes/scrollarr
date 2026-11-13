# Contributing to Scrollarr

Thank you for your interest in Scrollarr. This guide explains how to run the project locally and what we expect from a pull request.

## Running it locally

Scrollarr has no build step and the app has no runtime dependencies. You need Node 20 or later.

```sh
node dev/mock-servers.mjs
```

Open http://localhost:8380. The demo library imitates Suwayomi and Komga. Sign in to the demo Komga with the demo account given in docs/en/development.md; the mock Suwayomi accepts the demo credentials there when its authentication mode requires them. That page lists the other options (`SERVERS`, `SUWA_AUTH`, `NOTIFIER`).

## Code conventions

- The app is plain JavaScript in ES modules. Keep it free of build tools and of runtime dependencies.
- Code comments are currently in French, and that is accepted. New contributions may use English.
- Every user-facing string must go through `app/js/i18n.js`. The French string is the key: add the English translation next to it.
- A new server kind is added as a connector, see "Writing a reader" in docs/en/connectors.md.

## Branches and commits

Branch names follow the roadmap item they implement, where `<ID>` is an item of [docs/ROADMAP.md](docs/ROADMAP.md) such as `CONN-001`:

- `feature/<ID>-short-name`
- `fix/<ID>-short-name`
- `docs/<ID>-short-name`

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org), for example:

- `feat(connectors): define connector capability contract`
- `fix(sync): prevent silent progress overwrite`
- `test(komga): cover chapter progress`
- `docs(roadmap): update v1.1 status`

## Before opening a pull request

- [ ] The existing Komga and Suwayomi journeys still work against the demo servers.
- [ ] No secret, API key, password or `.env` file is committed.
- [ ] The documentation (README, roadmap status, connector guide) is updated when behaviour changes.
- [ ] Known limits are stated, in the pull request and in the README when they affect users.

The pull request template asks for the same points, together with the Definition of Done.

## Where to start

- [docs/ROADMAP.md](docs/ROADMAP.md) lists the planned work, with item IDs and acceptance criteria.
- The section "Writing a reader" of docs/en/connectors.md (and "Writing a collector") describes the connector contract.
- Security issues must not be reported in public: see [SECURITY.md](SECURITY.md).
