import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db, users } from "@dbbkp/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || "dbbkp-super-secret-change-in-prod";
const JWT_EXPIRES = process.env.JWT_EXPIRES || "7d";

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  try {
    const { username, password } = z.object({
      username: z.string().min(1),
      password: z.string().min(1),
    }).parse(req.body);

    const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { sub: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES } as jwt.SignOptions
    );

    return res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email, role: user.role },
    });
  } catch (err: any) {
    if (err?.name === "ZodError") return res.status(400).json({ error: "Invalid request body" });
    console.error("[Auth] Login error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get("/me", requireAuth, async (req: any, res) => {
  try {
    const [user] = await db.select({
      id: users.id,
      username: users.username,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
    }).from(users).where(eq(users.id, req.user.sub)).limit(1);

    if (!user) return res.status(404).json({ error: "User not found" });
    return res.json(user);
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/auth/register (admin-only, first-time setup) ──────────────────
router.post("/register", async (req, res) => {
  try {
    const { username, email, password, role = "user" } = z.object({
      username: z.string().min(3).max(50),
      email: z.string().email(),
      password: z.string().min(8),
      role: z.enum(["admin", "user"]).optional(),
    }).parse(req.body);

    // Check if admin already exists (first-time setup bypass)
    const [existingAdmin] = await db.select().from(users).limit(1);
    const isFirstUser = !existingAdmin;

    const passwordHash = await bcrypt.hash(password, 12);

    const [created] = await db.insert(users).values({
      username,
      email,
      passwordHash,
      role: isFirstUser ? "admin" : role,
    }).returning({ id: users.id, username: users.username, role: users.role });

    return res.status(201).json({ user: created });
  } catch (err: any) {
    if (err?.code === "23505") return res.status(409).json({ error: "Username or email already exists" });
    if (err?.name === "ZodError") return res.status(400).json({ error: err.issues });
    console.error("[Auth] Register error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Middleware ───────────────────────────────────────────────────────────────
export function requireAuth(req: any, res: any, next: any) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }
  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireAdmin(req: any, res: any, next: any) {
  requireAuth(req, res, () => {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }
    next();
  });
}

export default router;
