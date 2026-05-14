import { describe, expect, it, vi } from "vitest";
import { safeLog } from "./safeLog.js";

describe("safe server logging", () => {
  it("masks secrets, tokens, emails, and phone numbers", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    safeLog("ERROR", "deliveryFailure", {
      apiKey: "SG.secret-value",
      token: "pk-abcdef123456789",
      email: "admin@example.com",
      phone: "+15551112222",
      error: new Error("failed for admin@example.com with pk-abcdef123456789"),
    });

    const output = spy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).not.toContain("SG.secret-value");
    expect(output).not.toContain("pk-abcdef123456789");
    expect(output).not.toContain("admin@example.com");
    expect(output).not.toContain("+15551112222");

    spy.mockRestore();
  });
});
