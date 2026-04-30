import { db } from "./index";
import { users } from "./schema";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

async function seed() {
  console.log("🌱 Seeding database...");
  
  const passwordHash = await bcrypt.hash("admin123", 10);

  try {
    await db.insert(users).values({
      id: crypto.randomUUID(),
      username: "admin",
      email: "admin@dbbkp.local",
      passwordHash: passwordHash,
      role: "admin",
    }).onConflictDoNothing();

    console.log("✅ Admin user seeded (admin / admin123)");
  } catch (err) {
    console.error("❌ Seeding failed:", err);
  } finally {
    process.exit(0);
  }
}

seed();
