import { router, protectedProcedure, adminProcedure } from "../trpc";
import { z } from "zod";
import { db, jobs, pipelines, pipelineRuns } from "@dbbkp/db";
import { eq, sql } from "drizzle-orm";
import { pipelineQueue } from "../../queues";
import { TRPCError } from "@trpc/server";

// ─── UTILITIES ───────────────────────────────────────────────────────────────

/**
 * Ensures a database payload contains NO 'undefined' values.
 * postgres.js throws UNDEFINED_VALUE errors if any binding is undefined.
 */
function safePayload<T extends Record<string, any>>(obj: T): T {
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) {
      throw new Error(`[DB Guard] Undefined value detected for key: "${key}"`);
    }
  }
  return obj;
}

// ─── ROUTER ──────────────────────────────────────────────────────────────────

export const pipelineRouter = router({
  // ─── Dashboard ─────────────────────────────────────────────────────────────
  dashboard: protectedProcedure.query(async () => {
    try {
      const [pipelineList, runList] = await Promise.all([
        db.select().from(pipelines).orderBy(sql`created_at DESC`),
        db.select().from(pipelineRuns).orderBy(sql`created_at DESC`).limit(50),
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
    } catch (err) {
      console.error("[Pipeline:Dashboard] Error fetching data:", err);
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to load dashboard" });
    }
  }),

  // ─── List Pipelines ────────────────────────────────────────────────────────
  list: protectedProcedure.query(async () => {
    return db.select().from(pipelines).orderBy(sql`created_at DESC`);
  }),

  // ─── Get Single Pipeline ───────────────────────────────────────────────────
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const [p] = await db.select().from(pipelines).where(eq(pipelines.id, input.id)).limit(1);
      if (!p) throw new TRPCError({ code: "NOT_FOUND" });
      return p;
    }),

  // ─── Create Pipeline ───────────────────────────────────────────────────────
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
      try {
        const [p] = await db.insert(pipelines).values(safePayload({
          name: input.name,
          repoUrl: input.repoUrl,
          branch: input.branch,
          buildCommand: input.buildCommand ?? null,
          deployCommand: input.deployCommand ?? null,
          envVars: input.envVars ? JSON.stringify(input.envVars) : null,
        })).returning();
        return p;
      } catch (err) {
        console.error("[Pipeline:Create] FAILED:", err);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create pipeline" });
      }
    }),

  // ─── Update Pipeline ───────────────────────────────────────────────────────
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
      // Explicitly map defined properties only - NEVER spread input directly
      const updateData: any = { updatedAt: new Date() };
      
      if (input.name !== undefined) updateData.name = input.name;
      if (input.branch !== undefined) updateData.branch = input.branch;
      if (input.buildCommand !== undefined) updateData.buildCommand = input.buildCommand ?? null;
      if (input.deployCommand !== undefined) updateData.deployCommand = input.deployCommand ?? null;
      if (input.enabled !== undefined) updateData.enabled = input.enabled;

      const [p] = await db.update(pipelines)
        .set(safePayload(updateData))
        .where(eq(pipelines.id, input.id))
        .returning();

      if (!p) throw new TRPCError({ code: "NOT_FOUND" });
      return p;
    }),

  // ─── Delete Pipeline ───────────────────────────────────────────────────────
  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await db.delete(pipelines).where(eq(pipelines.id, input.id));
      return { success: true };
    }),

  // ─── Trigger Pipeline Run ──────────────────────────────────────────────────
  run: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const [p] = await db.select().from(pipelines).where(eq(pipelines.id, input.id)).limit(1);
      if (!p) throw new TRPCError({ code: "NOT_FOUND" });
      if (!p.enabled) throw new TRPCError({ code: "BAD_REQUEST", message: "Pipeline is disabled" });

      // 1. Create a run record with absolute safety
      const [run] = await db.insert(pipelineRuns).values(safePayload({
        pipelineId: p.id,
        status: "waiting",
        runner: process.env.PIPELINE_ISOLATION ?? "docker",
        image: process.env.PIPELINE_DOCKER_IMAGE ?? "node:20-bookworm",
      })).returning();

      // 2. Prepare payload (stringified for Job DB record)
      const payload = {
        runId: run.id,
        pipelineId: p.id,
        repoUrl: p.repoUrl,
        branch: p.branch ?? "main",
        buildCommand: p.buildCommand ?? null,
        deployCommand: p.deployCommand ?? null,
        envVars: p.envVars ? JSON.parse(p.envVars) : {},
      };

      const [dbJob] = await db.insert(jobs).values(safePayload({
        type: "pipeline",
        name: p.name,
        status: "waiting",
        payload: JSON.stringify(payload),
      })).returning();

      // 3. Enqueue job
      const job = await pipelineQueue.add("pipeline-run", { ...payload, dbJobId: dbJob.id });

      // 4. Update bullJobId refs
      await db.update(pipelineRuns).set({ bullJobId: String(job.id) }).where(eq(pipelineRuns.id, run.id));
      await db.update(jobs).set({ bullJobId: String(job.id) }).where(eq(jobs.id, dbJob.id));

      return { jobId: job.id, runId: run.id };
    }),

  // ─── List Runs ─────────────────────────────────────────────────────────────
  runs: protectedProcedure
    .input(z.object({ pipelineId: z.string().uuid() }))
    .query(async ({ input }) => {
      return db.select().from(pipelineRuns)
        .where(eq(pipelineRuns.pipelineId, input.pipelineId))
        .orderBy(sql`created_at DESC`)
        .limit(20);
    }),

  // ─── Get Single Run ────────────────────────────────────────────────────────
  runById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const [run] = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, input.id)).limit(1);
      if (!run) throw new TRPCError({ code: "NOT_FOUND" });
      const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.id, run.pipelineId)).limit(1);
      return { ...run, pipeline: pipeline ?? null };
    }),

  // ─── Get Run Logs ──────────────────────────────────────────────────────────
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
