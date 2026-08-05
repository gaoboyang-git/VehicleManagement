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

async function createVehicle(prisma, { vehicleCode, plateNumber, brandModel, status = "available", isDeleted = false }) {
  return prisma.vehicle.create({
    data: {
      vehicleCode,
      plateNumber,
      brandModel,
      status,
      isDeleted
    }
  });
}

describe("Issue 3 vehicle management API", () => {
  let testDatabase;
  let prisma;
  let app;

  beforeAll(() => {
    testDatabase = createTestDatabase("vehicle_api");
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
    await prisma.vehicle.deleteMany();
    await prisma.user.deleteMany();
    await createUser(prisma, {
      username: "admin",
      password: "admin",
      role: "admin",
      isBuiltinAdmin: true
    });
    await createUser(prisma, {
      username: "employee",
      password: "Employee001",
      role: "employee"
    });
    await createVehicle(prisma, {
      vehicleCode: "CAR-001",
      plateNumber: "沪A-10001",
      brandModel: "大众帕萨特"
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

  it("returns active vehicles to an administrator ordered by vehicle code", async () => {
    await createVehicle(prisma, {
      vehicleCode: "CAR-000",
      plateNumber: "沪A-10000",
      brandModel: "别克GL8"
    });
    await createVehicle(prisma, {
      vehicleCode: "CAR-999",
      plateNumber: "沪A-10999",
      brandModel: "已删除车",
      isDeleted: true
    });
    const agent = await adminAgent();

    const response = await agent.get("/api/vehicles");

    expect(response.status).toBe(200);
    expect(response.body.vehicles.map((vehicle) => vehicle.vehicleCode)).toEqual(["CAR-000", "CAR-001"]);
    expect(response.body.vehicles.map((vehicle) => vehicle.status)).toEqual(["available", "available"]);
  });

  it("allows an employee to read active vehicles for the registry dropdown but rejects vehicle management writes", async () => {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "employee", password: "Employee001" }).expect(200);

    await agent.get("/api/vehicles").expect(200);
    await agent.post("/api/vehicles").send({
      vehicleCode: "CAR-002",
      plateNumber: "沪A-10002",
      brandModel: "丰田凯美瑞"
    }).expect(403);
  });

  it("creates a vehicle with a default status and rejects duplicate vehicle code or plate number", async () => {
    const agent = await adminAgent();
    const admin = await prisma.user.findUnique({
      where: {
        username: "admin"
      }
    });

    const created = await agent.post("/api/vehicles").send({
      vehicleCode: "CAR-002",
      plateNumber: "沪A-10002",
      brandModel: "丰田凯美瑞"
    });
    const duplicateCode = await agent.post("/api/vehicles").send({
      vehicleCode: "CAR-001",
      plateNumber: "沪A-10003",
      brandModel: "本田雅阁"
    });
    const duplicatePlate = await agent.post("/api/vehicles").send({
      vehicleCode: "CAR-003",
      plateNumber: "沪A-10001",
      brandModel: "奥迪A6"
    });

    expect(created.status).toBe(201);
    expect(created.body.vehicle).toEqual(expect.objectContaining({
      vehicleCode: "CAR-002",
      plateNumber: "沪A-10002",
      brandModel: "丰田凯美瑞",
      status: "available",
      isDeleted: false
    }));
    const storedVehicle = await prisma.vehicle.findUnique({
      where: {
        id: created.body.vehicle.id
      }
    });
    expect(storedVehicle).toEqual(expect.objectContaining({
      createdBy: admin.id,
      updatedBy: admin.id,
      deletedAt: null,
      deletedBy: null
    }));
    expect(await prisma.operationLog.findFirst({
      where: {
        module: "vehicle",
        bizType: "vehicle",
        action: "create",
        bizId: created.body.vehicle.id
      }
    })).toBeTruthy();
    expect(duplicateCode.status).toBe(409);
    expect(duplicateCode.body).toEqual({ message: "车辆编号已存在" });
    expect(duplicatePlate.status).toBe(409);
    expect(duplicatePlate.body).toEqual({ message: "车牌号已存在" });
  });

  it("rejects missing vehicle code, plate number, or brand model", async () => {
    const agent = await adminAgent();

    await agent.post("/api/vehicles").send({
      vehicleCode: "",
      plateNumber: "沪A-10002",
      brandModel: "丰田凯美瑞"
    }).expect(400);
    await agent.post("/api/vehicles").send({
      vehicleCode: "CAR-002",
      plateNumber: "",
      brandModel: "丰田凯美瑞"
    }).expect(400);
    await agent.post("/api/vehicles").send({
      vehicleCode: "CAR-002",
      plateNumber: "沪A-10002",
      brandModel: ""
    }).expect(400);
  });

  it("creates a vehicle with an explicit in-use status and lets admins change status", async () => {
    const agent = await adminAgent();

    const created = await agent.post("/api/vehicles").send({
      vehicleCode: "CAR-002",
      plateNumber: "沪A-10002",
      brandModel: "丰田凯美瑞",
      status: "inUse"
    });

    expect(created.status).toBe(201);
    expect(created.body.vehicle.status).toBe("inUse");

    const switched = await agent.patch(`/api/vehicles/${created.body.vehicle.id}/status`).send({
      status: "available"
    });

    expect(switched.status).toBe(200);
    expect(switched.body.vehicle).toEqual(expect.objectContaining({
      id: created.body.vehicle.id,
      status: "available"
    }));
    expect(await prisma.operationLog.findFirst({
      where: {
        module: "vehicle",
        bizType: "vehicle",
        action: "update_status",
        bizId: created.body.vehicle.id
      }
    })).toBeTruthy();
  });

  it("rejects invalid vehicle status changes and blocks employees from updating status", async () => {
    const admin = await adminAgent();
    const employee = request.agent(app);
    await employee.post("/api/login").send({ username: "employee", password: "Employee001" }).expect(200);
    const vehicle = await prisma.vehicle.findUnique({
      where: {
        vehicleCode: "CAR-001"
      }
    });

    await admin.patch(`/api/vehicles/${vehicle.id}/status`).send({ status: "busy" }).expect(400);
    await employee.patch(`/api/vehicles/${vehicle.id}/status`).send({ status: "inUse" }).expect(403);
  });

  it("soft deletes a vehicle so it disappears from active vehicle lists", async () => {
    const agent = await adminAgent();
    const admin = await prisma.user.findUnique({
      where: {
        username: "admin"
      }
    });
    const vehicle = await prisma.vehicle.findUnique({
      where: {
        vehicleCode: "CAR-001"
      }
    });

    await agent.delete(`/api/vehicles/${vehicle.id}`).expect(204);

    const storedVehicle = await prisma.vehicle.findUnique({
      where: {
        id: vehicle.id
      }
    });
    const listResponse = await agent.get("/api/vehicles");

    expect(storedVehicle).toEqual(expect.objectContaining({
      id: vehicle.id,
      isDeleted: true,
      deletedBy: admin.id,
      updatedBy: admin.id
    }));
    expect(storedVehicle.deletedAt).toBeTruthy();
    expect(listResponse.body.vehicles).toEqual([]);
    expect(await prisma.operationLog.findFirst({
      where: {
        module: "vehicle",
        bizType: "vehicle",
        action: "delete",
        bizId: vehicle.id
      }
    })).toBeTruthy();
  });
});
