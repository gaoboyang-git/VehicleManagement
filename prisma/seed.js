import { PrismaClient } from "@prisma/client";
import { PrismaBetterSQLite3 } from "@prisma/adapter-better-sqlite3";
import bcrypt from "bcryptjs";

const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";
const prisma = new PrismaClient({
  adapter: new PrismaBetterSQLite3({ url: databaseUrl })
});

async function main() {
  const passwordHash = await bcrypt.hash("admin", 10);

  await prisma.user.upsert({
    where: {
      username: "admin"
    },
    update: {
      fullName: "管理员",
      passwordHash,
      role: "admin",
      isBuiltinAdmin: true
    },
    create: {
      username: "admin",
      fullName: "管理员",
      passwordHash,
      role: "admin",
      isBuiltinAdmin: true
    }
  });
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  });
