FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    && rm -rf /var/lib/apt/lists/*

COPY . .
RUN npm install
RUN npm run build

COPY ["prisma", "prisma"]
RUN npm run generateDbClient

FROM node:22-bookworm-slim AS final

ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /app
RUN mkdir /app/logs
WORKDIR /app

COPY ["package.json", "package-lock.json", "./"]
RUN npm install --production

COPY config config
COPY prisma prisma
COPY --from=build /app/dist dist
COPY --from=build /app/node_modules/.prisma node_modules/.prisma

CMD ["/bin/sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/index.js"]
