import "./env";
import { Worker } from "bullmq";
import { connection } from "./connection";
import { db, jobs, pipelineRuns, pipelineLogs } from "@dbbkp/db";
import { eq } from "drizzle-orm";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

type PipelineJobData = {
  runId?: string;
  dbJobId?: string;
  pipelineId: string;
  repoUrl: string;
  branch: string;
  buildCommand?: string | null;
  deployCommand?: string | null;
  envVars?: Record<string, string>;
};

const ALLOWED_COMMANDS = new Set(["npm", "pnpm", "yarn", "node", "python3", "pip3", "make", "go", "cargo"]);
const isolationMode = process.env.PIPELINE_ISOLATION || "docker";
const dockerImage = process.env.PIPELINE_DOCKER_IMAGE || "node:20-alpine";
const dockerMemory = process.env.PIPELINE_DOCKER_MEMORY || "1g";
const dockerCpus = process.env.PIPELINE_DOCKER_CPUS || "1";
const dockerNetwork = process.env.PIPELINE_DOCKER_NETWORK || "bridge";

async function sendLog(jobId: string, msg: string, type: "log" | "error" | "done" = "log") {
  const apiPort = process.env.API_PORT || process.env.PORT || "4000";
  try {
    await fetch(`http://localhost:${apiPort}/internal/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, message: msg, type }),
    }).catch(() => undefined);
  } catch {
    // Log transport must never fail the job.
  }
}

async function appendRunLog(runId: string | undefined, message: string) {
  if (!runId) return;
  
  // 1. Memory-friendly incremental log for the run table
  const [run] = await db.select({ log: pipelineRuns.log }).from(pipelineRuns).where(eq(pipelineRuns.id, runId)).limit(1);
  const nextLog = `${run?.log ?? ""}${message}`.slice(-200_000);
  await db.update(pipelineRuns).set({ log: nextLog }).where(eq(pipelineRuns.id, runId));

  // 2. Persistent log entry for history
  await db.insert(pipelineLogs).values({
    runId,
    content: message,
  });
}

async function patchRun(runId: string | undefined, data: Partial<typeof pipelineRuns.$inferInsert>) {
  if (!runId) return;
  await db.update(pipelineRuns).set(data).where(eq(pipelineRuns.id, runId));
}

async function patchJob(dbJobId: string | undefined, data: Partial<typeof jobs.$inferInsert>) {
  if (!dbJobId) return;
  await db.update(jobs).set(data).where(eq(jobs.id, dbJobId));
}

function detectInstallCommand(cwd: string): string {
  if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm install";
  if (fs.existsSync(path.join(cwd, "yarn.lock"))) return "yarn install";
  return "npm install --legacy-peer-deps";
}

function classifyError(error: string): string {
  if (error.includes("ERESOLVE") || error.includes("Could not resolve dependency")) return "Dependency conflict";
  if (error.includes("git clone")) return "Clone failed";
  if (error.includes("Docker failed")) return "Infrastructure error";
  if (error.includes("Build failed")) return "Build error";
  if (error.includes("Deploy failed")) return "Deploy error";
  return "Execution error";
}

function streamProcess(
  command: string,
  args: string[],
  cwd: string,
  jobId: string,
  runId: string | undefined,
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: false,
    });

    child.stdout.on("data", (data: Buffer) => {
      const msg = data.toString();
      stdout += msg;
      sendLog(jobId, msg);
      appendRunLog(runId, msg);
    });

    child.stderr.on("data", (data: Buffer) => {
      const msg = data.toString();
      stderr += msg;
      sendLog(jobId, msg, "error");
      appendRunLog(runId, msg);
    });

    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
    child.on("error", (err) => resolve({ code: 1, stdout, stderr: `${stderr}${err.message}` }));
  });
}

async function runHostCommand(command: string, cwd: string, jobId: string, runId: string | undefined, env: Record<string, string>) {
  const executable = command.trim().split(/\s+/)[0];
  if (!ALLOWED_COMMANDS.has(executable)) {
    throw new Error(`Command "${executable}" is not allowed for pipeline execution`);
  }
  const [bin, ...args] = command.trim().split(/\s+/);
  return streamProcess(bin, args, cwd, jobId, runId, env);
}

async function runDockerCommand(command: string, cwd: string, jobId: string, runId: string | undefined, env: Record<string, string>) {
  const envArgs = Object.keys(env).flatMap((key) => ["-e", key]);
  const dockerArgs = [
    "run",
    "--rm",
    "--init",
    "--network",
    dockerNetwork,
    "--memory",
    dockerMemory,
    "--cpus",
    dockerCpus,
    "--pids-limit",
    "256",
    "--security-opt",
    "no-new-privileges",
    "--cap-drop",
    "ALL",
    "-v",
    `${cwd}:/workspace`,
    "-w",
    "/workspace",
    ...envArgs,
    dockerImage,
    "sh",
    "-lc",
    command,
  ];

  return streamProcess("docker", dockerArgs, cwd, jobId, runId, env);
}

function detectRuntime(workDir: string): "node" | "python" | "unknown" {
  if (fs.existsSync(path.join(workDir, "package.json"))) return "node";
  if (fs.existsSync(path.join(workDir, "requirements.txt")) || fs.existsSync(path.join(workDir, "pyproject.toml"))) return "python";
  return "unknown";
}

async function runPipelineCommand(command: string, cwd: string, jobId: string, runId: string | undefined, env: Record<string, string>) {
  const runtime = detectRuntime(cwd);
  let finalCommand = command;
  let image = dockerImage;

  if (runtime === "node") {
    if (command.trim() === "npm install" || command.trim() === "install") {
      finalCommand = detectInstallCommand(cwd);
    }
    image = process.env.PIPELINE_DOCKER_IMAGE_NODE || "node:20-alpine";
  } else if (runtime === "python") {
    if (command.trim() === "npm install" || command.trim() === "install") {
      finalCommand = "pip install -r requirements.txt";
    }
    image = process.env.PIPELINE_DOCKER_IMAGE_PYTHON || "python:3.11-slim";
  }

  await sendLog(jobId, `Runtime detected: ${runtime} (using image: ${image})\n`);
  await appendRunLog(runId, `Runtime detected: ${runtime} (using image: ${image})\n`);

  if (isolationMode === "host") {
    return runHostCommand(finalCommand, cwd, jobId, runId, env);
  }

  // Use the specific image for the runtime
  const envArgs = Object.keys(env).flatMap((key) => ["-e", key]);
  const dockerArgs = [
    "run",
    "--rm",
    "--init",
    "--network",
    dockerNetwork,
    "--memory",
    dockerMemory,
    "--cpus",
    dockerCpus,
    "--pids-limit",
    "256",
    "--security-opt",
    "no-new-privileges",
    "--cap-drop",
    "ALL",
    "-v",
    `${cwd}:/workspace`,
    "-w",
    "/workspace",
    ...envArgs,
    image,
    "sh",
    "-lc",
    finalCommand,
  ];

  return streamProcess("docker", dockerArgs, cwd, jobId, runId, env);
}

export const pipelineWorker = new Worker<PipelineJobData>(
  "pipeline",
  async (job) => {
    if (job.name !== "pipeline-run") return;

    const { runId, dbJobId, repoUrl, branch, buildCommand, deployCommand, envVars = {} } = job.data;
    const workDir = path.join(os.tmpdir(), `dbbkp-pipeline-${job.id}`);
    const jid = String(job.id);
    const startedAt = new Date();

    await patchRun(runId, {
      status: "active",
      startedAt,
      runner: isolationMode,
      image: isolationMode === "docker" ? dockerImage : null,
    });
    await patchJob(dbJobId, { status: "active" });
    await sendLog(jid, `Pipeline started: ${repoUrl} (${branch})\n`);
    await appendRunLog(runId, `Pipeline started: ${repoUrl} (${branch})\n`);

    try {
      if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
      fs.mkdirSync(workDir, { recursive: true });

      const clone = await streamProcess("git", ["clone", "-b", branch, repoUrl, "."], workDir, jid, runId);
      if (clone.code !== 0) {
        throw new Error(`git clone failed: ${clone.stderr || clone.stdout}`);
      }

      if (buildCommand) {
        await sendLog(jid, `\nRunning build in ${isolationMode}: ${buildCommand}\n`);
        await appendRunLog(runId, `\nRunning build in ${isolationMode}: ${buildCommand}\n`);
        const build = await runPipelineCommand(buildCommand, workDir, jid, runId, envVars);
        if (build.code !== 0) throw new Error(`Build failed with exit code ${build.code}`);
      }

      if (deployCommand) {
        await sendLog(jid, `\nRunning deploy in ${isolationMode}: ${deployCommand}\n`);
        await appendRunLog(runId, `\nRunning deploy in ${isolationMode}: ${deployCommand}\n`);
        const deploy = await runPipelineCommand(deployCommand, workDir, jid, runId, envVars);
        if (deploy.code !== 0) throw new Error(`Deploy failed with exit code ${deploy.code}`);
      }

      const finishedAt = new Date();
      const result = { success: true, finishedAt: finishedAt.toISOString() };
      await sendLog(jid, "\nPipeline completed successfully\n", "done");
      await appendRunLog(runId, "\nPipeline completed successfully\n");
      await patchRun(runId, {
        status: "completed",
        exitCode: 0,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      });
      await patchJob(dbJobId, {
        status: "completed",
        result: JSON.stringify(result),
        finishedAt,
      });

      return result;
    } catch (err) {
      const finishedAt = new Date();
      const message = err instanceof Error ? err.message : String(err);
      const failureReason = classifyError(message);

      await sendLog(jid, `\nPipeline failed [${failureReason}]: ${message}\n`, "error");
      await appendRunLog(runId, `\nPipeline failed [${failureReason}]: ${message}\n`);
      await patchRun(runId, {
        status: "failed",
        exitCode: 1,
        error: message,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      });
      await patchJob(dbJobId, {
        status: "failed",
        error: message,
        finishedAt,
      });
      throw err;
    } finally {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        // Best effort cleanup.
      }
    }
  },
  { connection, concurrency: Number.parseInt(process.env.PIPELINE_CONCURRENCY || "2", 10) },
);

pipelineWorker.on("completed", (job) => console.log(`[Pipeline] Job ${job.id} completed`));
pipelineWorker.on("failed", (job, err) => console.error(`[Pipeline] Job ${job?.id} failed:`, err.message));
console.log("[Worker Node] Booted pipeline worker");
