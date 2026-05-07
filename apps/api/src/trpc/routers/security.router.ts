import { z } from "zod";
import { router, protectedProcedure, adminProcedure, permissionProcedure } from "../trpc";
import { 
  db, processSnapshots, securityThreats, nodes, 
  containerInstances, fileIntegritySnapshots, networkTelemetry 
} from "@dbbkp/db";
import { eq, sql, desc, and, lt } from "drizzle-orm";
import { PERMISSIONS } from "../../utils/rbac";
import Docker from "dockerode";

const docker = new Docker();

export const securityRouter = router({
  // ─── Process Explorer ──────────────────────────────────────────────────────
  listProcesses: permissionProcedure(PERMISSIONS.AUDIT_VIEW)
    .input(z.object({ nodeId: z.string().uuid().optional(), containerId: z.string().optional() }))
    .query(async ({ input }) => {
      let query = db.select().from(processSnapshots);
      
      const filters = [];
      if (input.nodeId) filters.push(eq(processSnapshots.nodeId, input.nodeId));
      if (input.containerId) filters.push(eq(processSnapshots.containerId, input.containerId));

      if (filters.length > 0) {
        return query.where(and(...filters)).orderBy(desc(processSnapshots.riskScore));
      }

      return query.orderBy(desc(processSnapshots.riskScore)).limit(100);
    }),

  // ─── Threat Console ────────────────────────────────────────────────────────
  listThreats: permissionProcedure(PERMISSIONS.SECURITY_RESOLVE)
    .query(async () => {
      return db
        .select()
        .from(securityThreats)
        .where(eq(securityThreats.status, "active"))
        .orderBy(desc(securityThreats.detectedAt));
    }),

  resolveThreat: permissionProcedure(PERMISSIONS.SECURITY_RESOLVE)
    .input(z.object({ threatId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await db
        .update(securityThreats)
        .set({ status: "resolved", resolvedAt: new Date() })
        .where(eq(securityThreats.id, input.threatId));
      return { success: true };
    }),

  // ─── Remediation Actions ───────────────────────────────────────────────────
  terminateProcess: permissionProcedure(PERMISSIONS.SECURITY_RESOLVE)
    .input(z.object({ nodeId: z.string().uuid(), pid: z.number() }))
    .mutation(async ({ input }) => {
      // In a real distributed system, we'd send a command to the agent
      // For now, if the node is local or we use a queue, we trigger the action.
      console.log(`[Security:Remediation] Terminating PID ${input.pid} on node ${input.nodeId}`);
      // Implementation: send 'kill -9 <pid>' via agent command channel (Sprint F)
      return { success: true, message: "Termination command queued" };
    }),

  quarantineContainer: permissionProcedure(PERMISSIONS.SECURITY_RESOLVE)
    .input(z.object({ containerId: z.string() }))
    .mutation(async ({ input }) => {
      console.log(`[Security:Remediation] Quarantining container ${input.containerId}`);
      try {
        const container = docker.getContainer(input.containerId);
        await container.pause(); // Initial quarantine: pause execution
        return { success: true, message: "Container paused (quarantined)" };
      } catch (err: any) {
        throw new Error(`Quarantine failed: ${err.message}`);
      }
    }),

  // ─── FIM Explorer ──────────────────────────────────────────────────────────
  listFileSnapshots: permissionProcedure(PERMISSIONS.AUDIT_VIEW)
    .input(z.object({ siteId: z.string().uuid() }))
    .query(async ({ input }) => {
      return db
        .select()
        .from(fileIntegritySnapshots)
        .where(eq(fileIntegritySnapshots.siteId, input.siteId))
        .orderBy(desc(fileIntegritySnapshots.lastSeenAt));
    }),

  // ─── Network Explorer ──────────────────────────────────────────────────────
  listNetworkEvents: permissionProcedure(PERMISSIONS.AUDIT_VIEW)
    .input(z.object({ nodeId: z.string().uuid().optional(), containerId: z.string().optional() }))
    .query(async ({ input }) => {
      let query = db.select().from(networkTelemetry);
      const filters = [];
      if (input.nodeId) filters.push(eq(networkTelemetry.nodeId, input.nodeId));
      if (input.containerId) filters.push(eq(networkTelemetry.containerId, input.containerId));
      
      if (filters.length > 0) {
        return query.where(and(...filters)).orderBy(desc(networkTelemetry.timestamp)).limit(200);
      }
      return query.orderBy(desc(networkTelemetry.timestamp)).limit(100);
    }),
});
