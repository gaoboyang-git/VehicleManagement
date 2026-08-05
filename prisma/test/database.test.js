import { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";

import { createTestDatabase, runPrisma } from "../../test-support/mysqlTestDb.js";

const activeDatabases = [];

afterEach(async () => {
  while (activeDatabases.length > 0) {
    const { prisma, cleanup } = activeDatabases.pop();
    await prisma?.$disconnect();
    cleanup?.();
  }
});

function createMigratedPrisma(prefix) {
  const testDatabase = createTestDatabase(prefix);
  runPrisma(["migrate", "deploy"], testDatabase.databaseUrl);

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: testDatabase.databaseUrl
      }
    }
  });

  activeDatabases.push({
    prisma,
    cleanup: testDatabase.cleanup,
    databaseUrl: testDatabase.databaseUrl
  });

  return {
    prisma,
    databaseUrl: testDatabase.databaseUrl
  };
}

describe("MySQL database initialization", () => {
  it(
    "creates the users table through migration and seeds exactly one builtin admin",
    async () => {
      const { prisma, databaseUrl } = createMigratedPrisma("prisma_seed");

      runPrisma(["db", "seed"], databaseUrl);
      runPrisma(["db", "seed"], databaseUrl);

      const admins = await prisma.user.findMany({
        where: {
          username: "admin",
          role: "admin",
          isBuiltinAdmin: true
        }
      });

      expect(admins).toHaveLength(1);
      expect(admins[0].passwordHash.length).toBeGreaterThan(0);
    },
    60000
  );

  it(
    "adds a vehicle status column that defaults to available for new rows",
    async () => {
      const { prisma } = createMigratedPrisma("prisma_vehicle_status");

      const vehicle = await prisma.vehicle.create({
        data: {
          vehicleCode: "CAR-001",
          plateNumber: "沪A-10001",
          brandModel: "大众帕萨特"
        }
      });

      expect(vehicle.status).toBe("available");
    },
    60000
  );

  it(
    "tracks the applied MySQL migration in the Prisma metadata table",
    async () => {
      const { prisma } = createMigratedPrisma("prisma_migrations");

      const appliedMigrations = await prisma.$queryRaw`
        SELECT migration_name
        FROM _prisma_migrations
        ORDER BY finished_at DESC
      `;

      expect(appliedMigrations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            migration_name: expect.stringContaining("init_mysql_core")
          })
        ])
      );
    },
    60000
  );
});
