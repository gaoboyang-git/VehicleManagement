import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

const rootDir = path.resolve(import.meta.dirname, "../..");

function run(command, args, databaseUrl) {
  execFileSync(command, args, {
    cwd: rootDir,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl
    },
    stdio: "pipe"
  });
}

describe("Issue 0 database initialization", () => {
  it(
    "creates the users table through migration and seeds exactly one builtin admin",
    async () => {
      const tempDir = mkdtempSync(path.join(tmpdir(), "vehicle-db-"));
      const databaseUrl = `file:${path.join(tempDir, "issue0.db")}`;

      try {
        run("npx", ["prisma", "migrate", "deploy"], databaseUrl);
        run("npx", ["prisma", "db", "seed"], databaseUrl);
        run("npx", ["prisma", "db", "seed"], databaseUrl);

        const prisma = new PrismaClient({
          datasources: {
            db: {
              url: databaseUrl
            }
          }
        });

        const admins = await prisma.user.findMany({
          where: {
            username: "admin",
            role: "admin",
            isBuiltinAdmin: true
          }
        });

        await prisma.$disconnect();

        expect(admins).toHaveLength(1);
        expect(admins[0].passwordHash.length).toBeGreaterThan(0);
      } finally {
        rmSync(tempDir, { force: true, recursive: true });
      }
    },
    60000
  );
});

describe("Issue 6 vehicle status database defaults", () => {
  it(
    "adds a vehicle status column that defaults to available for new rows",
    async () => {
      const tempDir = mkdtempSync(path.join(tmpdir(), "vehicle-status-db-"));
      const databaseUrl = `file:${path.join(tempDir, "issue6.db")}`;

      try {
        run("npx", ["prisma", "migrate", "deploy"], databaseUrl);

        const prisma = new PrismaClient({
          datasources: {
            db: {
              url: databaseUrl
            }
          }
        });

        const vehicle = await prisma.vehicle.create({
          data: {
            vehicleCode: "CAR-001",
            plateNumber: "沪A-10001",
            brandModel: "大众帕萨特"
          }
        });

        await prisma.$disconnect();

        expect(vehicle.status).toBe("available");
      } finally {
        rmSync(tempDir, { force: true, recursive: true });
      }
    },
    60000
  );
});
