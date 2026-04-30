import { db } from "./index";
import { users } from "./schema";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

async function seed() {
  console.log("\n🚀 DBBKP Bootstrapper: Initializing System...");

  // 1. Check if admin already exists (Idempotency)
  const existing = await db.select().from(users).limit(1);
  if (existing.length > 0) {
    console.log("ℹ️ System already initialized. Skipping admin seed.");
    process.exit(0);
  }

  // 2. Generate Strong Initial Password (AWS/PaaS style)
  const envPassword = process.env.INITIAL_ADMIN_PASSWORD;
  // Strong 24-character base64url password
  const randomPassword = crypto.randomBytes(18).toString("base64url"); 
  
  const initialPassword = envPassword || randomPassword;
  const passwordHash = await bcrypt.hash(initialPassword, 12);

  try {
    // 3. Seed Admin with mandatory rotation flag
    await db.insert(users).values({
      id: crypto.randomUUID(),
      username: "admin",
      email: "admin@dbbkp.local",
      passwordHash: passwordHash,
      role: "admin",
      mustChangePassword: true,
    });

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("✅ SYSTEM INITIALIZED SUCCESSFULLY");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("  Username: admin");
    console.log(`  Password: ${initialPassword}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("⚠️  IMPORTANT: Please log in and change your password immediately.");
    console.log("⚠️  This credential will only be shown ONCE.");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    
  } catch (err) {
    console.error("❌ Bootstrap failed:", err);
  } finally {
    process.exit(0);
  }
}

seed();
