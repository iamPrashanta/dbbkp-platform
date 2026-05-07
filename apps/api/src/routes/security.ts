import { Router } from "express";
import { 
  db, securityAlerts, sites, processSnapshots, securityThreats, 
  networkTelemetry, fileIntegritySnapshots 
} from "@dbbkp/db";
import { eq, like, sql, desc, lt, and } from "drizzle-orm";
import crypto from "node:crypto";
import { reconcileNodeSecurity } from "../services/security-reconciler";

const router = Router();

// Middleware to verify internal requests
router.use((req, res, next) => {
  const internalSecret = process.env.INTERNAL_SECRET || "dbbkp-internal-secret-change-me";
  const providedKey = req.headers["x-internal-key"];

  if (providedKey !== internalSecret) {
    console.warn(`[Security API] Unauthorized attempt from ${req.ip}`);
    res.status(403).json({ error: "Forbidden: Invalid internal key" });
    return;
  }
  next();
});

// The Go agent will post array of threats
// Agent reports host security posture (SSH, Firewall, Users)
router.post("/host-posture", async (req, res) => {
  try {
    const { nodeId, config } = req.body;

    if (!nodeId || !config) {
      res.status(400).json({ error: "nodeId and config required" });
      return;
    }

    // Trigger reconciliation asynchronously
    reconcileNodeSecurity(nodeId, config).catch(err => {
      console.error("[Security:Posture] Reconciliation failed:", err);
    });

    res.json({ ok: true });
  } catch (err: any) {
    console.error("[Security API] Failed to ingest host posture:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Agent reports file integrity changes
router.post("/fim-telemetry", async (req, res) => {
  try {
    const { siteId, files }: { 
      siteId: string, 
      files: Array<any> 
    } = req.body;

    if (!siteId || !Array.isArray(files)) {
      res.status(400).json({ error: "siteId and files array required" });
      return;
    }

    for (const file of files) {
      // 1. Update/Insert Snapshots
      await db.insert(fileIntegritySnapshots).values({
        id: crypto.randomUUID(),
        siteId,
        filePath: file.path,
        hash: file.hash,
        inode: file.inode,
        permissions: file.permissions,
        entropy: file.entropy,
        isExecutable: file.isExecutable,
      }).onConflictDoUpdate({
        target: [fileIntegritySnapshots.siteId, fileIntegritySnapshots.filePath] as any,
        set: { hash: file.hash, lastSeenAt: new Date() } as any
      });

      // 2. Alert on suspicious changes (e.g. .php file becoming executable or high entropy)
      if (file.path.endsWith(".php") && (file.isExecutable || file.entropy > 7.5)) {
        await db.insert(securityThreats).values({
          id: crypto.randomUUID(),
          siteId,
          type: "malware_persistence",
          severity: "critical",
          details: { ...file, message: `Suspicious PHP file modification: ${file.path}` }
        }).onConflictDoNothing();
      }
    }

    res.json({ ok: true, count: files.length });
  } catch (err: any) {
    console.error("[Security API] Failed to ingest FIM telemetry:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Agent reports network connections
router.post("/network-telemetry", async (req, res) => {
  try {
    const { nodeId, events }: { 
      nodeId: string, 
      events: Array<any> 
    } = req.body;

    if (!nodeId || !Array.isArray(events)) {
      res.status(400).json({ error: "nodeId and events array required" });
      return;
    }

    // 1. Batch Insert
    for (const event of events) {
      await db.insert(networkTelemetry).values({
        id: crypto.randomUUID(),
        nodeId,
        containerId: event.containerId,
        direction: event.direction,
        protocol: event.protocol,
        localAddr: event.localAddr,
        remoteAddr: event.remoteAddr,
        remotePort: event.remotePort,
        remoteAsn: event.remoteAsn,
        remoteCountry: event.remoteCountry,
        dnsRequest: event.dnsRequest,
        riskScore: event.riskScore || 0,
      });

      // 2. High-risk network event → Auto Threat
      if (event.riskScore && event.riskScore >= 80) {
        await db.insert(securityThreats).values({
          id: crypto.randomUUID(),
          nodeId,
          containerId: event.containerId,
          type: "network_threat",
          severity: "high",
          details: { ...event, message: `Suspicious ${event.direction} connection: ${event.remoteAddr}` }
        }).onConflictDoNothing();
      }
    }

    // 3. Prune old telemetry (keep last 24h)
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await db.delete(networkTelemetry).where(lt(networkTelemetry.timestamp, dayAgo));

    res.json({ ok: true, count: events.length });
  } catch (err: any) {
    console.error("[Security API] Failed to ingest network telemetry:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Agent reports real-time process list
router.post("/processes", async (req, res) => {
  try {
    const { nodeId, processes }: { 
      nodeId: string, 
      processes: Array<any> 
    } = req.body;

    if (!nodeId || !Array.isArray(processes)) {
      res.status(400).json({ error: "nodeId and processes array required" });
      return;
    }

    // 1. Prune old snapshots for this node (keep only the last 1)
    // In a high-traffic env, we'd use a more efficient rotation or TimeScaleDB
    await db.delete(processSnapshots).where(eq(processSnapshots.nodeId, nodeId));

    // 2. Insert new snapshots
    for (const proc of processes) {
      await db.insert(processSnapshots).values({
        id: crypto.randomUUID(),
        nodeId,
        containerId: proc.containerId,
        pid: proc.pid,
        ppid: proc.ppid,
        name: proc.name,
        command: proc.command,
        cpuUsage: proc.cpu,
        memoryUsage: proc.memory,
        user: proc.user,
        sockets: proc.sockets, // JSON array of ports/ips
        riskScore: proc.riskScore || 0,
        threatSignals: proc.threatSignals || [], // e.g. ["hidden_binary", "curl_pipe_bash"]
      });

      // 3. If risk score is high, create a security threat record automatically
      if (proc.riskScore && proc.riskScore >= 70) {
         await db.insert(securityThreats).values({
            id: crypto.randomUUID(),
            nodeId,
            containerId: proc.containerId,
            type: "suspicious_process",
            severity: proc.riskScore >= 90 ? "critical" : "high",
            details: { ...proc, message: `Suspicious process detected: ${proc.name} (Risk: ${proc.riskScore})` }
         }).onConflictDoNothing();
      }
    }

    res.json({ ok: true, count: processes.length });
  } catch (err: any) {
    console.error("[Security API] Failed to ingest processes:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/report", async (req, res) => {
  try {
    const alerts: Array<{
      type: string;
      severity: string;
      message: string;
      details?: Record<string, any>;
    }> = req.body.alerts || [];

    if (!Array.isArray(alerts) || alerts.length === 0) {
      res.json({ ok: true, message: "No alerts to process" });
      return;
    }

    console.log(`[Security API] Received ${alerts.length} threats from agent`);

    for (const alert of alerts) {
      let siteId: string | null = null;

      // Try to determine which site this belongs to based on the file path
      if (alert.details?.file) {
        const filePath = alert.details.file as string;
        // docRoots are usually /var/www/sites/<siteId>
        const match = filePath.match(/\/var\/www\/sites\/([a-f0-9-]+)\//);
        if (match && match[1]) {
          const possibleSiteId = match[1];
          // Verify site exists
          const [site] = await db.select({ id: sites.id }).from(sites).where(eq(sites.id, possibleSiteId)).limit(1);
          if (site) {
            siteId = site.id;
          }
        }
      }

      // De-duplicate active alerts (don't spam the DB if the file is already reported and unresolved)
      const detailsStr = alert.details ? JSON.stringify(alert.details) : null;
      
      const existing = await db.select().from(securityAlerts).where(eq(securityAlerts.resolved, false)).execute();
      
      const isDuplicate = existing.some(e => 
        e.type === alert.type && 
        e.message === alert.message && 
        (e.siteId === siteId || (!e.siteId && !siteId)) &&
        e.details === detailsStr
      );

      if (!isDuplicate) {
        await db.insert(securityAlerts).values({
          id: crypto.randomUUID(),
          siteId,
          type: alert.type,
          severity: alert.severity || "high",
          message: alert.message,
          details: detailsStr,
        });
      }
    }

    res.json({ ok: true, processed: alerts.length });
  } catch (err: any) {
    console.error("[Security API] Failed to process report:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
