import "dotenv/config";

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

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
