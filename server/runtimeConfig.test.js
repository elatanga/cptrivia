import { describe, expect, it } from "vitest";
import { resolveRuntimeConfigEnv } from "./runtimeConfig.js";

describe("server runtime data source config", () => {
  it("uses mock data for local server runtime by default", () => {
    expect(resolveRuntimeConfigEnv({ BUILD_ENV: "local" }).dataSource).toBe("mock");
  });

  it("forces Firebase in production even if mock is requested", () => {
    const result = resolveRuntimeConfigEnv({
      BUILD_ENV: "production",
      NODE_ENV: "production",
      DATA_SOURCE: "mock",
    });

    expect(result.productionRuntime).toBe(true);
    expect(result.requestedDataSource).toBe("mock");
    expect(result.dataSource).toBe("firebase");
  });
});
