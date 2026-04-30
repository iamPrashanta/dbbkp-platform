import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { db, sites } from "@dbbkp/db";
import { eq } from "drizzle-orm";
import { getFreePort } from "../../services/port-manager";
import { hostingQueue } from "../../queues";
import path from "path";
import crypto from "node:crypto";

export const sitesRouter = router({
  // ─── List Sites ────────────────────────────────────────────────────────────
  list: protectedProcedure.query(async () => {
    return db.select().from(sites).orderBy(sites.createdAt);
  }),

  // ─── Create Site ───────────────────────────────────────────────────────────
  create: protectedProcedure
    .input(
      z.object({
        domain: z.string(),
        runtime: z.enum(["static", "node", "python"]),
        source: z.enum(["zip", "git"]),
        repoUrl: z.string().optional(),
        branch: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      console.log(`[Sites:Create] Initializing site for domain: ${input.domain}`);
      try {
        const siteId = crypto.randomUUID();
        const docRoot = `/var/www/sites/${siteId}`;
        
        // Allocate port if not static
        console.log(`[Sites:Create] Allocating port for ${input.runtime}...`);
        const port = input.runtime === "static" ? null : await getFreePort();
        console.log(`[Sites:Create] Allocated port: ${port}`);

        console.log(`[Sites:Create] Inserting into DB...`);
        const [newSite] = await db
          .insert(sites)
          .values({
            id: siteId,
            domain: input.domain,
            type: input.runtime,
            docRoot,
            port,
            source: input.source,
            repoUrl: input.repoUrl,
            branch: input.branch,
            status: "provisioning",
          })
          .returning();

        // Enqueue deployment job
        console.log(`[Sites:Create] Enqueueing hosting job...`);
        await hostingQueue.add("deploy-site", { 
          siteId: newSite.id,
          source: input.source,
          repoUrl: input.repoUrl,
          branch: input.branch
        });

        console.log(`[Sites:Create] Success! SiteID: ${newSite.id}`);
        return newSite;
      } catch (err: any) {
        console.error(`[Sites:Create] FAILED:`, err);
        throw err;
      }
    }),

  // ─── Get Site Status ───────────────────────────────────────────────────────
  getStatus: protectedProcedure
    .input(z.object({ siteId: z.string() }))
    .query(async ({ input }) => {
      const [site] = await db
        .select()
        .from(sites)
        .where(eq(sites.id, input.siteId))
        .limit(1);
      return site;
    }),
});
