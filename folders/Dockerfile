FROM node:22-alpine
LABEL org.opencontainers.image.title="Scrollarr folders" \
      org.opencontainers.image.description="Optional service that lets Scrollarr browse manga folders mounted read-only (not yet connected to the app)" \
      org.opencontainers.image.source="https://github.com/Ark4ntes/scrollarr" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
# Aucune dépendance en l'état : pas de package-lock.json. Dès qu'une dépendance
# arrive (lecture des archives ZIP, étape B), ajouter le fichier de verrouillage
# et remplacer cette ligne par « RUN npm ci --omit=dev --no-audit --no-fund ».
COPY package.json ./
COPY *.js ./
ENV FOLDERS_PORT=8788
VOLUME /data
EXPOSE 8788
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.FOLDERS_PORT||8788)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server.js"]
