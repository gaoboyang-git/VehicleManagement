import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "..");

function resolveAdminDatabaseUrl() {
  return new URL(
    process.env.TEST_MYSQL_ADMIN_URL ?? "mysql://root@127.0.0.1:3306/mysql"
  );
}

function buildMysqlCliArgs({ database } = {}) {
  const baseUrl = resolveAdminDatabaseUrl();
  const args = [
    "-h",
    baseUrl.hostname || "127.0.0.1",
    "-P",
    baseUrl.port || "3306",
    "-u",
    decodeURIComponent(baseUrl.username)
  ];

  const password = decodeURIComponent(baseUrl.password ?? "");
  if (password) {
    args.push(`-p${password}`);
  }

  if (database) {
    args.push("-D", database);
  }

  return args;
}

function runMysql(sql, { database } = {}) {
  execFileSync("mysql", [...buildMysqlCliArgs({ database }), "-e", sql], {
    cwd: rootDir,
    stdio: "pipe"
  });
}

export function runPrisma(args, databaseUrl) {
  execFileSync("npx", ["prisma", ...args], {
    cwd: rootDir,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl
    },
    stdio: "pipe"
  });
}

export function createTestDatabase(prefix) {
  const databaseName = `${prefix}_${randomUUID().replace(/-/g, "")}`
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .slice(0, 60);

  runMysql(
    `CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
  );

  const databaseUrl = resolveAdminDatabaseUrl();
  databaseUrl.pathname = `/${databaseName}`;

  return {
    databaseName,
    databaseUrl: databaseUrl.toString(),
    cleanup() {
      runMysql(`DROP DATABASE IF EXISTS \`${databaseName}\`;`);
    }
  };
}
