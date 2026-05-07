import { db, auditLogs } from "@dbbkp/db";

// All known actions — extend this as the platform grows
export type AuditAction =
  | "login"
  | "logout"
  | "deploy"
  | "rollback"
  | "site_create"
  | "site_delete"
  | "file_edit"
  | "file_read"
  | "cron_create"
  | "cron_delete"
  | "db_create"
  | "db_delete"
  | "secret_set"
  | "secret_read"
  | "ssl_issued"
  | "ssl_renewed"
  | "dns_create"
  | "dns_delete"
  | "pipeline_run"
  | "pipeline_create"
  | "pipeline_delete"
  | "threat_detected"
  | "threat_resolved"
  | "user_create"
  | "user_delete";

export interface AuditContext {
  /** UUID of the user performing the action */
  actorId?: string;
  actorEmail?: string;
  /** ID of the resource being acted upon */
  targetId?: string;
  /** Type of resource: site | pipeline | db | secret | user */
  targetType?: string;
  targetName?: string;
  /** Any extra structured data to store */
  metadata?: Record<string, any>;
  /** Request IP address */
  ip?: string;
  userAgent?: string;
}

/**
 * Log an audit event to the database.
 * Non-throwing — if the insert fails it logs to stderr but does NOT crash the request.
 */
export async function logAudit(
  action: AuditAction,
  ctx: AuditContext = {}
): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      action,
      actorId: ctx.actorId ?? null,
      actorEmail: ctx.actorEmail ?? null,
      targetId: ctx.targetId ?? null,
      targetType: ctx.targetType ?? null,
      targetName: ctx.targetName ?? null,
      metadata: ctx.metadata ?? null,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });
  } catch (err) {
    // Non-fatal: never crash the caller
    console.error("[Audit] Failed to write audit log:", err);
  }
}
