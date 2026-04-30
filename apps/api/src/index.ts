import "./env";
import express from "express";
import cors from "cors";
import http from "http";
import morgan from "morgan";

import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./trpc";
import { createContext } from "./trpc/trpc";

import { broadcastLog, setupLogWebSocketServer } from "./ws/logs";

// REST routes
import authRouter from "./routes/auth";
import backupRouterLegacy from "./routes/backup";
import infraRouterLegacy from "./routes/infra";

const app = express();

// ─── Middleware ─────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(morgan("dev")); // logging

// ─── REST Auth (legacy support) ─────────────────────────────
app.use("/api/auth", authRouter);

// ─── tRPC ──────────────────────────────────────────────────
app.use(
  "/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext,
    onError: ({ error, path }) => {
      console.error(`[tRPC ERROR] ${path}:`, error);
    },
  })
);

// ─── Legacy REST (for old Vite UI) ──────────────────────────
app.use("/api/backup", backupRouterLegacy);
app.use("/api/infra", infraRouterLegacy);

// ─── Health ────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", ts: Date.now() });
});

app.post("/internal/log", (req, res) => {
  const { jobId, message, type } = req.body ?? {};
  if (!jobId || typeof message !== "string") {
    res.status(400).json({ error: "jobId and message are required" });
    return;
  }

  broadcastLog(String(jobId), message, type === "error" || type === "done" ? type : "log");
  res.json({ ok: true });
});

// ─── HTTP + WS Server ──────────────────────────────────────
const PORT = Number(process.env.PORT ?? 4000);

const httpServer = http.createServer(app);

// Attach WebSocket server
setupLogWebSocketServer(httpServer);

// IMPORTANT: bind to 0.0.0.0 (fix WSL / network access)
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log("\n═══════════════════════════════════════");
  console.log(`[API] Listening on http://localhost:${PORT}`);
  console.log(`[API] Health: http://localhost:${PORT}/health`);
  console.log(`[API] tRPC: http://localhost:${PORT}/trpc`);
  console.log(`[API] WS Logs: ws://localhost:${PORT}/ws/logs?jobId=<id>`);
  console.log("═══════════════════════════════════════\n");
});
