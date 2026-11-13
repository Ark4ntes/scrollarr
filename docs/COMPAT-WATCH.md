# Upstream compatibility watch (COMPAT-001)

Weekly review of the software Scrollarr depends on. It answers one question: *does a new release break something Scrollarr does?* The README's "Supported server versions" table is only updated when the answer is no.

## State (updated by each review)

| Component | Last reviewed version | Reviewed on | Result |
| --- | --- | --- | --- |
| Suwayomi-Server | v2.4.2366 (30 Sep 2026) | 2026-11-13 | no regression found |
| Komga | 1.29.2 (28 Oct 2026) | 2026-11-13 | no regression found |

Watched dependencies (see "Contexts" below to keep this list current):

| Component | Pinned in | Current pin |
| --- | --- | --- |
| nginx base image | `Dockerfile` | `nginx:1.27-alpine` |
| Node base image (notifier, folders) | `notifier/Dockerfile`, `folders/Dockerfile` | `node:22-alpine` |
| `web-push` | `notifier/package.json` | `^3.6.7` |
| `yauzl` | `folders/package.json` | `3.4.0` |

## How a review runs

1. **Releases.** List the releases published since the last reviewed version of each component (Suwayomi-Server, Komga, then the dependencies above).
2. **Release notes.** Look for breaking changes, API changes (GraphQL schema, REST, authentication, error format), Docker image changes, deprecations.
3. **Calls.** Check the calls Scrollarr makes against the server sources at the new tag:
   - Suwayomi: every operation in `app/js/connectors/suwayomi-queries.js` still exists in the GraphQL schema with the same arguments and fields.
   - Komga: every endpoint used by `app/js/connectors/readers/komga.js` (`/api/v1/...`, `/api/v2/users/me`) still exists with the same method; `/api/v3` is not used, so changes limited to it do not matter.
4. **Repository checks.** Run the unit tests (`tests/check_syntax.sh` and the `node tests/unit_*.mjs` scripts listed in `tests/README.md`).
5. **Contexts.** Look for anything the project started to depend on since the last review (below) and add it to the tables above.
6. **Decision.**
   - **No regression**: update the state table and the README tables (English and French), open a pull request. Nothing is merged without the maintainer.
   - **Potential regression**: do not touch the README claims. Open a pull request containing only a remediation plan in `docs/remediation/<component>-<version>.md` (what breaks, how sure we are, options, recommended fix, test to run, rollback), and alert the maintainer. The plan is applied only after the maintainer approves it.
   - **Nothing new**: no pull request; only add newly discovered contexts if there are any.

A review is static (release notes, sources, tests against the mock servers in `dev/`). It does not replace `node dev/check-suwayomi.mjs <url>` against a real Suwayomi.

## Contexts

Where to look for components that were added since the last review:

- images in `docker-compose.yml`, `deploy/docker-compose.yml`, the three `Dockerfile`s;
- `package.json` files (`notifier/`, `folders/`, `tests/graphql/`) and `tests/requirements.txt`;
- connectors in `app/js/connectors/` (readers and collectors): a new connector means a new server to watch;
- GitHub Actions in `.github/workflows/` and the versions of the actions they use;
- external services named in the README (reverse proxies, push services).

## Review log

| Date | Components | Result |
| --- | --- | --- |
| 2026-11-13 | Suwayomi-Server v2.4.2366, Komga 1.29.2 | Calls checked: Suwayomi operations unchanged since 2.0.1727 (README), Komga endpoints present in 1.29.2 sources. Komga 1.29.0 changed the error format of `/api/v3` only (RFC 9457); Scrollarr uses `/api/v1` and `/api/v2` and reads errors by HTTP status. Suwayomi 2.3.2238 returns partial results for Manga/Chapters queries: Scrollarr treats any GraphQL `errors` as a failure, which is the same behaviour as before. No regression found. |
