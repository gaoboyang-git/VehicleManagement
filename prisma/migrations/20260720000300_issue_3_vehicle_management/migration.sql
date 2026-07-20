-- Issue 3 adds vehicle archive management with soft delete support.
CREATE TABLE "Vehicle" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "vehicleCode" TEXT NOT NULL,
  "plateNumber" TEXT NOT NULL,
  "brandModel" TEXT NOT NULL,
  "isDeleted" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "Vehicle_vehicleCode_key" ON "Vehicle"("vehicleCode");
CREATE UNIQUE INDEX "Vehicle_plateNumber_key" ON "Vehicle"("plateNumber");
