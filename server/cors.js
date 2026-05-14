const LOCAL_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
]);

const CORS_METHODS = "GET,POST,DELETE,PUT,OPTIONS";
const CORS_HEADERS = "Content-Type,X-CPJS-Session";

const parseOrigins = (value) => String(value || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export function getAllowedOrigins(env = process.env) {
  return new Set([
    ...parseOrigins(env.ALLOWED_ORIGINS),
    ...parseOrigins(env.APP_ORIGIN),
    ...parseOrigins(env.PUBLIC_APP_URL),
  ]);
}

export function isProductionServerRuntime(env = process.env) {
  return env.NODE_ENV === "production" || env.BUILD_ENV === "production";
}

export function getSelfOrigin(req) {
  const host = req.get?.("host");
  if (!host) return null;
  const forwardedProto = req.get?.("x-forwarded-proto");
  const protocol = (forwardedProto || req.protocol || "https").split(",")[0].trim();
  return `${protocol}://${host}`;
}

export function isAllowedOrigin(origin, req, env = process.env) {
  if (!origin) return true;

  const allowedOrigins = getAllowedOrigins(env);
  const selfOrigin = getSelfOrigin(req);
  if (selfOrigin && origin === selfOrigin) return true;
  if (allowedOrigins.has(origin)) return true;
  if (!isProductionServerRuntime(env) && LOCAL_ORIGINS.has(origin)) return true;

  return false;
}

export function applyCorsHeaders(req, res, env = process.env) {
  const origin = req.get?.("origin");
  if (origin && isAllowedOrigin(origin, req, env)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", CORS_METHODS);
  res.setHeader("Access-Control-Allow-Headers", CORS_HEADERS);
  res.setHeader("Access-Control-Max-Age", "600");
}

export function createCorsMiddleware({ env = process.env, log = () => {} } = {}) {
  return (req, res, next) => {
    if (!req.path.startsWith("/api")) return next();

    const origin = req.get("origin");
    if (!isAllowedOrigin(origin, req, env)) {
      log("WARNING", "corsOriginRejected", { origin, path: req.path });
      return res.status(403).json({
        success: false,
        code: "ERR_FORBIDDEN",
        message: "Request origin is not allowed.",
      });
    }

    applyCorsHeaders(req, res, env);
    if (req.method === "OPTIONS") return res.status(204).end();
    return next();
  };
}
