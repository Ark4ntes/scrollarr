#!/usr/bin/env bash
# Produit deploy/docker-compose.yml à partir de docker-compose.yml : les mêmes
# services, sans « build: », avec la version des images choisie par
# SCROLLARR_VERSION. À relancer après toute modification de docker-compose.yml
# (tests/check_syntax.sh vérifie que les deux fichiers concordent).
set -euo pipefail
cd "$(dirname "$0")/.."
{
  cat <<'HEAD'
# Scrollarr — déploiement à partir des images publiées (aucun code à copier).
# Fichier produit par dev/make-deploy-compose.sh à partir de docker-compose.yml : ne pas modifier à la main.
#
#   Installer        docker compose up -d
#   Mettre à jour    docker compose pull && docker compose up -d
#   Revenir en arrière ou figer une version : SCROLLARR_VERSION=0.9.0 dans .env (par défaut : latest)
#
HEAD
  # Les deux premières lignes du fichier d'origine sont son propre titre.
  sed -e '1,/^services:/{/^services:/!d}' \
      -e '/^[[:space:]]*build:/d' \
      -e 's#\(image: ghcr\.io/ark4ntes/[a-z-]*\):latest#\1:${SCROLLARR_VERSION:-latest}#' docker-compose.yml
} > deploy/docker-compose.yml
