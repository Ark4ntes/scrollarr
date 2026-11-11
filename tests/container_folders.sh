#!/usr/bin/env bash
# Test du conteneur folders (READ-002 §4.11, étape A) : image construite, démarrage
# avec montage :ro et système de fichiers en lecture seule, écriture refusée,
# /health, refus de démarrer sans mode d'authentification, bibliothèque inchangée.
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

health() { inside "fetch('http://127.0.0.1:8788/health').then(r=>r.json()).then(j=>process.exit(j.ok&&j.auth==='password'&&j.libraries[0].name==='Scans'&&j.libraries[0].state==='ok'?0:1))"; }
check "/health answers, password mode, library ok" health
unauth() { inside "fetch('http://127.0.0.1:8788/api/v1/libraries').then(r=>process.exit(r.status===401?0:1))"; }
check "/api/v1/libraries refused without a session" unauth

# 3. Écritures refusées : bibliothèque (:ro), code de l'image (read_only), racine.
check "write to the library is refused" bash -c "! docker exec '$name' sh -c 'touch /libraries/Scans/intrus' 2>/dev/null"
check "write to the image is refused" bash -c "! docker exec '$name' sh -c 'touch /app/intrus' 2>/dev/null"
check "write to / is refused" bash -c "! docker exec '$name' sh -c 'touch /intrus' 2>/dev/null"
check "data volume is writable" docker exec "$name" sh -c 'test -s /data/secret.key'
check "runs as the requested non-root user" bash -c "[ \"\$(docker exec '$name' id -u)\" = '$(id -u)' ] && [ '$(id -u)' != 0 ]"

# 4. La bibliothèque n'a pas bougé.
check "library fingerprint unchanged" test "$before" = "$(fingerprint "$lib")"
echo "ALL PASS"
