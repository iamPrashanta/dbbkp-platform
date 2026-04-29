# Infrastructure Management & Security Platform

This is a **modern, distributed infrastructure orchestration and security platform**. It consists of an event-driven automation backend, a fleet of autonomous Bash-based agents (`infra-agent` & `dbbkp`), and a centralized GUI for managing server health, malware defense, and database snapshots across multiple remote nodes.

---

## 🏗️ Architecture overview

The platform is designed around a strictly decoupled **Push Architecture** to handle high-concurrency environments without failure cascading.

### 1. The Autonomous Agents

The heavy lifting on the servers is handled by lightweight, native Bash agents that run autonomously via `cron`.

- **`infra-agent.sh`**: The security scanner. It calculates risk scores, identifies malware (PHP shells, backdoors), enforces strict folder permissions, blocks malicious IPs via `ufw`, and quarantines threats. Instead of executing fixes blindly, it pushes structured JSON telemetry and events to a local Redis node.
- **`dbbkp.sh`**: The backup engine. It supports remote MySQL/MariaDB database snapshots and filesystem tarballs, backing them up locally or streaming them securely.

### 2. The Automation Worker (Node.js)

Inside `apps/worker`, a BullMQ/Node.js worker listens asynchronously (`BLPOP`) to the Redis event stream (`infra:events`).

- When `infra-agent` emits a `HIGH_RISK_DETECTED` event, the worker intercepts it.
- It enforces rate limits and idempotency (using SHA-1 payload hashing) to prevent backup-spam during active attacks.
- It dynamically spins up `dbbkp` in `--headless` mode to secure databases before any automated remediation occurs.

### 3. The Dashboard (GUI)

A unified interface (`apps/web` or `apps/api`) providing real-time visibility into the fleet. It visualizes the JSON reports pushed by the agents (`infra:report:<node_id>`), exposing memory metrics, top attack IPs, and pending quarantine reviews.

---

## 🚀 How the Agent Sync Works

Because the Bash agents are distributed independently, this monorepo uses an **automated synchronization layer** to ensure the platform always executes the latest agent code without manual copy-pasting or complex Git submodules.

During the initial `pnpm install`, the `postinstall` lifecycle hook runs `sync-scripts.js`. This script securely fetches the absolute latest versions of `dbbkp.sh` and `infra-agent.sh` directly from the `main` branch of the GitHub repository, dropping them into `scripts/`.

The `@dbbkp/runner` package natively traverses the directory tree using `resolveScriptPath()`, ensuring that your application seamlessly detects the scripts, whether in production or local development.

---

## 🔮 The Future Plan (Roadmap)

The ultimate goal for this platform is to evolve into a **turnkey server orchestration and hosting panel**, allowing teams to manage vast fleets of servers from a single, unified interface.

### Upcoming Milestones

1. **Multi-Node Centralization**: Evolving the local Redis push models to stream metrics to a central Aggregator API, enabling a single dashboard to monitor hundreds of globally distributed servers.
2. **One-Click Deployments & Migrations**: Expanding `dbbkp` to not just backup, but intelligently restore and migrate entire tech stacks (Nginx configs, PHP-FPM pools, MySQL databases) across servers effortlessly.
3. **Anomaly Detection & Auto-Ban**: Integrating baseline memory profiling. If a server suddenly spikes in CPU or receives an influx of unexpected requests, the platform will automatically trigger an `ufw` or `fail2ban` network lockdown.
4. **App Ecosystem Engine**: Transforming the core automation worker to support the 1-click installation of common applications (WordPress, Next.js, Laravel) with automatic SSL provisioning and reverse-proxy routing via Nginx/LiteSpeed.
5. **Role-Based Quarantine Audits**: A feature within the GUI that allows administrators to manually review, restore, or securely purge files pushed into the `/var/quarantine/` layer by the `infra-agent`.

---

## 🛠️ Getting Started

To launch the platform locally:

```bash
# 1. Install dependencies (This automatically syncs the latest bash agents!)
pnpm install

# 2. Start the development server (Web, API, and Worker)
pnpm run dev
```
