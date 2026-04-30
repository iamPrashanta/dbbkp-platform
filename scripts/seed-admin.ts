/**
 * scripts/seed-admin.ts
 * Run via: pnpm tsx scripts/seed-admin.ts
 * Env: DATABASE_URL, ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD
 */
import postgres from "postgres";
import bcrypt from "bcryptjs";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5432/dbbkp_panel";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || "admin@dbbkp.local";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
  console.error("[seed] ERROR: ADMIN_PASSWORD env var is required");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1 });

async function run() {
  try {
    // Check if any user exists already
    const existing = await sql`SELECT id FROM users WHERE username = ${ADMIN_USERNAME} LIMIT 1`;
    if (existing.length > 0) {
      console.log(`[seed] Admin user '${ADMIN_USERNAME}' already exists — skipping`);
      return;
    }

    const hash = await bcrypt.hash(ADMIN_PASSWORD!, 12);

    await sql`
      INSERT INTO users (id, email, username, password_hash, role)
      VALUES (gen_random_uuid(), ${ADMIN_EMAIL}, ${ADMIN_USERNAME}, ${hash}, 'admin')
    `;

    console.log(`[seed] ✓ Admin user '${ADMIN_USERNAME}' created`);
  } catch (err: any) {
    console.error("[seed] Failed:", err.message);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

run();
