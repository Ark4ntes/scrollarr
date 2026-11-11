#!/usr/bin/env bash
# Static checks: `node --check` on every JS file, then a GraphQL syntax check.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0
files=$(find app/js dev -type f \( -name '*.js' -o -name '*.mjs' \) | sort)
files="$files"$'\n'"app/sw.js"$'\n'"notifier/server.js"$'\n'"$(find folders -maxdepth 1 -name '*.js' | sort)"
count=0
for f in $files; do
  count=$((count + 1))
  if ! node --check "$f"; then fail=1; echo "SYNTAX ERROR: $f"; fi
done
echo "node --check: $count files"

# GraphQL queries (graphql is installed in tests/graphql only, not at the repo root)
npm install --prefix tests/graphql --no-audit --no-fund --silent
node tests/graphql/parse-queries.mjs || fail=1

exit $fail
