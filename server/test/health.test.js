import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "../src/app.js";

describe("Issue 0 health check", () => {
  it("returns an ok response from the backend health endpoint", async () => {
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });
});
