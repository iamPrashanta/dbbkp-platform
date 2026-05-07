import { Router } from "express";
import { db, securityAlerts, sites } from "@dbbkp/db";
import { eq, like } from "drizzle-orm";
import crypto from "node:crypto";

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
