#!/usr/bin/env bash
# Test du conteneur folders (READ-002 §4.11, étapes A et B) : image construite
# (dépendances installées par « npm ci »), démarrage avec montage :ro et système de
# fichiers en lecture seule, écriture refusée, /health, refus de démarrer sans mode
# d'authentification, lecture d'une page d'archive, d'une page de dossier et d'une
# couverture dans ce conteneur durci (sans rien écrire dans /tmp ni /data), bibliothèque inchangée.
# Nécessite Docker. Lancer avec : tests/container_folders.sh
set -euo pipefail
cd "$(dirname "$0")/.."

work=$(mktemp -d)
name="scrollarr-folders-test-$$"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT

fingerprint() { (cd "$1" && find . -printf '%p %s %T@ %i\n' | sort && find . -type f -exec sha256sum {} + | sort -k2) | sha256sum; }
check() { if "${@:2}"; then echo "PASS $1"; else echo "FAIL $1"; exit 1; fi; }

node dev/make-folders-fixture.mjs "$work/fixture" >/dev/null
lib="$work/fixture/libraries/Scans"
mkdir -p "$work/data"
before=$(fingerprint "$lib")

docker build -t scrollarr-folders:test folders >/dev/null
echo "PASS image built"

# 1. Sans FOLDERS_AUTH : le conteneur s'arrête avec un code non nul.
refuse() { ! docker run --rm --user "$(id -u):$(id -g)" -v "$lib:/libraries/Scans:ro" -v "$work/data:/data" scrollarr-folders:test >/dev/null 2>&1; }
check "refuses to start without FOLDERS_AUTH" refuse

# 2. Démarrage durci, comme dans docker-compose.yml.
docker run -d --name "$name" --user "$(id -u):$(id -g)" --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --memory 256m --pids-limit 64 --tmpfs /tmp \
  -e FOLDERS_AUTH=password -e FOLDERS_USER=essai -e FOLDERS_PASSWORD=mot-de-passe-d-essai \
  -v "$lib:/libraries/Scans:ro" -v "$work/data:/data" scrollarr-folders:test >/dev/null

inside() { docker exec "$name" node -e "$1"; }
for _ in $(seq 1 30); do inside "fetch('http://127.0.0.1:8788/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" 2>/dev/null && break; sleep 1; done

health() { inside "fetch('http://127.0.0.1:8788/health').then(r=>r.json()).then(j=>process.exit(JSON.stringify(j)==='{\"ok\":true}'?0:1))"; }
check "/health answers only ok" health
status() { docker exec "$name" node --input-type=module -e "
const base = 'http://127.0.0.1:8788', h = { 'Content-Type': 'application/json', 'X-Requested-With': 'check' };
const anon = await fetch(base + '/api/v1/status');
const login = await fetch(base + '/api/v1/login', { method: 'POST', headers: h, body: JSON.stringify({ username: 'essai', password: 'mot-de-passe-d-essai' }) });
const res = await fetch(base + '/api/v1/status', { headers: { Cookie: login.headers.get('set-cookie').split(';')[0] } });
const j = await res.json();
process.exit(anon.status === 401 && j.auth === 'password' && j.libraries[0].name === 'Scans' && j.libraries[0].state === 'ok' ? 0 : 1);
"; }
check "/api/v1/status needs a session, shows password mode and library ok" status
unauth() { inside "fetch('http://127.0.0.1:8788/api/v1/libraries').then(r=>process.exit(r.status===401?0:1))"; }
check "/api/v1/libraries refused without a session" unauth

# 3. Écritures refusées : bibliothèque (:ro), code de l'image (read_only), racine.
check "write to the library is refused" bash -c "! docker exec '$name' sh -c 'touch /libraries/Scans/intrus' 2>/dev/null"
check "write to the image is refused" bash -c "! docker exec '$name' sh -c 'touch /app/intrus' 2>/dev/null"
check "write to / is refused" bash -c "! docker exec '$name' sh -c 'touch /intrus' 2>/dev/null"
check "data volume is writable" docker exec "$name" sh -c 'test -s /data/secret.key'
check "runs as the requested non-root user" bash -c "[ \"\$(docker exec '$name' id -u)\" = '$(id -u)' ] && [ '$(id -u)' != 0 ]"

# 4. Lecture dans le conteneur durci : le module de lecture des archives est bien installé et rien n'est écrit.
reading() { docker exec "$name" node --input-type=module -e "
const base = 'http://127.0.0.1:8788', h = { 'Content-Type': 'application/json', 'X-Requested-With': 'check' };
const login = await fetch(base + '/api/v1/login', { method: 'POST', headers: h, body: JSON.stringify({ username: 'essai', password: 'mot-de-passe-d-essai' }) });
const cookie = login.headers.get('set-cookie').split(';')[0];
const api = (p, x = {}) => fetch(base + p, { headers: { Cookie: cookie, ...x } });
const find = async (n) => (await (await api('/api/v1/series?search=' + encodeURIComponent(n))).json()).content.find((s) => s.name === n);
const books = async (s) => (await (await api('/api/v1/series/' + s.id + '/books')).json()).content;
const check = (ok, what) => { if (!ok) { console.error('FAIL ' + what); process.exit(1); } };
const alpha = await find('Alpha Quest'), beta = await find('Beta Folders');
const archive = (await books(alpha))[0], folder = (await books(beta))[0];
for (const [label, book] of [['archive', archive], ['folder', folder]]) {
  const page = await api('/api/v1/books/' + book.id + '/pages/1');
  check(page.status === 200 && page.headers.get('content-type') === 'image/png' && (await page.arrayBuffer()).byteLength > 0, label + ' page');
  const again = await api('/api/v1/books/' + book.id + '/pages/1', { 'If-None-Match': page.headers.get('etag') });
  check(again.status === 304, label + ' revalidation');
}
check((await api('/api/v1/series/' + alpha.id + '/thumbnail')).status === 200, 'series cover');
check((await api('/api/v1/books/' + archive.id + '/pages/99')).status === 404, 'page out of range');
"; }
check "reads an archive page, a folder page, a cover and revalidates (304)" reading
check "nothing written to /tmp" docker exec "$name" sh -c 'test -z "$(ls -A /tmp)"'
check "only secret.key and libraries.json in /data" bash -c "[ \"\$(docker exec '$name' ls -A /data | grep -v -x -e secret.key -e libraries.json | wc -l)\" = 0 ]"

# 5. La bibliothèque n'a pas bougé.
check "library fingerprint unchanged" test "$before" = "$(fingerprint "$lib")"
echo "ALL PASS"
