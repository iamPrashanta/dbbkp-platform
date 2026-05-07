import { Worker } from "bullmq";
import { connection } from "./connection";
import { db, dbInstances } from "@dbbkp/db";
import { eq } from "drizzle-orm";
import execa from "execa";

export const databaseWorker = new Worker(
  "database",
  async (job) => {
    if (job.name !== "create-postgres") return;

    const { instanceId, dbName, dbUser, dbPass } = job.data;
    const [instance] = await db.select().from(dbInstances).where(eq(dbInstances.id, instanceId)).limit(1);
    
    if (!instance) throw new Error(`DB Instance ${instanceId} not found in database`);

    console.log(`[DatabaseWorker] Provisioning PostgreSQL database: ${dbName} for user: ${dbUser}`);

    try {
      // Create Database
      await execa("sudo", ["-u", "postgres", "psql", "-c", `CREATE DATABASE "${dbName}";`]);
      console.log(`[DatabaseWorker] Created database: ${dbName}`);

      // Create User with Password
      await execa("sudo", ["-u", "postgres", "psql", "-c", `CREATE USER "${dbUser}" WITH ENCRYPTED PASSWORD '${dbPass}';`]);
      console.log(`[DatabaseWorker] Created user: ${dbUser}`);

      // Grant Privileges
      await execa("sudo", ["-u", "postgres", "psql", "-c", `GRANT ALL PRIVILEGES ON DATABASE "${dbName}" TO "${dbUser}";`]);
      await execa("sudo", ["-u", "postgres", "psql", "-d", dbName, "-c", `ALTER SCHEMA public OWNER TO "${dbUser}";`]);
      console.log(`[DatabaseWorker] Granted privileges for ${dbName} to ${dbUser}`);

      return { success: true, message: `Database ${dbName} provisioned` };
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      
      // If error contains "already exists", it might be a partial failure or re-run, we can just log it
      if (message.includes("already exists")) {
        console.warn(`[DatabaseWorker] Resource already exists during DB creation: ${message}`);
        return { success: true, message: `Recovered: Resource already exists` };
      }

      console.error(`[DatabaseWorker] DB Provisioning failed:`, message);
      throw err;
    }
  },
  { connection, concurrency: 2 }
);

console.log("[Worker Node] Booted database worker");
