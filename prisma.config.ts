import "dotenv/config";

import { PrismaBetterSQLite3 } from "@prisma/adapter-better-sqlite3";
import { defineConfig } from "prisma/config";

const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";

export default defineConfig({
  experimental: {
    adapter: true
  },
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node prisma/seed.js"
  },
  engine: "js",
  adapter: async () => new PrismaBetterSQLite3({ url: databaseUrl })
});
