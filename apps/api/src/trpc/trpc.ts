import { initTRPC, TRPCError } from "@trpc/server";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

export type Context = {
  user: { sub: string; username: string; role: string } | null;
  lastActivityAt: number | null;
};

export function createContext({ req }: { req: any }): Context {
  const header = req.headers?.authorization as string | undefined;
  const lastActivityHeader = req.headers?.["x-last-activity"] as string | undefined;
  const lastActivityAt = lastActivityHeader ? parseInt(lastActivityHeader) : null;

  if (!header?.startsWith("Bearer ")) {
    return { user: null, lastActivityAt };
  }

  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, JWT_SECRET) as any;

    return {
      user: {
        sub: payload.sub,
        username: payload.username,
        role: payload.role,
      },
      lastActivityAt,
    };
  } catch {
    return { user: null, lastActivityAt };
  }
}

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  // 30-minute inactivity check
  const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
  if (ctx.lastActivityAt && (Date.now() - ctx.lastActivityAt > IDLE_TIMEOUT_MS)) {
    throw new TRPCError({ 
      code: "UNAUTHORIZED", 
      message: "Session expired due to inactivity" 
    });
  }

  return next();
});

export const adminProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return next();
});