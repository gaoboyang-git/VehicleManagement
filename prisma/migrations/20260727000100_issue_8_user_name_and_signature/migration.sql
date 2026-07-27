ALTER TABLE "User" ADD COLUMN "fullName" TEXT NOT NULL DEFAULT '';

UPDATE "User"
SET "fullName" = "username"
WHERE TRIM(COALESCE("fullName", '')) = '';

ALTER TABLE "VehicleUseRecord" ADD COLUMN "driverName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "VehicleUseRecord" ADD COLUMN "driverSignatureImage" TEXT;

UPDATE "VehicleUseRecord"
SET "driverName" = "driverSignature"
WHERE TRIM(COALESCE("driverName", '')) = '';
