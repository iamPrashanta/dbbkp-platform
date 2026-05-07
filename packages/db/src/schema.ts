import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  primaryKey,
} from "drizzle-orm/pg-core";

// ─── USERS ───────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  username: varchar("username", { length: 100 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: varchar("role", { length: 20 }).notNull().default("user"), // admin | user
  mustChangePassword: boolean("must_change_password").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── SESSIONS (Auth & Activity) ─────────────────────────────────────────────
export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  lastActivityAt: timestamp("last_activity_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── SERVERS ─────────────────────────────────────────────────────────────────
export const servers = pgTable("servers", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  host: varchar("host", { length: 255 }).notNull(),
  sshUser: varchar("ssh_user", { length: 255 }).notNull().default("root"),
  sshPort: integer("ssh_port").default(22),
  sshKeyPath: text("ssh_key_path"),
  isLocal: boolean("is_local").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── JOBS ─────────────────────────────────────────────────────────────────────
export const jobs = pgTable("jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  bullJobId: varchar("bull_job_id", { length: 100 }),
  type: varchar("type", { length: 50 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("waiting"),
  payload: text("payload"),
  result: text("result"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow(),
  finishedAt: timestamp("finished_at"),
});

// ─── PIPELINES ────────────────────────────────────────────────────────────────
export const pipelines = pgTable("pipelines", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  repoUrl: text("repo_url").notNull(),
  branch: varchar("branch", { length: 255 }).default("main"),
  buildCommand: text("build_command"),
  deployCommand: text("deploy_command"),
  envVars: text("env_vars"),
  enabled: boolean("enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── PIPELINE RUNS ────────────────────────────────────────────────────────────
export const pipelineRuns = pgTable("pipeline_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  pipelineId: uuid("pipeline_id").notNull().references(() => pipelines.id, { onDelete: "cascade" }),
  bullJobId: varchar("bull_job_id", { length: 100 }),
  status: varchar("status", { length: 20 }).notNull().default("waiting"),
  commitSha: varchar("commit_sha", { length: 40 }),
  log: text("log"),
  runner: varchar("runner", { length: 20 }).default("docker"),
  image: varchar("image", { length: 255 }),
  exitCode: integer("exit_code"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow(),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  durationMs: integer("duration_ms"),
});

// ─── SITES ────────────────────────────────────────────────────────────────────
export const sites = pgTable("sites", {
  id: uuid("id").defaultRandom().primaryKey(),
  domain: varchar("domain", { length: 255 }).notNull().unique(),
  type: varchar("type", { length: 20 }).notNull().default("static"),
  docRoot: text("doc_root").notNull(),
  port: integer("port"),
  pm2Name: varchar("pm2_name", { length: 100 }),
  source: varchar("source", { length: 20 }).notNull().default("zip"),
  repoUrl: text("repo_url"),
  branch: varchar("branch", { length: 100 }).default("main"),
  buildCommand: text("build_command"),
  startCommand: text("start_command"),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  phpVersion: varchar("php_version", { length: 10 }).default("8.2"),
  sslEnabled: boolean("ssl_enabled").default(false),
  sslExpiry: timestamp("ssl_expiry"),
  nginxConfig: text("nginx_config"),
  active: boolean("active").default(true),
  isPreview: boolean("is_preview").default(false),
  parentSiteId: uuid("parent_site_id"),
  currentTag: varchar("current_tag", { length: 100 }),

  // Resource Quotas
  cpuLimit: integer("cpu_limit").default(1),
  memoryLimit: integer("memory_limit").default(512),
  pidsLimit: integer("pids_limit").default(256),
  isReadOnly: boolean("is_read_only").default(false),
  
  // Reconciliation
  desiredStatus: varchar("desired_status", { length: 20 }).default("active"),
  lastReconciledAt: timestamp("last_reconciled_at"),
  
  // Expiration
  expiresAt: timestamp("expires_at"),
  isTemporary: boolean("is_temporary").default(false),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── DB INSTANCES ─────────────────────────────────────────────────────────────
export const dbInstances = pgTable("db_instances", {
  id: uuid("id").defaultRandom().primaryKey(),
  type: varchar("type", { length: 20 }).notNull(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  dbUser: varchar("db_user", { length: 100 }).notNull(),
  siteId: uuid("site_id").references(() => sites.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── PIPELINE LOGS ──────────────────────────────────────────────────────────
export const pipelineLogs = pgTable("pipeline_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  runId: uuid("run_id").notNull().references(() => pipelineRuns.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── SECURITY ALERTS ──────────────────────────────────────────────────────────
export const securityAlerts = pgTable("security_alerts", {
  id: uuid("id").defaultRandom().primaryKey(),
  siteId: uuid("site_id").references(() => sites.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 50 }).notNull(),
  severity: varchar("severity", { length: 20 }).notNull().default("high"),
  message: text("message").notNull(),
  details: text("details"),
  resolved: boolean("resolved").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

// ─── SECRETS ──────────────────────────────────────────────────────────────────
export const secrets = pgTable("secrets", {
  id: uuid("id").defaultRandom().primaryKey(),
  keyName: varchar("key_name", { length: 255 }).notNull().unique(),
  encryptedValue: text("encrypted_value").notNull(),
  iv: varchar("iv", { length: 64 }).notNull(),
  authTag: varchar("auth_tag", { length: 64 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── AUDIT LOGS ──────────────────────────────────────────────────────────────
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  action: varchar("action", { length: 100 }).notNull(),
  actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
  actorEmail: varchar("actor_email", { length: 255 }),
  targetId: uuid("target_id"),
  targetType: varchar("target_type", { length: 50 }),
  targetName: varchar("target_name", { length: 255 }),
  metadata: jsonb("metadata"),
  ip: varchar("ip", { length: 50 }),
  userAgent: varchar("user_agent", { length: 500 }),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── CRON JOBS ───────────────────────────────────────────────────────────────
export const cronJobs = pgTable("cron_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  siteId: uuid("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  command: text("command").notNull(),
  schedule: varchar("schedule", { length: 100 }).notNull(),
  active: boolean("active").default(true),
  lastRunAt: timestamp("last_run_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── NODES ──────────────────────────────────────────────────────────────────
export const nodes = pgTable("nodes", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  hostname: varchar("hostname", { length: 255 }).notNull(),
  tokenHash: text("token_hash").notNull(),
  ip: varchar("ip", { length: 64 }),
  publicIp: varchar("public_ip", { length: 64 }),
  os: varchar("os", { length: 100 }),
  arch: varchar("arch", { length: 20 }),
  cpuCores: integer("cpu_cores"),
  memoryMb: integer("memory_mb"),
  dockerVersion: varchar("docker_version", { length: 50 }),
  agentVersion: varchar("agent_version", { length: 50 }),
  status: varchar("status", { length: 20 }).notNull().default("offline"),
  tags: jsonb("tags").$type<string[]>().default([]),
  lastHeartbeatAt: timestamp("last_heartbeat_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── NODE METRICS ──────────────────────────────────────────────────────────
export const nodeMetrics = pgTable("node_metrics", {
  id: uuid("id").defaultRandom().primaryKey(),
  nodeId: uuid("node_id").notNull().references(() => nodes.id, { onDelete: "cascade" }),
  cpuUsage: integer("cpu_usage"),
  memoryUsage: integer("memory_usage"),
  diskUsage: integer("disk_usage"),
  networkRxKb: integer("network_rx_kb"),
  networkTxKb: integer("network_tx_kb"),
  timestamp: timestamp("timestamp").defaultNow(),
});

// ─── TERMINAL SESSIONS ──────────────────────────────────────────────────────────
export const terminalSessions = pgTable("terminal_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  nodeId: uuid("node_id").references(() => nodes.id, { onDelete: "set null" }),
  siteId: uuid("site_id").references(() => sites.id, { onDelete: "set null" }),
  sessionType: varchar("session_type", { length: 30 }).notNull().default("container"),
  targetContainerId: varchar("target_container_id", { length: 100 }),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  idleTimeoutAt: timestamp("idle_timeout_at"),
  recording: text("recording"),
  startedAt: timestamp("started_at").defaultNow(),
  endedAt: timestamp("ended_at"),
});

// ─── RBAC ─────────────────────────────────────────────────────────────────────
export const roles = pgTable("roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 50 }).notNull().unique(),
  description: text("description"),
  isSystem: boolean("is_system").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const permissions = pgTable("permissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: varchar("key", { length: 100 }).notNull().unique(),
  description: text("description"),
});

export const rolePermissions = pgTable("role_permissions", {
  roleId: uuid("role_id").references(() => roles.id, { onDelete: "cascade" }),
  permissionId: uuid("permission_id").references(() => permissions.id, { onDelete: "cascade" }),
}, (t) => ({
  pk: primaryKey({ columns: [t.roleId, t.permissionId] }),
}));

export const userRoles = pgTable("user_roles", {
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  roleId: uuid("role_id").references(() => roles.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id"),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.roleId] }),
}));

// ─── CONTAINER TRACKING ───────────────────────────────────────────────────────
export const containerInstances = pgTable("container_instances", {
  id: uuid("id").defaultRandom().primaryKey(),
  dockerId: varchar("docker_id", { length: 128 }).notNull().unique(),
  nodeId: uuid("node_id").references(() => nodes.id, { onDelete: "cascade" }),
  siteId: uuid("site_id").references(() => sites.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id"),
  runtime: varchar("runtime", { length: 50 }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── EDR & PROCESS EXPLORER ─────────────────────────────────────────
export const processSnapshots = pgTable("process_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  nodeId: uuid("node_id").references(() => nodes.id, { onDelete: "cascade" }),
  containerId: varchar("container_id", { length: 128 }),
  pid: integer("pid").notNull(),
  ppid: integer("ppid"),
  name: varchar("name", { length: 255 }).notNull(),
  command: text("command"),
  cpuUsage: integer("cpu_usage"),
  memoryUsage: integer("memory_usage"),
  user: varchar("user", { length: 100 }),
  sockets: jsonb("sockets"),
  riskScore: integer("risk_score").default(0),
  threatSignals: jsonb("threat_signals"),
  timestamp: timestamp("timestamp").defaultNow(),
});

export const securityThreats = pgTable("security_threats", {
  id: uuid("id").defaultRandom().primaryKey(),
  nodeId: uuid("node_id").references(() => nodes.id, { onDelete: "cascade" }),
  siteId: uuid("site_id").references(() => sites.id, { onDelete: "cascade" }),
  containerId: varchar("container_id", { length: 128 }),
  type: varchar("type", { length: 50 }).notNull(),
  severity: varchar("severity", { length: 20 }).default("high"),
  status: varchar("status", { length: 20 }).default("active"),
  details: jsonb("details"),
  detectedAt: timestamp("detected_at").defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

// ─── FIM & NETWORK TELEMETRY ──────────────────────────────────────────────────
export const fileIntegritySnapshots = pgTable("file_integrity_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  siteId: uuid("site_id").references(() => sites.id, { onDelete: "cascade" }),
  filePath: text("file_path").notNull(),
  hash: varchar("hash", { length: 64 }).notNull(),
  inode: varchar("inode", { length: 50 }),
  permissions: varchar("permissions", { length: 10 }),
  entropy: integer("entropy"),
  isExecutable: boolean("is_executable").default(false),
  lastSeenAt: timestamp("last_seen_at").defaultNow(),
});

export const networkTelemetry = pgTable("network_telemetry", {
  id: uuid("id").defaultRandom().primaryKey(),
  nodeId: uuid("node_id").references(() => nodes.id, { onDelete: "cascade" }),
  containerId: varchar("container_id", { length: 128 }),
  direction: varchar("direction", { length: 10 }).notNull(),
  protocol: varchar("protocol", { length: 10 }),
  localAddr: varchar("local_addr", { length: 100 }),
  remoteAddr: varchar("remote_addr", { length: 100 }),
  remotePort: integer("remote_port"),
  remoteAsn: integer("remote_asn"),
  remoteCountry: varchar("remote_country", { length: 2 }),
  dnsRequest: text("dns_request"),
  riskScore: integer("risk_score").default(0),
  timestamp: timestamp("timestamp").defaultNow(),
});

// ─── SECURITY HARDENING & COMPLIANCE ──────────────────────────────────────────
export const securityPolicies = pgTable("security_policies", {
  id: uuid("id").defaultRandom().primaryKey(),
  nodeId: uuid("node_id").references(() => nodes.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  mode: varchar("mode", { length: 20 }).default("monitor"),
  sshPolicy: jsonb("ssh_policy"),
  firewallPolicy: jsonb("firewall_policy"),
  userPolicy: jsonb("user_policy"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const nodeHardeningState = pgTable("node_hardening_state", {
  id: uuid("id").defaultRandom().primaryKey(),
  nodeId: uuid("node_id").references(() => nodes.id, { onDelete: "cascade" }).unique(),
  overallScore: integer("overall_score").default(0),
  complianceStatus: varchar("compliance_status", { length: 20 }).default("unknown"),
  actualConfig: jsonb("actual_config"),
  driftDetails: jsonb("drift_details"),
  lastScannedAt: timestamp("last_scanned_at").defaultNow(),
});

export const securityRemediationPlans = pgTable("security_remediation_plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  nodeId: uuid("node_id").references(() => nodes.id, { onDelete: "cascade" }),
  policyId: uuid("policy_id").references(() => securityPolicies.id),
  status: varchar("status", { length: 20 }).default("pending"),
  plannedChanges: jsonb("planned_changes"),
  rollbackData: jsonb("rollback_data"),
  riskLevel: varchar("risk_level", { length: 20 }).default("medium"),
  createdBy: uuid("created_by").references(() => users.id),
  approvedBy: uuid("approved_by").references(() => users.id),
  appliedAt: timestamp("applied_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const securityActions = pgTable("security_actions", {
  id: uuid("id").defaultRandom().primaryKey(),
  nodeId: uuid("node_id").references(() => nodes.id, { onDelete: "cascade" }),
  planId: uuid("plan_id").references(() => securityRemediationPlans.id),
  
  action: varchar("action", { length: 100 }).notNull(), // e.g. disable_root_ssh
  actorId: uuid("actor_id").references(() => users.id),
  
  status: varchar("status", { length: 20 }).default("success"), // success | failed | reverted
  
  beforeState: jsonb("before_state"),
  afterState: jsonb("after_state"),
  
  rollbackSnapshotId: varchar("rollback_snapshot_id", { length: 100 }),
  correlationId: varchar("correlation_id", { length: 100 }),
  
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Site = typeof sites.$inferSelect;
export type Pipeline = typeof pipelines.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type Secret = typeof secrets.$inferSelect;
export type Node = typeof nodes.$inferSelect;
export type NodeMetric = typeof nodeMetrics.$inferSelect;
export type TerminalSession = typeof terminalSessions.$inferSelect;
export type Role = typeof roles.$inferSelect;
export type Permission = typeof permissions.$inferSelect;
export type ContainerInstance = typeof containerInstances.$inferSelect;
export type ProcessSnapshot = typeof processSnapshots.$inferSelect;
export type SecurityThreat = typeof securityThreats.$inferSelect;
export type FileIntegritySnapshot = typeof fileIntegritySnapshots.$inferSelect;
export type NetworkTelemetry = typeof networkTelemetry.$inferSelect;
export type SecurityPolicy = typeof securityPolicies.$inferSelect;
export type NodeHardeningState = typeof nodeHardeningState.$inferSelect;
export type SecurityRemediationPlan = typeof securityRemediationPlans.$inferSelect;
export type SecurityAction = typeof securityActions.$inferSelect;
