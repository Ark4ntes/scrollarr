FROM node:22-alpine
LABEL org.opencontainers.image.title="Scrollarr folders" \
      org.opencontainers.image.description="Optional service that lets Scrollarr browse and read manga folders and CBZ/ZIP archives mounted read-only" \
      org.opencontainers.image.source="https://github.com/Ark4ntes/scrollarr" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
# Une seule dépendance (yauzl, lecture des archives ZIP), à la version exacte du
# package-lock.json : « npm ci » refuse de s'écarter du fichier de verrouillage.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY *.js ./
# Même précaution que pour l'image principale : lisible par l'utilisateur du service.
RUN chmod -R a+rX /app
ENV FOLDERS_PORT=8788
VOLUME /data
EXPOSE 8788
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.FOLDERS_PORT||8788)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server.js"]
