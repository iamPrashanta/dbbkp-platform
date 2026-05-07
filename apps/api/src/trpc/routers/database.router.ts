import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { db, dbInstances } from "@dbbkp/db";
import { eq, sql } from "drizzle-orm";
import { databaseQueue } from "../../queues";
import crypto from "node:crypto";

export const databaseRouter = router({
  list: protectedProcedure.query(async () => {
    return db.select().from(dbInstances).orderBy(sql`created_at DESC`);
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(3).max(30).regex(/^[a-z0-9_]+$/),
        type: z.enum(["pgsql", "mysql"]).default("pgsql"),
        dbUser: z.string().min(3).max(30).regex(/^[a-z0-9_]+$/),
        siteId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const dbPass = crypto.randomBytes(12).toString("hex");

      // Check if name already taken
      const existing = await db.select().from(dbInstances).where(eq(dbInstances.name, input.name)).limit(1);
      if (existing.length > 0) {
        throw new Error("Database name already in use.");
      }

      const [newInstance] = await db.insert(dbInstances).values({
        id: crypto.randomUUID(),
        name: input.name,
        type: input.type,
        dbUser: input.dbUser,
        siteId: input.siteId,
      }).returning();

      if (input.type === "pgsql") {
        await databaseQueue.add("create-postgres", {
          instanceId: newInstance.id,
          dbName: input.name,
          dbUser: input.dbUser,
          dbPass: dbPass,
        });
      } else {
        // Future: implement mysql logic or throw
        throw new Error("MySQL provisioning is not yet implemented.");
      }

      return {
        instance: newInstance,
        credentials: {
          username: input.dbUser,
          password: dbPass,
          host: "127.0.0.1",
          port: input.type === "pgsql" ? 5432 : 3306,
          database: input.name,
        }
      };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      // NOTE: For safety in this early version, we only delete the DB record.
      // We don't automatically drop production databases from PostgreSQL to prevent data loss.
      // The user must drop them manually or we can add a specific `forceDrop` flag later.
      await db.delete(dbInstances).where(eq(dbInstances.id, input.id));
      return { success: true, message: "Database record deleted. Physical DB preserved for safety." };
    }),
});
