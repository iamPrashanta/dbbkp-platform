import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { db, cronJobs } from "@dbbkp/db";
import { eq, sql } from "drizzle-orm";
import { cronQueue } from "../../queues";
import crypto from "node:crypto";

export const cronRouter = router({
  list: protectedProcedure
    .input(z.object({ siteId: z.string().uuid() }))
    .query(async ({ input }) => {
      return db.select().from(cronJobs).where(eq(cronJobs.siteId, input.siteId)).orderBy(sql`created_at DESC`);
    }),

  create: protectedProcedure
    .input(
      z.object({
        siteId: z.string().uuid(),
        command: z.string().min(1),
        schedule: z.string().min(5), // Simple cron validation
      })
    )
    .mutation(async ({ input }) => {
      const [newCron] = await db.insert(cronJobs).values({
        id: crypto.randomUUID(),
        siteId: input.siteId,
        command: input.command,
        schedule: input.schedule,
      }).returning();

      // Register repeatable job in BullMQ
      await cronQueue.add(
        "execute-cron",
        { cronId: newCron.id },
        { 
          repeat: { pattern: input.schedule },
          jobId: `cron-${newCron.id}` // Use deterministic ID to allow removing later
        }
      );

      return newCron;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const [cronJob] = await db.select().from(cronJobs).where(eq(cronJobs.id, input.id)).limit(1);
      if (!cronJob) throw new Error("Cron job not found");

      // Remove from DB
      await db.delete(cronJobs).where(eq(cronJobs.id, input.id));

      // Remove from BullMQ Repeatable Jobs
      const repeatableJobs = await cronQueue.getRepeatableJobs();
      const jobToRemove = repeatableJobs.find(j => j.id === `cron-${input.id}`);
      if (jobToRemove) {
        await cronQueue.removeRepeatableByKey(jobToRemove.key);
      }

      return { success: true };
    }),
});
