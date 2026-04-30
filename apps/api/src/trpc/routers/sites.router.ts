import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { db, sites } from "@dbbkp/db";
import { eq } from "drizzle-orm";
import { getFreePort } from "../../services/port-manager";
import { hostingQueue } from "../../queues";
import path from "path";

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
      const siteId = crypto.randomUUID();
      const docRoot = `/var/www/sites/${siteId}`;
      
      // Allocate port if not static
      const port = input.runtime === "static" ? null : await getFreePort();

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
      await hostingQueue.add("deploy-site", { 
        siteId: newSite.id,
        source: input.source,
        repoUrl: input.repoUrl,
        branch: input.branch
      });

      return newSite;
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
