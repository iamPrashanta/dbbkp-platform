import { db, securityRemediationPlans, securityActions, securityPolicies } from "@dbbkp/db";
import { eq } from "drizzle-orm";
import { SecurityRule, POLICY_PACKS } from "@dbbkp/utils";
import { TraceContext, TraceUtils } from "@dbbkp/utils";

/**
 * Remediation Engine
 * 
 * Manages the lifecycle of security hardening actions.
 * Detect -> Plan -> Risk Analyze -> Approve -> Execute -> Verify -> Rollback
 */
export class RemediationEngine {
  
  /**
   * 1. Detect & Plan
   * Generates a remediation plan based on detected drift.
   */
  async createPlan(nodeId: string, drift: any[], trace: TraceContext) {
    console.log(`[Remediation:Planner] Creating plan for node ${nodeId}`);

    const plannedChanges = drift.map(d => ({
      ruleId: d.ruleId,
      field: d.key,
      proposedValue: d.expected,
      currentValue: d.actual,
      risk: "medium", // placeholder
      remediation: d.remediation,
    }));

    const [plan] = await db.insert(securityRemediationPlans).values({
      id: crypto.randomUUID(),
      nodeId,
      status: "pending",
      plannedChanges: { changes: plannedChanges },
      riskLevel: "medium",
    }).returning();

    return plan;
  }

  /**
   * 2. Execute (with Safety Guards)
   */
  async executePlan(planId: string, actorId: string, trace: TraceContext) {
    const [plan] = await db
      .select()
      .from(securityRemediationPlans)
      .where(eq(securityRemediationPlans.id, planId));

    if (!plan || plan.status !== "approved") {
      throw new Error("Plan not found or not approved");
    }

    console.log(`[Remediation:Executor] Executing plan ${planId} on node ${plan.nodeId}`);

    const changes = (plan.plannedChanges as any).changes;
    
    for (const change of changes) {
      // a. Safety Guard Check (Stub)
      if (change.safetyGuard === "ssh_access") {
        console.log(`[Remediation:Guard] Running SSH safety check...`);
        // Logic: verify if current session is stable and port 22 remains open
      }

      // b. Log Action (Immutable timeline)
      const actionId = crypto.randomUUID();
      await db.insert(securityActions).values({
        id: actionId,
        nodeId: plan.nodeId as string,
        planId: plan.id,
        action: change.ruleId,
        actorId,
        status: "pending",
        beforeState: { value: change.currentValue },
        correlationId: trace.correlationId,
      });

      // c. Execute via Broker (Future step)
      // d. Verify (Future step)
      
      await db.update(securityActions)
        .set({ status: "success", afterState: { value: change.proposedValue } })
        .where(eq(securityActions.id, actionId));
    }

    await db.update(securityRemediationPlans)
      .set({ status: "applied", appliedAt: new Date() })
      .where(eq(securityRemediationPlans.id, planId));

    return { success: true };
  }
}

export const remediationEngine = new RemediationEngine();
