import { router, protectedProcedure, publicProcedure } from "../trpc";
import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db, users, sessions, auditLogs } from "@dbbkp/db";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import crypto from "node:crypto";

const JWT_SECRET = process.env.JWT_SECRET || "dbbkp-super-secret-change-in-prod";

// ─── UTILITIES ───────────────────────────────────────────────────────────────

function deepClean(obj: any): any {
  if (obj === undefined) return null;
  if (obj === null) return null;
  if (Array.isArray(obj)) return obj.filter((v) => v !== undefined).map(deepClean);
  if (typeof obj === "object" && obj !== null) {
    if (obj instanceof Date) return obj;
    return Object.fromEntries(
      Object.entries(obj).filter(([_, v]) => v !== undefined).map(([k, v]) => [k, deepClean(v)])
    );
  }
  return obj;
}

function assertClean<T extends Record<string, any>>(obj: T): T {
  const cleaned = deepClean(obj);
  for (const [key, value] of Object.entries(cleaned)) {
    if (value === undefined) {
      throw new Error(`[DB Guard:Auth] Undefined value detected for key: "${key}"`);
    }
  }
  return cleaned;
}

// ─── ROUTER ──────────────────────────────────────────────────────────────────

export const authRouter = router({
  // Login → returns JWT with sid (session id)
  login: publicProcedure
    .input(z.object({ username: z.string(), password: z.string() }))
    .mutation(async ({ input }) => {
      const [user] = await db.select().from(users).where(eq(users.username, input.username)).limit(1);
      if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid credentials" });

      const valid = await bcrypt.compare(input.password, user.passwordHash);
      if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid credentials" });

      // 1. Create Server-Side Session (Source of Truth for Inactivity)
      const sessionId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      await db.insert(sessions).values(assertClean({
        id: sessionId,
        userId: user.id,
        expiresAt,
      }));

      // 2. Generate JWT including the sid and mcp (must change password) flag
      const token = jwt.sign(
        { 
          sub: user.id, 
          sid: sessionId, 
          username: user.username, 
          role: user.role,
          mcp: user.mustChangePassword
        },
        JWT_SECRET,
        { expiresIn: "7d" } as jwt.SignOptions
      );

      return { 
        token, 
        user: { 
          id: user.id, 
          username: user.username, 
          email: user.email, 
          role: user.role,
          mustChangePassword: user.mustChangePassword
        } 
      };
    }),

  // Get current user (Verifies session via tRPC middleware)
  me: protectedProcedure.query(async ({ ctx }) => {
    const [user] = await db.select({
      id: users.id, 
      username: users.username,
      email: users.email, 
      role: users.role, 
      createdAt: users.createdAt,
      mustChangePassword: users.mustChangePassword,
    }).from(users).where(eq(users.id, ctx.user.sub)).limit(1);

    if (!user) throw new TRPCError({ code: "NOT_FOUND" });
    return user;
  }),

  // Change Password
  changePassword: protectedProcedure
    .input(z.object({ newPassword: z.string().min(8) }))
    .mutation(async ({ ctx, input }) => {
      const passwordHash = await bcrypt.hash(input.newPassword, 12);
      
      // 1. Update Password & Flag
      await db.update(users)
        .set(assertClean({
          passwordHash,
          mustChangePassword: false,
          updatedAt: new Date()
        }))
        .where(eq(users.id, ctx.user.sub));

      // 2. Security Audit
      await db.insert(auditLogs).values(assertClean({
        type: "security",
        userId: ctx.user.sub,
        event: "Password changed via dashboard. Mandatory rotation complete.",
        ip: ctx.ip,
      }));

      // 3. Global Session Revocation (Ensures old JWTs with sid are useless)
      await db.delete(sessions).where(eq(sessions.userId, ctx.user.sub));

      return { success: true };
    }),
});
