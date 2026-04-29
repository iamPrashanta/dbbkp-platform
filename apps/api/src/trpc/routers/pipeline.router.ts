import { router, protectedProcedure, adminProcedure } from "../trpc";
import { z } from "zod";
import { db, pipelines, pipelineRuns } from "@dbbkp/db";
import { eq, desc } from "drizzle-orm";
import { pipelineQueue } from "../../queues";
import { TRPCError } from "@trpc/server";

export const pipelineRouter = router({
  list: protectedProcedure.query(async () => {
    return db.select().from(pipelines).orderBy(desc(pipelines.createdAt));
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const [p] = await db.select().from(pipelines).where(eq(pipelines.id, input.id)).limit(1);
      if (!p) throw new TRPCError({ code: "NOT_FOUND" });
      return p;
    }),

  create: adminProcedure
    .input(z.object({
      name: z.string().min(1),
      repoUrl: z.string().url(),
      branch: z.string().default("main"),
      buildCommand: z.string().optional(),
      deployCommand: z.string().optional(),
      envVars: z.record(z.string()).optional(),
    }))
    .mutation(async ({ input }) => {
      const [p] = await db.insert(pipelines).values({
        name: input.name,
        repoUrl: input.repoUrl,
        branch: input.branch,
        buildCommand: input.buildCommand,
        deployCommand: input.deployCommand,
        envVars: input.envVars ? JSON.stringify(input.envVars) : null,
      }).returning();
      return p;
    }),

  update: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().optional(),
      branch: z.string().optional(),
      buildCommand: z.string().optional(),
      deployCommand: z.string().optional(),
      enabled: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      const [p] = await db.update(pipelines).set({ ...data, updatedAt: new Date() })
        .where(eq(pipelines.id, id)).returning();
      if (!p) throw new TRPCError({ code: "NOT_FOUND" });
      return p;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await db.delete(pipelines).where(eq(pipelines.id, input.id));
      return { success: true };
    }),

  run: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const [p] = await db.select().from(pipelines).where(eq(pipelines.id, input.id)).limit(1);
      if (!p) throw new TRPCError({ code: "NOT_FOUND" });
      if (!p.enabled) throw new TRPCError({ code: "BAD_REQUEST", message: "Pipeline is disabled" });

      // Create a run record
      const [run] = await db.insert(pipelineRuns).values({
        pipelineId: p.id,
        status: "waiting",
      }).returning();

      // Enqueue job
      const job = await pipelineQueue.add("pipeline-run", {
        runId: run.id,
        pipelineId: p.id,
        repoUrl: p.repoUrl,
        branch: p.branch,
        buildCommand: p.buildCommand,
        deployCommand: p.deployCommand,
        envVars: p.envVars ? JSON.parse(p.envVars) : {},
      });

      // Update run with bullJobId
      await db.update(pipelineRuns).set({ bullJobId: String(job.id) }).where(eq(pipelineRuns.id, run.id));

      return { jobId: job.id, runId: run.id };
    }),

  runs: protectedProcedure
    .input(z.object({ pipelineId: z.string().uuid() }))
    .query(async ({ input }) => {
      return db.select().from(pipelineRuns)
        .where(eq(pipelineRuns.pipelineId, input.pipelineId))
        .orderBy(desc(pipelineRuns.createdAt))
        .limit(20);
    }),
});
