FROM node:22-alpine
LABEL org.opencontainers.image.title="Scrollarr notifier" \
      org.opencontainers.image.description="Optional Web Push notifier for Scrollarr (new chapters on Suwayomi and Komga)" \
      org.opencontainers.image.source="https://github.com/Ark4ntes/scrollarr" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.js ./
# Même précaution que pour l'image principale : lisible par l'utilisateur « node ».
RUN chmod -R a+rX /app
ENV DATA_DIR=/data PORT=8787
VOLUME /data
EXPOSE 8787
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server.js"]
