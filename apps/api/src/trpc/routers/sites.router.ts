import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../trpc";
import { db, sites } from "@dbbkp/db";
import { eq, sql } from "drizzle-orm";
import { getFreePort } from "../../services/port-manager";
import { hostingQueue } from "../../queues";
import crypto from "node:crypto";
import Docker from "dockerode";
import { cloudflare } from "../../services/cloudflare";

const docker = new Docker();

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
  list: protectedProcedure.query(async () => {
    return db.select().from(sites).orderBy(sql`created_at DESC`);
  }),

  // ─── Create Site ───────────────────────────────────────────────────────────
  create: adminProcedure
    .input(
      z.object({
        domain: z.string(),
        runtime: z.enum(["static", "node", "python", "php", "docker"]),
        source: z.enum(["git", "zip"]),
        repoUrl: z.string().optional(),
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
            repoUrl: input.repoUrl ?? null,
            branch: input.branch,
            status: "provisioning",
          }))
          .returning();

        if (input.source === "git") {
          await hostingQueue.add("deploy-site", { 
            siteId: newSite.id,
            source: input.source,
            repoUrl: input.repoUrl,
            branch: input.branch
          });
        }

        // Auto-provision DNS if Cloudflare is enabled
        if (cloudflare.isEnabled()) {
          try {
            console.log(`[Sites:Create] Provisioning DNS for ${input.domain} via Cloudflare...`);
            const serverIp = process.env.SERVER_IP || "127.0.0.1";
            // Check if record exists first
            const records = await cloudflare.listRecords();
            if (!records.find(r => r.name === input.domain)) {
              await cloudflare.createRecord("A", input.domain, serverIp, true);
              console.log(`[Sites:Create] DNS record created for ${input.domain}`);
            } else {
              console.log(`[Sites:Create] DNS record already exists for ${input.domain}`);
            }
          } catch (cfErr) {
            console.error(`[Sites:Create] Cloudflare DNS provisioning failed:`, cfErr);
            // Non-fatal, so we don't throw
          }
        }

        return newSite;
      } catch (err: any) {
        console.error(`[Sites:Create] FAILED:`, err);
        throw err;
      }
    }),

  // ─── Get Site Status ───────────────────────────────────────────────────────
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const [site] = await db
        .select()
        .from(sites)
        .where(eq(sites.id, input.id))
        .limit(1);
      return site;
    }),

  // ─── Delete Site ───────────────────────────────────────────────────────────
  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const [site] = await db.select().from(sites).where(eq(sites.id, input.id)).limit(1);
      if (!site) return { success: false };

      // 1. Cleanup Docker
      if (site.pm2Name) {
        try {
          const container = docker.getContainer(site.pm2Name);
          await container.stop().catch(() => {});
          await container.remove().catch(() => {});
        } catch {}
      }

      // 2. Delete from DB
      await db.delete(sites).where(eq(sites.id, input.id));

      // 3. Cleanup DNS
      if (cloudflare.isEnabled()) {
        try {
          await cloudflare.deleteRecordByName(site.domain);
          console.log(`[Sites:Delete] DNS record removed for ${site.domain}`);
        } catch (cfErr) {
          console.error(`[Sites:Delete] Cloudflare DNS cleanup failed:`, cfErr);
        }
      }

      return { success: true };
    }),

  // ─── Stats (CPU/RAM) ───────────────────────────────────────────────────────
  stats: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const [site] = await db.select().from(sites).where(eq(sites.id, input.id)).limit(1);
      if (!site || !site.pm2Name) return null;

      try {
        const container = docker.getContainer(site.pm2Name);
        const stats = await container.stats({ stream: false });
        
        // Calculate CPU %
        const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
        const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
        const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100 : 0;

        // Calculate RAM %
        const usedMemory = stats.memory_stats.usage - (stats.memory_stats.stats?.cache || 0);
        const ramPercent = (usedMemory / stats.memory_stats.limit) * 100;

        return {
          cpu: Math.min(100, Math.max(0, cpuPercent)),
          ram: Math.min(100, Math.max(0, ramPercent)),
          memoryUsed: usedMemory,
          memoryLimit: stats.memory_stats.limit,
        };
      } catch {
        return null;
      }
    }),
});
