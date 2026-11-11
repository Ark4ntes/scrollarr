# Scrollarr : fichiers statiques servis par nginx, sans étape de build.
FROM nginx:1.27-alpine

LABEL org.opencontainers.image.title="Scrollarr" \
      org.opencontainers.image.description="Vertical manga reader PWA for self-hosted Suwayomi and Komga servers" \
      org.opencontainers.image.source="https://github.com/Ark4ntes/scrollarr" \
      org.opencontainers.image.licenses="MIT"

COPY app/ /usr/share/nginx/html/
# Le modèle est rendu au démarrage par le mécanisme « templates » de l'image officielle.
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
# Les droits des fichiers copiés sont ceux du dossier d'origine. Selon la façon dont le
# dépôt a été récupéré (archive extraite sur un NAS, umask restrictif, ACL), ils peuvent
# être illisibles pour l'utilisateur de nginx : on les rend lisibles par tous, sans écriture.
RUN chmod -R a+rX /usr/share/nginx/html /etc/nginx/templates

# Les trois variables doivent exister, même vides (vide = serveur non configuré).
ENV KOMGA_URL="" SUWAYOMI_URL="" FOLDERS_URL=""

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/servers.json || exit 1
