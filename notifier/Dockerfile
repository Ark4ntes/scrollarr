FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.js ./
ENV DATA_DIR=/data PORT=8787
VOLUME /data
EXPOSE 8787
USER node
CMD ["node", "server.js"]
