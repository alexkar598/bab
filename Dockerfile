FROM node:17-alpine

ENV NODE_ENV=production

WORKDIR /app

ARG NPM_TOKEN
COPY .npmrc.docker .npmrc
COPY ["package.json", "package-lock.json", "./"]

RUN npm install --production

COPY . .

CMD [ "npm", "start" ]