import { Router } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db, nodes, nodeMetrics } from "@dbbkp/db";
import { eq, lt, sql } from "drizzle-orm";
import { logAudit } from "@dbbkp/audit";
import { broadcastMetrics } from "../ws/gateway";

const router = Router();

// ─── Middleware: verify node bearer token ─────────────────────────────────────
async function requireNodeToken(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing node token" });
    return;
  }
  const token = authHeader.slice(7);

  // nodeId must be provided in the header
  const nodeId = req.headers["x-node-id"] as string;
  if (!nodeId) {
    res.status(401).json({ error: "Missing x-node-id header" });
    return;
  }

  const [node] = await db.select().from(nodes).where(eq(nodes.id, nodeId)).limit(1);
  if (!node) {
    res.status(401).json({ error: "Unknown node" });
    return;
  }

  const valid = await bcrypt.compare(token, node.tokenHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid node token" });
    return;
  }

  req.node = node;
  next();
}

// ─── POST /internal/nodes/register ───────────────────────────────────────────
// Called by the installer after `dbbkp-agent install`.
// Requires the one-time INTERNAL_SECRET (bootstrap key), then returns a
// permanent bearer token that is stored on-host at /etc/dbbkp-agent/token.
router.post("/register", async (req, res) => {
  const internalSecret = process.env.INTERNAL_SECRET || "dbbkp-internal-secret-change-me";
  if (req.headers["x-internal-key"] !== internalSecret) {
    console.warn(`[Nodes] Unauthorized registration attempt from ${req.ip}`);
    res.status(403).json({ error: "Invalid bootstrap key" });
    return;
  }

  try {
    const {
      name,
      hostname,
      ip,
      publicIp,
      os,
      arch,
      cpuCores,
      memoryMb,
      dockerVersion,
      agentVersion,
    } = req.body;

    if (!name || !hostname) {
      res.status(400).json({ error: "name and hostname are required" });
      return;
    }

    // Generate a permanent node token (cryptographically random, 48 bytes → base64)
    const rawToken = crypto.randomBytes(48).toString("base64url");
    const tokenHash = await bcrypt.hash(rawToken, 12);

    const [node] = await db
      .insert(nodes)
      .values({
        id: crypto.randomUUID(),
        name,
        hostname,
        tokenHash,
        ip: ip ?? null,
        publicIp: publicIp ?? null,
        os: os ?? null,
        arch: arch ?? null,
        cpuCores: cpuCores ?? null,
        memoryMb: memoryMb ?? null,
        dockerVersion: dockerVersion ?? null,
        agentVersion: agentVersion ?? null,
        status: "online",
        lastHeartbeatAt: new Date(),
      })
      .returning();

    logAudit("site_create", {
      targetId: node.id,
      targetType: "node",
      targetName: node.hostname,
      metadata: { os, arch, agentVersion },
      ip: req.ip,
    });

    console.log(`[Nodes] Registered new node: ${node.hostname} (${node.id})`);

    // Return the plaintext token — this is the ONLY time it is ever sent
    res.status(201).json({
      nodeId: node.id,
      token: rawToken,
      message: "Store this token securely at /etc/dbbkp-agent/token — it will not be shown again",
    });
  } catch (err: any) {
    console.error("[Nodes:Register] Error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

// ─── POST /internal/nodes/heartbeat ──────────────────────────────────────────
router.post("/heartbeat", requireNodeToken, async (req: any, res) => {
  try {
    const { agentVersion, uptime } = req.body;

    await db
      .update(nodes)
      .set({
        status: "online",
        lastHeartbeatAt: new Date(),
        agentVersion: agentVersion ?? req.node.agentVersion,
        updatedAt: new Date(),
      })
      .where(eq(nodes.id, req.node.id));

    res.json({ ok: true, ts: Date.now() });
  } catch (err: any) {
    console.error("[Nodes:Heartbeat] Error:", err);
    res.status(500).json({ error: "Heartbeat failed" });
  }
});

// ─── POST /internal/nodes/metrics ────────────────────────────────────────────
router.post("/metrics", requireNodeToken, async (req: any, res) => {
  try {
    const {
      cpuUsage,
      memoryUsage,
      diskUsage,
      networkRxKb,
      networkTxKb,
    } = req.body;

    await db.insert(nodeMetrics).values({
      id: crypto.randomUUID(),
      nodeId: req.node.id,
      cpuUsage: cpuUsage ?? null,
      memoryUsage: memoryUsage ?? null,
      diskUsage: diskUsage ?? null,
      networkRxKb: networkRxKb ?? null,
      networkTxKb: networkTxKb ?? null,
    });

    // Push to all dashboard subscribers in real-time
    broadcastMetrics(req.node.id, {
      cpu: cpuUsage ?? 0,
      memory: memoryUsage ?? 0,
      disk: diskUsage ?? 0,
      networkRxKb: networkRxKb ?? 0,
      networkTxKb: networkTxKb ?? 0,
    });

    res.json({ ok: true });
  } catch (err: any) {
    console.error("[Nodes:Metrics] Error:", err);
    res.status(500).json({ error: "Metrics ingestion failed" });
  }
});

// ─── POST /internal/nodes/events ─────────────────────────────────────────────
// Generic event endpoint: agents can push security alerts, deployment events, etc.
router.post("/events", requireNodeToken, async (req: any, res) => {
  try {
    const { type, severity, message, details } = req.body;

    if (!type || !message) {
      res.status(400).json({ error: "type and message are required" });
      return;
    }

    // Reuse the security alert pathway for threat events
    if (type === "threat" || type === "malware" || type === "suspicious_process" || type === "cron") {
      const { securityAlerts } = await import("@dbbkp/db");
      await db.insert(securityAlerts).values({
        id: crypto.randomUUID(),
        type,
        severity: severity ?? "high",
        message,
        details: details ? JSON.stringify(details) : null,
      });
    }

    // Always write to audit log
    logAudit("threat_detected", {
      targetType: "node",
      targetId: req.node.id,
      targetName: req.node.hostname,
      metadata: { type, severity, message },
    });

    res.json({ ok: true });
  } catch (err: any) {
    console.error("[Nodes:Events] Error:", err);
    res.status(500).json({ error: "Event ingestion failed" });
  }
});

// ─── Offline detection sweep ──────────────────────────────────────────────────
// Call this on a schedule (e.g. every 30s from a setInterval in the API startup)
export async function sweepOfflineNodes() {
  const cutoff = new Date(Date.now() - 60_000); // 60 seconds stale = offline
  const result = await db
    .update(nodes)
    .set({ status: "offline", updatedAt: new Date() })
    .where(
      sql`status = 'online' AND last_heartbeat_at < ${cutoff}`
    )
    .returning({ id: nodes.id, hostname: nodes.hostname });

  if (result.length > 0) {
    console.warn(
      `[Nodes:Sweep] Marked ${result.length} node(s) offline: ${result.map((n) => n.hostname).join(", ")}`
    );
  }
}

// ─── Metrics retention sweep ──────────────────────────────────────────────────
// Deletes node_metrics older than 7 days. Call from same sweep interval.
export async function pruneOldMetrics() {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  await db
    .delete(nodeMetrics)
    .where(lt(nodeMetrics.timestamp, cutoff));
}

export default router;
