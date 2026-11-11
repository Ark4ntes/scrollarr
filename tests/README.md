# Tests

Two kinds of checks, both run in CI (`.github/workflows/ci.yml`).

## Static checks (a few seconds)

```sh
tests/check_syntax.sh
```

Runs `node --check` on `app/js/**`, `app/sw.js`, `dev/**`, `notifier/server.js` and `folders/*.js`, then parses every GraphQL query of the Suwayomi connector. The `graphql` package is installed in `tests/graphql/` only (the repo root has no `package.json`). Requires Node 22 and network access for `npm install`.

## End-to-end tests (~4 minutes for both scripts)

Headless browser tests (Playwright for Python) that start the demo server (`node dev/mock-servers.mjs`) on ports 8391-8397 and 8411-8412 and drive the app.

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install -r tests/requirements.txt
python -m playwright install chromium     # add --with-deps on a fresh Linux box

python tests/e2e_servers.py     # servers, merged library, auth modes, offline (~100 s)
python tests/e2e_profiles.py    # reading profiles (~2.5 min)
python tests/e2e_merge.py       # two devices on the same profile, server test button (~30 s)
python tests/e2e_sync.py        # same-revision ties, skewed clocks, change during a slow write, subscriptions (~1.5 min)
node tests/unit_sync.mjs        # merge rules alone, no browser (instant)
node tests/unit_contracts.mjs   # reader and collector contracts (instant)
node tests/unit_tasks.mjs       # common task model (instant)
node tests/unit_folders_naming.mjs   # folders service: naming, natural sort, chapter numbers (instant)
node tests/unit_folders_ids.mjs      # folders service: identifiers, path confinement (instant)
node tests/unit_folders_config.mjs   # folders service: every invalid configuration refuses to start (~2 s)
node tests/unit_folders_auth.mjs     # folders service: password/none modes, sessions, attempt limit, cross-origin guards (~3 s)
node tests/unit_folders_library.mjs  # folders service: index, invalidation, unavailable libraries (~1 s)
node tests/integration_folders.mjs   # folders service started on a generated library, structure walked over HTTP (~1 s)
tests/container_folders.sh           # folders image with read-only mounts (needs Docker)
python3 tests/nginx_headers.py # security headers on every nginx location, template rendered and run locally (needs nginx, curl; ~3 s)
node tests/unit_profiles.mjs    # profile sync: independent documents, list merge (~8 s)
node tests/unit_store.mjs       # subscriptions: a 404 must be seen twice, 24 h apart, before deleting (instant)
node tests/unit_facade.mjs      # facade with test-only readers, e.g. one without progress.write (instant)
python tests/e2e_progress.py    # a reader that does not declare progress.write: no menu action, no request (~30 s)
python tests/e2e_offline.py     # downloaded chapters when the server hangs, is refused by a proxy, or there is no network (~40 s)
python tests/e2e_tasks.py       # collector tasks: progress, failure, cancellation, history (~40 s)
```

Each script prints `PASS`/`FAIL` lines, then `ALL PASS` or `SOME FAILED`. The exit status is 0 only if every check passed and no exception occurred; demo servers are always stopped.

| Variable | Effect |
| --- | --- |
| `CHROME_PATH` | Use this Chrome/Chromium executable instead of Playwright's bundled Chromium. |
| `SHOTS_DIR` | Save screenshots to this directory (created if needed). No screenshots when unset. |

Make sure ports 8391-8397 and 8411-8412 are free before running (a stale demo server makes checks fail).
