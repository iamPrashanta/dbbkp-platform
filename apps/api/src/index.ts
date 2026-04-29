import express from "express";
import cors from "cors";
import http from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./trpc/index";
import { createContext } from "./trpc/trpc";
import { setupLogWebSocketServer } from "./ws/logs";
import authRouter from "./routes/auth";

// Legacy REST routes (kept for backwards compat with existing UI)
import backupRouterLegacy from "./routes/backup";
import infraRouterLegacy from "./routes/infra";

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

// ─── Auth REST (for simple fetch-based login from existing UI) ────────────────
app.use("/api/auth", authRouter);

// ─── tRPC ─────────────────────────────────────────────────────────────────────
app.use(
  "/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext,
    onError: ({ error, path }) => {
      console.error(`[tRPC] Error in ${path}:`, error.message);
    },
  })
);

// ─── Legacy REST routes (kept for current Vite dashboard) ─────────────────────
app.use("/api/backup", backupRouterLegacy);
app.use("/api/infra", infraRouterLegacy);

// ─── Health ───────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ status: "ok", ts: Date.now() }));

// ─── HTTP + WebSocket server ──────────────────────────────────────────────────
const PORT = Number(process.env.PORT ?? 3000);
const httpServer = http.createServer(app);
setupLogWebSocketServer(httpServer);

httpServer.listen(PORT, () => {
  console.log(`[Control Plane API] Listening on port ${PORT}`);
  console.log(`[Control Plane API] tRPC at http://localhost:${PORT}/trpc`);
  console.log(`[Control Plane API] WebSocket logs at ws://localhost:${PORT}/ws/logs?jobId=<id>`);
});
