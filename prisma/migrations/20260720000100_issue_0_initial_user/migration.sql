-- Issue 0 only creates the minimal user table needed for auth initialization.
CREATE TABLE "User" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "username" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "isBuiltinAdmin" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
