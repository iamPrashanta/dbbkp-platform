import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
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
// Persisted mirror of BullMQ jobs for querying history
export const jobs = pgTable("jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  bullJobId: varchar("bull_job_id", { length: 100 }), // BullMQ job id
  type: varchar("type", { length: 50 }).notNull(), // backup | infra | pipeline
  name: varchar("name", { length: 100 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("waiting"), // waiting | active | completed | failed
  payload: text("payload"),   // JSON input
  result: text("result"),     // JSON output
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
  envVars: text("env_vars"), // JSON key-value pairs
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

// ─── SITES (traditional hosting) ─────────────────────────────────────────────
export const sites = pgTable("sites", {
  id: uuid("id").defaultRandom().primaryKey(),
  domain: varchar("domain", { length: 255 }).notNull().unique(),
  type: varchar("type", { length: 20 }).notNull().default("static"), // static | node | python | php | docker
  docRoot: text("doc_root").notNull(),
  port: integer("port"), // Internal port for the app
  pm2Name: varchar("pm2_name", { length: 100 }), // PM2 process name
  source: varchar("source", { length: 20 }).notNull().default("zip"), // zip | git
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
  parentSiteId: uuid("parent_site_id"), // Reference to main site
  currentTag: varchar("current_tag", { length: 100 }), // e.g. v-171828328 or commit sha
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── DB INSTANCES ─────────────────────────────────────────────────────────────
export const dbInstances = pgTable("db_instances", {
  id: uuid("id").defaultRandom().primaryKey(),
  type: varchar("type", { length: 20 }).notNull(), // pgsql | mysql
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
  type: varchar("type", { length: 50 }).notNull(), // malware | suspicious_process | permissions | cron
  severity: varchar("severity", { length: 20 }).notNull().default("high"),
  message: text("message").notNull(),
  details: text("details"), // JSON string with file path, line number, matched string, etc.
  resolved: boolean("resolved").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

// ─── SECRETS ──────────────────────────────────────────────────────────────────
// Stores encrypted credentials: API keys, SSH keys, DB passwords, tokens
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
  // action: what happened — login | deploy | rollback | file_edit | cron_create | db_create | ssl | dns | delete
  action: varchar("action", { length: 100 }).notNull(),
  // actor: who triggered it
  actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
  actorEmail: varchar("actor_email", { length: 255 }),
  // target: what was affected
  targetId: uuid("target_id"),
  targetType: varchar("target_type", { length: 50 }), // site | pipeline | db | secret
  targetName: varchar("target_name", { length: 255 }),
  // details
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
  schedule: varchar("schedule", { length: 100 }).notNull(), // cron expression e.g., "* * * * *"
  active: boolean("active").default(true),
  lastRunAt: timestamp("last_run_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Server = typeof servers.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Pipeline = typeof pipelines.$inferSelect;
export type PipelineRun = typeof pipelineRuns.$inferSelect;
export type PipelineLog = typeof pipelineLogs.$inferSelect;
export type Site = typeof sites.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type CronJob = typeof cronJobs.$inferSelect;
export type SecurityAlert = typeof securityAlerts.$inferSelect;
export type Secret = typeof secrets.$inferSelect;
