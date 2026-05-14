import { describe, expect, it, vi } from "vitest";
import { createCorsMiddleware, isAllowedOrigin } from "./cors.js";

const reqFor = ({ origin, host = "app.example.com", method = "GET", path = "/api/test", protocol = "https" } = {}) => ({
  path,
  method,
  protocol,
  get: (name) => {
    const headers = {
      origin,
      host,
      "x-forwarded-proto": protocol,
    };
    return headers[String(name).toLowerCase()];
  },
});

const resFor = () => {
  const res = {
    headers: {},
    statusCode: 200,
    setHeader: vi.fn((key, value) => { res.headers[key] = value; }),
    status: vi.fn((code) => { res.statusCode = code; return res; }),
    json: vi.fn((body) => { res.body = body; return res; }),
    end: vi.fn(() => res),
  };
  return res;
};

describe("production CORS policy", () => {
  it("allows approved local origins outside production", () => {
    const req = reqFor({ origin: "http://localhost:3000", host: "localhost:8080", protocol: "http" });
    expect(isAllowedOrigin("http://localhost:3000", req, { NODE_ENV: "development" })).toBe(true);
  });

  it("allows approved production origins", () => {
    const req = reqFor({ origin: "https://studio.cruzpham.com" });
    expect(isAllowedOrigin("https://studio.cruzpham.com", req, {
      NODE_ENV: "production",
      ALLOWED_ORIGINS: "https://studio.cruzpham.com",
    })).toBe(true);
  });

  it("rejects unapproved production origins", () => {
    const req = reqFor({ origin: "https://evil.example" });
    expect(isAllowedOrigin("https://evil.example", req, {
      NODE_ENV: "production",
      ALLOWED_ORIGINS: "https://studio.cruzpham.com",
    })).toBe(false);
  });

  it("answers approved preflight requests", () => {
    const log = vi.fn();
    const middleware = createCorsMiddleware({
      env: { NODE_ENV: "production", ALLOWED_ORIGINS: "https://studio.cruzpham.com" },
      log,
    });
    const req = reqFor({ origin: "https://studio.cruzpham.com", method: "OPTIONS" });
    const res = resFor();
    const next = vi.fn();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("https://studio.cruzpham.com");
    expect(res.headers["Access-Control-Allow-Methods"]).toContain("POST");
    expect(next).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("logs rejected origins safely", () => {
    const log = vi.fn();
    const middleware = createCorsMiddleware({
      env: { NODE_ENV: "production", ALLOWED_ORIGINS: "https://studio.cruzpham.com" },
      log,
    });
    const req = reqFor({ origin: "https://evil.example" });
    const res = resFor();

    middleware(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(log).toHaveBeenCalledWith("WARNING", "corsOriginRejected", {
      origin: "https://evil.example",
      path: "/api/test",
    });
  });
});
