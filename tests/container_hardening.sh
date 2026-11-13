#!/usr/bin/env bash
# Durcissement des conteneurs principal et notifier (SEC-002) : construit les images et les lance
# avec EXACTEMENT les options de docker-compose.yml (lues dans « docker compose config », jamais
# recopiées ici). Trois scénarios, un par étape de la CI, pour qu'un échec soit attribuable :
#   main      le conteneur principal démarre durci et sert la page ;
#   proxy     le conteneur principal durci relaie une requête vers un amont jetable ;
#   notifier  le notifier démarre durci, répond sur /health et /vapid et écrit son volume /data.
# Sans argument : les trois. Nécessite Docker et python3.
# Lancer avec : tests/container_hardening.sh [main|proxy|notifier]
set -euo pipefail
cd "$(dirname "$0")/.."

scenarios=("$@"); [ ${#scenarios[@]} -gt 0 ] || scenarios=(main proxy notifier)
work=$(mktemp -d)
tag="$$"
net="scrollarr-hardening-$tag"
cleanup() { docker rm -f "sh-main-$tag" "sh-proxy-$tag" "sh-notifier-$tag" "sh-up-$tag" >/dev/null 2>&1 || true; docker network rm "$net" >/dev/null 2>&1 || true; docker rmi "scrollarr:hardening-$tag" "scrollarr-notifier:hardening-$tag" >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
# En cas d'échec, l'état et la fin des journaux des conteneurs partent dans une annotation GitHub
# (« ::error:: ») : c'est la seule trace lisible sans accès aux journaux de la CI.
diag() {
  for c in "sh-main-$tag" "sh-proxy-$tag" "sh-notifier-$tag"; do
    docker inspect "$c" >/dev/null 2>&1 || continue
    printf '%s [%s] ' "$c" "$(docker inspect -f '{{.State.Status}} exit={{.State.ExitCode}}' "$c" 2>&1)"
    docker logs --tail 6 "$c" 2>&1 | tr '\n' '|' | cut -c1-900
  done
}
check() { if "${@:2}"; then echo "PASS $1"; else echo "FAIL $1"; echo "::error title=container_hardening::FAIL $1 -- $(diag | tr -d '\r' | tr '\n' ' ')"; exit 1; fi; }

# Options Compose d'un service, converties en arguments « docker run » (un par ligne, protégés par shlex).
# Refuse un fichier Compose qui n'a plus les options attendues : le test ne doit pas passer à vide.
opts() {
  docker compose --profile push --profile folders config --format json | python3 -c '
import json, shlex, sys
svc = json.load(sys.stdin)["services"][sys.argv[1]]
expect_ro = sys.argv[1] == "notifier"
out = []
for o in svc.get("security_opt", []): out += ["--security-opt", o]
for c in svc.get("cap_drop", []): out += ["--cap-drop", c]
for c in svc.get("cap_add", []): out += ["--cap-add", c]
if svc.get("read_only"): out += ["--read-only"]
for t in svc.get("tmpfs", []): out += ["--tmpfs", t]
if svc.get("user"): out += ["--user", str(svc["user"])]
if "no-new-privileges:true" not in svc.get("security_opt", []) or svc.get("cap_drop") != ["ALL"] or (expect_ro and not svc.get("read_only")):
    sys.exit("docker-compose.yml : options de durcissement manquantes pour " + sys.argv[1])
print(shlex.join(out))
' "$1"
}
envs() { # variables d'environnement du service, valeurs de Compose (SUWAYOMI_URL peut être remplacée par $2)
  docker compose --profile push --profile folders config --format json | python3 -c '
import json, shlex, sys
env = dict(json.load(sys.stdin)["services"][sys.argv[1]].get("environment", {}))
if len(sys.argv) > 2: env["SUWAYOMI_URL"] = sys.argv[2]
print(shlex.join(a for k, v in env.items() for a in ("-e", f"{k}={v}")))
' "$@"
}
wait_for() { for _ in $(seq 1 30); do "$@" >/dev/null 2>&1 && return 0; sleep 1; done; return 1; }

docker network create "$net" >/dev/null

build_main() {
  docker build -t "scrollarr:hardening-$tag" . >/dev/null
  echo "PASS main image built"
}

# Le conteneur principal avec les options de Compose ; $1 = nom, le reste = arguments supplémentaires de « docker run ».
run_main() {
  local name="$1"; shift
  eval "docker run -d --name '$name' --network '$net' $(opts scrollarr) $(envs scrollarr "${UPSTREAM:-}") \"\$@\" 'scrollarr:hardening-$tag'" >/dev/null
}

for scenario in "${scenarios[@]}"; do
  case "$scenario" in
    main)
      build_main
      run_main "sh-main-$tag" -p 127.0.0.1:18382:80
      page() { curl -fs -m 3 http://127.0.0.1:18382/ | grep -q '<title>'; }
      check "main container starts with the hardening options and serves the page" wait_for page
      check "main container serves a script and servers.json" bash -c "curl -fs -m 3 -o /dev/null http://127.0.0.1:18382/js/config.js && curl -fs -m 3 http://127.0.0.1:18382/servers.json | grep -q suwayomi"
      check "nginx workers run as the nginx user (privileges dropped)" bash -c "docker exec 'sh-main-$tag' ps -o user,args | grep 'nginx: worker' | grep -q '^nginx'"
      # Docker peut renvoyer les capacités avec ou sans préfixe « CAP_ » et dans un autre ordre : on compare des ensembles.
      caps_ok() { docker inspect "sh-main-$tag" | python3 -c '
import json, sys
h = json.load(sys.stdin)[0]["HostConfig"]
norm = lambda xs: {x.upper().removeprefix("CAP_") for x in (xs or [])}
ok = any("no-new-privileges" in o for o in (h.get("SecurityOpt") or [])) and norm(h.get("CapDrop")) == {"ALL"} and norm(h.get("CapAdd")) == {"CHOWN", "SETGID", "SETUID", "NET_BIND_SERVICE"}
sys.exit(0 if ok else 1)'; }
      check "no new privileges, capabilities limited to the Compose set" caps_ok
      check "the image's health check command succeeds in the hardened container" docker exec "sh-main-$tag" wget -q -O /dev/null http://127.0.0.1/servers.json
      ;;
    proxy)
      build_main
      # Amont jetable : répond « upstream-ok » et recopie le chemin reçu.
      docker run -d --name "sh-up-$tag" --network "$net" --network-alias up node:22-alpine node -e "
require('http').createServer((q, r) => { r.setHeader('Content-Type', 'application/json'); r.end(JSON.stringify({ upstream: 'ok', path: q.url })); }).listen(9000)" >/dev/null
      up() { docker exec "sh-up-$tag" node -e "fetch('http://127.0.0.1:9000/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"; }
      wait_for up
      UPSTREAM=http://up:9000 run_main "sh-proxy-$tag" -p 127.0.0.1:18383:80
      proxied() { curl -fs -m 3 http://127.0.0.1:18383/suwayomi/api/essai | grep -q '"upstream":"ok"'; }
      check "hardened main container proxies a request to the upstream" wait_for proxied
      check "the proxied path reaches the upstream without the prefix" bash -c "curl -fs -m 3 http://127.0.0.1:18383/suwayomi/api/essai | grep -q '\"path\":\"/api/essai\"'"
      ;;
    notifier)
      docker build -t "scrollarr-notifier:hardening-$tag" notifier >/dev/null
      echo "PASS notifier image built"
      mkdir -p "$work/notifier-data"; chmod 777 "$work/notifier-data"   # l'utilisateur « node » (1000) doit pouvoir y écrire
      eval "docker run -d --name 'sh-notifier-$tag' --network '$net' $(opts notifier) $(envs notifier http://up.invalid:9000) -v '$work/notifier-data:/data' 'scrollarr-notifier:hardening-$tag'" >/dev/null
      inside() { docker exec "sh-notifier-$tag" node -e "$1"; }
      health() { inside "fetch('http://127.0.0.1:8787/health').then(r=>r.json()).then(j=>process.exit(j.ok===true?0:1),()=>process.exit(1))"; }
      check "notifier starts with the hardening options and answers /health" wait_for health
      vapid() { inside "fetch('http://127.0.0.1:8787/vapid').then(r=>r.json()).then(j=>process.exit(typeof j.publicKey==='string'&&j.publicKey.length>20?0:1),()=>process.exit(1))"; }
      check "notifier answers /vapid with a public key" vapid
      check "notifier wrote its keys to the data volume" bash -c "ls '$work/notifier-data' | grep -q ."
      check "root filesystem is read-only (write outside /data and /tmp refused)" bash -c "! docker exec 'sh-notifier-$tag' sh -c 'touch /app/intrus' 2>/dev/null"
      check "/tmp is writable (tmpfs)" docker exec "sh-notifier-$tag" sh -c 'touch /tmp/ok'
      check "runs as the non-root node user" bash -c "[ \"\$(docker exec 'sh-notifier-$tag' id -u)\" != 0 ]"
      ;;
    *) echo "scénario inconnu : $scenario" >&2; exit 2 ;;
  esac
done
echo "ALL PASS"
