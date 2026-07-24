import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import request from "supertest";
import XLSX from "xlsx";
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

function getBinaryResponse(agent, path) {
  return agent.get(path).buffer(true).parse((res, callback) => {
    const chunks = [];

    res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    res.on("end", () => callback(null, Buffer.concat(chunks)));
    res.on("error", callback);
  });
}

async function createUser(prisma, { username, password, role, isBuiltinAdmin = false }) {
  return prisma.user.create({
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

async function createRecord(
  prisma,
  {
    vehicleId,
    userId,
    businessDate = "2026-07-20",
    departureTime = "09:00",
    returnTime = "10:00",
    reason = "外出办事",
    route = "园区-政务大厅",
    startMileage = 1000,
    endMileage = 1100,
    distance = 100,
    isCrossDay = false,
    driverSignature = "张三",
    fuelFee = "0",
    fuelVolume = "0",
    remark = "",
    createdAt
  }
) {
  const data = {
    vehicleId,
    userId,
    businessDate,
    departureTime,
    returnTime,
    reason,
    route,
    startMileage,
    endMileage,
    distance,
    isCrossDay,
    driverSignature,
    fuelFee,
    fuelVolume,
    remark
  };

  if (createdAt) {
    data.createdAt = new Date(createdAt);
  }

  return prisma.vehicleUseRecord.create({
    data
  });
}

describe("Issue 4 registry API", () => {
  let tempDir;
  let prisma;
  let app;

  beforeAll(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "vehicle-records-"));
    const databaseUrl = `file:${path.join(tempDir, "records.db")}`;
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
      username: "employee",
      password: "Employee001",
      role: "employee"
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

  async function employeeAgent() {
    const agent = request.agent(app);
    await agent.post("/api/login").send({ username: "employee", password: "Employee001" }).expect(200);
    return agent;
  }

  it("returns a blank default start mileage for a vehicle with no history", async () => {
    const vehicle = await createVehicle(prisma, {
      vehicleCode: "CAR-001",
      plateNumber: "沪A-10001",
      brandModel: "大众帕萨特"
    });
    const agent = await employeeAgent();

    const response = await agent.get(`/api/vehicles/${vehicle.id}/latest-mileage`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ startMileage: null });
  });

  it("returns the latest mileage for the selected vehicle only", async () => {
    const employee = await prisma.user.findUnique({
      where: {
        username: "employee"
      }
    });
    const vehicleA = await createVehicle(prisma, {
      vehicleCode: "CAR-001",
      plateNumber: "沪A-10001",
      brandModel: "大众帕萨特"
    });
    const vehicleB = await createVehicle(prisma, {
      vehicleCode: "CAR-002",
      plateNumber: "沪A-10002",
      brandModel: "别克GL8"
    });
    await createRecord(prisma, {
      vehicleId: vehicleA.id,
      userId: employee.id,
      startMileage: 800,
      endMileage: 900,
      distance: 100
    });
    await createRecord(prisma, {
      vehicleId: vehicleA.id,
      userId: employee.id,
      startMileage: 900,
      endMileage: 1000,
      distance: 100
    });
    await createRecord(prisma, {
      vehicleId: vehicleB.id,
      userId: employee.id,
      startMileage: 400,
      endMileage: 500,
      distance: 100
    });
    const agent = await employeeAgent();

    const responseA = await agent.get(`/api/vehicles/${vehicleA.id}/latest-mileage`);
    const responseB = await agent.get(`/api/vehicles/${vehicleB.id}/latest-mileage`);

    expect(responseA.status).toBe(200);
    expect(responseA.body).toEqual({ startMileage: 1000 });
    expect(responseB.status).toBe(200);
    expect(responseB.body).toEqual({ startMileage: 500 });
  });

  it("lets an employee submit a same-day registry record and stores the calculated distance", async () => {
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
    const agent = await employeeAgent();

    const response = await agent.post("/api/records").send({
      vehicleId: vehicle.id,
      businessDate: "2026-07-20",
      departureTime: "09:00",
      returnTime: "10:00",
      reason: "外出办事",
      route: "园区-政务大厅",
      startMileage: 1000,
      endMileage: 1120,
      driverSignature: "张三",
      fuelFee: "100.5",
      fuelVolume: "20.25",
      remark: "正常"
    });

    const storedRecord = await prisma.vehicleUseRecord.findFirst({
      where: {
        vehicleId: vehicle.id,
        userId: employee.id
      }
    });

    expect(response.status).toBe(201);
    expect(response.body.record).toEqual(
      expect.objectContaining({
        vehicleId: vehicle.id,
        distance: 120,
        isCrossDay: false,
        fuelFee: "100.5",
        fuelVolume: "20.25"
      })
    );
    expect(storedRecord).toEqual(
      expect.objectContaining({
        vehicleId: vehicle.id,
        userId: employee.id,
        startMileage: 1000,
        endMileage: 1120,
        distance: 120,
        isCrossDay: false,
        businessDate: "2026-07-20",
        departureTime: "09:00",
        returnTime: "10:00",
        fuelFee: "100.5",
        fuelVolume: "20.25"
      })
    );
  });

  it("allows registry submits when the selected vehicle is in use", async () => {
    const vehicle = await createVehicle(prisma, {
      vehicleCode: "CAR-001",
      plateNumber: "沪A-10001",
      brandModel: "大众帕萨特",
      status: "inUse"
    });
    const agent = await employeeAgent();

    const response = await agent.post("/api/records").send({
      vehicleId: vehicle.id,
      businessDate: "2026-07-20",
      departureTime: "09:00",
      returnTime: "10:00",
      reason: "外出办事",
      route: "园区-政务大厅",
      startMileage: 1000,
      endMileage: 1120,
      driverSignature: "张三",
      fuelFee: "0",
      fuelVolume: "0",
      remark: ""
    });

    expect(response.status).toBe(201);
    expect(response.body.record).toEqual(
      expect.objectContaining({
        vehicleId: vehicle.id,
        distance: 120,
        isCrossDay: false
      })
    );
    expect(await prisma.vehicleUseRecord.count()).toBe(1);
  });

  it("lets an administrator submit a cross-day registry record with explicit next-day datetime values", async () => {
    const admin = await prisma.user.findUnique({
      where: {
        username: "admin"
      }
    });
    const vehicle = await createVehicle(prisma, {
      vehicleCode: "CAR-001",
      plateNumber: "沪A-10001",
      brandModel: "大众帕萨特"
    });
    const agent = await adminAgent();

    const response = await agent.post("/api/records").send({
      vehicleId: vehicle.id,
      businessDate: "2026-07-20",
      departureTime: "2026-07-20T23:00",
      returnTime: "2026-07-21T01:00",
      reason: "夜间值班",
      route: "园区-值班点",
      startMileage: 1500,
      endMileage: 1550,
      driverSignature: "李四"
    });

    const storedRecord = await prisma.vehicleUseRecord.findFirst({
      where: {
        vehicleId: vehicle.id,
        userId: admin.id
      }
    });

    expect(response.status).toBe(201);
    expect(response.body.record).toEqual(
      expect.objectContaining({
        distance: 50,
        isCrossDay: true
      })
    );
    expect(storedRecord.departureTime).toBe("2026-07-20T23:00");
    expect(storedRecord.returnTime).toBe("2026-07-21T01:00");
    expect(storedRecord.isCrossDay).toBe(true);
  });

  it("accepts datetime-local inputs and derives the record date and cross-day flag", async () => {
    const employee = await prisma.user.findUnique({
      where: {
        username: "employee"
      }
    });
    const vehicle = await createVehicle(prisma, {
      vehicleCode: "CAR-010",
      plateNumber: "沪A-10100",
      brandModel: "丰田凯美瑞"
    });
    const agent = await employeeAgent();

    const response = await agent.post("/api/records").send({
      vehicleId: vehicle.id,
      businessDate: "2026-07-01",
      departureTime: "2026-07-20T23:00",
      returnTime: "2026-07-21T01:00",
      reason: "跨天出车",
      route: "园区-机场",
      startMileage: 1000,
      endMileage: 1080,
      driverSignature: "张三"
    });

    const storedRecord = await prisma.vehicleUseRecord.findFirst({
      where: {
        vehicleId: vehicle.id,
        userId: employee.id
      }
    });

    expect(response.status).toBe(201);
    expect(storedRecord.businessDate).toBe("2026-07-20");
    expect(storedRecord.departureTime).toBe("2026-07-20T23:00");
    expect(storedRecord.returnTime).toBe("2026-07-21T01:00");
    expect(storedRecord.isCrossDay).toBe(true);
  });

  it("returns full datetime strings when an admin reads records created from datetime-local inputs", async () => {
    const employee = await prisma.user.findUnique({
      where: {
        username: "employee"
      }
    });
    const vehicle = await createVehicle(prisma, {
      vehicleCode: "CAR-020",
      plateNumber: "沪A-10200",
      brandModel: "本田雅阁"
    });
    const employeeSubmitter = await employeeAgent();

    await employeeSubmitter.post("/api/records").send({
      vehicleId: vehicle.id,
      businessDate: "2026-07-01",
      departureTime: "2026-07-20T08:30",
      returnTime: "2026-07-20T10:45",
      reason: "行政外勤",
      route: "园区-政务中心",
      startMileage: 2000,
      endMileage: 2060,
      driverSignature: "张三"
    }).expect(201);

    const adminReader = await adminAgent();
    const response = await adminReader.get("/api/records");

    expect(response.status).toBe(200);
    expect(response.body.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          vehicleId: vehicle.id,
          businessDate: "2026-07-20",
          departureTime: "2026-07-20T08:30",
          returnTime: "2026-07-20T10:45"
        })
      ])
    );
  });

  it("rejects records when the end mileage is smaller than the start mileage", async () => {
    const vehicle = await createVehicle(prisma, {
      vehicleCode: "CAR-001",
      plateNumber: "沪A-10001",
      brandModel: "大众帕萨特"
    });
    const agent = await employeeAgent();

    const response = await agent.post("/api/records").send({
      vehicleId: vehicle.id,
      businessDate: "2026-07-20",
      departureTime: "09:00",
      returnTime: "10:00",
      reason: "外出办事",
      route: "园区-政务大厅",
      startMileage: 1000,
      endMileage: 900,
      driverSignature: "张三"
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: "终点公里不能小于起步公里" });
    expect(await prisma.vehicleUseRecord.count()).toBe(0);
  });

  it("rejects records when the return time is earlier than the departure time", async () => {
    const vehicle = await createVehicle(prisma, {
      vehicleCode: "CAR-001",
      plateNumber: "沪A-10001",
      brandModel: "大众帕萨特"
    });
    const agent = await employeeAgent();

    const response = await agent.post("/api/records").send({
      vehicleId: vehicle.id,
      businessDate: "2026-07-20",
      departureTime: "2026-07-20T10:00",
      returnTime: "2026-07-20T09:00",
      reason: "外出办事",
      route: "园区-政务大厅",
      startMileage: 1000,
      endMileage: 1100,
      driverSignature: "张三"
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: "还车时间不能小于出车时间" });
    expect(await prisma.vehicleUseRecord.count()).toBe(0);
  });

  it("allows a zero-distance record when the end mileage equals the start mileage", async () => {
    const vehicle = await createVehicle(prisma, {
      vehicleCode: "CAR-001",
      plateNumber: "沪A-10001",
      brandModel: "大众帕萨特"
    });
    const agent = await employeeAgent();

    const response = await agent.post("/api/records").send({
      vehicleId: vehicle.id,
      businessDate: "2026-07-20",
      departureTime: "09:00",
      returnTime: "10:00",
      reason: "原地待命",
      route: "园区内",
      startMileage: 1000,
      endMileage: 1000,
      driverSignature: "张三"
    });

    expect(response.status).toBe(201);
    expect(response.body.record.distance).toBe(0);
    expect((await prisma.vehicleUseRecord.findFirst()).distance).toBe(0);
  });

  it("rejects negative, blank, and non-numeric mileage values", async () => {
    const vehicle = await createVehicle(prisma, {
      vehicleCode: "CAR-001",
      plateNumber: "沪A-10001",
      brandModel: "大众帕萨特"
    });
    const agent = await employeeAgent();

    await agent.post("/api/records").send({
      vehicleId: vehicle.id,
      businessDate: "2026-07-20",
      departureTime: "09:00",
      returnTime: "10:00",
      reason: "外出办事",
      route: "园区-政务大厅",
      startMileage: -1,
      endMileage: 1000,
      driverSignature: "张三"
    }).expect(400);

    await agent.post("/api/records").send({
      vehicleId: vehicle.id,
      businessDate: "2026-07-20",
      departureTime: "09:00",
      returnTime: "10:00",
      reason: "外出办事",
      route: "园区-政务大厅",
      startMileage: "  ",
      endMileage: 1000,
      driverSignature: "张三"
    }).expect(400);

    const response = await agent.post("/api/records").send({
      vehicleId: vehicle.id,
      businessDate: "2026-07-20",
      departureTime: "09:00",
      returnTime: "10:00",
      reason: "外出办事",
      route: "园区-政务大厅",
      startMileage: 1000,
      endMileage: "abc",
      driverSignature: "张三"
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: "起步公里和终点公里必须为非负数字" });
    expect(await prisma.vehicleUseRecord.count()).toBe(0);
  });

  it("rejects non-numeric or negative fuel values", async () => {
    const vehicle = await createVehicle(prisma, {
      vehicleCode: "CAR-001",
      plateNumber: "沪A-10001",
      brandModel: "大众帕萨特"
    });
    const agent = await employeeAgent();

    const invalidText = await agent.post("/api/records").send({
      vehicleId: vehicle.id,
      businessDate: "2026-07-20",
      departureTime: "09:00",
      returnTime: "10:00",
      reason: "外出办事",
      route: "园区-政务大厅",
      startMileage: 1000,
      endMileage: 1100,
      driverSignature: "张三",
      fuelFee: "abc",
      fuelVolume: "20"
    });
    const invalidNegative = await agent.post("/api/records").send({
      vehicleId: vehicle.id,
      businessDate: "2026-07-20",
      departureTime: "09:00",
      returnTime: "10:00",
      reason: "外出办事",
      route: "园区-政务大厅",
      startMileage: 1000,
      endMileage: 1100,
      driverSignature: "张三",
      fuelFee: "10",
      fuelVolume: "-1"
    });

    expect(invalidText.status).toBe(400);
    expect(invalidText.body).toEqual({ message: "加油费用和加油数量必须为非负数字" });
    expect(invalidNegative.status).toBe(400);
    expect(invalidNegative.body).toEqual({ message: "加油费用和加油数量必须为非负数字" });
  });

  it("rejects a stale submit when the selected vehicle has been deleted", async () => {
    const vehicle = await createVehicle(prisma, {
      vehicleCode: "CAR-001",
      plateNumber: "沪A-10001",
      brandModel: "大众帕萨特"
    });
    await prisma.vehicle.update({
      where: {
        id: vehicle.id
      },
      data: {
        isDeleted: true
      }
    });
    const agent = await employeeAgent();

    const response = await agent.post("/api/records").send({
      vehicleId: vehicle.id,
      businessDate: "2026-07-20",
      departureTime: "09:00",
      returnTime: "10:00",
      reason: "外出办事",
      route: "园区-政务大厅",
      startMileage: 1000,
      endMileage: 1100,
      driverSignature: "张三"
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: "车辆不存在或已失效" });
    expect(await prisma.vehicleUseRecord.count()).toBe(0);
  });

  it("returns all effective records to an administrator with registry, vehicle, and user fields", async () => {
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
    const vehicleA = await createVehicle(prisma, {
      vehicleCode: "CAR-001",
      plateNumber: "沪A-10001",
      brandModel: "大众帕萨特"
    });
    const vehicleB = await createVehicle(prisma, {
      vehicleCode: "CAR-002",
      plateNumber: "沪A-10002",
      brandModel: "别克GL8"
    });

    await createRecord(prisma, {
      vehicleId: vehicleA.id,
      userId: employee.id,
      businessDate: "2026-07-19",
      departureTime: "08:00",
      returnTime: "09:00",
      startMileage: 800,
      endMileage: 900,
      distance: 100,
      driverSignature: "张三",
      reason: "REC-A-OLD"
    });
    await createRecord(prisma, {
      vehicleId: vehicleA.id,
      userId: admin.id,
      businessDate: "2026-07-20",
      departureTime: "10:00",
      returnTime: "11:00",
      startMileage: 900,
      endMileage: 1000,
      distance: 100,
      driverSignature: "李四",
      reason: "REC-A-NEW"
    });
    await createRecord(prisma, {
      vehicleId: vehicleB.id,
      userId: employee.id,
      businessDate: "2026-07-20",
      departureTime: "12:00",
      returnTime: "13:00",
      startMileage: 500,
      endMileage: 550,
      distance: 50,
      driverSignature: "王五",
      reason: "REC-B"
    });
    await prisma.vehicle.update({
      where: {
        id: vehicleB.id
      },
      data: {
        isDeleted: true
      }
    });

    const agent = await adminAgent();
    const response = await agent.get("/api/records");

    expect(response.status).toBe(200);
    expect(response.body.records).toHaveLength(3);
    expect(response.body.records.map((record) => record.reason)).toEqual([
      "REC-B",
      "REC-A-NEW",
      "REC-A-OLD"
    ]);
    expect(response.body.records[0]).toEqual(
      expect.objectContaining({
        vehicleCode: "CAR-002",
        plateNumber: "沪A-10002",
        registrantUsername: "employee",
        businessDate: "2026-07-20",
        departureTime: "12:00",
        returnTime: "13:00",
        fuelFee: "0",
        fuelVolume: "0",
        driverSignature: "王五",
        reason: "REC-B"
      })
    );
    expect(response.body.records[2]).toEqual(
      expect.objectContaining({
        vehicleCode: "CAR-001",
        plateNumber: "沪A-10001",
        registrantUsername: "employee",
        reason: "REC-A-OLD"
      })
    );
  });

  it("filters records by keyword, vehicle, registrant, and date", async () => {
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
    const vehicleA = await createVehicle(prisma, {
      vehicleCode: "CAR-001",
      plateNumber: "沪A-10001",
      brandModel: "大众帕萨特"
    });
    const vehicleB = await createVehicle(prisma, {
      vehicleCode: "CAR-002",
      plateNumber: "沪A-10002",
      brandModel: "别克GL8"
    });

    await createRecord(prisma, {
      vehicleId: vehicleA.id,
      userId: employee.id,
      businessDate: "2026-07-20",
      reason: "MATCH-ONE",
      route: "园区-A"
    });
    await createRecord(prisma, {
      vehicleId: vehicleA.id,
      userId: admin.id,
      businessDate: "2026-07-21",
      reason: "MATCH-TWO",
      route: "园区-B"
    });
    await createRecord(prisma, {
      vehicleId: vehicleB.id,
      userId: employee.id,
      businessDate: "2026-07-21",
      reason: "OTHER",
      route: "园区-C"
    });

    const agent = await adminAgent();
    const response = await agent.get("/api/records").query({
      keyword: "MATCH",
      vehicleCode: "CAR-001",
      registrantUsername: "admin",
      businessDate: "2026-07-21"
    });

    expect(response.status).toBe(200);
    expect(response.body.records).toHaveLength(1);
    expect(response.body.records[0]).toEqual(
      expect.objectContaining({
        reason: "MATCH-TWO",
        vehicleCode: "CAR-001",
        registrantUsername: "admin",
        businessDate: "2026-07-21"
      })
    );
  });

  it("rejects record management reads and deletes for employees", async () => {
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
    const record = await createRecord(prisma, {
      vehicleId: vehicle.id,
      userId: employee.id,
      reason: "REC-EMPLOYEE"
    });
    const agent = await employeeAgent();

    await agent.get("/api/records").expect(403);
    await agent.delete(`/api/records/${record.id}`).expect(403);
    expect(await prisma.vehicleUseRecord.count()).toBe(1);
  });

  it("deletes the latest record and recalculates the vehicle default start mileage from remaining records", async () => {
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
      userId: employee.id,
      businessDate: "2026-07-19",
      departureTime: "08:00",
      returnTime: "09:00",
      startMileage: 800,
      endMileage: 900,
      distance: 100,
      reason: "REC-OLD"
    });
    const latestRecord = await createRecord(prisma, {
      vehicleId: vehicle.id,
      userId: employee.id,
      businessDate: "2026-07-20",
      departureTime: "10:00",
      returnTime: "11:00",
      startMileage: 900,
      endMileage: 1000,
      distance: 100,
      reason: "REC-LATEST"
    });
    const agent = await adminAgent();

    const deleteResponse = await agent.delete(`/api/records/${latestRecord.id}`);
    const latestMileageResponse = await agent.get(`/api/vehicles/${vehicle.id}/latest-mileage`);
    const listResponse = await agent.get("/api/records");

    expect(deleteResponse.status).toBe(204);
    expect(await prisma.vehicleUseRecord.count()).toBe(1);
    expect(latestMileageResponse.status).toBe(200);
    expect(latestMileageResponse.body).toEqual({ startMileage: 900 });
    expect(listResponse.body.records.map((record) => record.reason)).toEqual(["REC-OLD"]);
  });

  it("batch deletes selected records and rejects empty selections", async () => {
    const employee = await prisma.user.findUnique({
      where: {
        username: "employee"
      }
    });
    const vehicleA = await createVehicle(prisma, {
      vehicleCode: "CAR-001",
      plateNumber: "沪A-10001",
      brandModel: "大众帕萨特"
    });
    const vehicleB = await createVehicle(prisma, {
      vehicleCode: "CAR-002",
      plateNumber: "沪A-10002",
      brandModel: "别克GL8"
    });
    await createRecord(prisma, {
      vehicleId: vehicleA.id,
      userId: employee.id,
      businessDate: "2026-07-19",
      endMileage: 900,
      reason: "KEEP-OLD"
    });
    const latestA = await createRecord(prisma, {
      vehicleId: vehicleA.id,
      userId: employee.id,
      businessDate: "2026-07-20",
      startMileage: 900,
      endMileage: 1000,
      reason: "DELETE-A"
    });
    const deleteB = await createRecord(prisma, {
      vehicleId: vehicleB.id,
      userId: employee.id,
      businessDate: "2026-07-20",
      startMileage: 500,
      endMileage: 600,
      reason: "DELETE-B"
    });

    const agent = await adminAgent();

    const emptyResponse = await agent.post("/api/records/batch-delete").send({ ids: [] });

    expect(emptyResponse.status).toBe(400);
    expect(emptyResponse.body).toEqual({ message: "请选择至少一条记录" });

    const deleteResponse = await agent.post("/api/records/batch-delete").send({
      ids: [latestA.id, deleteB.id]
    });
    const latestMileageResponse = await agent.get(`/api/vehicles/${vehicleA.id}/latest-mileage`);
    const listResponse = await agent.get("/api/records");

    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body).toEqual({ message: "已删除 2 条记录", deletedCount: 2 });
    expect(await prisma.vehicleUseRecord.count()).toBe(1);
    expect(latestMileageResponse.body).toEqual({ startMileage: 900 });
    expect(listResponse.body.records.map((record) => record.reason)).toEqual(["KEEP-OLD"]);
  });

  it("exports all effective records to xlsx for an administrator", async () => {
    const employee = await prisma.user.findUnique({
      where: {
        username: "employee"
      }
    });
    const vehicleA = await createVehicle(prisma, {
      vehicleCode: "CAR-001",
      plateNumber: "沪A-10001",
      brandModel: "大众帕萨特"
    });
    const vehicleB = await createVehicle(prisma, {
      vehicleCode: "CAR-002",
      plateNumber: "沪A-10002",
      brandModel: "别克GL8"
    });
    const vehicleC = await createVehicle(prisma, {
      vehicleCode: "CAR-003",
      plateNumber: "沪A-10003",
      brandModel: "丰田埃尔法"
    });

    await createRecord(prisma, {
      vehicleId: vehicleA.id,
      userId: employee.id,
      businessDate: "2026-07-19",
      departureTime: "08:00",
      returnTime: "09:00",
      startMileage: 800,
      endMileage: 900,
      distance: 100,
      reason: "REC-A-OLD",
      route: "园区-旧地点",
      driverSignature: "张三",
      createdAt: "2026-07-19T08:30:00.000Z"
    });
    await createRecord(prisma, {
      vehicleId: vehicleA.id,
      userId: employee.id,
      businessDate: "2026-07-20",
      departureTime: "09:00",
      returnTime: "10:00",
      startMileage: 900,
      endMileage: 1000,
      distance: 100,
      reason: "REC-A-NEW",
      route: "园区-新地点",
      driverSignature: "李四",
      createdAt: "2026-07-20T09:30:00.000Z"
    });
    const deletedRecord = await createRecord(prisma, {
      vehicleId: vehicleA.id,
      userId: employee.id,
      businessDate: "2026-07-20",
      departureTime: "11:00",
      returnTime: "12:00",
      startMileage: 1000,
      endMileage: 1100,
      distance: 100,
      reason: "REC-DELETE",
      route: "园区-应删除",
      driverSignature: "王五",
      createdAt: "2026-07-20T11:30:00.000Z"
    });
    await createRecord(prisma, {
      vehicleId: vehicleB.id,
      userId: employee.id,
      businessDate: "2026-07-20",
      departureTime: "13:00",
      returnTime: "14:00",
      startMileage: 500,
      endMileage: 550,
      distance: 50,
      reason: "REC-B",
      route: "园区-B",
      driverSignature: "赵六",
      createdAt: "2026-07-20T13:30:00.000Z"
    });
    await createRecord(prisma, {
      vehicleId: vehicleC.id,
      userId: employee.id,
      businessDate: "2026-07-20",
      departureTime: "15:00",
      returnTime: "16:00",
      startMileage: 300,
      endMileage: 360,
      distance: 60,
      reason: "REC-C",
      route: "园区-C",
      driverSignature: "孙七",
      createdAt: "2026-07-20T15:30:00.000Z"
    });
    await prisma.vehicle.update({
      where: {
        id: vehicleC.id
      },
      data: {
        isDeleted: true
      }
    });
    await prisma.vehicleUseRecord.delete({
      where: {
        id: deletedRecord.id
      }
    });

    const agent = await adminAgent();
    const response = await getBinaryResponse(agent, "/api/records/export");
    const workbook = XLSX.read(response.body, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    expect(response.headers["content-disposition"]).toContain("attachment");
    expect(rows[0]).toEqual([
      "车牌号",
      "日期",
      "出车时间",
      "还车时间",
      "事由",
      "目的地及行车路线",
      "起步公里读数",
      "终点公里读数",
      "行车公里数",
      "加油费用/数量",
      "驾驶员签字",
      "备注"
    ]);
    expect(rows.slice(1).map((row) => row[0])).toEqual([
      "沪A-10003",
      "沪A-10002",
      "沪A-10001",
      "沪A-10001"
    ]);
    expect(rows.slice(1).map((row) => row[1])).toEqual([
      "2026-07-20",
      "2026-07-20",
      "2026-07-20",
      "2026-07-19"
    ]);
    expect(rows.slice(1).map((row) => row[4])).toEqual([
      "REC-C",
      "REC-B",
      "REC-A-NEW",
      "REC-A-OLD"
    ]);
    expect(rows.slice(1).map((row) => row[2])).toEqual([
      "2026-07-20 15:00",
      "2026-07-20 13:00",
      "2026-07-20 09:00",
      "2026-07-19 08:00"
    ]);
    expect(rows.slice(1).map((row) => row[3])).toEqual([
      "2026-07-20 16:00",
      "2026-07-20 14:00",
      "2026-07-20 10:00",
      "2026-07-19 09:00"
    ]);
    expect(rows.flat().includes("REC-DELETE")).toBe(false);
  });

  it("exports only records that match the current filters", async () => {
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
    const vehicleA = await createVehicle(prisma, {
      vehicleCode: "CAR-001",
      plateNumber: "沪A-10001",
      brandModel: "大众帕萨特"
    });
    const vehicleB = await createVehicle(prisma, {
      vehicleCode: "CAR-002",
      plateNumber: "沪A-10002",
      brandModel: "别克GL8"
    });

    await createRecord(prisma, {
      vehicleId: vehicleA.id,
      userId: admin.id,
      businessDate: "2026-07-21",
      reason: "EXPORT-MATCH",
      route: "园区-A"
    });
    await createRecord(prisma, {
      vehicleId: vehicleA.id,
      userId: employee.id,
      businessDate: "2026-07-21",
      reason: "EXPORT-OTHER-USER",
      route: "园区-B"
    });
    await createRecord(prisma, {
      vehicleId: vehicleB.id,
      userId: admin.id,
      businessDate: "2026-07-21",
      reason: "EXPORT-OTHER-VEHICLE",
      route: "园区-C"
    });

    const agent = await adminAgent();
    const response = await getBinaryResponse(
      agent,
      "/api/records/export?keyword=EXPORT&vehicleCode=CAR-001&registrantUsername=admin&businessDate=2026-07-21"
    );
    const workbook = XLSX.read(response.body, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    expect(response.status).toBe(200);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual([
      "日期",
      "出车时间",
      "还车时间",
      "事由",
      "目的地及行车路线",
      "起步公里读数",
      "终点公里读数",
      "行车公里数",
      "加油费用/数量",
      "驾驶员签字",
      "备注"
    ]);
    expect(rows[1][0]).toBe("2026-07-21");
    expect(rows[1][1]).toBe("2026-07-21 09:00");
    expect(rows[1][2]).toBe("2026-07-21 10:00");
    expect(rows[1][3]).toBe("EXPORT-MATCH");
  });

  it("exports full datetime values for records created from datetime-local inputs", async () => {
    const vehicle = await createVehicle(prisma, {
      vehicleCode: "CAR-030",
      plateNumber: "沪A-10300",
      brandModel: "奥迪A4"
    });
    const employeeSubmitter = await employeeAgent();

    await employeeSubmitter.post("/api/records").send({
      vehicleId: vehicle.id,
      businessDate: "2026-07-01",
      departureTime: "2026-07-22T08:15",
      returnTime: "2026-07-22T11:20",
      reason: "导出校验",
      route: "园区-办事大厅",
      startMileage: 3200,
      endMileage: 3290,
      driverSignature: "张三"
    }).expect(201);

    const agent = await adminAgent();
    const response = await getBinaryResponse(agent, "/api/records/export");
    const workbook = XLSX.read(response.body, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    expect(response.status).toBe(200);
    expect(rows).toContainEqual(
      expect.arrayContaining([
        "2026-07-22",
        "2026-07-22 08:15",
        "2026-07-22 11:20",
        "导出校验"
      ])
    );
  });

  it("rejects export for employees", async () => {
    const agent = await employeeAgent();

    await agent.get("/api/records/export").expect(403);
  });

  it("exports only a header row when there are no records", async () => {
    const agent = await adminAgent();
    const response = await getBinaryResponse(agent, "/api/records/export");
    const workbook = XLSX.read(response.body, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    expect(response.status).toBe(200);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual([
      "日期",
      "出车时间",
      "还车时间",
      "事由",
      "目的地及行车路线",
      "起步公里读数",
      "终点公里读数",
      "行车公里数",
      "加油费用/数量",
      "驾驶员签字",
      "备注"
    ]);
  });
});
