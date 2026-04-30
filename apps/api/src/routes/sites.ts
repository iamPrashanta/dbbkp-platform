import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs-extra";
import crypto from "node:crypto";
import { db, sites } from "@dbbkp/db";
import { eq } from "drizzle-orm";
import { getFreePort } from "../services/port-manager";
import { hostingQueue } from "../queues";

const router = express.Router();
const upload = multer({ dest: "/tmp/dbbkp-uploads/" });

// ─── POST /api/sites/upload ──────────────────────────────────────────────────
// Auth disabled temporarily as requested for dev speed
router.post("/upload", upload.single("project"), async (req: any, res) => {
  console.log("[Sites:Upload] Received upload request", req.body);
  
  try {
    const { domain, type } = req.body;
    const file = req.file;

    if (!domain) return res.status(400).json({ error: "Domain is required" });
    if (!file) return res.status(400).json({ error: "No file uploaded" });

    const siteId = crypto.randomUUID();
    const sitePath = `/var/www/sites/${siteId}`;

    console.log(`[Sites:Upload] Preparing site directory: ${sitePath}`);
    await fs.ensureDir(sitePath);

    // 1. Unzip
    console.log(`[Sites:Upload] Extracting project files...`);
    const AdmZip = require("adm-zip");
    const zip = new AdmZip(file.path);
    zip.extractAllTo(sitePath, true);

    // 2. Allocate Port
    const port = type === "static" ? null : await getFreePort();
    console.log(`[Sites:Upload] Allocated port: ${port}`);

    // 3. Create site record
    console.log(`[Sites:Upload] Inserting into DB...`);
    const [newSite] = await db
      .insert(sites)
      .values({
        id: siteId,
        domain,
        type: type || "static",
        docRoot: sitePath,
        port,
        source: "zip",
        status: "provisioning",
      })
      .returning();

    // 4. Cleanup temp file
    await fs.remove(file.path);

    // 5. Enqueue deployment job
    console.log(`[Sites:Upload] Enqueueing hosting job...`);
    await hostingQueue.add("deploy-site", { 
      siteId: newSite.id,
      source: "zip"
    });

    return res.json({
      success: true,
      siteId: newSite.id,
      domain,
      runtime: type,
      port
    });

  } catch (err: any) {
    console.error("[Sites:Upload] FAILED:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/sites ──────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const allSites = await db.select().from(sites);
    return res.json(allSites);
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
