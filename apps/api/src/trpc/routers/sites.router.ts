import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import { db, sites } from "@dbbkp/db";
import { eq, sql } from "drizzle-orm";
import { getFreePort } from "../../services/port-manager";
import { hostingQueue } from "../../queues";
import crypto from "node:crypto";

// ─── UTILITIES (HARDENED) ────────────────────────────────────────────────────

function deepClean(obj: any): any {
  if (obj === undefined) return null;
  if (obj === null) return null;
  if (Array.isArray(obj)) return obj.map(deepClean);
  if (typeof obj === "object" && obj !== null) {
    if (obj instanceof Date) return obj;
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([_, v]) => v !== undefined)
        .map(([k, v]) => [k, deepClean(v)])
    );
  }
  return obj;
}

function assertClean<T extends Record<string, any>>(obj: T): T {
  const cleaned = deepClean(obj);
  for (const [key, value] of Object.entries(cleaned)) {
    if (value === undefined) {
      throw new Error(`[DB Guard:Sites] Undefined value detected for key: "${key}"`);
    }
  }
  return cleaned;
}

// ─── ROUTER ──────────────────────────────────────────────────────────────────

export const sitesRouter = router({
  // ─── List Sites ────────────────────────────────────────────────────────────
  list: publicProcedure.query(async () => {
    return db.select().from(sites).orderBy(sql`created_at DESC`);
  }),

  // ─── Create Site ───────────────────────────────────────────────────────────
  create: publicProcedure
    .input(
      z.object({
        domain: z.string(),
        runtime: z.enum(["static", "node", "python"]),
        source: z.enum(["git"]),
        repoUrl: z.string(),
        branch: z.string().default("main"),
      })
    )
    .mutation(async ({ input }) => {
      console.log(`[Sites:Create] Initializing site for domain: ${input.domain}`);
      try {
        const siteId = crypto.randomUUID();
        const docRoot = `/var/www/sites/${siteId}`;
        
        const port = input.runtime === "static" ? null : await getFreePort();

        const [newSite] = await db
          .insert(sites)
          .values(assertClean({
            id: siteId,
            domain: input.domain,
            type: input.runtime,
            docRoot,
            port,
            source: input.source,
            repoUrl: input.repoUrl,
            branch: input.branch,
            status: "provisioning",
          }))
          .returning();

        await hostingQueue.add("deploy-site", { 
          siteId: newSite.id,
          source: input.source,
          repoUrl: input.repoUrl,
          branch: input.branch
        });

        return newSite;
      } catch (err: any) {
        console.error(`[Sites:Create] FAILED:`, err);
        throw err;
      }
    }),

  // ─── Get Site Status ───────────────────────────────────────────────────────
  getStatus: publicProcedure
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
