import { db, sites } from "@dbbkp/db";
import { eq, and, sql } from "drizzle-orm";
import { hostingQueue } from "../queues";
import Docker from "dockerode";

const docker = new Docker();

/**
 * Platform Reconciliation Engine
 * 
 * Ensures "Desired State" (DB) matches "Actual State" (Infrastructure).
 * Detects drifted or crashed sites and triggers recovery jobs.
 */
export function startReconciliationLoop() {
  console.log("[Reconciler] Starting Platform Reconciliation Loop (interval: 15m)");

  setInterval(async () => {
    try {
      // 1. Find sites that should be "active" but might be crashed/missing
      const activeSites = await db
        .select()
        .from(sites)
        .where(eq(sites.desiredStatus, "active"));

      if (activeSites.length === 0) return;

      const containers = await docker.listContainers({ all: true });
      const runningNames = containers.flatMap(c => c.Names);

      for (const site of activeSites) {
        const expectedName = `/dbbkp-site-${site.id.slice(0, 8)}`;
        const isRunning = runningNames.includes(expectedName);

        if (!isRunning && site.status === "active") {
          console.warn(`[Reconciler] Drift detected: Site ${site.domain} is missing/crashed. Triggering recovery...`);
          
          // Update status to 'drifted' so UI reflects reality
          await db.update(sites)
            .set({ status: "drifted", lastReconciledAt: new Date() })
            .where(eq(sites.id, site.id));

          // Trigger re-deployment
          await hostingQueue.add("deploy-site", { siteId: site.id });
        } else {
          // Update last reconciled timestamp
          await db.update(sites)
            .set({ lastReconciledAt: new Date() })
            .where(eq(sites.id, site.id));
        }
      }
    } catch (err) {
      console.error("[Reconciler] Loop error:", err);
    }
  }, 15 * 60_000); // Every 15 minutes
}
