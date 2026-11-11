#!/usr/bin/env bash
# The images must work when the repository was fetched with restrictive file
# modes (archive extracted on a NAS, umask 077): the build copies the modes as
# they are, and the services do not run as root. Needs Docker.
set -euo pipefail
cd "$(dirname "$0")/.."
work=$(mktemp -d); name="scrollarr-perms-$$"
cleanup() { docker rm -f "$name" "$name-n" >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
fail=0
check() { if "${@:2}"; then echo "PASS $1"; else echo "FAIL $1"; fail=1; fi; }

cp -r Dockerfile app nginx notifier folders "$work/"
find "$work" -type f -exec chmod 600 {} +
find "$work" -type d -exec chmod 700 {} +

docker build -q -t scrollarr:perms "$work" >/dev/null
docker run -d --name "$name" -p 127.0.0.1:18380:80 scrollarr:perms >/dev/null
sleep 3
code() { curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:18380/$1"; }
check "main image serves the page when sources were mode 600" test "$(code index.html)" = 200
check "main image serves a script in a sub-folder" test "$(code js/connectors/index.js)" = 200
check "main image serves servers.json" test "$(code servers.json)" = 200

docker build -q -t scrollarr-notifier:perms "$work/notifier" >/dev/null
check "notifier image: its user can read the code" docker run --rm --entrypoint node scrollarr-notifier:perms -e "require('fs').readFileSync('/app/server.js')"
docker build -q -t scrollarr-folders:perms "$work/folders" >/dev/null
check "folders image: its user can read the code" docker run --rm --user 1000:1000 --entrypoint node scrollarr-folders:perms -e "require('fs').readFileSync('/app/server.js')"

[ "$fail" = 0 ] && echo "ALL PASS" || { echo "SOME FAILED"; exit 1; }
