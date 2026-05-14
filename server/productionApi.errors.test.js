import express from "express";
import { createServer } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { createProductionApiRouter } from "./productionApi.js";

async function withApi(router, run) {
  const app = express();
  app.use(express.json());
  app.use("/api", router);

  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

describe("production API Firebase failure handling", () => {
  it("returns a safe error when Firebase reads fail", async () => {
    const db = {
      collection: vi.fn(() => {
        throw new Error("firebase read failed with service-account-secret");
      }),
    };
    const log = vi.fn();

    await withApi(createProductionApiRouter({ db, log }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/bootstrap/status`);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body).toMatchObject({
        success: false,
        code: "ERR_NETWORK",
        message: "Service unavailable. Please try again.",
      });
      expect(JSON.stringify(body)).not.toContain("service-account-secret");
      expect(log).toHaveBeenCalledWith("ERROR", "apiUnhandledError", {
        error: expect.any(Error),
      });
    });
  });

  it("returns a safe error when Firebase writes fail", async () => {
    const db = {
      runTransaction: vi.fn().mockRejectedValue(new Error("firebase write failed with service-account-secret")),
    };
    const log = vi.fn();

    await withApi(createProductionApiRouter({ db, log }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/bootstrap/master`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin" }),
      });
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body).toMatchObject({
        success: false,
        code: "ERR_NETWORK",
        message: "Service unavailable. Please try again.",
      });
      expect(JSON.stringify(body)).not.toContain("service-account-secret");
      expect(log).toHaveBeenCalledWith("ERROR", "apiUnhandledError", {
        error: expect.any(Error),
      });
    });
  });
});
