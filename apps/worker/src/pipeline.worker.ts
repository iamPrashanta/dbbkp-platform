import { Worker } from "bullmq";
import { connection } from "./connection";
import { db, pipelineRuns } from "@dbbkp/db";
import { eq } from "drizzle-orm";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

// We import broadcastLog via HTTP POST to avoid circular dep across apps
// In production, move logClients to a shared Redis pub/sub channel
async function sendLog(jobId: string, msg: string, type = "log") {
  try {
    await fetch(`http://localhost:${process.env.API_PORT ?? 3000}/internal/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, message: msg, type }),
    }).catch(() => {}); // non-critical, swallow errors
  } catch {}
}

// ─── Allowed commands (security: no raw user shell injection) ─────────────────
const ALLOWED_PREFIXES = ["npm", "pnpm", "yarn", "node", "python3", "pip3", "make", "go", "cargo", "bash -c", "sh -c"];

function isCommandSafe(cmd: string): boolean {
  return ALLOWED_PREFIXES.some(prefix => cmd.trim().startsWith(prefix));
}

// ─── Run a command and stream stdout/stderr ───────────────────────────────────
function runCommandStreamed(
  cmd: string,
  args: string[],
  cwd: string,
  jobId: string,
  env: Record<string, string> = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";

    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: false,
    });

    child.stdout.on("data", (data: Buffer) => {
      const msg = data.toString();
      stdout += msg;
      sendLog(jobId, msg);
    });

    child.stderr.on("data", (data: Buffer) => {
      const msg = data.toString();
      stderr += msg;
      sendLog(jobId, msg, "error");
    });

    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
    child.on("error", (err) => {
      stderr += err.message;
      resolve({ code: 1, stdout, stderr });
    });
  });
}

// ─── Pipeline Worker ──────────────────────────────────────────────────────────
export const pipelineWorker = new Worker(
  "pipeline",
  async (job) => {
    if (job.name !== "pipeline-run") return;

    const { runId, pipelineId, repoUrl, branch, buildCommand, deployCommand, envVars = {} } = job.data;
    const workDir = `/tmp/dbbkp-pipeline-${job.id}`;
    const jid = String(job.id);

    await sendLog(jid, `🚀 Pipeline started — cloning ${repoUrl}@${branch}\n`);

    // Mark run as active
    if (runId) {
      await db.update(pipelineRuns).set({ status: "active" }).where(eq(pipelineRuns.id, runId));
    }

    try {
      // 1. Clean work dir
      if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
      fs.mkdirSync(workDir, { recursive: true });

      // 2. Git clone
      const clone = await runCommandStreamed("git", ["clone", "-b", branch, repoUrl, "."], workDir, jid);
      if (clone.code !== 0) throw new Error(`git clone failed: ${clone.stderr}`);

      // 3. Build
      if (buildCommand) {
        if (!isCommandSafe(buildCommand)) throw new Error(`Build command not allowed: "${buildCommand}"`);
        await sendLog(jid, `\n🔨 Running build: ${buildCommand}\n`);
        const [buildBin, ...buildArgs] = buildCommand.split(" ");
        const build = await runCommandStreamed(buildBin, buildArgs, workDir, jid, envVars);
        if (build.code !== 0) throw new Error(`Build failed (exit ${build.code})`);
      }

      // 4. Deploy
      if (deployCommand) {
        if (!isCommandSafe(deployCommand)) throw new Error(`Deploy command not allowed: "${deployCommand}"`);
        await sendLog(jid, `\n🚢 Running deploy: ${deployCommand}\n`);
        const [depBin, ...depArgs] = deployCommand.split(" ");
        const deploy = await runCommandStreamed(depBin, depArgs, workDir, jid, envVars);
        if (deploy.code !== 0) throw new Error(`Deploy failed (exit ${deploy.code})`);
      }

      await sendLog(jid, `\n✅ Pipeline completed successfully\n`, "done");

      if (runId) {
        await db.update(pipelineRuns).set({ status: "completed", finishedAt: new Date() })
          .where(eq(pipelineRuns.id, runId));
      }

      return { success: true };
    } catch (err: any) {
      await sendLog(jid, `\n❌ Pipeline failed: ${err.message}\n`, "error");
      if (runId) {
        await db.update(pipelineRuns)
          .set({ status: "failed", finishedAt: new Date(), log: err.message })
          .where(eq(pipelineRuns.id, runId));
      }
      throw err;
    } finally {
      // Cleanup work dir
      try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
    }
  },
  { connection, concurrency: 2 }
);

pipelineWorker.on("completed", (job) => console.log(`[Pipeline] Job ${job.id} completed`));
pipelineWorker.on("failed", (job, err) => console.error(`[Pipeline] Job ${job?.id} failed:`, err.message));
console.log("[Worker Node] Booted pipeline worker");
