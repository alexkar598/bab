FROM node:17-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY ["package.json", "package-lock.json", "./"]

RUN npm install --production

COPY "node_modules/@alexkar598/bab-hub" "node_modules/@alexkar598/bab-hub"

COPY . .

RUN npm run generateDbClient

CMD /bin/sh -c "npx prisma migrate deploy && npm start"