import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("production API guardrails", () => {
  const productionApiPath = path.join(process.cwd(), "server", "productionApi.js");

  it("does not import or reference local mock DB storage", () => {
    const source = readFileSync(productionApiPath, "utf8");

    expect(source).not.toMatch(/localStorage/);
    expect(source).not.toMatch(/cruzpham_db_/);
    expect(source).not.toMatch(/cruzpham_sys_bootstrap/);
  });

  it("bootstrap creates only Firebase system/user records, not mock seed data", () => {
    const source = readFileSync(productionApiPath, "utf8");

    expect(source).toContain("system_bootstrap");
    expect(source).toContain("MASTER_ADMIN");
    expect(source).not.toContain("saveUsers");
    expect(source).not.toContain("seed");
  });
});
