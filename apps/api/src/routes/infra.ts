import { Router } from "express";
import { Queue } from "bullmq";

export const infraQueue = new Queue("infra", {
  connection: { host: process.env.REDIS_HOST || "127.0.0.1", port: parseInt(process.env.REDIS_PORT || "6379") },
});

const router = Router();

// Helper to standardise responses
const handleJob = async (jobName: string, req: any, res: any) => {
  try {
    const job = await infraQueue.add(jobName, {
      timestamp: Date.now(),
      ...req.body
    });

    res.json({
      success: true,
      message: `${jobName} job queued successfully`,
      jobId: job.id
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};

router.post("/health-check", (req, res) => handleJob("infra-health", req, res));
router.post("/disk", (req, res) => handleJob("infra-disk", req, res));
router.post("/network", (req, res) => handleJob("infra-network", req, res));
router.post("/scan", (req, res) => handleJob("infra-scan", req, res));

router.get("/jobs", async (req, res) => {
  try {
    const jobs = await infraQueue.getJobs(['waiting', 'active', 'completed', 'failed']);
    const formattedJobs = jobs.map(j => ({
      id: j.id,
      name: j.name,
      data: j.data,
      state: j.finishedOn ? (j.failedReason ? 'failed' : 'completed') : (j.processedOn ? 'active' : 'waiting'),
      failedReason: j.failedReason,
      timestamp: j.timestamp,
      finishedOn: j.finishedOn,
      result: j.returnvalue,
    })).sort((a, b) => b.timestamp - a.timestamp);
    
    res.json(formattedJobs);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

export default router;
