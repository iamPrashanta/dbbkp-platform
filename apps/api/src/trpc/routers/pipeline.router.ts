import { router, protectedProcedure, adminProcedure } from "../trpc";
import { z } from "zod";
import { db, jobs, pipelines, pipelineRuns } from "@dbbkp/db";
import { eq, sql } from "drizzle-orm";
import { pipelineQueue } from "../../queues";
import { TRPCError } from "@trpc/server";

// ─── UTILITIES (HARDENED) ────────────────────────────────────────────────────

/**
 * Recursively strips 'undefined' values from an object, replacing them with 'null'.
 * This is the only way to be 100% safe from postgres.js UNDEFINED_VALUE errors.
 */
function deepClean(obj: any): any {
  if (obj === undefined) return null;
  if (obj === null) return null;

  if (Array.isArray(obj)) {
    return obj.map(deepClean);
  }

  if (typeof obj === "object" && obj !== null) {
    // If it's a Date, return as is (don't convert to object entries)
    if (obj instanceof Date) return obj;

    return Object.fromEntries(
      Object.entries(obj)
        .filter(([_, v]) => v !== undefined)
        .map(([k, v]) => [k, deepClean(v)])
    );
  }

  return obj;
}

/**
 * Fail-fast check to ensure NO undefined values reach the database driver.
 */
function assertClean<T extends Record<string, any>>(obj: T): T {
  const cleaned = deepClean(obj);
  for (const [key, value] of Object.entries(cleaned)) {
    if (value === undefined) {
      throw new Error(`[CRITICAL] Undefined leaked into DB payload for key: "${key}"`);
    }
  }
  return cleaned;
}

// ─── STARTUP VALIDATION ──────────────────────────────────────────────────────

console.log("[Pipeline:Init] Verifying Drizzle Schema Bindings...");
try {
  const check = {
    pipelines: !!pipelines.id && !!pipelines.createdAt,
    runs: !!pipelineRuns.id && !!pipelineRuns.createdAt
  };
  if (!check.pipelines || !check.runs) {
    console.error("[Pipeline:FATAL] Schema instance mismatch! Columns are undefined.", check);
  } else {
    console.log("[Pipeline:Init] Schema bindings verified (Type-Safe)");
  }
} catch (e) {
  console.error("[Pipeline:FATAL] Schema verification crashed!", e);
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
    } catch (err: any) {
      console.error("[Pipeline:Dashboard] Error fetching data:", err);
      throw new TRPCError({ 
        code: "INTERNAL_SERVER_ERROR", 
        message: err.message || "Failed to load dashboard" 
      });
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
        const payload = assertClean({
          name: input.name,
          repoUrl: input.repoUrl,
          branch: input.branch,
          buildCommand: input.buildCommand ?? null,
          deployCommand: input.deployCommand ?? null,
          envVars: input.envVars ? JSON.stringify(input.envVars) : null,
        });

        const [p] = await db.insert(pipelines).values(payload).returning();
        return p;
      } catch (err: any) {
        console.error("[Pipeline:Create] FAILED:", err);
        throw new TRPCError({ 
          code: "INTERNAL_SERVER_ERROR", 
          message: err.message || "Failed to create pipeline" 
        });
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
      // Explicitly map properties and use deepClean guard
      const updateData: any = { updatedAt: new Date() };
      
      if (input.name !== undefined) updateData.name = input.name;
      if (input.branch !== undefined) updateData.branch = input.branch;
      if (input.buildCommand !== undefined) updateData.buildCommand = input.buildCommand ?? null;
      if (input.deployCommand !== undefined) updateData.deployCommand = input.deployCommand ?? null;
      if (input.enabled !== undefined) updateData.enabled = input.enabled;

      const [p] = await db.update(pipelines)
        .set(assertClean(updateData))
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
      const [run] = await db.insert(pipelineRuns).values(assertClean({
        pipelineId: p.id,
        status: "waiting",
        runner: process.env.PIPELINE_ISOLATION ?? "docker",
        image: process.env.PIPELINE_DOCKER_IMAGE ?? "node:20-bookworm",
      })).returning();

      // 2. Prepare payload
      const runPayload = deepClean({
        runId: run.id,
        pipelineId: p.id,
        repoUrl: p.repoUrl,
        branch: p.branch ?? "main",
        buildCommand: p.buildCommand ?? null,
        deployCommand: p.deployCommand ?? null,
        envVars: p.envVars ? JSON.parse(p.envVars) : {},
      });

      const [dbJob] = await db.insert(jobs).values(assertClean({
        type: "pipeline",
        name: p.name,
        status: "waiting",
        payload: JSON.stringify(runPayload),
      })).returning();

      // 3. Enqueue job
      const job = await pipelineQueue.add("pipeline-run", { ...runPayload, dbJobId: dbJob.id });

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
