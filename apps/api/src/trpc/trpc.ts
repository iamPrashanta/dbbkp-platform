import { initTRPC, TRPCError } from "@trpc/server";
import jwt from "jsonwebtoken";

import { db, sessions, users } from "@dbbkp/db";
import { eq } from "drizzle-orm";
import { hasPermission } from "../utils/rbac";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

export type Context = {
  user: { 
    sub: string; 
    sid: string; 
    username: string; 
    role: string;
    mustChangePassword: boolean;
  } | null;
  ip: string | null;
};

export function createContext({ req }: { req: any }): Context {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || null;
  const header = req.headers?.authorization as string | undefined;

  if (!header?.startsWith("Bearer ")) {
    return { user: null, ip };
  }

  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, JWT_SECRET) as any;

    return {
      user: {
        sub: payload.sub,
        sid: payload.sid,
        username: payload.username,
        role: payload.role,
        mustChangePassword: !!payload.mcp,
      },
      ip,
    };
  } catch {
    return { user: null, ip };
  }
}

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async ({ ctx, next, path }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  try {
    // 1. Fetch Session AND User Flag from DB (Absolute Source of Truth)
    const [sessionWithUser] = await db
      .select({
        id: sessions.id,
        expiresAt: sessions.expiresAt,
        lastActivityAt: sessions.lastActivityAt,
        mustChangePassword: users.mustChangePassword,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.id, ctx.user.sid))
      .limit(1);

    if (!sessionWithUser) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Session not found" });
    }

    // 2. Mandatory Password Rotation Enforcement (Real-time DB check)
    if (sessionWithUser.mustChangePassword && path !== "auth.changePassword") {
      throw new TRPCError({ 
        code: "FORBIDDEN", 
        message: "PASSWORD_ROTATION_REQUIRED" 
      });
    }

    const now = new Date();

    // 3. Absolute Expiry Check
    if (sessionWithUser.expiresAt < now) {
      await db.delete(sessions).where(eq(sessions.id, sessionWithUser.id));
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Session expired" });
    }

    // 4. Idle Inactivity Check (30 minutes)
    const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
    if (now.getTime() - sessionWithUser.lastActivityAt.getTime() > IDLE_TIMEOUT_MS) {
      await db.delete(sessions).where(eq(sessions.id, sessionWithUser.id));
      throw new TRPCError({ 
        code: "UNAUTHORIZED", 
        message: "Session expired due to inactivity" 
      });
    }

    // 5. Update Activity
    await db.update(sessions)
      .set({ lastActivityAt: now })
      .where(eq(sessions.id, sessionWithUser.id));

    return next();
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    console.error("[TRPC:Auth] Fatal middleware error:", err);
    throw new TRPCError({ 
      code: "INTERNAL_SERVER_ERROR", 
      message: "Authentication service unavailable" 
    });
  }
});

export const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.user?.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return next();
});

/**
 * Procedural permission procedure.
 * Usage: permissionProcedure(PERMISSIONS.SITE_DEPLOY).query(...)
 */
export const permissionProcedure = (permission: string) =>
  protectedProcedure.use(async ({ ctx, next }) => {
    const allowed = await hasPermission(ctx.user!.sub, permission);
    if (!allowed) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Missing required permission: ${permission}`,
      });
    }
    return next();
  });