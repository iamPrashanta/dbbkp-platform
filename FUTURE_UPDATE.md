# 🚀 DBBKP Platform — Future Scope & Roadmap

This document outlines the strategic roadmap for evolving the DBBKP platform from a single-node PaaS into a production-grade DevOps control plane.

---

## 📊 Current Platform Maturity: Tier 2 (Single-Node PaaS)

### ✔ Completed Milestones

- [x] **Containerized Isolation**: Full Docker-per-site runtime.
- [x] **Build vs Runtime Separation**: Ephemeral build containers for dependency resolution.
- [x] **Infra Orchestration**: Automated Port Management + Nginx Reverse Proxy.
- [x] **Multi-Runtime Support**: Auto-detection for Node.js and Python.
- [x] **Queue-Based Execution**: BullMQ-backed orchestration with WebSocket live logs.
- [x] **Persistence & Logging**: Host-volume binding + DB/File log separation.

---

## 🧪 Strategic Roadmap: Phase-by-Phase

### 🔥 Phase 1: Production Stability (Immediate Impact)

> **Goal**: Bridge the gap between "functional" and "reliable".

1. **Docker Image Build System**
   - Transition from `docker run` + runtime install to `docker build` with tagging (e.g., `site-id:v1`).
   - This enables **Image Reproducibility** and **Atomic Deploys**.
2. **Deployment Versioning & Rollback**
   - Keep history of the last 3–5 images.
   - Implementation of a one-click Revert/Rollback system.
3. **Secrets & Environment Manager**
   - Encrypted storage for `.env` variables in the database.
   - Secure injection of variables into containers at runtime.
4. **SSL Automation (Let’s Encrypt)**
   - Integration with `certbot` for automatic certificate issuance and renewal.
   - Auto-attachment of SSL blocks to Nginx configurations.

### 🟡 Phase 2: The "Control Panel" Power

> **Goal**: Add traditional hosting features similar to Plesk/cPanel.

1. **Domain & DNS Management**
   - UI for mapping multiple domains to a single site.
   - DNS record management (initially A/CNAME records).
2. **File Manager (Browser-based)**
   - Web-based interface to edit, upload, and delete files in the site's `docRoot`.
3. **Cron Jobs UI**
   - Schedule recurring scripts, maintenance tasks, or pipeline triggers.
4. **Logs UI Improvements**
   - Searchable, filterable historical logs for both CI and Runtime.

### 🔵 Phase 3: Infrastructure Scaling

> **Goal**: Move toward multi-node orchestration like Coolify.

1. **Multi-Server Management**
   - Connect remote nodes via SSH.
   - Deploy containers to specific servers from a single control plane.
2. **Real-time Metrics Dashboard**
   - CPU / RAM / Disk usage graphs per site using Docker stats.
3. **GitHub Webhook Integration**
   - Automatic deployment triggers on `git push`.

---

## 🧭 Strategic Identity: PaaS vs Hosting

As we evolve, the platform must choose a primary identity to avoid feature bloat:

| Feature Focus | **Direction A: DevOps PaaS** (Vercel/Railway) | **Direction B: Hosting Panel** (cPanel/Plesk) |
| :--- | :--- | :--- |
| **Primary Target** | Developers & Agencies | Business Owners & Resellers |
| **Key Advantage** | Fast CI/CD, Git integration, Previews | Domain/Email/File Management |
| **Tech Stack** | Docker, K8s, Serverless | Nginx, PHP, BIND, Exim |

> **Current Decision**: Evolve as a **Developer-first PaaS** (Option A) with high-leverage hosting features (Option B) to compete in the "Modern Control Panel" space.

---

## 🛠️ Upcoming Implementation: "The Next Big Leap"

We are currently focusing on the **Docker Image Builder** and **SSL Automation**. This will involve:

1. Moving from direct file execution to **Dockerfile generation**.
2. Automating **Certbot-over-Nginx** workflows.
3. Implementing **Encrypted Env Injection**.

---
*Last Updated: 2026-04-30* — DBBKP Automation
