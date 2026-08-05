import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { createTestDatabase, runPrisma } from "../../test-support/mysqlTestDb.js";

async function createUser(prisma, { username, password, role, isBuiltinAdmin = false, fullName = username }) {
  return prisma.user.create({
    data: {
      username,
      fullName,
      passwordHash: await bcrypt.hash(password, 10),
      role,
      isBuiltinAdmin
    }
  });
}

describe("Issue 6 operation log API", () => {
  let testDatabase;
  let prisma;
  let app;

  beforeAll(() => {
    testDatabase = createTestDatabase("vehicle_operation_logs");
    runPrisma(["migrate", "deploy"], testDatabase.databaseUrl);
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: testDatabase.databaseUrl
        }
      }
    });
    app = createApp({ prisma });
  }, 30000);

  beforeEach(async () => {
    await prisma.operationLog.deleteMany();
    await prisma.session.deleteMany();
    await prisma.vehicleUseRecord.deleteMany();
    await prisma.vehicle.deleteMany();
    await prisma.user.deleteMany();

    const admin = await createUser(prisma, {
      username: "admin",
      password: "admin",
      role: "admin",
      isBuiltinAdmin: true,
      fullName: "系统管理员"
    });
    const manager = await createUser(prisma, {
      username: "manager",
      password: "Manager001",
      role: "admin",
      fullName: "车队管理员"
    });
    await createUser(prisma, {
      username: "employee",
      password: "Employee001",
      role: "employee",
      fullName: "普通员工"
    });

    await prisma.operationLog.createMany({
      data: [
        {
          module: "vehicle",
          bizType: "vehicle",
          bizId: "CAR-001",
          action: "create",
          operatorUserId: admin.id,
          requestPath: "/api/vehicles",
          requestMethod: "POST",
          requestIp: "127.0.0.1",
          afterData: {
            vehicleCode: "CAR-001"
          },
          resultStatus: "success",
          operatedAt: new Date("2026-08-03T09:00:00.000Z")
        },
        {
          module: "user",
          bizType: "user",
          bizId: manager.id,
          action: "delete",
          operatorUserId: manager.id,
          requestPath: `/api/users/${manager.id}`,
          requestMethod: "DELETE",
          requestIp: "127.0.0.2",
          beforeData: {
            username: "manager"
          },
          resultStatus: "failed",
          errorMessage: "不能删除当前登录管理员账号",
          operatedAt: new Date("2026-08-04T09:30:00.000Z")
        },
        {
          module: "auth",
          bizType: "session",
          bizId: null,
          action: "login",
          operatorUserId: null,
          requestPath: "/api/login",
          requestMethod: "POST",
          requestIp: "127.0.0.3",
          afterData: {
            username: "missing"
          },
          resultStatus: "failed",
          errorMessage: "账号或密码错误",
          operatedAt: new Date("2026-08-05T01:00:00.000Z")
        }
      ]
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    testDatabase?.cleanup();
  });

  async function adminAgent() {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "admin", password: "admin" }).expect(200);
    return agent;
  }

  async function employeeAgent() {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "employee", password: "Employee001" }).expect(200);
    return agent;
  }

  it("returns operation logs to administrators ordered by latest operated time", async () => {
    const agent = await adminAgent();

    const response = await agent.get("/api/operation-logs");

    expect(response.status).toBe(200);
    expect(response.body.logs).toHaveLength(4);
    const operatedAtValues = response.body.logs.map((log) => log.operatedAt);
    expect(operatedAtValues).toEqual([...operatedAtValues].sort((left, right) => right.localeCompare(left)));

    expect(response.body.logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        module: "auth",
        action: "login",
        resultStatus: "failed",
        operatorUsername: "",
        operatorName: ""
      }),
      expect.objectContaining({
        module: "user",
        action: "delete",
        operatorUsername: "manager",
        operatorName: "车队管理员",
        errorMessage: "不能删除当前登录管理员账号"
      }),
      expect.objectContaining({
        module: "vehicle",
        action: "create",
        operatorUsername: "admin",
        operatorName: "系统管理员",
        resultStatus: "success"
      })
    ]));
    expect(response.body.logs.find((log) =>
      log.module === "auth" && log.action === "login" && log.resultStatus === "success"
    )).toBeTruthy();
  });

  it("supports filtering operation logs by module, result status, operator, date, and keyword", async () => {
    const agent = await adminAgent();
    const manager = await prisma.user.findUnique({
      where: {
        username: "manager"
      }
    });

    const response = await agent.get("/api/operation-logs").query({
      module: "user",
      resultStatus: "failed",
      operatorUserId: manager.id,
      dateFrom: "2026-08-04",
      dateTo: "2026-08-04",
      keyword: "管理员账号"
    });

    expect(response.status).toBe(200);
    expect(response.body.logs).toHaveLength(1);
    expect(response.body.logs[0]).toEqual(expect.objectContaining({
      module: "user",
      action: "delete",
      operatorUsername: "manager",
      resultStatus: "failed"
    }));
  });

  it("rejects operation log reads for employees", async () => {
    const agent = await employeeAgent();

    await agent.get("/api/operation-logs").expect(403);
  });
});
