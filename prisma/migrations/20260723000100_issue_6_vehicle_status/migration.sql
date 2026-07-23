-- Issue 6 adds a real manual vehicle availability state.
ALTER TABLE "Vehicle" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'available';
