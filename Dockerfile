FROM alpine:3.21.3 as build

RUN apk --no-cache add --upgrade nodejs~22 npm openssl

ENV NODE_ENV=production
WORKDIR /app

COPY ["package.json", "package-lock.json", "./"]
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm install --production

COPY ["prisma", "prisma"]
RUN npm run generateDbClient

FROM alpine:3.21.3 as final

RUN apk --no-cache add --upgrade nodejs~22 openssl

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
