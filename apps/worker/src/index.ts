import "./env";
import { Worker } from "bullmq";
import { runCommand, resolveScriptPath } from "@dbbkp/runner";
import { connection } from "./connection";
import "./pipeline.worker";

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
    connection,
  }
);

console.log("[Worker Node] Booted and polling BullMQ 'backup' queue...");

const infraScriptPath = resolveScriptPath("infra-agent.sh");

new Worker(
  "infra",
  async (job) => {
    console.log(`[Worker] Executing job ${job.id}: ${job.name}`);
    
    let mode = "full";
    if (job.name === "infra-health") mode = "health";
    else if (job.name === "infra-disk") mode = "disk";
    else if (job.name === "infra-network") mode = "network";
    
    const result = await runCommand({
      cmd: "bash",
      args: [infraScriptPath, "--json", `--mode=${mode}`],
      timeoutMs: 1000 * 60 * 10, // 10 min max for heavy scan
    });

    console.log(`[Worker] Job ${job.id} finished with code ${result.code}`);
    
    if (result.code !== 0) {
      console.error(`[Worker] Error: ${result.stderr}`);
      throw new Error(`Infra process exited with code ${result.code}. stderr: ${result.stderr}`);
    }
    
    // Strip Windows CR bytes (script may have CRLF endings when run in WSL)
    // then extract the outermost JSON object from stdout, ignoring bash noise
    try {
      const raw = result.stdout.replace(/\r/g, '').trim();
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start !== -1 && end !== -1 && end > start) {
        const jsonStr = raw.slice(start, end + 1);
        const parsed = JSON.parse(jsonStr);
        console.log(`[Worker] Job ${job.id} parsed JSON successfully`);
        return parsed;
      }
      return JSON.parse(raw);
    } catch (e) {
      console.warn(`[Worker] Job ${job.id} output is not valid JSON, returning raw`);
      return { raw: result.stdout.slice(0, 500) }; // truncate to avoid bloating Redis
    }
  },
  {
    connection,
  }
);

console.log("[Worker Node] Booted and polling BullMQ 'infra' queue...");
