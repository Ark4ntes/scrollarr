#!/usr/bin/env bash
# Static checks: `node --check` on every JS file, a YAML parse of the workflows, then a GraphQL syntax check.
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

# Workflows : un fichier YAML invalide (par exemple un « : » dans un nom d'étape non guillemeté) empêche toute exécution de la CI.
# Ruby est livré avec l'image ubuntu-latest de GitHub et lit le YAML sans dépendance ; PyYAML sert de repli.
workflows=$(find .github/workflows -type f \( -name '*.yml' -o -name '*.yaml' \) | sort)
if command -v ruby >/dev/null 2>&1; then
  ruby -ryaml -e 'bad = 0; ARGV.each { |f| begin; YAML.safe_load(File.read(f), aliases: true); rescue Psych::Exception => e; bad = 1; puts "YAML ERROR: #{f}: #{e.message}"; end }; exit bad' $workflows || fail=1
elif python3 -c 'import yaml' 2>/dev/null; then
  python3 -c 'import sys, yaml
bad = 0
for f in sys.argv[1:]:
    try: yaml.safe_load(open(f))
    except yaml.YAMLError as e: bad = 1; print("YAML ERROR:", f, e)
sys.exit(bad)' $workflows || fail=1
else
  echo "YAML ERROR: neither ruby nor PyYAML is available to check the workflows"; fail=1
fi
echo "yaml: $(echo "$workflows" | wc -l) workflow file(s)"

# deploy/docker-compose.yml is generated from docker-compose.yml: it must be up to date
if bash dev/make-deploy-compose.sh && git diff --quiet -- deploy/docker-compose.yml 2>/dev/null; then
  echo "deploy compose: up to date"
else
  echo "DEPLOY ERROR: deploy/docker-compose.yml differs from what dev/make-deploy-compose.sh produces; run it and commit"; fail=1
fi

# GraphQL queries (graphql is installed in tests/graphql only, not at the repo root)
npm install --prefix tests/graphql --no-audit --no-fund --silent
node tests/graphql/parse-queries.mjs || fail=1

exit $fail
