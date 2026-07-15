FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# сначала только зависимости — так пересборки будут мгновенными
COPY package.json ./
RUN npm install --omit=dev

# потом код
COPY server.js ./
COPY public ./public

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://localhost:3000/ >/dev/null || exit 1

CMD ["node", "server.js"]
