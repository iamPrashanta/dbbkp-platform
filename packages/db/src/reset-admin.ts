import { db } from "./index";
import { users, sessions, auditLogs } from "./schema";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";

/**
 * CLI Utility to reset the admin password.
 * Usage: tsx src/reset-admin.ts [new_password]
 */
async function resetAdmin() {
  const newPassword = process.argv[2];
  
  if (!newPassword) {
    console.error("\n❌ Error: No password provided.");
    console.log("Usage: pnpm db:reset-admin <new_password>\n");
    process.exit(1);
  }

  console.log(`\n🔐 Resetting admin password...`);

  try {
    const passwordHash = await bcrypt.hash(newPassword, 12);

    // 1. Update Admin User
    const [admin] = await db
      .update(users)
      .set({ 
        passwordHash, 
        mustChangePassword: false, // CLI reset overrides mandatory change
        updatedAt: new Date()
      })
      .where(eq(users.username, "admin"))
      .returning();

    if (!admin) {
      console.error("❌ Error: Admin user not found in database.");
      process.exit(1);
    }

    // 2. Security Audit
    await db.insert(auditLogs).values({
      type: "security",
      userId: admin.id,
      event: "Admin password reset via CLI (root access).",
      ip: "127.0.0.1",
    });

    // 3. Revoke all active sessions for this user (Security)
    await db.delete(sessions).where(eq(sessions.userId, admin.id));

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("✅ ADMIN PASSWORD RESET SUCCESSFUL");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`  Username: admin`);
    console.log(`  Password: ${newPassword}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("ℹ️  All active admin sessions have been revoked.");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  } catch (err) {
    console.error("❌ Reset failed:", err);
  } finally {
    process.exit(0);
  }
}

resetAdmin();
