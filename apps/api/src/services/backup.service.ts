import { runCommand, resolveScriptPath } from "@dbbkp/runner";

// Resolving the absolute path so we avoid relative chaos
const scriptPath = resolveScriptPath("dbbkp.sh");

export async function runPgBackup(env: {
  DB_HOST: string;
  DB_USER: string;
  DB_PASS: string;
  DB_NAME: string;
}) {
  return runCommand({
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
}
