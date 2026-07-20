-- Issue 4 adds vehicle use records for registry submission and mileage chaining.
CREATE TABLE "VehicleUseRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "vehicleId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "businessDate" TEXT NOT NULL,
  "departureTime" TEXT NOT NULL,
  "returnTime" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "route" TEXT NOT NULL,
  "startMileage" REAL NOT NULL,
  "endMileage" REAL NOT NULL,
  "distance" REAL NOT NULL,
  "isCrossDay" BOOLEAN NOT NULL DEFAULT false,
  "fuelFee" TEXT,
  "fuelVolume" TEXT,
  "driverSignature" TEXT NOT NULL,
  "remark" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VehicleUseRecord_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VehicleUseRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "VehicleUseRecord_vehicleId_createdAt_idx" ON "VehicleUseRecord"("vehicleId", "createdAt");
CREATE INDEX "VehicleUseRecord_userId_createdAt_idx" ON "VehicleUseRecord"("userId", "createdAt");
