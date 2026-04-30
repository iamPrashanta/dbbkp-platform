import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import { Server } from "http";

// Map: jobId → Set of connected WebSocket clients
export const logClients = new Map<string, Set<WebSocket>>();
const logBuffers = new Map<string, Array<{ type: "log" | "error" | "done"; message: string; jobId: string; ts: number }>>();
const MAX_BUFFERED_MESSAGES = 1000;

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

    const buffered = logBuffers.get(jobId) ?? [];
    for (const entry of buffered) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ ...entry, replay: true }));
      }
    }

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
  const payloadObject = { type, message, jobId: String(jobId), ts: Date.now() };
  const buffer = logBuffers.get(String(jobId)) ?? [];
  buffer.push(payloadObject);
  if (buffer.length > MAX_BUFFERED_MESSAGES) {
    buffer.splice(0, buffer.length - MAX_BUFFERED_MESSAGES);
  }
  logBuffers.set(String(jobId), buffer);

  const subscribers = logClients.get(String(jobId));
  if (!subscribers || subscribers.size === 0) return;

  const payload = JSON.stringify(payloadObject);
  for (const ws of subscribers) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}
