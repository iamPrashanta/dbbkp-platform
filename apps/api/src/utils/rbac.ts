import { db, users, userRoles, roles, rolePermissions, permissions } from "@dbbkp/db";
import { eq, and } from "drizzle-orm";

/**
 * RBAC System
 * 
 * Logic:
 * 1. Fetch user roles from user_roles
 * 2. Fetch permissions associated with those roles via role_permissions
 * 3. Check if the required permission key exists in the user's permission set
 */

export async function getUserPermissions(userId: string): Promise<string[]> {
  // Get all permission keys for the user
  const result = await db
    .select({
      key: permissions.key,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(userRoles.userId, userId));

  return result.map((p) => p.key);
}

export async function hasPermission(userId: string, permissionKey: string): Promise<boolean> {
  // Short-circuit: System admins get everything
  const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  if (user?.role === "admin") return true;

  const userPerms = await getUserPermissions(userId);
  return userPerms.includes(permissionKey);
}

/**
 * Predefined System Permissions
 */
export const PERMISSIONS = {
  SITE_CREATE: "site.create",
  SITE_DELETE: "site.delete",
  SITE_DEPLOY: "site.deploy",
  TERMINAL_OPEN: "terminal.open",
  TERMINAL_WRITE: "terminal.write",
  CRON_CREATE: "cron.create",
  DATABASE_CREATE: "database.create",
  NODE_MANAGE: "node.manage",
  SECURITY_RESOLVE: "security.resolve",
  AUDIT_VIEW: "audit.view",
} as const;

/**
 * Initialize system roles (Admin, Developer, Viewer)
 */
export async function seedRoles() {
  const systemRoles = [
    { name: "admin", description: "Full system access", isSystem: true },
    { name: "developer", description: "Manage sites and deployments", isSystem: true },
    { name: "viewer", description: "Read-only access", isSystem: true },
  ];

  for (const r of systemRoles) {
    await db.insert(roles).values(r).onConflictDoNothing();
  }
}
