import { router, protectedProcedure } from "../trpc";
import { z } from "zod";
import { db, securityAlerts } from "@dbbkp/db";
import { eq, sql } from "drizzle-orm";
import { infraQueue } from "../../queues";

export const infraRouter = router({
  scan: protectedProcedure
    .input(z.object({ mode: z.enum(["full", "health", "disk", "network"]).default("full") }))
    .mutation(async ({ input }) => {
      const job = await infraQueue.add("infra-scan", { mode: input.mode });
      return { jobId: job.id };
    }),

  health: protectedProcedure.mutation(async () => {
    const job = await infraQueue.add("infra-health", { mode: "health" });
    return { jobId: job.id };
  }),

  disk: protectedProcedure.mutation(async () => {
    const job = await infraQueue.add("infra-disk", { mode: "disk" });
    return { jobId: job.id };
  }),

  network: protectedProcedure.mutation(async () => {
    const job = await infraQueue.add("infra-network", { mode: "network" });
    return { jobId: job.id };
  }),

  jobs: protectedProcedure.query(async () => {
    const { infraQueue: q } = await import("../../queues");
    const [completed, failed, active, waiting] = await Promise.all([
      q.getCompleted(0, 19),
      q.getFailed(0, 9),
      q.getActive(),
      q.getWaiting(),
    ]);
    return [...active, ...waiting, ...completed, ...failed].map(j => ({
      id: String(j.id),
      name: j.name,
      state: j.failedReason ? "failed" : completed.includes(j) ? "completed" : active.includes(j) ? "active" : "waiting",
      timestamp: j.timestamp,
      data: j.data,
      result: j.returnvalue,
      failedReason: j.failedReason,
    }));
  }),

  alerts: protectedProcedure.query(async () => {
    return db.select().from(securityAlerts)
      .where(eq(securityAlerts.resolved, false))
      .orderBy(sql`created_at DESC`);
  }),

  resolveAlert: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await db.update(securityAlerts)
        .set({ resolved: true, resolvedAt: new Date() })
        .where(eq(securityAlerts.id, input.id));
      return { success: true };
    }),
});
