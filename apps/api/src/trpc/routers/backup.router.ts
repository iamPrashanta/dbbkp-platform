import { router, protectedProcedure } from "../trpc";
import { z } from "zod";
import { backupQueue } from "../../queues";

export const backupRouter = router({
  pgsql: protectedProcedure
    .input(z.object({
      DB_HOST: z.string().default("localhost"),
      DB_USER: z.string(),
      DB_PASS: z.string(),
      DB_NAME: z.string(),
    }))
    .mutation(async ({ input }) => {
      const job = await backupQueue.add("pgsql-backup", { db: input });
      return { jobId: job.id };
    }),

  seed: protectedProcedure
    .input(z.object({ engine: z.enum(["pgsql"]).default("pgsql") }))
    .mutation(async ({ input }) => {
      const job = await backupQueue.add("pgsql-seed", { engine: input.engine });
      return { jobId: job.id };
    }),
});
