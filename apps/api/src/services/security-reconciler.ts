import { eq } from "drizzle-orm";
import { POSTURE_RISK_WEIGHTS, RULES } from "@dbbkp/utils";
import { remediationEngine } from "./remediation-engine";
import { TraceUtils } from "@dbbkp/utils";

/**
 * Security Compliance Reconciler
 * 
 * Continuously compares the actual host posture against the defined 
 * security baseline. Calculates risk scores and flags drift.
 */
export async function reconcileNodeSecurity(nodeId: string, actualConfig: any) {
  console.log(`[Security:Reconciler] Analyzing posture for node ${nodeId}`);

  // 1. Get the desired policy for this node
  const [policy] = await db
    .select()
    .from(securityPolicies)
    .where(eq(securityPolicies.nodeId, nodeId));

  if (!policy) {
    console.log(`[Security:Reconciler] No policy defined for node ${nodeId}. Skipping.`);
    return;
  }

  let score = 100;
  const drift: any[] = [];

  // 2. Rule Evaluation
  // Rule: SSH Root Disabled
  if (actualConfig.ssh?.rootLogin !== RULES.SSH_ROOT_DISABLED.condition.value) {
    score -= POSTURE_RISK_WEIGHTS.critical;
    drift.push({ 
      ruleId: RULES.SSH_ROOT_DISABLED.id,
      key: RULES.SSH_ROOT_DISABLED.condition.field, 
      expected: RULES.SSH_ROOT_DISABLED.condition.value, 
      actual: actualConfig.ssh?.rootLogin,
      remediation: RULES.SSH_ROOT_DISABLED.remediation,
    });
  }

  // Rule: SSH Password Auth Disabled
  if (actualConfig.ssh?.passwordAuth !== RULES.SSH_PASS_AUTH_DISABLED.condition.value) {
    score -= POSTURE_RISK_WEIGHTS.critical;
    drift.push({ 
      ruleId: RULES.SSH_PASS_AUTH_DISABLED.id,
      key: RULES.SSH_PASS_AUTH_DISABLED.condition.field, 
      expected: RULES.SSH_PASS_AUTH_DISABLED.condition.value, 
      actual: actualConfig.ssh?.passwordAuth,
      remediation: RULES.SSH_PASS_AUTH_DISABLED.remediation,
    });
  }

  // 3. Auto-Plan if drift detected
  if (drift.length > 0 && policy.mode !== "monitor") {
    const trace = TraceUtils.createContext();
    await remediationEngine.createPlan(nodeId, drift, trace);
  }

  // 3. Update Node Hardening State
  await db.insert(nodeHardeningState).values({
    id: crypto.randomUUID(),
    nodeId,
    overallScore: Math.max(0, score),
    complianceStatus: drift.length > 0 ? "drifted" : "compliant",
    actualConfig,
    driftDetails: { drift },
    lastScannedAt: new Date(),
  }).onConflictDoUpdate({
    target: [nodeHardeningState.nodeId] as any,
    set: {
      overallScore: Math.max(0, score),
      complianceStatus: drift.length > 0 ? "drifted" : "compliant",
      actualConfig,
      driftDetails: { drift },
      lastScannedAt: new Date(),
    } as any
  });

  console.log(`[Security:Reconciler] Node ${nodeId} posture score: ${score}% (${drift.length} drift items)`);
}
