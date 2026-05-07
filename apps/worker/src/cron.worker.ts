import { Worker } from "bullmq";
import { connection } from "./connection";
import { db, cronJobs, sites } from "@dbbkp/db";
import { eq } from "drizzle-orm";
import Docker from "dockerode";

const docker = new Docker();

export const cronWorker = new Worker(
  "cron",
  async (job) => {
    if (job.name !== "execute-cron") return;

    const { cronId } = job.data;
    
    // Fetch cron job and site
    const [cronJob] = await db.select().from(cronJobs).where(eq(cronJobs.id, cronId)).limit(1);
    if (!cronJob || !cronJob.active) {
      console.log(`[CronWorker] Cron ${cronId} is inactive or deleted. Skipping.`);
      return { success: false, reason: "Inactive" };
    }

    const [site] = await db.select().from(sites).where(eq(sites.id, cronJob.siteId)).limit(1);
    if (!site) {
      console.log(`[CronWorker] Site for cron ${cronId} not found. Skipping.`);
      return { success: false, reason: "Site not found" };
    }

    console.log(`[CronWorker] Executing cron job ${cronId} for site ${site.domain}: ${cronJob.command}`);

    try {
      if (site.type === "static") {
        throw new Error("Cannot run cron jobs on static sites");
      }

      // Container name should match hosting worker logic
      const containerName = site.pm2Name || `dbbkp-site-${site.id.slice(0, 8)}`;
      const container = docker.getContainer(containerName);

      // Verify container is running
      const containerInfo = await container.inspect();
      if (!containerInfo.State.Running) {
        throw new Error(`Container ${containerName} is not running`);
      }

      // Execute command inside the container
      const exec = await container.exec({
        Cmd: ["sh", "-c", cronJob.command],
        AttachStdout: true,
        AttachStderr: true,
        User: site.type === "php" ? "www-data" : "0:0", // Run as appropriate user
      });

      const stream = await exec.start({ Detach: false });
      
      let output = "";
      stream.on('data', (chunk) => {
        output += chunk.toString('utf8');
      });

      await new Promise((resolve) => stream.on('end', resolve));

      const execInfo = await exec.inspect();
      console.log(`[CronWorker] Cron job ${cronId} finished with exit code ${execInfo.ExitCode}`);

      // Update last run time
      await db.update(cronJobs).set({ lastRunAt: new Date() }).where(eq(cronJobs.id, cronId));

      return {
        success: execInfo.ExitCode === 0,
        exitCode: execInfo.ExitCode,
        output: output.trim(),
      };
    } catch (err: any) {
      console.error(`[CronWorker] Cron execution failed:`, err.message);
      throw err;
    }
  },
  { connection, concurrency: 5 } // allow parallel execution
);

console.log("[Worker Node] Booted cron worker");
