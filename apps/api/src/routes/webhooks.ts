import { Router } from "express";
import crypto from "node:crypto";
import { db, sites, pipelines } from "@dbbkp/db";
import { eq } from "drizzle-orm";
import { hostingQueue, pipelineQueue } from "../queues";

const router = Router();

// Helper to verify GitHub webhook signatures
function verifyGitHubSignature(payload: string, signature: string, secret: string) {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(payload);
  const digest = `sha256=${hmac.digest("hex")}`;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

router.post("/github", async (req, res) => {
  try {
    const signature = req.headers["x-hub-signature-256"] as string;
    const event = req.headers["x-github-event"] as string;
    const secret = process.env.GITHUB_WEBHOOK_SECRET;

    if (!signature || !event) {
      res.status(400).json({ error: "Missing signature or event" });
      return;
    }

    if (secret) {
      const rawPayload = JSON.stringify(req.body);
      if (!verifyGitHubSignature(rawPayload, signature, secret)) {
        res.status(401).json({ error: "Invalid signature" });
        return;
      }
    }

    const payload = req.body;
    
    // Check if this repository is linked to any of our pipelines
    const repoUrl = payload.repository?.clone_url || payload.repository?.html_url;
    if (!repoUrl) {
      res.status(400).json({ error: "No repository URL found in payload" });
      return;
    }

    if (event === "push") {
      const branch = payload.ref?.replace("refs/heads/", "") || "main";
      
      // 1. Trigger Pipelines
      const linkedPipelines = await db.select().from(pipelines).where(eq(pipelines.repoUrl, repoUrl));
      for (const pipeline of linkedPipelines) {
        if (pipeline.branch === branch && pipeline.enabled) {
          console.log(`[Webhook] Triggering pipeline ${pipeline.name} for branch ${branch}`);
          // Note: In a real system, we'd use the pipeline router's run method, but we can just enqueue directly here
          // We would need to create a pipelineRun and job record. To keep it simple, we just log it for now.
          // The actual implementation of triggering a pipeline run is better done via the tRPC client or shared logic.
          console.log(`[Webhook] Pipeline triggering is delegated to manual / tRPC run for now.`);
        }
      }

      // 2. Trigger Site Auto-Deploys (if we want direct site push-to-deploy)
      const linkedSites = await db.select().from(sites).where(eq(sites.repoUrl, repoUrl));
      for (const site of linkedSites) {
        if (site.branch === branch && site.active && !site.isPreview) {
          console.log(`[Webhook] Triggering auto-deploy for site ${site.domain}`);
          await hostingQueue.add("deploy-site", {
            siteId: site.id,
            source: "git",
            repoUrl: site.repoUrl,
            branch: site.branch,
          });
        }
      }
    } 
    else if (event === "pull_request") {
      const action = payload.action;
      const prNumber = payload.pull_request?.number;
      const branch = payload.pull_request?.head?.ref;
      
      if (!prNumber || !branch) {
        res.status(400).json({ error: "Invalid PR payload" });
        return;
      }

      // Find the parent site that corresponds to this repository
      const [parentSite] = await db.select().from(sites).where(eq(sites.repoUrl, repoUrl)).limit(1);
      
      if (parentSite && !parentSite.isPreview) {
        const previewDomain = `pr-${prNumber}-${parentSite.domain}`;

        if (action === "opened" || action === "synchronize" || action === "reopened") {
          console.log(`[Webhook] Spinning up Preview Environment: ${previewDomain}`);
          
          // Check if preview site already exists
          const [existingPreview] = await db.select().from(sites).where(eq(sites.domain, previewDomain)).limit(1);
          
          let previewSiteId;
          if (!existingPreview) {
            const [newPreview] = await db.insert(sites).values({
              id: crypto.randomUUID(),
              domain: previewDomain,
              type: parentSite.type,
              docRoot: `/var/www/sites/preview-${crypto.randomUUID().slice(0, 8)}`,
              source: "git",
              repoUrl: repoUrl,
              branch: branch,
              isPreview: true,
              parentSiteId: parentSite.id,
              active: true,
            }).returning();
            previewSiteId = newPreview.id;
          } else {
            previewSiteId = existingPreview.id;
          }

          // Trigger deployment for the preview site
          await hostingQueue.add("deploy-site", {
            siteId: previewSiteId,
            source: "git",
            repoUrl: repoUrl,
            branch: branch,
          });
        } 
        else if (action === "closed") {
          console.log(`[Webhook] Tearing down Preview Environment: ${previewDomain}`);
          
          const [previewSite] = await db.select().from(sites).where(eq(sites.domain, previewDomain)).limit(1);
          if (previewSite) {
            // We would ideally have a "destroy-site" worker job
            // For now, we update it as inactive and we could clean it up manually or add a cleanup job
            await db.update(sites).set({ active: false }).where(eq(sites.id, previewSite.id));
            console.log(`[Webhook] Marked preview site ${previewSite.id} as inactive.`);
          }
        }
      }
    }

    res.json({ ok: true });
  } catch (err: any) {
    console.error("[Webhook Error]:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
