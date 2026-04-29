import { Worker } from "bullmq";
import { runCommand, resolveScriptPath } from "@dbbkp/runner";

const scriptPath = resolveScriptPath("dbbkp.sh");

new Worker(
  "backup",
  async (job) => {
    if (job.name === "pgsql-backup") {
      console.log(`[Worker] Executing job ${job.id}: pgsql-backup`);
      
      const env = job.data.db;
      const result = await runCommand({
        cmd: "bash",
        args: [
          scriptPath,
          "--headless",
          "--mode=pgsql-backup",
        ],
        env: {
          ENV_DB_HOST: env.DB_HOST,
          ENV_DB_USER: env.DB_USER,
          ENV_DB_PASS: env.DB_PASS,
          ENV_DB_NAME: env.DB_NAME,
        },
        timeoutMs: 1000 * 60 * 60, // 1 hour timeout protection
      });

      console.log(`[Worker] Job ${job.id} finished with code ${result.code}`);
      
      if (result.code !== 0) {
        console.error(`[Worker] Error: ${result.stderr}`);
        throw new Error(`Bash process exited with code ${result.code}. stderr: ${result.stderr}`);
      }
      
      return result.stdout;
    } else if (job.name === "pgsql-seed") {
      console.log(`[Worker] Executing job ${job.id}: pgsql-seed`);
      
      const seedScriptPath = resolveScriptPath("seed-pg.sh");
      const result = await runCommand({
        cmd: "bash",
        args: [seedScriptPath],
        timeoutMs: 1000 * 60 * 5, // 5 min timeout
      });

      console.log(`[Worker] Seed Job ${job.id} finished with code ${result.code}`);
      
      if (result.code !== 0) {
        console.error(`[Worker] Error: ${result.stderr}`);
        throw new Error(`Seed process exited with code ${result.code}. stderr: ${result.stderr}`);
      }
      
      return result.stdout;
    }
  },
  {
    connection: { host: process.env.REDIS_HOST || "127.0.0.1", port: parseInt(process.env.REDIS_PORT || "6379") },
  }
);

console.log("[Worker Node] Booted and polling BullMQ 'backup' queue...");
