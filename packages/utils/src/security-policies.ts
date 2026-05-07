/**
 * Security Posture & Hardening Policy Definitions
 */

export interface SecurityRule {
  id: string;
  category: "ssh" | "firewall" | "users" | "system";
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  
  condition: {
    field: string; // e.g. "ssh.rootLogin"
    operator: "equals" | "not_equals" | "contains" | "not_contains";
    value: any;
  };
  
  remediation?: {
    type: "sshd_config" | "ufw" | "shell_command";
    action: "set" | "add" | "remove";
    key?: string;
    value?: any;
    script?: string;
  };

  safetyGuard?: "ssh_access" | "network_connectivity";
}

export interface PolicyPack {
  id: string;
  name: string;
  description: string;
  rules: SecurityRule[];
}

/**
 * Standard Rules Library
 */
export const RULES: Record<string, SecurityRule> = {
  SSH_ROOT_DISABLED: {
    id: "ssh-root-disabled",
    category: "ssh",
    severity: "critical",
    description: "Disable root login over SSH",
    condition: { field: "ssh.rootLogin", operator: "equals", value: false },
    remediation: { type: "sshd_config", action: "set", key: "PermitRootLogin", value: "no" },
    safetyGuard: "ssh_access",
  },
  SSH_PASS_AUTH_DISABLED: {
    id: "ssh-pass-auth-disabled",
    category: "ssh",
    severity: "critical",
    description: "Disable password authentication for SSH",
    condition: { field: "ssh.passwordAuth", operator: "equals", value: false },
    remediation: { type: "sshd_config", action: "set", key: "PasswordAuthentication", value: "no" },
    safetyGuard: "ssh_access",
  },
  FIREWALL_ENABLED: {
    id: "firewall-enabled",
    category: "firewall",
    severity: "high",
    description: "Ensure UFW firewall is enabled",
    condition: { field: "firewall.enabled", operator: "equals", value: true },
    remediation: { type: "ufw", action: "set", value: "enable" },
    safetyGuard: "network_connectivity",
  },
};

/**
 * Policy Packs
 */
export const POLICY_PACKS: PolicyPack[] = [
  {
    id: "ubuntu-hardened",
    name: "Ubuntu Hardened Baseline",
    description: "Strict hardening based on CIS and industry best practices.",
    rules: [RULES.SSH_ROOT_DISABLED, RULES.SSH_PASS_AUTH_DISABLED, RULES.FIREWALL_ENABLED],
  },
  {
    id: "hosting-safe",
    name: "Shared Hosting Safe Mode",
    description: "Balanced security for shared hosting environments.",
    rules: [RULES.SSH_ROOT_DISABLED, RULES.FIREWALL_ENABLED],
  }
];

/**
 * Risk Scoring Weights
 */
export const POSTURE_RISK_WEIGHTS = {
  critical: 40,
  high: 25,
  medium: 10,
  low: 5,
};
