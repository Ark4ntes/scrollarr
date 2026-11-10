# Tests

Two kinds of checks, both run in CI (`.github/workflows/ci.yml`).

## Static checks (a few seconds)

```sh
tests/check_syntax.sh
```

Runs `node --check` on `app/js/**`, `app/sw.js`, `dev/**` and `notifier/server.js`, then parses every GraphQL query of the Suwayomi connector. The `graphql` package is installed in `tests/graphql/` only (the repo root has no `package.json`). Requires Node 22 and network access for `npm install`.

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
```

Each script prints `PASS`/`FAIL` lines, then `ALL PASS` or `SOME FAILED`. The exit status is 0 only if every check passed and no exception occurred; demo servers are always stopped.

| Variable | Effect |
| --- | --- |
| `CHROME_PATH` | Use this Chrome/Chromium executable instead of Playwright's bundled Chromium. |
| `SHOTS_DIR` | Save screenshots to this directory (created if needed). No screenshots when unset. |

Make sure ports 8391-8397 and 8411-8412 are free before running (a stale demo server makes checks fail).
