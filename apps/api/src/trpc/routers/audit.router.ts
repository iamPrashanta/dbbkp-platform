import { router, protectedProcedure, adminProcedure } from "../trpc";
import { z } from "zod";
import { db, auditLogs, secrets } from "@dbbkp/db";
import { eq, sql, desc } from "drizzle-orm";
import { encrypt, decrypt } from "@dbbkp/security";

export const auditRouter = router({
  // ─── Audit Log List ─────────────────────────────────────────────────────────
  list: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(500).default(100) }))
    .query(async ({ input }) => {
      return db
        .select()
        .from(auditLogs)
        .orderBy(desc(auditLogs.createdAt))
        .limit(input.limit);
    }),
});

export const secretsRouter = router({
  // ─── Set Secret ─────────────────────────────────────────────────────────────
  set: adminProcedure
    .input(
      z.object({
        keyName: z.string().min(1).max(255),
        value: z.string().min(1),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const payload = encrypt(input.value);
      await db
        .insert(secrets)
        .values({
          keyName: input.keyName,
          encryptedValue: payload.encryptedValue,
          iv: payload.iv,
          authTag: payload.authTag,
          description: input.description ?? null,
        })
        .onConflictDoUpdate({
          target: secrets.keyName,
          set: {
            encryptedValue: payload.encryptedValue,
            iv: payload.iv,
            authTag: payload.authTag,
            updatedAt: new Date(),
          },
        });
      return { success: true };
    }),

  // ─── Get Secret (decrypted) ──────────────────────────────────────────────────
  get: adminProcedure
    .input(z.object({ keyName: z.string() }))
    .query(async ({ input }) => {
      const [secret] = await db
        .select()
        .from(secrets)
        .where(eq(secrets.keyName, input.keyName))
        .limit(1);
      if (!secret) throw new Error("Secret not found");
      const value = decrypt({
        encryptedValue: secret.encryptedValue,
        iv: secret.iv,
        authTag: secret.authTag,
      });
      return { keyName: secret.keyName, value, description: secret.description };
    }),

  // ─── List Secret Keys (no values exposed) ──────────────────────────────────
  list: adminProcedure.query(async () => {
    return db
      .select({
        id: secrets.id,
        keyName: secrets.keyName,
        description: secrets.description,
        createdAt: secrets.createdAt,
        updatedAt: secrets.updatedAt,
      })
      .from(secrets)
      .orderBy(desc(secrets.createdAt));
  }),

  // ─── Delete Secret ──────────────────────────────────────────────────────────
  delete: adminProcedure
    .input(z.object({ keyName: z.string() }))
    .mutation(async ({ input }) => {
      await db.delete(secrets).where(eq(secrets.keyName, input.keyName));
      return { success: true };
    }),
});
