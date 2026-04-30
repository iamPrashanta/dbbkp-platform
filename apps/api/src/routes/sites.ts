import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db, sites } from "@dbbkp/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "./auth";
import { execSync } from "child_process";

import { getFreePort } from "../services/port-manager";
import { hostingQueue } from "../queues";

const router = Router();
const upload = multer({ dest: "/tmp/dbbkp-uploads/" });

// ─── POST /api/sites/upload ──────────────────────────────────────────────────
router.post("/upload", requireAuth, upload.single("project"), async (req: any, res) => {
  try {
    const { domain, type = "static", buildCommand, startCommand } = req.body;
    if (!domain) return res.status(400).json({ error: "Domain is required" });
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const docRoot = `/var/www/sites/${domain}`;
    
    // 1. Allocate Port
    const port = await getFreePort();

    // 2. Create site record or update existing
    let [site] = await db.select().from(sites).where(eq(sites.domain, domain)).limit(1);
    
    if (!site) {
      [site] = await db.insert(sites).values({
        domain,
        type,
        docRoot,
        port,
        buildCommand,
        startCommand,
        status: "deploying",
      }).returning();
    } else {
      [site] = await db.update(sites).set({
        type,
        port,
        buildCommand,
        startCommand,
        status: "deploying",
      }).where(eq(sites.id, site.id)).returning();
    }

    // 3. Extract files
    if (!fs.existsSync(docRoot)) fs.mkdirSync(docRoot, { recursive: true });
    
    const zipPath = req.file.path;
    execSync(`unzip -o ${zipPath} -d ${docRoot}`);
    fs.unlinkSync(zipPath); // cleanup

    // 4. Trigger Orchestration Job
    await hostingQueue.add("deploy-site", { siteId: site.id });

    return res.json({ 
      success: true, 
      message: "Deployment triggered", 
      site: { ...site, status: "deploying", port } 
    });

  } catch (err: any) {
    console.error("[Sites] Deployment failed:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/sites ──────────────────────────────────────────────────────────
router.get("/", requireAuth, async (req, res) => {
  try {
    const allSites = await db.select().from(sites);
    return res.json(allSites);
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
