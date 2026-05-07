import { router, protectedProcedure, adminProcedure } from "../trpc";
import { z } from "zod";
import { db, nodes, nodeMetrics } from "@dbbkp/db";
import { eq, desc, and, gt } from "drizzle-orm";

export const nodesRouter = router({
  // ─── List all nodes ─────────────────────────────────────────────────────────
  list: protectedProcedure.query(async () => {
    return db
      .select({
        id: nodes.id,
        name: nodes.name,
        hostname: nodes.hostname,
        ip: nodes.ip,
        publicIp: nodes.publicIp,
        os: nodes.os,
        arch: nodes.arch,
        cpuCores: nodes.cpuCores,
        memoryMb: nodes.memoryMb,
        dockerVersion: nodes.dockerVersion,
        agentVersion: nodes.agentVersion,
        status: nodes.status,
        tags: nodes.tags,
        lastHeartbeatAt: nodes.lastHeartbeatAt,
        createdAt: nodes.createdAt,
      })
      .from(nodes)
      .orderBy(desc(nodes.createdAt));
  }),

  // ─── Get single node ─────────────────────────────────────────────────────────
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const [node] = await db.select().from(nodes).where(eq(nodes.id, input.id)).limit(1);
      if (!node) throw new Error("Node not found");
      return node;
    }),

  // ─── Get recent metrics for a node ──────────────────────────────────────────
  metrics: protectedProcedure
    .input(z.object({
      nodeId: z.string().uuid(),
      limit: z.number().min(1).max(500).default(120),
    }))
    .query(async ({ input }) => {
      return db
        .select()
        .from(nodeMetrics)
        .where(eq(nodeMetrics.nodeId, input.nodeId))
        .orderBy(desc(nodeMetrics.timestamp))
        .limit(input.limit);
    }),

  // ─── Update node tags ────────────────────────────────────────────────────────
  setTags: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      tags: z.array(z.string()),
    }))
    .mutation(async ({ input }) => {
      await db
        .update(nodes)
        .set({ tags: input.tags, updatedAt: new Date() })
        .where(eq(nodes.id, input.id));
      return { success: true };
    }),

  // ─── Delete (deregister) a node ──────────────────────────────────────────────
  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await db.delete(nodes).where(eq(nodes.id, input.id));
      return { success: true };
    }),
});
