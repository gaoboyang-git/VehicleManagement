import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp, createSessionStore } from "../src/app.js";

const rootDir = path.resolve(import.meta.dirname, "../..");

function runPrisma(args, databaseUrl) {
  execFileSync("npx", ["prisma", ...args], {
    cwd: rootDir,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl
    },
    stdio: "pipe"
  });
}

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
  let tempDir;
  let prisma;
  let app;

  beforeAll(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "vehicle-api-"));
    const databaseUrl = `file:${path.join(tempDir, "vehicles.db")}`;
    runPrisma(["migrate", "deploy"], databaseUrl);
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl
        }
      }
    });
    app = createApp({ prisma, sessionStore: createSessionStore() });
  }, 30000);

  beforeEach(async () => {
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
    if (tempDir) {
      rmSync(tempDir, { force: true, recursive: true });
    }
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

    expect(storedVehicle.isDeleted).toBe(true);
    expect(listResponse.body.vehicles).toEqual([]);
  });
});
