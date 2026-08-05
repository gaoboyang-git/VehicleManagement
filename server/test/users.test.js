import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { createTestDatabase, runPrisma } from "../../test-support/mysqlTestDb.js";

async function createUser(prisma, { username, password, role, isBuiltinAdmin = false }) {
  await prisma.user.create({
    data: {
      username,
      passwordHash: await bcrypt.hash(password, 10),
      role,
      isBuiltinAdmin
    }
  });
}

async function createVehicle(prisma, { vehicleCode, plateNumber, brandModel, status = "available" }) {
  return prisma.vehicle.create({
    data: {
      vehicleCode,
      plateNumber,
      brandModel,
      status,
      isDeleted: false
    }
  });
}

async function createRecord(prisma, { vehicleId, userId }) {
  return prisma.vehicleUseRecord.create({
    data: {
      vehicleId,
      userId,
      businessDate: "2026-07-27",
      departureTime: "2026-07-27T09:00",
      returnTime: "2026-07-27T10:00",
      reason: "测试用车",
      route: "园区-政务大厅",
      startMileage: 1000,
      endMileage: 1001,
      distance: 1,
      driverName: "测试用户",
      driverSignature: "测试用户",
      remark: ""
    }
  });
}

describe("Issue 2 user management API", () => {
  let testDatabase;
  let prisma;
  let app;

  beforeAll(() => {
    testDatabase = createTestDatabase("vehicle_users");
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
    await createUser(prisma, {
      username: "admin",
      password: "admin",
      role: "admin",
      isBuiltinAdmin: true
    });
    await createUser(prisma, {
      username: "manager",
      password: "Manager001",
      role: "admin"
    });
    await createUser(prisma, {
      username: "employee",
      password: "Employee001",
      role: "employee"
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

  async function managerAgent() {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "manager", password: "Manager001" }).expect(200);
    return agent;
  }

  it("returns the full user list to an administrator", async () => {
    const agent = await adminAgent();
    const response = await agent.get("/api/users");

    expect(response.status).toBe(200);
    expect(response.body.users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ username: "admin", role: "admin", isBuiltinAdmin: true }),
        expect.objectContaining({ username: "manager", role: "admin", isBuiltinAdmin: false }),
        expect.objectContaining({ username: "employee", role: "employee", isBuiltinAdmin: false })
      ])
    );
  });

  it("rejects user management access for an employee", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "employee", password: "Employee001" }).expect(200);

    await agent.get("/api/users").expect(403);
    await agent.post("/api/users").send({
      username: "new_user",
      password: "NewUser001",
      role: "employee"
    }).expect(403);
  });

  it("creates an employee account and rejects duplicate usernames", async () => {
    const agent = await adminAgent();
    const admin = await prisma.user.findUnique({
      where: {
        username: "admin"
      }
    });

    const createResponse = await agent.post("/api/users").send({
      username: "new_employee",
      password: "123",
      role: "employee"
    });
    const duplicateResponse = await agent.post("/api/users").send({
      username: "new_employee",
      password: "Another001",
      role: "employee"
    });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.user).toEqual(expect.objectContaining({
      username: "new_employee",
      role: "employee",
      isBuiltinAdmin: false
    }));
    const storedUser = await prisma.user.findUnique({
      where: {
        username: "new_employee"
      }
    });
    expect(storedUser).toEqual(expect.objectContaining({
      createdBy: admin.id,
      updatedBy: admin.id,
      deletedAt: null,
      deletedBy: null
    }));
    expect(await prisma.operationLog.findFirst({
      where: {
        module: "user",
        bizType: "user",
        action: "create",
        bizId: createResponse.body.user.id
      }
    })).toBeTruthy();
    await request(app)
      .post("/api/login")
      .send({ username: "new_employee", password: "123" })
      .expect(200);
    expect(duplicateResponse.status).toBe(409);
    expect(duplicateResponse.body).toEqual({ message: "账号已存在" });
  });

  it("creates an administrator account", async () => {
    const agent = await adminAgent();

    const response = await agent.post("/api/users").send({
      username: "new_admin",
      password: "NewAdmin001",
      role: "admin"
    });

    expect(response.status).toBe(201);
    expect(response.body.user.role).toBe("admin");
  });

  it("rejects missing fields when creating users", async () => {
    const agent = await adminAgent();

    await agent.post("/api/users").send({ username: "", password: "x", role: "employee" }).expect(400);
    await agent.post("/api/users").send({ username: "x", password: "", role: "employee" }).expect(400);
    await agent.post("/api/users").send({ username: "x", password: "x", role: "" }).expect(400);
  });

  it("deletes a normal employee account and prevents re-login", async () => {
    const agent = await adminAgent();
    const admin = await prisma.user.findUnique({
      where: {
        username: "admin"
      }
    });
    const employee = await prisma.user.findUnique({
      where: {
        username: "employee"
      }
    });

    const deleteById = await agent.delete(`/api/users/${employee.id}`);

    expect(deleteById.status).toBe(204);
    const deletedEmployee = await prisma.user.findUnique({
      where: {
        id: employee.id
      }
    });
    expect(deletedEmployee).toEqual(expect.objectContaining({
      id: employee.id,
      deletedBy: admin.id,
      updatedBy: admin.id
    }));
    expect(deletedEmployee.deletedAt).toBeTruthy();
    expect(await prisma.operationLog.findFirst({
      where: {
        module: "user",
        bizType: "user",
        action: "delete",
        bizId: employee.id
      }
    })).toBeTruthy();
    await request(app)
      .post("/api/login")
      .send({ username: "employee", password: "Employee001" })
      .expect(401);
  });

  it("returns a clear business error when deleting a user who already has records", async () => {
    const agent = await adminAgent();
    const employee = await prisma.user.findUnique({
      where: {
        username: "employee"
      }
    });
    const vehicle = await createVehicle(prisma, {
      vehicleCode: "CAR-001",
      plateNumber: "沪A-10001",
      brandModel: "大众帕萨特"
    });

    await createRecord(prisma, {
      vehicleId: vehicle.id,
      userId: employee.id
    });

    const response = await agent.delete(`/api/users/${employee.id}`);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: "账号「employee」已有1条用车记录，暂不支持删除"
    });
    expect(await prisma.user.findUnique({ where: { username: "employee" } })).toBeTruthy();
  });

  it("rejects deleting the built-in admin account but allows deleting a non-built-in administrator", async () => {
    const agent = await adminAgent();
    const builtinAdmin = await prisma.user.findUnique({
      where: { username: "admin" }
    });
    const otherAdmin = await prisma.user.findUnique({
      where: { username: "manager" }
    });

    await agent.delete(`/api/users/${builtinAdmin.id}`).expect(400);
    await agent.delete(`/api/users/${otherAdmin.id}`).expect(204);
    await request(app)
      .post("/api/login")
      .send({ username: "manager", password: "Manager001" })
      .expect(401);
  });

  it("requires confirmation-free password reset and still blocks resetting the builtin admin itself", async () => {
    const agent = await adminAgent();
    const employee = await prisma.user.findUnique({
      where: { username: "employee" }
    });
    const manager = await prisma.user.findUnique({
      where: { username: "manager" }
    });
    const builtinAdmin = await prisma.user.findUnique({
      where: { username: "admin" }
    });

    const response = await agent.post(`/api/users/${employee.id}/reset-password`).send({
      newPassword: "123",
      confirmPassword: "123"
    });

    expect(response.status).toBe(200);
    const resetLog = await prisma.operationLog.findFirst({
      where: {
        module: "user",
        bizType: "user",
        action: "reset_password",
        bizId: employee.id
      },
      orderBy: {
        createdAt: "desc"
      }
    });
    expect(resetLog).toBeTruthy();
    expect(resetLog.afterData).toEqual(expect.objectContaining({
      sessionInvalidated: true
    }));

    await request(app)
      .post("/api/login")
      .send({ username: "employee", password: "123" })
      .expect(200);
    await request(app)
      .post("/api/login")
      .send({ username: "employee", password: "Employee001" })
      .expect(401);

    await agent.post(`/api/users/${employee.id}/reset-password`).send({
      newPassword: "ResetEmployee002",
      confirmPassword: "Different002"
    }).expect(400);

    await agent.post(`/api/users/${builtinAdmin.id}/reset-password`).send({
      newPassword: "ResetAdmin001",
      confirmPassword: "ResetAdmin001"
    }).expect(400);

    await agent.post(`/api/users/${manager.id}/reset-password`).send({
      newPassword: "ResetManager001",
      confirmPassword: "ResetManager001"
    }).expect(200);
  });

  it("allows the builtin admin to reset a non-builtin administrator password", async () => {
    const agent = await adminAgent();
    const manager = await prisma.user.findUnique({
      where: { username: "manager" }
    });

    await agent.post(`/api/users/${manager.id}/reset-password`).send({
      newPassword: "ResetManager001",
      confirmPassword: "ResetManager001"
    }).expect(200);

    await request(app)
      .post("/api/login")
      .send({ username: "manager", password: "ResetManager001" })
      .expect(200);
    await request(app)
      .post("/api/login")
      .send({ username: "manager", password: "Manager001" })
      .expect(401);
  });

  it("rejects deleting the current non-builtin administrator account", async () => {
    const agent = await managerAgent();
    const manager = await prisma.user.findUnique({
      where: { username: "manager" }
    });

    const response = await agent.delete(`/api/users/${manager.id}`);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: "不能删除当前登录管理员账号" });
    expect(await prisma.user.findUnique({ where: { username: "manager" } })).toBeTruthy();
  });
});
