import Prisma from "@prisma/client";
import config from "config";
const prisma = new Prisma.PrismaClient({
  datasources: {
    db: {
      url: config.get<string>("database.connectionString"),
    },
  },
});

async function main() {
  await prisma.client.createMany({
    data: [
      {
        clientId: "testing_public",
        contactInfo: "Application Owner",
        desc: "Public testing client",
        redirectUris: [
          "http://localhost:80",
          "https://localhost:80",
          "http://localhost:8080",
          "https://localhost:8080",
        ],
        type: Prisma.ClientType.Public,
      },
      {
        clientId: "testing",
        clientSecret: "testing_secret",
        contactInfo: "Application Owner",
        desc: "Confidential testing client",
        redirectUris: [
          "http://localhost:80",
          "https://localhost:80",
          "http://localhost:8080",
          "https://localhost:8080",
        ],
        type: Prisma.ClientType.Confidential,
      },
    ]
  });
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
