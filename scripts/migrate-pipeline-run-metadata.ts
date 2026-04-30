import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/dbbkp_panel";
const sql = postgres(databaseUrl, { max: 1 });

await sql`ALTER TABLE "pipeline_runs" ADD COLUMN IF NOT EXISTS "runner" varchar(20) DEFAULT 'docker'`;
await sql`ALTER TABLE "pipeline_runs" ADD COLUMN IF NOT EXISTS "image" varchar(255)`;
await sql`ALTER TABLE "pipeline_runs" ADD COLUMN IF NOT EXISTS "exit_code" integer`;
await sql`ALTER TABLE "pipeline_runs" ADD COLUMN IF NOT EXISTS "error" text`;
await sql`ALTER TABLE "pipeline_runs" ADD COLUMN IF NOT EXISTS "started_at" timestamp`;
await sql`ALTER TABLE "pipeline_runs" ADD COLUMN IF NOT EXISTS "duration_ms" integer`;

await sql.end();
console.log("Pipeline run metadata migration applied.");
