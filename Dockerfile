FROM node:17-alpine as build

ENV NODE_ENV=production
WORKDIR /app

COPY ["package.json", "package-lock.json", "./"]
RUN npm install --production
COPY "node_modules/@alexkar598/bab-hub" "node_modules/@alexkar598/bab-hub"

COPY ["prisma", "prisma"]
RUN npm run generateDbClient

FROM alpine:3.15 as final

RUN apk --no-cache add --upgrade nodejs~16

RUN mkdir -p /app
RUN mkdir /app/logs
WORKDIR /app

COPY --from=build /app/node_modules node_modules
COPY config config
COPY prisma prisma
COPY package.json package.json
COPY dist dist

ENV NODE_ENV=production
CMD /bin/sh -c "./node_modules/.bin/prisma migrate deploy && node dist/index.js"
