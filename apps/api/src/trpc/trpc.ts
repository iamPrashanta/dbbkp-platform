import { initTRPC, TRPCError } from "@trpc/server";
import jwt from "jsonwebtoken";

import { db, sessions } from "@dbbkp/db";
import { eq } from "drizzle-orm";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

export type Context = {
  user: { sub: string; sid: string; username: string; role: string } | null;
};

export function createContext({ req }: { req: any }): Context {
  const header = req.headers?.authorization as string | undefined;

  if (!header?.startsWith("Bearer ")) {
    return { user: null };
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
      },
    };
  } catch {
    return { user: null };
  }
}

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  // 1. Fetch Session from DB (Source of Truth)
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, ctx.user.sid))
    .limit(1);

  if (!session) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Session not found" });
  }

  const now = new Date();

  // 2. Absolute Expiry Check
  if (session.expiresAt < now) {
    await db.delete(sessions).where(eq(sessions.id, session.id));
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Session expired" });
  }

  // 3. Idle Inactivity Check (30 minutes)
  const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
  if (now.getTime() - session.lastActivityAt.getTime() > IDLE_TIMEOUT_MS) {
    await db.delete(sessions).where(eq(sessions.id, session.id));
    throw new TRPCError({ 
      code: "UNAUTHORIZED", 
      message: "Session expired due to inactivity" 
    });
  }

  // 4. Update Activity
  await db.update(sessions)
    .set({ lastActivityAt: now })
    .where(eq(sessions.id, session.id));

  return next();
});

export const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.user?.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return next();
});