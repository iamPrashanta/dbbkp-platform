import { router, protectedProcedure, adminProcedure } from "../trpc";
import { z } from "zod";
import { db, jobs, pipelines, pipelineRuns } from "@dbbkp/db";
import { eq, desc } from "drizzle-orm";
import { pipelineQueue } from "../../queues";
import { TRPCError } from "@trpc/server";

// Helper to sanitize DB inputs (Postgres doesn't allow undefined)
function clean<T extends Record<string, any>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, v === undefined ? null : v])
  ) as T;
}

export const pipelineRouter = router({
  dashboard: protectedProcedure.query(async () => {
    const [pipelineList, runList] = await Promise.all([
      db.select().from(pipelines).orderBy(desc(pipelines.createdAt)),
      db.select().from(pipelineRuns).orderBy(desc(pipelineRuns.createdAt)).limit(50),
    ]);

    const pipelineById = new Map(pipelineList.map((pipeline) => [pipeline.id, pipeline]));
    const recentRuns = runList.map((run) => ({
      ...run,
      pipeline: pipelineById.get(run.pipelineId) ?? null,
    }));

    return {
      pipelines: pipelineList,
      recentRuns,
      summary: {
        pipelines: pipelineList.length,
        active: runList.filter((run) => run.status === "active").length,
        completed: runList.filter((run) => run.status === "completed").length,
        failed: runList.filter((run) => run.status === "failed").length,
      },
    };
  }),

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
      const [p] = await db.insert(pipelines).values(clean({
        name: input.name,
        repoUrl: input.repoUrl,
        branch: input.branch,
        buildCommand: input.buildCommand,
        deployCommand: input.deployCommand,
        envVars: input.envVars ? JSON.stringify(input.envVars) : null,
      })).returning();
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
      const [p] = await db.update(pipelines).set(clean({ ...data, updatedAt: new Date() }))
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
      const [run] = await db.insert(pipelineRuns).values(clean({
        pipelineId: p.id,
        status: "waiting",
        runner: process.env.PIPELINE_ISOLATION ?? "docker",
        image: process.env.PIPELINE_DOCKER_IMAGE ?? "node:20-bookworm",
      })).returning();

      const payload = {
        runId: run.id,
        pipelineId: p.id,
        repoUrl: p.repoUrl,
        branch: p.branch,
        buildCommand: p.buildCommand,
        deployCommand: p.deployCommand,
        envVars: p.envVars ? JSON.parse(p.envVars) : {},
      };

      const [dbJob] = await db.insert(jobs).values({
        type: "pipeline",
        name: p.name,
        status: "waiting",
        payload: JSON.stringify(payload),
      }).returning();

      // Enqueue job
      const job = await pipelineQueue.add("pipeline-run", { ...payload, dbJobId: dbJob.id });

      // Update run with bullJobId
      await db.update(pipelineRuns).set({ bullJobId: String(job.id) }).where(eq(pipelineRuns.id, run.id));
      await db.update(jobs).set({ bullJobId: String(job.id) }).where(eq(jobs.id, dbJob.id));

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

  runById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const [run] = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, input.id)).limit(1);
      if (!run) throw new TRPCError({ code: "NOT_FOUND" });
      const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.id, run.pipelineId)).limit(1);
      return { ...run, pipeline: pipeline ?? null };
    }),

  log: protectedProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .query(async ({ input }) => {
      const [run] = await db.select({
        id: pipelineRuns.id,
        bullJobId: pipelineRuns.bullJobId,
        log: pipelineRuns.log,
        status: pipelineRuns.status,
      }).from(pipelineRuns).where(eq(pipelineRuns.id, input.runId)).limit(1);
      if (!run) throw new TRPCError({ code: "NOT_FOUND" });
      return run;
    }),
});
