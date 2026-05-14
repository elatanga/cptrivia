import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createCorsMiddleware } from "./server/cors.js";
import { createProductionApiRouter } from "./server/productionApi.js";
import { resolveRuntimeConfigEnv } from "./server/runtimeConfig.js";
import { safeLog } from "./server/safeLog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Global Error Handlers
process.on('uncaughtException', (err) => {
  console.error('CRITICAL: Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('CRITICAL: Unhandled Rejection at:', promise, 'reason:', reason);
});

const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(createCorsMiddleware({ log: safeLog }));
app.use("/api", createProductionApiRouter({ log: safeLog }));

// 1. CONSTANTS & ENV
const PORT = process.env.PORT || 8080;
const REQUIRED_KEYS = [
  "FIREBASE_API_KEY",
  "FIREBASE_AUTH_DOMAIN",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_STORAGE_BUCKET",
  "FIREBASE_MESSAGING_SENDER_ID",
  "FIREBASE_APP_ID",
];

// 2. RUNTIME CONFIG ENDPOINT 
app.get("/runtime-config.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");

  const missing = REQUIRED_KEYS.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.warn("CONFIG WARNING: Missing runtime keys:", missing);
  }

  const safe = (v) => String(v || "").replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
  const { buildEnv, productionRuntime, requestedDataSource, dataSource } = resolveRuntimeConfigEnv(process.env);

  if (productionRuntime && requestedDataSource.toLowerCase() !== "firebase") {
    safeLog("WARNING", "mockDataSourceIgnoredInProduction", { buildEnv, requestedDataSource });
  }

  const configContent = `
    window.__RUNTIME_CONFIG__ = {
      FIREBASE_API_KEY: "${safe(process.env.FIREBASE_API_KEY)}",
      FIREBASE_AUTH_DOMAIN: "${safe(process.env.FIREBASE_AUTH_DOMAIN)}",
      FIREBASE_PROJECT_ID: "${safe(process.env.FIREBASE_PROJECT_ID)}",
      FIREBASE_STORAGE_BUCKET: "${safe(process.env.FIREBASE_STORAGE_BUCKET)}",
      FIREBASE_MESSAGING_SENDER_ID: "${safe(process.env.FIREBASE_MESSAGING_SENDER_ID)}",
      FIREBASE_APP_ID: "${safe(process.env.FIREBASE_APP_ID)}",
      API_KEY: "${safe(process.env.API_KEY)}",
      GEMINI_API_KEY: "${safe(process.env.GEMINI_API_KEY)}",
      GEMINI_MODEL: "${safe(process.env.GEMINI_MODEL)}",
      AI_MODEL: "${safe(process.env.AI_MODEL)}",
      BUILD_ENV: "${safe(buildEnv)}",
      DATA_SOURCE: "${safe(dataSource)}"
    };
  `;
  res.status(200).send(configContent);
});

// 3. HEALTH CHECK
app.get("/_health", (req, res) => res.status(200).send("OK"));

// 4. STATIC FILES
const buildPath = path.join(__dirname, "build");
app.use(express.static(buildPath, {
  maxAge: "1h",
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// 5. SPA FALLBACK
app.get("*", (req, res) => {
  if (req.path.match(/\.(js|css|png|jpg|jpeg|gif|ico|json|svg|map)$/)) {
    return res.status(404).send("Not Found");
  }
  res.sendFile(path.join(buildPath, "index.html"));
});

// 6. START SERVER (Single Listener)
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`SERVER: Listening on port ${PORT}`);
  console.log(`SERVER: Serving build from ${buildPath}`);
});

// Graceful Shutdown
process.on('SIGTERM', () => {
  server.close(() => console.log('Process terminated'));
});
