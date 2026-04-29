import { spawn } from "child_process";
import fs from "fs";
import path from "path";

export type RunOptions = {
  cmd: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  timeoutMs?: number;
};

export function runCommand(options: RunOptions): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.cmd, options.args, {
      env: { ...process.env, ...options.env },
      cwd: options.cwd,
    });

    let stdout = "";
    let stderr = "";

    const timeout = options.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("Process timeout"));
        }, options.timeoutMs)
      : null;

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("close", (code) => {
      if (timeout) clearTimeout(timeout);
      resolve({ code: code ?? 0, stdout, stderr });
    });

    child.on("error", reject);
  });
}

/**
 * Dynamically resolves the path to a script by walking up the directory tree.
 * Checks for the script inside a `scripts/` or `dbbkp/` folder.
 * Eliminates the need to copy scripts into the platform repo.
 */
export function resolveScriptPath(scriptName: string): string {
  if (process.env.SCRIPTS_DIR) {
    return path.join(process.env.SCRIPTS_DIR, scriptName).replace(/\\/g, "/");
  }

  let currentDir = process.cwd();
  
  // Walk up to 5 directories looking for "dbbkp" or "scripts" folder containing the script
  for (let i = 0; i < 5; i++) {
    const scriptsPath = path.join(currentDir, "scripts", scriptName);
    if (fs.existsSync(scriptsPath)) return scriptsPath.replace(/\\/g, "/");

    const dbbkpPath = path.join(currentDir, "dbbkp", scriptName);
    if (fs.existsSync(dbbkpPath)) return dbbkpPath.replace(/\\/g, "/");

    // also check sibling dbbkp just in case we are inside dbbkp-platform
    const siblingDbbkpPath = path.join(currentDir, "../dbbkp", scriptName);
    if (fs.existsSync(siblingDbbkpPath)) return siblingDbbkpPath.replace(/\\/g, "/");

    currentDir = path.dirname(currentDir);
  }

  throw new Error(`Script ${scriptName} not found in any standard locations.`);
}
