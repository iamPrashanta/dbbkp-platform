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
import sitesRouter from "./routes/sites";
import backupRouterLegacy from "./routes/backup";
import infraRouterLegacy from "./routes/infra";

const app = express();

// ─── Middleware ─────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(morgan("dev", {
  skip: (req) => req.url === "/internal/log"
}));

// ─── REST Auth (legacy support) ─────────────────────────────
app.use("/api/auth", authRouter);
app.use("/api/sites", sitesRouter);

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

import getPort from "get-port";

// ─── HTTP + WS Server ──────────────────────────────────────
async function startServer() {
  const DEFAULT_PORT = Number(process.env.PORT ?? 4000);
  
  // Dynamic port allocation (checks OS-level availability)
  const port = await getPort({ 
    port: [DEFAULT_PORT, 4001, 4002, 4003] 
  });

  const httpServer = http.createServer(app);

  // Attach WebSocket server
  setupLogWebSocketServer(httpServer);

  httpServer.listen(port, "0.0.0.0", () => {
    console.log("\n═══════════════════════════════════════");
    console.log(`[API] Server Ready`);
    console.log(`[API] URL: http://localhost:${port}`);
    console.log(`[API] tRPC: http://localhost:${port}/trpc`);
    console.log(`[API] WS Logs: ws://localhost:${port}/ws/logs`);
    if (port !== DEFAULT_PORT) {
      console.warn(`[API] Warning: Port ${DEFAULT_PORT} was busy. Fallback to ${port}.`);
    }
    console.log("═══════════════════════════════════════\n");
  });

  httpServer.on("error", (err: any) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[API] Error: Port ${port} is already in use.`);
      process.exit(1);
    } else {
      console.error("[API] Server error:", err);
    }
  });
}

startServer().catch((err) => {
  console.error("[API] Failed to start server:", err);
  process.exit(1);
});
