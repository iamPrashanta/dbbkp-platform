import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
} from "drizzle-orm/pg-core";

// ─── USERS ───────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  username: varchar("username", { length: 100 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: varchar("role", { length: 20 }).notNull().default("user"), // admin | user
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
  type: varchar("type", { length: 20 }).notNull().default("static"), // static | node | python | php
  docRoot: text("doc_root").notNull(),
  port: integer("port"), // Internal port for the app
  pm2Name: varchar("pm2_name", { length: 100 }), // PM2 process name
  buildCommand: text("build_command"),
  startCommand: text("start_command"),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  phpVersion: varchar("php_version", { length: 10 }).default("8.2"),
  sslEnabled: boolean("ssl_enabled").default(false),
  sslExpiry: timestamp("ssl_expiry"),
  nginxConfig: text("nginx_config"),
  active: boolean("active").default(true),
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

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Server = typeof servers.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Pipeline = typeof pipelines.$inferSelect;
export type PipelineRun = typeof pipelineRuns.$inferSelect;
export type PipelineLog = typeof pipelineLogs.$inferSelect;
export type Site = typeof sites.$inferSelect;
