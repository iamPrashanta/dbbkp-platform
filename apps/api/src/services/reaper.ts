import { db, sites } from "@dbbkp/db";
import { eq, lt, and } from "drizzle-orm";
import { hostingQueue } from "../queues";

/**
 * Site Expiration Reaper
 * 
 * Automatically cleans up temporary/preview environments that have passed
 * their expiration date. This prevents resource leaks on infrastructure nodes.
 */
export function startExpirationReaper() {
  console.log("[Reaper] Starting Site Expiration Reaper (interval: 10m)");

  setInterval(async () => {
    try {
      const now = new Date();
      
      // Find expired sites that are active or failed (not already deleted)
      const expiredSites = await db
        .select({ id: sites.id, domain: sites.domain })
        .from(sites)
        .where(
          and(
            eq(sites.isTemporary, true),
            lt(sites.expiresAt, now)
          )
        );

      if (expiredSites.length === 0) return;

      console.log(`[Reaper] Found ${expiredSites.length} expired sites. Triggering cleanup...`);

      for (const site of expiredSites) {
        console.log(`[Reaper] Cleaning up expired site: ${site.domain} (${site.id})`);
        
        // We add a delete job to the queue
        // Note: The delete procedure in the router handles Docker cleanup + DNS
        // Here we trigger the same cleanup logic.
        // For simplicity, we trigger a 'delete-site' job (we need to define this in worker)
        await hostingQueue.add("delete-site", { siteId: site.id });
      }
    } catch (err) {
      console.error("[Reaper] Error during site cleanup:", err);
    }
  }, 10 * 60_000); // Every 10 minutes
}
