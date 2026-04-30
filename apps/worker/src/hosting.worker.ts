import { Worker } from "bullmq";
import { connection } from "./connection";
import { db, sites } from "@dbbkp/db";
import { eq } from "drizzle-orm";
import Docker from "dockerode";
import execa from "execa";
import fs from "fs-extra";

const docker = new Docker();

// ─── Hosting Worker ──────────────────────────────────────────────────────────
export const hostingWorker = new Worker(
  "hosting",
  async (job) => {
    if (job.name !== "deploy-site") return;

    const { siteId } = job.data;
    const [site] = await db.select().from(sites).where(eq(sites.id, siteId)).limit(1);
    if (!site) throw new Error("Site not found");

    const { domain, docRoot, type, port, source, repoUrl, branch } = site;
    const containerName = `dbbkp-site-${site.id.slice(0, 8)}`;
    const logPath = `/var/log/dbbkp/${site.id}.log`;

    // Ensure log directory exists
    await fs.ensureDir("/var/log/dbbkp");

    const logStream = fs.createWriteStream(logPath, { flags: "a" });
    const log = (msg: string) => {
      const entry = `[${new Date().toISOString()}] ${msg}\n`;
      logStream.write(entry);
      console.log(`[Hosting:${domain}] ${msg}`);
    };

    try {
      await db.update(sites).set({ status: "provisioning" }).where(eq(sites.id, siteId));
      log(`Starting deployment for ${domain} (Source: ${source}, Type: ${type})`);

      // 1. Container Cleanup (Thorough)
      log("Cleaning up existing containers...");
      const containers = await docker.listContainers({ all: true });
      for (const c of containers) {
        if (c.Names.includes(`/${containerName}`)) {
          const container = docker.getContainer(c.Id);
          log(`Stopping/Removing old container: ${c.Id.slice(0, 12)}`);
          await container.stop().catch(() => {});
          await container.remove().catch(() => {});
        }
      }

      // 2. Source Preparation
      await fs.ensureDir(docRoot);
      if (source === "git" && repoUrl) {
        log(`Cloning repository: ${repoUrl} (branch: ${branch})...`);
        // Clean docRoot first
        await fs.emptyDir(docRoot);
        await execa("git", ["clone", "--depth=1", "-b", branch || "main", repoUrl, docRoot]);
      } else if (source === "zip") {
        log("Project source is ZIP (files already extracted or expected in docRoot)");
      }

      // 3. Build Stage (Separated)
      if (type !== "static") {
        log(`Starting build stage for ${type}...`);
        const buildImage = type === "node" ? "node:20-alpine" : "python:3.11-slim";
        const installCmd = type === "node" ? "npm install --production" : "pip install -r requirements.txt";

        const buildContainer = await docker.createContainer({
          Image: buildImage,
          Tty: true,
          HostConfig: { Binds: [`${docRoot}:/app`] },
          WorkingDir: "/app",
          Cmd: ["sh", "-c", installCmd],
        });

        await buildContainer.start();
        const buildResult = await buildContainer.wait();
        await buildContainer.remove();

        if (buildResult.StatusCode !== 0) {
          throw new Error(`Build stage failed with code ${buildResult.StatusCode}`);
        }
        log("Build stage completed successfully");

        // 4. Runtime Stage (with Health Checks)
        log("Starting runtime container...");
        const startCmd = site.startCommand || (type === "node" ? "npm start" : "python app.py");
        
        const container = await docker.createContainer({
          Image: buildImage,
          name: containerName,
          ExposedPorts: { [`${port}/tcp`]: {} },
          Healthcheck: {
            Test: ["CMD", "sh", "-c", `nc -z localhost ${port} || exit 1`],
            Interval: 10 * 1000000000, // 10s
            Timeout: 5 * 1000000000,   // 5s
            Retries: 3,
            StartPeriod: 15 * 1000000000, // 15s grace
          },
          HostConfig: {
            Binds: [`${docRoot}:/app`],
            PortBindings: { [`${port}/tcp`]: [{ HostPort: String(port) }] },
            RestartPolicy: { Name: "always" },
            Memory: 512 * 1024 * 1024,
            CpuPeriod: 100000,
            CpuQuota: 50000,
          },
          WorkingDir: "/app",
          Env: [`PORT=${port}`, `NODE_ENV=production`],
          Cmd: ["sh", "-c", startCmd],
        });

        await container.start();
        log(`Runtime container started: ${containerName}`);
      }
      log(`Runtime container started: ${containerName}`);

      // 5. Nginx Configuration
      log("Configuring Nginx...");
      let nginxConfig = "";

      if (type === "static") {
        nginxConfig = `
server {
    listen 80;
    server_name ${domain};
    root ${docRoot};
    index index.html index.htm;

    location / {
        try_files $uri $uri/ =404;
    }
}
`;
      } else {
        nginxConfig = `
server {
    listen 80;
    server_name ${domain};

    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
`;
      }

      const configPath = `/etc/nginx/sites-available/dbbkp-${domain}`;
      const enabledPath = `/etc/nginx/sites-enabled/dbbkp-${domain}`;
      const tmpPath = `/tmp/nginx-${domain}.conf`;

      await fs.writeFile(tmpPath, nginxConfig);
      
      try {
        await execa("sudo", ["mv", tmpPath, configPath]);
        await execa("sudo", ["ln", "-sf", configPath, enabledPath]);
        await execa("sudo", ["nginx", "-t"]);
        await execa("sudo", ["systemctl", "reload", "nginx"]);
        log("Nginx reloaded successfully");
      } catch (err: any) {
        log(`Nginx reload failed: ${err.message}`);
        throw new Error(`Nginx reload failed: ${err.message}`);
      }

      await db.update(sites).set({ 
        status: "active", 
        pm2Name: containerName,
        nginxConfig,
        updatedAt: new Date() 
      }).where(eq(sites.id, siteId));

      log("Deployment completed successfully");
      return { success: true, port, containerName };
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      log(`Deployment failed: ${message}`);
      await db.update(sites).set({ status: "failed" }).where(eq(sites.id, siteId));
      throw err;
    } finally {
      logStream.end();
    }
  },
  { connection, concurrency: 1 }
);

console.log("[Worker Node] Booted hosting worker");
