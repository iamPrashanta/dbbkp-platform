import { router, protectedProcedure, publicProcedure } from "../trpc";
import { z } from "zod";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { db, users } from "@dbbkp/db";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

const JWT_SECRET = process.env.JWT_SECRET || "dbbkp-super-secret-change-in-prod";

export const authRouter = router({
  // Login → returns JWT
  login: publicProcedure
    .input(z.object({ username: z.string(), password: z.string() }))
    .mutation(async ({ input }) => {
      const [user] = await db.select().from(users).where(eq(users.username, input.username)).limit(1);
      if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid credentials" });

      const valid = await bcrypt.compare(input.password, user.passwordHash);
      if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid credentials" });

      const token = jwt.sign(
        { sub: user.id, username: user.username, role: user.role },
        JWT_SECRET,
        { expiresIn: "7d" } as jwt.SignOptions
      );
      return { token, user: { id: user.id, username: user.username, email: user.email, role: user.role } };
    }),

  // Register (first user = admin, subsequent = user)
  register: publicProcedure
    .input(z.object({
      username: z.string().min(3).max(50),
      email: z.string().email(),
      password: z.string().min(8),
    }))
    .mutation(async ({ input }) => {
      const [existing] = await db.select({ id: users.id }).from(users).limit(1);
      const isFirst = !existing;
      const passwordHash = await bcrypt.hash(input.password, 12);
      try {
        const [created] = await db.insert(users).values({
          username: input.username,
          email: input.email,
          passwordHash,
          role: isFirst ? "admin" : "user",
        }).returning({ id: users.id, username: users.username, role: users.role });
        return { user: created };
      } catch (e: any) {
        if (e?.code === "23505") throw new TRPCError({ code: "CONFLICT", message: "Username or email already taken" });
        throw e;
      }
    }),

  // Get current user
  me: protectedProcedure.query(async ({ ctx }) => {
    const [user] = await db.select({
      id: users.id, username: users.username,
      email: users.email, role: users.role, createdAt: users.createdAt,
    }).from(users).where(eq(users.id, ctx.user.sub)).limit(1);
    if (!user) throw new TRPCError({ code: "NOT_FOUND" });
    return user;
  }),
});
