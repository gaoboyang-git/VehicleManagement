import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { PrismaBetterSQLite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import fontkit from "@pdf-lib/fontkit";
import bcrypt from "bcryptjs";
import cors from "cors";
import express from "express";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getRegistryConstraintErrors } from "../../shared/registryConstraints.js";

const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";
const appDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const defaultPrisma = new PrismaClient({
  adapter: new PrismaBetterSQLite3({ url: databaseUrl })
});

function toPublicUser(user) {
  return {
    username: user.username,
    fullName: resolveUserFullName(user),
    role: user.role
  };
}

function toManagedUser(user) {
  return {
    id: user.id,
    username: user.username,
    fullName: resolveUserFullName(user),
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
    status: vehicle.status,
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
    driverName: resolveRecordDriverName(record),
    driverSignature: record.driverSignature,
    driverSignatureImage: record.driverSignatureImage ?? null,
    remark: record.remark
  };
}

function toManagedRecord(record) {
  return {
    ...toPublicRecord(record),
    vehicleCode: record.vehicle.vehicleCode,
    plateNumber: record.vehicle.plateNumber,
    brandModel: record.vehicle.brandModel,
    registrantUsername: record.user.username,
    registrantName: resolveRecordDriverName(record),
    createdAt: record.createdAt.toISOString()
  };
}

function resolveUserFullName(user) {
  const fullName = String(user?.fullName ?? "").trim();
  return fullName || String(user?.username ?? "").trim();
}

function resolveRecordDriverName(record) {
  const driverName = String(record?.driverName ?? "").trim();
  const fallbackSignature = String(record?.driverSignature ?? "").trim();

  if (driverName) {
    return driverName;
  }

  if (fallbackSignature) {
    return fallbackSignature;
  }

  return resolveUserFullName(record?.user);
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
      time: "",
      datetime: ""
    };
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) {
    return {
      date: text.slice(0, 10),
      time: text.slice(11, 16),
      datetime: text
    };
  }

  return {
    date: "",
    time: text,
    datetime: text
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

function isFullDateTimeText(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value ?? "").trim());
}

function addDaysToDateText(dateText, days) {
  const [year, month, day] = String(dateText ?? "")
    .split("-")
    .map((value) => Number(value));

  if (!year || !month || !day) {
    return String(dateText ?? "").trim();
  }

  const nextDate = new Date(Date.UTC(year, month - 1, day + days));
  const nextYear = nextDate.getUTCFullYear();
  const nextMonth = String(nextDate.getUTCMonth() + 1).padStart(2, "0");
  const nextDay = String(nextDate.getUTCDate()).padStart(2, "0");

  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function formatManagedRecordDateTime(record, value, { isReturn = false } = {}) {
  const text = String(value ?? "").trim();

  if (!text) {
    return "";
  }

  if (isFullDateTimeText(text)) {
    return text.replace("T", " ");
  }

  if (!record.businessDate) {
    return text;
  }

  const dateText = isReturn && record.isCrossDay ? addDaysToDateText(record.businessDate, 1) : record.businessDate;
  return `${dateText} ${text}`;
}

function formatPdfExportFileName(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `用车记录-${year}年${month}月${day}日.pdf`;
}

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

function isValidSignatureImage(value) {
  const text = String(value ?? "").trim();

  if (!text) {
    return false;
  }

  if (!/^data:image\/(png|jpeg|jpg);base64,/i.test(text)) {
    return false;
  }

  return text.length <= 1_500_000;
}

function formatVehicleDisplay(vehicle) {
  const plateNumber = String(vehicle?.plateNumber ?? "").trim();
  const brandModel = String(vehicle?.brandModel ?? "").trim();

  if (plateNumber && brandModel) {
    return `${plateNumber}-${brandModel}`;
  }

  return plateNumber || String(vehicle?.vehicleCode ?? "").trim() || "-";
}

function decodeSignatureImage(dataUrl) {
  const [header, base64 = ""] = String(dataUrl ?? "").split(",", 2);
  const format = /data:image\/(png|jpeg|jpg);base64/i.test(header) ? header.toLowerCase() : "";

  return {
    bytes: Buffer.from(base64, "base64"),
    format: format.includes("png") ? "png" : "jpg"
  };
}

const pdfUnicodeFontCandidates = [
  resolve(appDirectory, "assets/fonts/NotoSansCJKsc-Regular.otf"),
  resolve(appDirectory, "server/assets/fonts/NotoSansCJKsc-Regular.otf"),
  resolve(process.cwd(), "assets/fonts/NotoSansCJKsc-Regular.otf"),
  resolve(process.cwd(), "server/assets/fonts/NotoSansCJKsc-Regular.otf"),
  resolve(process.cwd(), "server/assets/fonts/ArialUnicode.ttf"),
  resolve(process.cwd(), "assets/fonts/ArialUnicode.ttf"),
  "/Library/Fonts/Arial Unicode.ttf",
  "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
  "/System/Library/Fonts/Hiragino Sans GB.ttc",
  "/System/Library/Fonts/STHeiti Medium.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
  "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"
];

async function loadPdfFonts(pdfDoc) {
  pdfDoc.registerFontkit(fontkit);

  for (const fontPath of pdfUnicodeFontCandidates) {
    if (!existsSync(fontPath)) {
      continue;
    }

    try {
      const fontBytes = await readFile(fontPath);
      const regularFont = await pdfDoc.embedFont(fontBytes, { subset: false });

      return {
        regularFont,
        // Reuse the same Unicode-capable font for table headers.
        // Embedding a second "bold" instance from some system CJK fonts can render
        // Chinese text as solid blocks in exported PDFs.
        boldFont: regularFont,
        sanitizeText: (value) => String(value ?? "")
      };
    } catch {
      continue;
    }
  }

  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  return {
    regularFont,
    boldFont,
    sanitizeText: (value) => String(value ?? "").replace(/[^\x20-\x7E]/g, " ")
  };
}

function formatPdfDateTimeCell(record, value, options = {}) {
  const text = formatManagedRecordDateTime(record, value, options);

  if (!text) {
    return "";
  }

  const [dateText, timeText = ""] = text.split(" ");
  return timeText ? `${dateText}\n${timeText}` : dateText;
}

function truncatePdfLine(line, maxWidth, font, size) {
  let text = String(line ?? "");

  if (font.widthOfTextAtSize(text, size) <= maxWidth) {
    return text;
  }

  while (text.length > 1 && font.widthOfTextAtSize(`${text}…`, size) > maxWidth) {
    text = text.slice(0, -1);
  }

  return `${text}…`;
}

function wrapPdfText(text, maxWidth, font, size, maxLines = 4) {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n");
  const hasLineLimit = Number.isFinite(maxLines);

  if (!normalized.trim()) {
    return [""];
  }

  const lines = [];
  const paragraphs = normalized.split("\n");

  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push("");
      if (hasLineLimit && lines.length >= maxLines) {
        break;
      }
      continue;
    }

    let currentLine = "";

    for (const character of paragraph) {
      const nextLine = `${currentLine}${character}`;

      if (!currentLine || font.widthOfTextAtSize(nextLine, size) <= maxWidth) {
        currentLine = nextLine;
        continue;
      }

      lines.push(currentLine);
      currentLine = character;

      if (hasLineLimit && lines.length >= maxLines) {
        break;
      }
    }

    if (hasLineLimit && lines.length >= maxLines) {
      lines[maxLines - 1] = truncatePdfLine(lines[maxLines - 1], maxWidth, font, size);
      break;
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    if (hasLineLimit && lines.length >= maxLines) {
      break;
    }
  }

  if (hasLineLimit && lines.length > maxLines) {
    return lines.slice(0, maxLines);
  }

  if (hasLineLimit && paragraphs.length > 0 && lines.length === maxLines) {
    lines[maxLines - 1] = truncatePdfLine(lines[maxLines - 1], maxWidth, font, size);
  }

  return lines.length ? lines : [""];
}

function drawPdfCellText(page, { text, x, topY, width, height, font, size, color, align = "left", maxLines = 4 }) {
  const horizontalPadding = 4;
  const lineHeight = size + 2;
  const lines = wrapPdfText(text, Math.max(width - horizontalPadding * 2, 8), font, size, maxLines);
  const totalHeight = lines.length * lineHeight;
  let cursorY = topY - Math.max((height - totalHeight) / 2, 6) - size;

  for (const line of lines) {
    const lineWidth = font.widthOfTextAtSize(line, size);
    const drawX =
      align === "center"
        ? x + Math.max((width - lineWidth) / 2, horizontalPadding)
        : x + horizontalPadding;

    page.drawText(line, {
      x: drawX,
      y: cursorY,
      size,
      font,
      color
    });
    cursorY -= lineHeight;
  }
}

function getPdfTableColumns(records) {
  const distinctPlateNumbers = new Set(
    records.map((record) => String(record.vehicle?.plateNumber ?? "").trim()).filter(Boolean)
  );
  const isMultiVehicle = distinctPlateNumbers.size > 1;

  const columns = isMultiVehicle
    ? [
        { key: "plateNumber", label: "车牌号", width: 68, align: "center", maxLines: 2, value: (record) => record.vehicle?.plateNumber ?? "-" },
        { key: "businessDate", label: "日期", width: 60, align: "center", maxLines: 1, value: (record) => record.businessDate || "-" },
        { key: "departureTime", label: "出车时间", width: 74, align: "center", maxLines: Infinity, value: (record) => formatPdfDateTimeCell(record, record.departureTime) },
        { key: "returnTime", label: "还车时间", width: 74, align: "center", maxLines: Infinity, value: (record) => formatPdfDateTimeCell(record, record.returnTime, { isReturn: true }) },
        { key: "reason", label: "事由", width: 78, align: "left", maxLines: Infinity, value: (record) => record.reason || "-" },
        { key: "route", label: "目的地及行车路线", width: 120, align: "left", maxLines: Infinity, value: (record) => record.route || "-" },
        { key: "startMileage", label: "起步公里读数", width: 84, align: "center", maxLines: 2, value: (record) => String(record.startMileage ?? "-") },
        { key: "endMileage", label: "终点公里读数", width: 84, align: "center", maxLines: 2, value: (record) => String(record.endMileage ?? "-") },
        { key: "distance", label: "行车公里数", width: 68, align: "center", maxLines: 2, value: (record) => String(record.distance ?? "-") },
        { key: "fuel", label: "加油费用/数量", width: 88, align: "center", maxLines: Infinity, value: (record) => formatFuelExportValue(record.fuelFee, record.fuelVolume) || "-" },
        { key: "signature", label: "驾驶员签字", width: 74, align: "center", maxLines: 1, value: () => "" },
        { key: "remark", label: "备注", width: 41, align: "left", maxLines: Infinity, value: (record) => record.remark || "-" }
      ]
    : [
        { key: "businessDate", label: "日期", width: 52, align: "center", maxLines: 2, value: (record) => record.businessDate || "-" },
        { key: "departureTime", label: "出车时间", width: 76, align: "center", maxLines: Infinity, value: (record) => formatPdfDateTimeCell(record, record.departureTime) },
        { key: "returnTime", label: "还车时间", width: 76, align: "center", maxLines: Infinity, value: (record) => formatPdfDateTimeCell(record, record.returnTime, { isReturn: true }) },
        { key: "reason", label: "事由", width: 78, align: "left", maxLines: Infinity, value: (record) => record.reason || "-" },
        { key: "route", label: "目的地及行车路线", width: 132, align: "left", maxLines: Infinity, value: (record) => record.route || "-" },
        { key: "startMileage", label: "起步公里读数", width: 88, align: "center", maxLines: 2, value: (record) => String(record.startMileage ?? "-") },
        { key: "endMileage", label: "终点公里读数", width: 89, align: "center", maxLines: 2, value: (record) => String(record.endMileage ?? "-") },
        { key: "distance", label: "行车公里数", width: 73, align: "center", maxLines: 2, value: (record) => String(record.distance ?? "-") },
        { key: "fuel", label: "加油费用/数量", width: 92, align: "center", maxLines: Infinity, value: (record) => formatFuelExportValue(record.fuelFee, record.fuelVolume) || "-" },
        { key: "signature", label: "驾驶员签字", width: 73, align: "center", maxLines: 1, value: () => "" },
        { key: "remark", label: "备注", width: 42, align: "left", maxLines: Infinity, value: (record) => record.remark || "-" }
      ];

  return columns;
}

function fitPdfTableColumns(columns, pageWidth, marginX) {
  const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);
  // Leave a generous right-side safety gap so browser/PDF viewers never crop the last columns.
  const availableWidth = pageWidth - marginX * 2 - 120;

  if (totalWidth <= availableWidth) {
    return columns;
  }

  const scale = availableWidth / totalWidth;

  return columns.map((column) => ({
    ...column,
    width: column.width * scale
  }));
}

async function createRecordsPdf(records) {
  const pdfDoc = await PDFDocument.create();
  const { regularFont, boldFont, sanitizeText } = await loadPdfFonts(pdfDoc);
  const pageWidth = 841.89;
  const pageHeight = 595.28;
  const marginX = 6;
  const tableTopY = 582;
  const headerHeight = 38;
  const baseRowHeight = 39;
  const bottomMargin = 8;
  const borderColor = rgb(0, 0, 0);
  const imageCache = new Map();
  const columns = fitPdfTableColumns(getPdfTableColumns(records), pageWidth, marginX);
  const pageContentHeight = tableTopY - headerHeight - bottomMargin;
  const cellHorizontalPadding = 4;
  const bodyFontSize = 5.8;
  const bodyLineHeight = bodyFontSize + 2;

  function measureRowHeight(record) {
    let maxLineCount = 1;

    for (const column of columns) {
      if (column.key === "signature") {
        continue;
      }

      const text = sanitizeText(column.value(record));
      const lines = wrapPdfText(
        text,
        Math.max(column.width - cellHorizontalPadding * 2, 8),
        regularFont,
        bodyFontSize,
        column.maxLines ?? Infinity
      );

      maxLineCount = Math.max(maxLineCount, lines.length);
    }

    return Math.max(baseRowHeight, maxLineCount * bodyLineHeight + 12);
  }

  const paginatedRows = [];
  let currentPageRows = [];
  let usedPageHeight = 0;

  for (const record of records) {
    const rowHeight = measureRowHeight(record);

    if (currentPageRows.length > 0 && usedPageHeight + rowHeight > pageContentHeight) {
      paginatedRows.push(currentPageRows);
      currentPageRows = [];
      usedPageHeight = 0;
    }

    currentPageRows.push({ record, rowHeight });
    usedPageHeight += rowHeight;
  }

  if (currentPageRows.length === 0) {
    paginatedRows.push([]);
  } else {
    paginatedRows.push(currentPageRows);
  }

  function drawTableHeader(page) {
    let currentX = marginX;

    for (const column of columns) {
      page.drawRectangle({
        x: currentX,
        y: tableTopY - headerHeight,
        width: column.width,
        height: headerHeight,
        borderWidth: 1,
        borderColor
      });
      drawPdfCellText(page, {
        text: sanitizeText(column.label),
        x: currentX,
        topY: tableTopY,
        width: column.width,
        height: headerHeight,
        font: boldFont,
        size: 6.2,
        color: rgb(0, 0, 0),
        align: "center",
        maxLines: 2
      });
      currentX += column.width;
    }
  }

  async function drawSignatureImage(page, record, x, rowTopY, width, rowHeight) {
    if (!record.driverSignatureImage) {
      return;
    }

    let embeddedImage = imageCache.get(record.driverSignatureImage);

    if (!embeddedImage) {
      const { bytes, format } = decodeSignatureImage(record.driverSignatureImage);
      embeddedImage = format === "png" ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
      imageCache.set(record.driverSignatureImage, embeddedImage);
    }

    const targetWidth = width - 10;
    const targetHeight = rowHeight - 8;
    const imageSize = embeddedImage.scale(1);
    const scale = Math.min(targetWidth / imageSize.width, targetHeight / imageSize.height);
    const imageWidth = imageSize.width * scale;
    const imageHeight = imageSize.height * scale;
    const imageX = x + (width - imageWidth) / 2;
    const imageY = rowTopY - rowHeight + (rowHeight - imageHeight) / 2;

    page.drawImage(embeddedImage, {
      x: imageX,
      y: imageY,
      width: imageWidth,
      height: imageHeight
    });

    // Draw once more at the same position to strengthen light pen strokes in exported PDFs.
    page.drawImage(embeddedImage, {
      x: imageX,
      y: imageY,
      width: imageWidth,
      height: imageHeight
    });
  }

  async function drawRecordRow(page, record, rowTopY, rowHeight) {
    let currentX = marginX;

    for (const column of columns) {
      page.drawRectangle({
        x: currentX,
        y: rowTopY - rowHeight,
        width: column.width,
        height: rowHeight,
        borderWidth: 1,
        borderColor
      });

      if (column.key === "signature") {
        await drawSignatureImage(page, record, currentX, rowTopY, column.width, rowHeight);
      } else {
        drawPdfCellText(page, {
          text: sanitizeText(column.value(record)),
          x: currentX,
          topY: rowTopY,
          width: column.width,
          height: rowHeight,
          font: regularFont,
          size: bodyFontSize,
          color: rgb(0, 0, 0),
          align: column.align ?? "center",
          maxLines: column.maxLines ?? Infinity
        });
      }

      currentX += column.width;
    }
  }

  const totalPages = Math.max(1, paginatedRows.length);

  for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
    const page = pdfDoc.addPage([pageWidth, pageHeight]);

    drawTableHeader(page);

    const pageRows = paginatedRows[pageIndex] ?? [];
    let cursorY = tableTopY - headerHeight;

    for (const row of pageRows) {
      await drawRecordRow(page, row.record, cursorY, row.rowHeight);
      cursorY -= row.rowHeight;
    }

    while (cursorY - baseRowHeight >= bottomMargin) {
      let currentX = marginX;

      for (const column of columns) {
        page.drawRectangle({
          x: currentX,
          y: cursorY - baseRowHeight,
          width: column.width,
          height: baseRowHeight,
          borderWidth: 1,
          borderColor
        });
        currentX += column.width;
      }

      cursorY -= baseRowHeight;
    }
  }

  return pdfDoc.save();
}

const vehicleStatusValues = ["available", "inUse"];

function readVehicleStatus(value, fallback = "available") {
  const status = String(value ?? "").trim();

  if (!status) {
    return fallback;
  }

  if (status === "idle" || status === "闲置" || status === "使用中" || status === "in_use") {
    return "inUse";
  }

  if (status === "available" || status === "可用" || status === "空闲中") {
    return "available";
  }

  return status;
}

function isValidVehicleStatus(status) {
  return vehicleStatusValues.includes(status);
}

function readRecordFilters(request) {
  const recordIds = String(request.query.recordIds ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    keyword: String(request.query.keyword ?? "").trim().toLowerCase(),
    vehicleId: String(request.query.vehicleId ?? "").trim(),
    vehicleCode: String(request.query.vehicleCode ?? "").trim(),
    registrantUsername: String(request.query.registrantUsername ?? "").trim(),
    businessDate: String(request.query.businessDate ?? "").trim(),
    recordScope: String(request.query.recordScope ?? "").trim(),
    recordIds: new Set(recordIds)
  };
}

function recordMatchesFilters(record, filters) {
  const registrantName = resolveRecordDriverName(record);

  if (filters.recordScope === "visible") {
    if (!filters.recordIds?.has(record.id)) {
      return false;
    }
  }

  const matchesKeyword = filters.keyword
    ? [
        record.reason,
        record.route,
        record.vehicle.vehicleCode,
        record.vehicle.plateNumber,
        record.vehicle.brandModel,
        registrantName,
        record.user.username,
        record.driverSignature,
        record.remark ?? ""
      ]
        .join(" ")
        .toLowerCase()
        .includes(filters.keyword)
    : true;

  const matchesVehicle = filters.vehicleId
    ? record.vehicleId === filters.vehicleId
    : filters.vehicleCode
      ? record.vehicle.vehicleCode === filters.vehicleCode
      : true;
  const matchesUser = filters.registrantUsername
    ? registrantName === filters.registrantUsername || record.user.username === filters.registrantUsername
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
      if (left.businessDate !== right.businessDate) {
        return right.businessDate.localeCompare(left.businessDate);
      }

      return right.createdAt.getTime() - left.createdAt.getTime();
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
  app.use(express.json({ limit: "4mb" }));

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
      const fullName = String(request.body.fullName ?? "").trim() || username;
      const role = String(request.body.role ?? "");

      if (!username || !password || !role) {
        return response.status(400).json({ message: "用户姓名、账号、密码、角色必填" });
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
          fullName,
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

      const recordCount = await prisma.vehicleUseRecord.count({
        where: {
          userId: user.id
        }
      });

      if (recordCount > 0) {
        return response.status(400).json({
          message: `账号「${user.username}」已有${recordCount}条用车记录，暂不支持删除`
        });
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
      const status = readVehicleStatus(request.body.status);

      if (!vehicleCode || !plateNumber || !brandModel) {
        return response.status(400).json({ message: "车辆编号、车牌号、品牌型号必填" });
      }

      if (!isValidVehicleStatus(status)) {
        return response.status(400).json({ message: "车辆状态不合法" });
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
          brandModel,
          status
        }
      });

      return response.status(201).json({ vehicle: toPublicVehicle(vehicle) });
    })
  );

  app.patch(
    "/api/vehicles/:id/status",
    requireLogin,
    requireAdmin,
    asyncHandler(async (request, response) => {
      const status = readVehicleStatus(request.body.status, "");

      if (!isValidVehicleStatus(status)) {
        return response.status(400).json({ message: "车辆状态不合法" });
      }

      const vehicle = await prisma.vehicle.findUnique({
        where: {
          id: request.params.id
        }
      });

      if (!vehicle || vehicle.isDeleted) {
        return response.status(404).json({ message: "车辆不存在" });
      }

      const updatedVehicle = await prisma.vehicle.update({
        where: {
          id: vehicle.id
        },
        data: {
          status
        }
      });

      return response.json({ vehicle: toPublicVehicle(updatedVehicle) });
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
      const buffer = Buffer.from(await createRecordsPdf(records));

      response.setHeader(
        "Content-Type",
        "application/pdf"
      );
      const fileName = formatPdfExportFileName();
      response.setHeader(
        "Content-Disposition",
        `attachment; filename="vehicle-records.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}`
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
      const departureTime = departureDateTime.datetime || departureDateTime.time;
      const returnTime = returnDateTime.datetime || returnDateTime.time;
      const reason = readRequiredText(request.body.reason);
      const route = readRequiredText(request.body.route);
      const legacyDriverSignature = readRequiredText(request.body.driverSignature);
      const driverName =
        readRequiredText(request.body.driverName) ||
        legacyDriverSignature ||
        resolveUserFullName(request.auth.user);
      const driverSignatureImage = String(request.body.driverSignatureImage ?? "").trim();
      const startMileage = parseMileage(request.body.startMileage);
      const endMileage = parseMileage(request.body.endMileage);
      const fuelFee = readOptionalText(request.body.fuelFee);
      const fuelVolume = readOptionalText(request.body.fuelVolume);
      const remark = readOptionalText(request.body.remark);
      const fieldErrors = getRegistryConstraintErrors({
        reason,
        route,
        remark,
        startMileage: request.body.startMileage,
        endMileage: request.body.endMileage,
        fuelFee,
        fuelVolume
      });

      if (
        !vehicleId ||
        !businessDate ||
        !departureTime ||
        !returnTime ||
        !reason ||
        !route ||
        !driverName
      ) {
        return response.status(400).json({
          message: "日期、出车时间、还车时间、事由、路线、起步公里、终点公里、驾驶员签字必填"
        });
      }

      if (Object.keys(fieldErrors).length > 0) {
        return response.status(400).json({
          message: Object.values(fieldErrors)[0],
          fieldErrors
        });
      }

      if (startMileage === null || endMileage === null) {
        return response.status(400).json({ message: "起步公里和终点公里必须为非负数字" });
      }

      if (!isValidNonNegativeDecimal(fuelFee) || !isValidNonNegativeDecimal(fuelVolume)) {
        return response.status(400).json({ message: "加油费用和加油数量必须为非负数字" });
      }

      if (driverSignatureImage && !isValidSignatureImage(driverSignatureImage)) {
        return response.status(400).json({ message: "手写签字无效，请重新签字后提交" });
      }

      if (!driverSignatureImage && !legacyDriverSignature) {
        return response.status(400).json({ message: "日期、出车时间、还车时间、事由、路线、起步公里、终点公里、驾驶员签字必填" });
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
              : isReturnEarlierThanDeparture(departureTime, returnTime),
          fuelFee,
          fuelVolume,
          driverName,
          driverSignature: driverName,
          driverSignatureImage: driverSignatureImage || null,
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

  app.use((error, _request, response, next) => {
    if (error?.type === "entity.too.large" || error?.status === 413) {
      return response.status(413).json({
        message: "手写签字内容过大，请缩短签字范围或清空重签后再提交"
      });
    }

    return next(error);
  });

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
