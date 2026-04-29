import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import { Server } from "http";

// Map: jobId → Set of connected WebSocket clients
export const logClients = new Map<string, Set<WebSocket>>();

export function setupLogWebSocketServer(httpServer: Server) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws/logs" });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url!, `http://localhost`);
    const jobId = url.searchParams.get("jobId");

    if (!jobId) {
      ws.close(1008, "jobId required");
      return;
    }

    if (!logClients.has(jobId)) logClients.set(jobId, new Set());
    logClients.get(jobId)!.add(ws);

    console.log(`[WS] Client subscribed to job ${jobId}`);

    ws.on("close", () => {
      logClients.get(jobId)?.delete(ws);
      if (logClients.get(jobId)?.size === 0) logClients.delete(jobId);
    });

    ws.on("error", () => {
      logClients.get(jobId)?.delete(ws);
    });
  });

  console.log("[WS] Log streaming WebSocket server ready on /ws/logs");
  return wss;
}

// Call this from workers to broadcast a log line to all subscribers
export function broadcastLog(jobId: string, message: string, type: "log" | "error" | "done" = "log") {
  const subscribers = logClients.get(String(jobId));
  if (!subscribers || subscribers.size === 0) return;

  const payload = JSON.stringify({ type, message, jobId, ts: Date.now() });
  for (const ws of subscribers) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}
