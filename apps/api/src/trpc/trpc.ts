import { initTRPC, TRPCError } from "@trpc/server";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

export type Context = {
  user: { sub: string; username: string; role: string } | null;
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