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

    const { siteId, targetCommit } = job.data;
    const [site] = await db.select().from(sites).where(eq(sites.id, siteId)).limit(1);
    if (!site) throw new Error("Site not found");

    const { domain, docRoot, type, port, source, repoUrl, branch } = site;
    const isRollback = !!targetCommit;
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
        await fs.emptyDir(docRoot);
        
        if (isRollback) {
          log(`[Rollback] Checking out specific commit/tag: ${targetCommit}`);
          await execa("git", ["clone", repoUrl, docRoot]);
          await execa("git", ["checkout", targetCommit], { cwd: docRoot });
        } else {
          await execa("git", ["clone", "--depth=1", "-b", branch || "main", repoUrl, docRoot]);
        }
        
        // If not a rollback, capture the latest commit SHA for tagging later
        if (!isRollback) {
          try {
            const { stdout } = await execa("git", ["rev-parse", "--short", "HEAD"], { cwd: docRoot });
            job.data.targetCommit = stdout.trim(); // We'll use this for the Docker tag
          } catch {}
        }
      } else if (source === "zip") {
        log("Project source is ZIP (files already extracted or expected in docRoot)");
        if (!isRollback) job.data.targetCommit = `v-${Date.now()}`;
      }

      const activeTag = job.data.targetCommit || "latest";
      const imageTag = `${containerName}:${activeTag}`;

      // 3. Build Stage (Separated)
      if (type === "docker") {
        if (isRollback) {
          log(`[Rollback] Skipping Docker build. Using existing tagged image: ${imageTag}`);
          // Check if image exists locally
          try {
            await execa("docker", ["image", "inspect", imageTag]);
          } catch {
            throw new Error(`Rollback failed: Image ${imageTag} not found on server.`);
          }
        } else {
          log(`Starting Docker native build stage for ${domain}...`);
          
          if (!fs.existsSync(path.join(docRoot, "Dockerfile"))) {
            throw new Error("No Dockerfile found in project root for Docker deployment type");
          }

          const buildCmd = ["docker", "build", "-t", imageTag, "-t", `${containerName}:latest`, "."];
          log(`Running: ${buildCmd.join(" ")}`);
          
          const buildProcess = await execa("docker", buildCmd, {
            cwd: docRoot,
            all: true,
          });
          
          if (buildProcess.exitCode !== 0) {
            throw new Error(`Docker build failed: ${buildProcess.all}`);
          }
          
          log(`Docker build completed successfully (Tagged: ${imageTag})`);
        }
      } else if (type !== "static" && type !== "php") {
        log(`Starting build stage for ${type}...`);
        const buildImage = type === "node" ? "node:20-alpine" : "python:3.11-slim";
        
        let installCmd = "";
        if (type === "node") {
          installCmd = fs.existsSync(path.join(docRoot, "pnpm-lock.yaml")) ? "npm install -g pnpm && pnpm install --production" : "npm install --production";
        } else if (type === "python") {
          installCmd = fs.existsSync(path.join(docRoot, "requirements.txt")) 
            ? "pip install --no-cache-dir -r requirements.txt" 
            : "pip install --no-cache-dir .";
        }

        const buildContainer = await docker.createContainer({
          Image: buildImage,
          Tty: true,
          HostConfig: { 
            Binds: [
              `${docRoot}:/app`,
              "/app/node_modules", // Anonymous volume for build speed and permissions
              "/app/.venv"         // Support python venvs too
            ] 
          },
          WorkingDir: "/app",
          Cmd: ["sh", "-c", installCmd],
          User: "0:0",
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
        let startCmd = site.startCommand;
        
        let runtimeImage = buildImage;
        if (type === "php") {
          runtimeImage = "php:8.2-apache"; 
        } else if (type === "docker") {
          runtimeImage = imageTag; // Use the explicitly versioned tag
        }
        
        if (!startCmd && type !== "php" && type !== "docker") {
          if (type === "node") {
            startCmd = "npm start";
          } else if (type === "python") {
            // Prefer gunicorn if available, fallback to app.py
            const hasGunicorn = fs.existsSync(path.join(docRoot, "requirements.txt")) && 
                               fs.readFileSync(path.join(docRoot, "requirements.txt"), "utf8").includes("gunicorn");
            startCmd = hasGunicorn ? `gunicorn --bind 0.0.0.0:${port} app:app` : `python app.py`;
          }
        }
        
        const exposedPort = type === "php" ? 80 : port;
        const hostPort = port;

        const container = await docker.createContainer({
          Image: runtimeImage,
          name: containerName,
          ExposedPorts: { [`${exposedPort}/tcp`]: {} },
          Healthcheck: {
            Test: type === "php" ? ["CMD", "curl", "-f", "http://localhost"] : ["CMD", "sh", "-c", `nc -z localhost ${exposedPort} || exit 1`],
            Interval: 10 * 1000000000, // 10s
            Timeout: 5 * 1000000000,   // 5s
            Retries: 3,
            StartPeriod: 15 * 1000000000, // 15s grace
          },
          HostConfig: {
            Binds: type === "php" 
              ? [`${docRoot}:/var/www/html`] 
              : type === "docker"
              ? [] // Native docker builds don't map source code at runtime
              : [`${docRoot}:/app`, "/app/node_modules", "/app/.venv"],
            PortBindings: { [`${exposedPort}/tcp`]: [{ HostPort: String(hostPort) }] },
            RestartPolicy: { Name: "always" },
            Memory: 512 * 1024 * 1024,
            CpuPeriod: 100000,
            CpuQuota: 50000,
          },
          WorkingDir: type === "php" ? "/var/www/html" : type === "docker" ? undefined : "/app",
          Env: [`PORT=${exposedPort}`, `NODE_ENV=production`, `PYTHONUNBUFFERED=1`],
          Cmd: (type === "php" || type === "docker") ? undefined : ["sh", "-c", startCmd || ""],
          User: (type === "php" || type === "docker") ? undefined : "0:0",
        });

        await container.start();
        log(`Runtime container started: ${containerName}`);
      }
      log(`Runtime container started: ${containerName}`);

      // 5. Traefik Configuration
      log("Configuring Traefik dynamic routing and SSL...");
      let traefikConfig = "";
      
      const safeDomainName = domain.replace(/[^a-zA-Z0-9-]/g, "-");

      if (type === "static") {
        // For static sites, Traefik needs to serve files or we spin up a lightweight nginx/caddy container
        // Since we are moving to a PaaS model, we'll create a lightweight static container instead of host Nginx.
        log("Deploying lightweight static server for static site...");
        
        const staticContainerName = `dbbkp-static-${site.id.slice(0, 8)}`;
        const staticContainer = await docker.createContainer({
          Image: "nginx:alpine",
          name: staticContainerName,
          HostConfig: {
            Binds: [`${docRoot}:/usr/share/nginx/html:ro`],
            RestartPolicy: { Name: "always" },
          },
          Labels: {
            "traefik.enable": "true",
            [`traefik.http.routers.site-${safeDomainName}.rule`]: `Host(\`${domain}\`)`,
            [`traefik.http.routers.site-${safeDomainName}.entrypoints`]: "websecure",
            [`traefik.http.routers.site-${safeDomainName}.tls.certresolver`]: "letsencrypt",
            [`traefik.http.services.site-${safeDomainName}.loadbalancer.server.port`]: "80",
          }
        });
        await staticContainer.start();
        
        // Traefik docker provider will pick this up automatically! No need for file config.
        await db.update(sites).set({ 
          status: "active", 
          pm2Name: staticContainerName,
          nginxConfig: "Traefik Docker Provider",
          updatedAt: new Date() 
        }).where(eq(sites.id, siteId));

      } else {
        // Native / Python / Node running natively or in docker without traefik labels
        // We will generate a Traefik dynamic file config to route to localhost:port
        
        traefikConfig = `
http:
  routers:
    site-${safeDomainName}:
      rule: "Host(\`${domain}\`)"
      entryPoints:
        - "websecure"
      service: "service-${safeDomainName}"
      tls:
        certResolver: "letsencrypt"

  services:
    service-${safeDomainName}:
      loadBalancer:
        servers:
          - url: "http://127.0.0.1:${port}"
`;

        const configDir = "/opt/dbbkp/traefik/rules";
        const configPath = `${configDir}/${domain}.yml`;
        
        try {
          await fs.ensureDir(configDir);
          await fs.writeFile(configPath, traefikConfig);
          log(`Traefik routing file created at ${configPath}`);
        } catch (err: any) {
          log(`Warning: Failed to write Traefik config to ${configPath}. (Are we running in a container without volume mount?) Error: ${err.message}`);
          // Fallback to local for development
          const localConfigPath = path.join(process.cwd(), `traefik-rules-${domain}.yml`);
          await fs.writeFile(localConfigPath, traefikConfig);
          log(`Wrote fallback config to ${localConfigPath}`);
        }

        await db.update(sites).set({ 
          status: "active", 
          pm2Name: containerName,
          nginxConfig: traefikConfig,
          currentTag: activeTag,
          updatedAt: new Date() 
        }).where(eq(sites.id, siteId));
      }

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
