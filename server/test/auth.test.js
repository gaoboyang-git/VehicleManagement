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

describe("Issue 1 authentication API", () => {
  let tempDir;
  let prisma;
  let app;

  beforeAll(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "vehicle-auth-"));
    const databaseUrl = `file:${path.join(tempDir, "auth.db")}`;
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

  it("logs in an administrator with a valid username and password", async () => {
    const response = await request(app)
      .post("/api/login")
      .send({ username: "admin", password: "admin" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      user: {
        username: "admin",
        role: "admin"
      }
    });
    expect(response.headers["set-cookie"]?.[0]).toContain("sessionId=");
  });

  it("logs in an employee and returns the employee role", async () => {
    const response = await request(app)
      .post("/api/login")
      .send({ username: "employee", password: "Employee001" });

    expect(response.status).toBe(200);
    expect(response.body.user).toEqual({
      username: "employee",
      role: "employee"
    });
  });

  it("returns the same login failure message for a wrong password and a missing account", async () => {
    const wrongPassword = await request(app)
      .post("/api/login")
      .send({ username: "employee", password: "wrong" });
    const missingAccount = await request(app)
      .post("/api/login")
      .send({ username: "missing", password: "anything" });

    expect(wrongPassword.status).toBe(401);
    expect(missingAccount.status).toBe(401);
    expect(wrongPassword.body).toEqual({ message: "账号或密码错误" });
    expect(missingAccount.body).toEqual({ message: "账号或密码错误" });
  });

  it("rejects login when username or password is blank", async () => {
    const missingUsername = await request(app)
      .post("/api/login")
      .send({ username: "", password: "admin" });
    const missingPassword = await request(app)
      .post("/api/login")
      .send({ username: "admin", password: "" });

    expect(missingUsername.status).toBe(400);
    expect(missingPassword.status).toBe(400);
  });

  it("rejects password changes when the user is not logged in", async () => {
    const response = await request(app).post("/api/change-password").send({
      currentPassword: "Employee001",
      newPassword: "NewEmployee001",
      confirmPassword: "NewEmployee001"
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "未登录" });
  });

  it("changes the current employee password, invalidates the current session, and rejects the old password", async () => {
    const agent = request.agent(app);

    await agent.post("/api/login").send({ username: "employee", password: "Employee001" }).expect(200);

    const changeResponse = await agent.post("/api/change-password").send({
      currentPassword: "Employee001",
      newPassword: "NewEmployee001",
      confirmPassword: "NewEmployee001"
    });

    expect(changeResponse.status).toBe(200);
    expect(changeResponse.body).toEqual({ message: "密码已修改，请重新登录" });

    await agent.post("/api/change-password").send({
      currentPassword: "NewEmployee001",
      newPassword: "Another001",
      confirmPassword: "Another001"
    }).expect(401);

    await request(app)
      .post("/api/login")
      .send({ username: "employee", password: "Employee001" })
      .expect(401);

    await request(app)
      .post("/api/login")
      .send({ username: "employee", password: "NewEmployee001" })
      .expect(200);
  });

  it("does not change the password when the current password is wrong", async () => {
    const agent = request.agent(app);

    await agent.post("/api/login").send({ username: "employee", password: "Employee001" }).expect(200);

    const response = await agent.post("/api/change-password").send({
      currentPassword: "wrong",
      newPassword: "NewEmployee001",
      confirmPassword: "NewEmployee001"
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: "当前密码错误" });

    await request(app)
      .post("/api/login")
      .send({ username: "employee", password: "Employee001" })
      .expect(200);
  });

  it("rejects mismatched new passwords and a new password equal to the current password", async () => {
    const agent = request.agent(app);

    await agent.post("/api/login").send({ username: "employee", password: "Employee001" }).expect(200);

    const mismatch = await agent.post("/api/change-password").send({
      currentPassword: "Employee001",
      newPassword: "NewEmployee001",
      confirmPassword: "Different001"
    });
    const samePassword = await agent.post("/api/change-password").send({
      currentPassword: "Employee001",
      newPassword: "Employee001",
      confirmPassword: "Employee001"
    });

    expect(mismatch.status).toBe(400);
    expect(mismatch.body).toEqual({ message: "两次新密码不一致" });
    expect(samePassword.status).toBe(400);
    expect(samePassword.body).toEqual({ message: "新密码不能与当前密码相同" });
  });

  it("allows an administrator to change only their own password through the self-service endpoint", async () => {
    const agent = request.agent(app);

    await agent.post("/api/login").send({ username: "admin", password: "admin" }).expect(200);

    await agent.post("/api/change-password").send({
      username: "employee",
      currentPassword: "admin",
      newPassword: "NewAdmin001",
      confirmPassword: "NewAdmin001"
    }).expect(200);

    await request(app)
      .post("/api/login")
      .send({ username: "admin", password: "NewAdmin001" })
      .expect(200);
    await request(app)
      .post("/api/login")
      .send({ username: "employee", password: "NewAdmin001" })
      .expect(401);
  });

  it("clears the session on logout", async () => {
    const agent = request.agent(app);

    await agent.post("/api/login").send({ username: "employee", password: "Employee001" }).expect(200);
    await agent.post("/api/logout").expect(204);

    await agent.post("/api/change-password").send({
      currentPassword: "Employee001",
      newPassword: "NewEmployee001",
      confirmPassword: "NewEmployee001"
    }).expect(401);
  });
});
