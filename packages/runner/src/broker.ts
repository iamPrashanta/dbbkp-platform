import { spawn, spawnSync } from "child_process";
import { logAudit } from "@dbbkp/audit";
import { TraceContext } from "@dbbkp/utils";

export type ExecutionIntentType = "shell.exec" | "docker.exec" | "docker.run" | "container.restart";

export interface ExecutionIntent {
  type: ExecutionIntentType;
  actorId: string;
  tenantId?: string;
  targetId?: string; // siteId or containerId
  command: string;
  args: string[];
  trace?: TraceContext;
}

export interface ExecutionPolicy {
  allowSudo: boolean;
  allowedCommandClasses: string[]; // e.g. "package_manager", "utility", "app_start"
  blockedPatterns: string[];
  maxMemoryMb?: number;
  maxCpus?: number;
  pidsLimit?: number;
  readOnly?: boolean;
}

export const DEFAULT_POLICY: ExecutionPolicy = {
  allowSudo: false,
  allowedCommandClasses: ["utility", "app_start"],
  blockedPatterns: ["rm -rf /", "mkfs", "dd", "chmod 777", "chown root"],
  maxMemoryMb: 512,
  maxCpus: 1,
  pidsLimit: 256,
  readOnly: false,
};

/**
 * Execution Broker
 * 
 * The central authority for running shell and docker commands.
 * Enforces security policies, quotas, and audit trails.
 */
export class ExecutionBroker {
  /**
   * Safe Docker Run
   * Generates hardened docker run arguments based on policy.
   */
  static getDockerSecurityArgs(policy: Partial<ExecutionPolicy> = {}): string[] {
    const p = { ...DEFAULT_POLICY, ...policy };
    const args: string[] = [
      `--memory=${p.maxMemoryMb}m`,
      `--cpus=${p.maxCpus}`,
      `--pids-limit=${p.pidsLimit}`,
      "--security-opt=no-new-privileges",
      "--restart=unless-stopped",
    ];

    if (p.readOnly) {
      args.push("--read-only");
    }

    return args;
  }

  /**
   * Validate Execution Intent
   * The core decision point for whether an action is safe.
   */
  static async validateIntent(intent: ExecutionIntent, policy: Partial<ExecutionPolicy> = {}): Promise<void> {
    const p = { ...DEFAULT_POLICY, ...policy };
    const fullCmd = `${intent.command} ${intent.args.join(" ")}`;

    // 1. Ownership & Tenant Boundary (Conceptual - would check DB in real impl)
    if (intent.tenantId && intent.targetId) {
       // logAudit("intent_validation", { intent });
    }

    // 2. Command Class & Pattern Checks
    if (!p.allowSudo && (intent.command === "sudo" || intent.args.includes("sudo"))) {
      throw new Error("Execution Denied: Privilege escalation (sudo) is forbidden.");
    }

    for (const blocked of p.blockedPatterns) {
      if (fullCmd.includes(blocked)) {
        throw new Error(`Execution Denied: Command contains blocked pattern "${blocked}"`);
      }
    }

    // 3. Type-specific checks
    if (intent.type === "docker.exec") {
      // Ensure we're not exec-ing into a privileged shell unless allowed
      if (intent.args.includes("--privileged")) {
         throw new Error("Execution Denied: Privileged docker execution is forbidden.");
      }
    }

    logAudit("intent_authorized", {
      actorId: intent.actorId,
      targetType: intent.type,
      targetName: intent.targetId || intent.command,
      metadata: { 
        fullCmd,
        correlationId: intent.trace?.correlationId,
        traceId: intent.trace?.traceId,
      },
    });
  }

  /**
   * Safe Shell Execution
   */
  static async runShell(
    intent: ExecutionIntent,
    options: { 
      cwd?: string; 
      env?: NodeJS.ProcessEnv; 
      policy?: Partial<ExecutionPolicy>;
    } = {}
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    // 1. Validate Intent
    await this.validateIntent(intent, options.policy);

    // 2. Spawn
    return new Promise((resolve, reject) => {
      const child = spawn(intent.command, intent.args, {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));

      child.on("close", (code) => {
        resolve({ code: code ?? 0, stdout, stderr });
      });

      child.on("error", reject);
    });
  }
}
