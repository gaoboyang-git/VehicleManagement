import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { PrismaBetterSQLite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import cors from "cors";
import express from "express";
import * as XLSX from "xlsx";

const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";
const defaultPrisma = new PrismaClient({
  adapter: new PrismaBetterSQLite3({ url: databaseUrl })
});

function toPublicUser(user) {
  return {
    username: user.username,
    role: user.role
  };
}

function toManagedUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    isBuiltinAdmin: user.isBuiltinAdmin
  };
}

function toPublicVehicle(vehicle) {
  return {
    id: vehicle.id,
    vehicleCode: vehicle.vehicleCode,
    plateNumber: vehicle.plateNumber,
    brandModel: vehicle.brandModel,
    isDeleted: vehicle.isDeleted
  };
}

function toPublicRecord(record) {
  return {
    id: record.id,
    vehicleId: record.vehicleId,
    userId: record.userId,
    businessDate: record.businessDate,
    departureTime: record.departureTime,
    returnTime: record.returnTime,
    reason: record.reason,
    route: record.route,
    startMileage: record.startMileage,
    endMileage: record.endMileage,
    distance: record.distance,
    isCrossDay: record.isCrossDay,
    fuelFee: record.fuelFee,
    fuelVolume: record.fuelVolume,
    driverSignature: record.driverSignature,
    remark: record.remark
  };
}

function toManagedRecord(record) {
  return {
    ...toPublicRecord(record),
    vehicleCode: record.vehicle.vehicleCode,
    plateNumber: record.vehicle.plateNumber,
    registrantUsername: record.user.username,
    createdAt: record.createdAt.toISOString()
  };
}

function readRequiredText(value) {
  return String(value ?? "").trim();
}

function readOptionalText(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function readDateTimeParts(value) {
  const text = String(value ?? "").trim();

  if (!text) {
    return {
      date: "",
      time: ""
    };
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) {
    return {
      date: text.slice(0, 10),
      time: text.slice(11, 16)
    };
  }

  return {
    date: "",
    time: text
  };
}

function isReturnEarlierThanDeparture(departureValue, returnValue) {
  const departureText = String(departureValue ?? "").trim();
  const returnText = String(returnValue ?? "").trim();

  if (!departureText || !returnText) {
    return false;
  }

  if (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(departureText) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(returnText)
  ) {
    return returnText < departureText;
  }

  const departureTime = departureText.includes("T") ? departureText.slice(11, 16) : departureText;
  const returnTime = returnText.includes("T") ? returnText.slice(11, 16) : returnText;

  return returnTime < departureTime;
}

function formatFuelExportValue(fuelFee, fuelVolume) {
  const feeText = String(fuelFee ?? "").trim();
  const volumeText = String(fuelVolume ?? "").trim();

  if (!feeText && !volumeText) {
    return "";
  }

  return `${feeText ? `${feeText}元` : "-"}/${volumeText ? `${volumeText}L` : "-"}`;
}

function formatExportFileName(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `用车记录-${year}年${month}月${day}日.xlsx`;
}

const recordExportHeaders = [
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
];

function parseMileage(value) {
  const text = String(value ?? "").trim();

  if (!text) {
    return null;
  }

  const mileage = Number(text);

  if (!Number.isFinite(mileage) || mileage < 0) {
    return null;
  }

  return mileage;
}

function isComplexPassword(value) {
  const text = String(value ?? "");
  return text.length >= 6 && /[A-Za-z]/.test(text) && /\d/.test(text);
}

function isValidNonNegativeDecimal(value) {
  if (value === null || value === undefined) {
    return true;
  }

  const text = String(value).trim();

  if (!text) {
    return true;
  }

  if (!/^\d+(\.\d+)?$/.test(text)) {
    return false;
  }

  return Number(text) >= 0;
}

function readRecordFilters(request) {
  return {
    keyword: String(request.query.keyword ?? "").trim().toLowerCase(),
    vehicleCode: String(request.query.vehicleCode ?? "").trim(),
    registrantUsername: String(request.query.registrantUsername ?? "").trim(),
    businessDate: String(request.query.businessDate ?? "").trim()
  };
}

function recordMatchesFilters(record, filters) {
  const matchesKeyword = filters.keyword
    ? [
        record.reason,
        record.route,
        record.vehicle.vehicleCode,
        record.vehicle.plateNumber,
        record.user.username,
        record.driverSignature,
        record.remark ?? ""
      ]
        .join(" ")
        .toLowerCase()
        .includes(filters.keyword)
    : true;

  const matchesVehicle = filters.vehicleCode
    ? record.vehicle.vehicleCode === filters.vehicleCode
    : true;
  const matchesUser = filters.registrantUsername
    ? record.user.username === filters.registrantUsername
    : true;
  const matchesDate = filters.businessDate ? record.businessDate === filters.businessDate : true;

  return matchesKeyword && matchesVehicle && matchesUser && matchesDate;
}

async function loadManagedRecords(prisma, filters = {}) {
  const records = await prisma.vehicleUseRecord.findMany({
    include: {
      vehicle: true,
      user: true
    }
  });

  return records
    .filter((record) => recordMatchesFilters(record, filters))
    .sort((left, right) => {
      if (left.vehicle.vehicleCode !== right.vehicle.vehicleCode) {
        return left.vehicle.vehicleCode.localeCompare(right.vehicle.vehicleCode);
      }

      if (left.businessDate !== right.businessDate) {
        return left.businessDate.localeCompare(right.businessDate);
      }

      return left.createdAt.getTime() - right.createdAt.getTime();
    });
}

function readCookie(request, name) {
  const cookies = request.headers.cookie?.split(";") ?? [];

  for (const cookie of cookies) {
    const [rawKey, ...rawValue] = cookie.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(rawValue.join("="));
    }
  }

  return undefined;
}

function setSessionCookie(response, sessionId) {
  response.cookie("sessionId", sessionId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/"
  });
}

function clearSessionCookie(response) {
  response.clearCookie("sessionId", {
    path: "/"
  });
}

function asyncHandler(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

export function createSessionStore() {
  const sessions = new Map();

  return {
    create(userId) {
      const sessionId = randomUUID();
      sessions.set(sessionId, userId);
      return sessionId;
    },
    get(sessionId) {
      return sessions.get(sessionId);
    },
    delete(sessionId) {
      sessions.delete(sessionId);
    }
  };
}

export function createApp({ prisma = defaultPrisma, sessionStore = createSessionStore() } = {}) {
  const app = express();
  const clientDistPath = resolve(process.cwd(), "dist");

  app.use(cors({ credentials: true, origin: true }));
  app.use(express.json());

  async function requireLogin(request, response, next) {
    const sessionId = readCookie(request, "sessionId");
    const userId = sessionId ? sessionStore.get(sessionId) : undefined;

    if (!sessionId || !userId) {
      return response.status(401).json({ message: "未登录" });
    }

    const user = await prisma.user.findUnique({
      where: {
        id: userId
      }
    });

    if (!user) {
      sessionStore.delete(sessionId);
      clearSessionCookie(response);
      return response.status(401).json({ message: "未登录" });
    }

    request.auth = {
      sessionId,
      user
    };
    return next();
  }

  function requireAdmin(request, response, next) {
    if (request.auth.user.role !== "admin") {
      return response.status(403).json({ message: "无权限" });
    }

    return next();
  }

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.post(
    "/api/login",
    asyncHandler(async (request, response) => {
      const username = String(request.body.username ?? "").trim();
      const password = String(request.body.password ?? "");

      if (!username || !password) {
        return response.status(400).json({ message: "账号和密码必填" });
      }

      const user = await prisma.user.findUnique({
        where: {
          username
        }
      });
      const isValidPassword = user ? await bcrypt.compare(password, user.passwordHash) : false;

      if (!user || !isValidPassword) {
        return response.status(401).json({ message: "账号或密码错误" });
      }

      const sessionId = sessionStore.create(user.id);
      setSessionCookie(response, sessionId);

      return response.json({ user: toPublicUser(user) });
    })
  );

  app.post("/api/logout", (request, response) => {
    const sessionId = readCookie(request, "sessionId");

    if (sessionId) {
      sessionStore.delete(sessionId);
    }

    clearSessionCookie(response);
    return response.sendStatus(204);
  });

  app.post(
    "/api/change-password",
    requireLogin,
    asyncHandler(async (request, response) => {
      const currentPassword = String(request.body.currentPassword ?? "");
      const newPassword = String(request.body.newPassword ?? "");
      const confirmPassword = String(request.body.confirmPassword ?? "");

      if (!currentPassword || !newPassword || !confirmPassword) {
        return response.status(400).json({ message: "密码字段必填" });
      }

      if (newPassword !== confirmPassword) {
        return response.status(400).json({ message: "两次新密码不一致" });
      }

      if (newPassword === currentPassword) {
        return response.status(400).json({ message: "新密码不能与当前密码相同" });
      }

      if (!isComplexPassword(newPassword)) {
        return response.status(400).json({ message: "新密码需至少 6 位且同时包含字母和数字" });
      }

      const isValidCurrentPassword = await bcrypt.compare(
        currentPassword,
        request.auth.user.passwordHash
      );

      if (!isValidCurrentPassword) {
        return response.status(400).json({ message: "当前密码错误" });
      }

      await prisma.user.update({
        where: {
          id: request.auth.user.id
        },
        data: {
          passwordHash: await bcrypt.hash(newPassword, 10)
        }
      });

      sessionStore.delete(request.auth.sessionId);
      clearSessionCookie(response);

      return response.json({ message: "密码已修改，请重新登录" });
    })
  );

  app.get(
    "/api/users",
    requireLogin,
    requireAdmin,
    asyncHandler(async (_request, response) => {
      const users = await prisma.user.findMany({
        orderBy: {
          createdAt: "asc"
        }
      });

      return response.json({ users: users.map(toManagedUser) });
    })
  );

  app.post(
    "/api/users",
    requireLogin,
    requireAdmin,
    asyncHandler(async (request, response) => {
      const username = String(request.body.username ?? "").trim();
      const password = String(request.body.password ?? "");
      const role = String(request.body.role ?? "");

      if (!username || !password || !role) {
        return response.status(400).json({ message: "账号、密码、角色必填" });
      }

      if (!["admin", "employee"].includes(role)) {
        return response.status(400).json({ message: "角色不合法" });
      }

      const existingUser = await prisma.user.findUnique({
        where: {
          username
        }
      });

      if (existingUser) {
        return response.status(409).json({ message: "账号已存在" });
      }

      const user = await prisma.user.create({
        data: {
          username,
          passwordHash: await bcrypt.hash(password, 10),
          role,
          isBuiltinAdmin: false
        }
      });

      return response.status(201).json({ user: toManagedUser(user) });
    })
  );

  app.delete(
    "/api/users/:id",
    requireLogin,
    requireAdmin,
    asyncHandler(async (request, response) => {
      const user = await prisma.user.findUnique({
        where: {
          id: request.params.id
        }
      });

      if (!user) {
        return response.status(404).json({ message: "用户不存在" });
      }

      if (user.isBuiltinAdmin) {
        return response.status(400).json({ message: "内置 admin 不可删除" });
      }

      if (request.auth.user.id === user.id && request.auth.user.username !== "admin") {
        return response.status(400).json({ message: "不能删除当前登录管理员账号" });
      }

      await prisma.user.delete({
        where: {
          id: user.id
        }
      });

      return response.sendStatus(204);
    })
  );

  app.post(
    "/api/users/:id/reset-password",
    requireLogin,
    requireAdmin,
    asyncHandler(async (request, response) => {
      const newPassword = String(request.body.newPassword ?? "");
      const confirmPassword = String(request.body.confirmPassword ?? "");

      if (!newPassword || !confirmPassword) {
        return response.status(400).json({ message: "新密码和确认新密码必填" });
      }

      if (newPassword !== confirmPassword) {
        return response.status(400).json({ message: "两次新密码不一致" });
      }

      const user = await prisma.user.findUnique({
        where: {
          id: request.params.id
        }
      });

      if (!user) {
        return response.status(404).json({ message: "用户不存在" });
      }

      if (user.id === request.auth.user.id) {
        return response.status(400).json({ message: "请使用修改密码功能修改本人密码" });
      }

      if (request.auth.user.username === "admin") {
        await prisma.user.update({
          where: {
            id: user.id
          },
          data: {
            passwordHash: await bcrypt.hash(newPassword, 10)
          }
        });

        return response.json({ message: "密码已重置" });
      }

      if (user.isBuiltinAdmin || user.role !== "employee") {
        return response.status(400).json({ message: "只能重置普通用户密码" });
      }

      await prisma.user.update({
        where: {
          id: user.id
        },
        data: {
          passwordHash: await bcrypt.hash(newPassword, 10)
        }
      });

      return response.json({ message: "密码已重置" });
    })
  );

  app.get(
    "/api/vehicles",
    requireLogin,
    asyncHandler(async (_request, response) => {
      const vehicles = await prisma.vehicle.findMany({
        where: {
          isDeleted: false
        },
        orderBy: {
          vehicleCode: "asc"
        }
      });

      return response.json({ vehicles: vehicles.map(toPublicVehicle) });
    })
  );

  app.get(
    "/api/vehicles/:id/latest-mileage",
    requireLogin,
    asyncHandler(async (request, response) => {
      const vehicle = await prisma.vehicle.findUnique({
        where: {
          id: request.params.id
        }
      });

      if (!vehicle || vehicle.isDeleted) {
        return response.status(404).json({ message: "车辆不存在或已失效" });
      }

      const latestRecord = await prisma.vehicleUseRecord.findFirst({
        where: {
          vehicleId: vehicle.id
        },
        orderBy: {
          createdAt: "desc"
        }
      });

      return response.json({
        startMileage: latestRecord ? latestRecord.endMileage : null
      });
    })
  );

  app.post(
    "/api/vehicles",
    requireLogin,
    requireAdmin,
    asyncHandler(async (request, response) => {
      const vehicleCode = String(request.body.vehicleCode ?? "").trim();
      const plateNumber = String(request.body.plateNumber ?? "").trim();
      const brandModel = String(request.body.brandModel ?? "").trim();

      if (!vehicleCode || !plateNumber || !brandModel) {
        return response.status(400).json({ message: "车辆编号、车牌号、品牌型号必填" });
      }

      const duplicateCode = await prisma.vehicle.findUnique({
        where: {
          vehicleCode
        }
      });
      if (duplicateCode) {
        return response.status(409).json({ message: "车辆编号已存在" });
      }

      const duplicatePlate = await prisma.vehicle.findUnique({
        where: {
          plateNumber
        }
      });
      if (duplicatePlate) {
        return response.status(409).json({ message: "车牌号已存在" });
      }

      const vehicle = await prisma.vehicle.create({
        data: {
          vehicleCode,
          plateNumber,
          brandModel
        }
      });

      return response.status(201).json({ vehicle: toPublicVehicle(vehicle) });
    })
  );

  app.delete(
    "/api/vehicles/:id",
    requireLogin,
    requireAdmin,
    asyncHandler(async (request, response) => {
      const vehicle = await prisma.vehicle.findUnique({
        where: {
          id: request.params.id
        }
      });

      if (!vehicle) {
        return response.status(404).json({ message: "车辆不存在" });
      }

      if (vehicle.isDeleted) {
        return response.status(400).json({ message: "车辆已删除" });
      }

      await prisma.vehicle.update({
        where: {
          id: vehicle.id
        },
        data: {
          isDeleted: true
        }
      });

      return response.sendStatus(204);
    })
  );

  app.get(
    "/api/records",
    requireLogin,
    requireAdmin,
    asyncHandler(async (request, response) => {
      const records = await loadManagedRecords(prisma, readRecordFilters(request));

      return response.json({ records: records.map(toManagedRecord) });
    })
  );

  app.get(
    "/api/records/export",
    requireLogin,
    requireAdmin,
    asyncHandler(async (request, response) => {
      const records = await loadManagedRecords(prisma, readRecordFilters(request));
      const rows = [
        recordExportHeaders,
        ...records.map((record) => [
          record.businessDate,
          record.departureTime,
          record.returnTime,
          record.reason,
          record.route,
          record.startMileage,
          record.endMileage,
          record.distance,
          formatFuelExportValue(record.fuelFee, record.fuelVolume),
          record.driverSignature,
          record.remark ?? ""
        ])
      ];
      const workbook = XLSX.utils.book_new();
      const sheet = XLSX.utils.aoa_to_sheet(rows);

      XLSX.utils.book_append_sheet(workbook, sheet, "记录");

      const buffer = XLSX.write(workbook, {
        bookType: "xlsx",
        type: "buffer"
      });

      response.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      const fileName = formatExportFileName();
      response.setHeader(
        "Content-Disposition",
        `attachment; filename="vehicle-records.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`
      );

      return response.send(buffer);
    })
  );

  app.post(
    "/api/records",
    requireLogin,
    asyncHandler(async (request, response) => {
      const vehicleId = readRequiredText(request.body.vehicleId);
      const requestedBusinessDate = readRequiredText(request.body.businessDate);
      const departureDateTime = readDateTimeParts(request.body.departureTime);
      const returnDateTime = readDateTimeParts(request.body.returnTime);
      const businessDate = departureDateTime.date || requestedBusinessDate;
      const departureTime = departureDateTime.time;
      const returnTime = returnDateTime.time;
      const reason = readRequiredText(request.body.reason);
      const route = readRequiredText(request.body.route);
      const driverSignature = readRequiredText(request.body.driverSignature);
      const startMileage = parseMileage(request.body.startMileage);
      const endMileage = parseMileage(request.body.endMileage);
      const fuelFee = readOptionalText(request.body.fuelFee);
      const fuelVolume = readOptionalText(request.body.fuelVolume);
      const remark = readOptionalText(request.body.remark);

      if (
        !vehicleId ||
        !businessDate ||
        !departureTime ||
        !returnTime ||
        !reason ||
        !route ||
        !driverSignature
      ) {
        return response.status(400).json({
          message: "日期、出车时间、还车时间、事由、路线、起步公里、终点公里、驾驶员签字必填"
        });
      }

      if (startMileage === null || endMileage === null) {
        return response.status(400).json({ message: "起步公里和终点公里必须为非负数字" });
      }

      if (!isValidNonNegativeDecimal(fuelFee) || !isValidNonNegativeDecimal(fuelVolume)) {
        return response.status(400).json({ message: "加油费用和加油数量必须为非负数字" });
      }

      if (isReturnEarlierThanDeparture(request.body.departureTime, request.body.returnTime)) {
        return response.status(400).json({ message: "还车时间不能小于出车时间" });
      }

      if (endMileage < startMileage) {
        return response.status(400).json({ message: "终点公里不能小于起步公里" });
      }

      const vehicle = await prisma.vehicle.findUnique({
        where: {
          id: vehicleId
        }
      });

      if (!vehicle || vehicle.isDeleted) {
        return response.status(400).json({ message: "车辆不存在或已失效" });
      }

      const record = await prisma.vehicleUseRecord.create({
        data: {
          vehicleId: vehicle.id,
          userId: request.auth.user.id,
          businessDate,
          departureTime,
          returnTime,
          reason,
          route,
          startMileage,
          endMileage,
          distance: endMileage - startMileage,
          isCrossDay:
            returnDateTime.date && businessDate
              ? returnDateTime.date !== businessDate
              : returnTime < departureTime,
          fuelFee,
          fuelVolume,
          driverSignature,
          remark
        }
      });

      return response.status(201).json({
        message: "登记已提交",
        record: toPublicRecord(record)
      });
    })
  );

  app.post(
    "/api/records/batch-delete",
    requireLogin,
    requireAdmin,
    asyncHandler(async (request, response) => {
      const ids = Array.isArray(request.body.ids)
        ? [...new Set(request.body.ids.map((value) => String(value ?? "").trim()).filter(Boolean))]
        : [];

      if (ids.length === 0) {
        return response.status(400).json({ message: "请选择至少一条记录" });
      }

      const existingRecords = await prisma.vehicleUseRecord.findMany({
        where: {
          id: {
            in: ids
          }
        },
        select: {
          id: true
        }
      });

      if (existingRecords.length !== ids.length) {
        return response.status(404).json({ message: "记录不存在" });
      }

      await prisma.vehicleUseRecord.deleteMany({
        where: {
          id: {
            in: ids
          }
        }
      });

      return response.json({
        message: `已删除 ${ids.length} 条记录`,
        deletedCount: ids.length
      });
    })
  );

  app.delete(
    "/api/records/:id",
    requireLogin,
    requireAdmin,
    asyncHandler(async (request, response) => {
      const record = await prisma.vehicleUseRecord.findUnique({
        where: {
          id: request.params.id
        }
      });

      if (!record) {
        return response.status(404).json({ message: "记录不存在" });
      }

      await prisma.vehicleUseRecord.delete({
        where: {
          id: record.id
        }
      });

      return response.sendStatus(204);
    })
  );

  if (existsSync(clientDistPath)) {
    app.use(express.static(clientDistPath));
    app.get("*", (request, response, next) => {
      if (request.path.startsWith("/api/")) {
        return next();
      }

      return response.sendFile(join(clientDistPath, "index.html"));
    });
  }

  return app;
}

export const app = createApp();
