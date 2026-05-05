# 🚀 DBBKP Platform — Infrastructure Orchestration + PaaS Control Plane

A **distributed infrastructure orchestration, security automation, and deployment platform** that acts as a unified control plane for managing servers at scale.

It combines:

* ⚙️ Autonomous security + backup agents
* 🧠 Event-driven control plane (Node.js + Redis + Workers)
* 🌐 PaaS deployment engine (pipelines + containers)
* 📊 Centralized dashboard (Next.js)

👉 This is not just a hosting panel — it is a **programmable DevOps control plane**.

---

# 🏗️ Architecture Overview

The platform follows a **decoupled, event-driven push architecture**, ensuring:

* No cascading failures
* High concurrency handling
* Autonomous node behavior
* Central orchestration without tight coupling

---

## 1. 🛰️ Autonomous Agents (Server Layer)

Lightweight Bash agents run via `cron` on each server.

### 🔐 `infra-agent.sh` (Security Engine)

* Malware detection (PHP shells, backdoors)
* Risk scoring system
* Auto firewall blocking (`ufw`)
* File quarantine (`/var/quarantine`)
* Permission enforcement
* Attack surface analysis
* Pushes structured JSON → Redis

---

### 💾 `dbbkp.sh` (Backup Engine)

* MySQL / MariaDB backups
* Filesystem snapshots (tarballs)
* Remote backup streaming
* Disaster recovery ready
* Can run standalone or headless

---

## 2. 🧠 Control Plane (Node.js)

Located in:

```
apps/api
apps/worker
```

---

### ⚡ API Layer (`apps/api`)

* tRPC backend
* Auth + session management
* Node + pipeline management
* Internal secure endpoints

---

### ⚙️ Worker (`apps/worker`)

* BullMQ-based async processor
* Consumes Redis events (`infra:events`)
* Handles:

  * Backup triggers
  * Security responses
  * CI/CD pipelines

---

### 🔄 Event Flow Example

```
infra-agent detects HIGH_RISK
        ↓
Push → Redis (infra:events)
        ↓
Worker consumes (BLPOP)
        ↓
Rate-limit + idempotency (SHA-1 hashing)
        ↓
Trigger dbbkp (headless backup)
        ↓
Proceed with remediation
```

---

## 3. 🌐 Frontend Layer

### 🖥️ Panel (`apps/panel`)

* Next.js 15
* Admin dashboard
* Node monitoring
* Security insights
* Quarantine review system

---

### 🌍 Web (`apps/web`)

* Optional Vite-based frontend
* Lightweight UI layer

---

## 4. 🗄️ Database Layer

Located in:

```
packages/db
```

* PostgreSQL
* Drizzle ORM
* Versioned migrations
* Seeded admin system

---

## 5. 🧩 Runner Layer

Located in:

```
packages/runner
```

* Executes Bash agents
* Resolves script paths dynamically
* Supports dev + production environments

---

# 📦 Monorepo Structure

```
apps/
  api/        → backend (tRPC)
  worker/     → async job runner
  panel/      → Next.js admin UI
  web/        → Vite frontend

packages/
  db/         → schema + migrations + seed
  runner/     → script execution engine

scripts/
  infra-agent.sh
  dbbkp.sh
```

---

# 🔄 Agent Sync System (Zero Manual Updates)

Agents are always kept up-to-date automatically.

### How it works

During:

```bash
pnpm install
```

A `postinstall` hook runs:

```
sync-scripts.js
```

It:

* Fetches latest scripts from GitHub (`main` branch)
* Updates:

  * `infra-agent.sh`
  * `dbbkp.sh`
* Stores them in `/scripts`

---

### Runtime Resolution

`@dbbkp/runner` uses:

```
resolveScriptPath()
```

So your app:

* Always executes latest scripts
* Works in both local + production environments
* Requires zero manual sync

---

# ⚙️ Setup (Local Development)

---

## 1. Install dependencies

```bash
pnpm install
```

---

## 2. Configure environment

Create `.env`:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/dbbkp_panel

JWT_SECRET=your-secret
API_PORT=4000

REDIS_HOST=127.0.0.1
REDIS_PORT=6379
```

---

## 3. Setup Database (IMPORTANT)

```bash
export $(grep -v '^#' .env | xargs)
```

---

### Generate migrations

```bash
pnpm --filter @dbbkp/db db:generate
```

---

### Apply migrations

```bash
pnpm --filter @dbbkp/db db:migrate
```

---

### Seed admin

```bash
pnpm --filter @dbbkp/db db:seed
```

---

## 4. Start platform

```bash
pnpm dev
```

---

# 🔐 Default Admin Access

```
Username: admin
Password: admin123
```

---

# 🔁 Development Utilities

### Clean restart

```bash
pnpm dev:clean
```

---

### Kill processes

```bash
pkill -9 node
```

---

# 🚀 PaaS Deployment Engine (Pipelines)

Deploy applications using:

* Git repositories
* Custom build commands
* Containerized environments

---

## Example Pipeline

```
Name: express-app
Repo: https://github.com/expressjs/express
Branch: master

Build: npm install
Deploy: node examples/hello-world/index.js
```

---

## Pipeline Flow

```
Git Clone
   ↓
Docker Build Environment
   ↓
Run Build Command
   ↓
Run Deploy Command
   ↓
Expose via Port
```

---

# 🔐 Security Design

* Server-side session validation
* Sliding inactivity timeout (30 min)
* Redis-based event isolation
* Internal API secured via `INTERNAL_SECRET`
* No client-trust model

---

# 🧱 Production Storage Layout

```
/var/www/
  ├── panel/        → control plane
  ├── sites/        → deployed apps
  ├── pipeline/     → build artifacts
  └── backups/      → dbbkp outputs
```

---

# ⚠️ Common Issues

---

## Database errors

```
relation does not exist
```

Fix:

```bash
pnpm --filter @dbbkp/db db:migrate
```

---

## Postgres role error

```
role "user" does not exist
```

Fix:

```bash
sudo -u postgres psql
CREATE ROLE postgres WITH LOGIN PASSWORD 'postgres';
ALTER ROLE postgres CREATEDB;
```

---

## Docker permission issues

* Use Docker volumes
* Avoid OneDrive mounts

---

## Port conflicts

```bash
lsof -i :3000
lsof -i :4000
```

---

# 🔮 Roadmap

### Phase 1 — Scale Control Plane

* Multi-node aggregation API
* Centralized monitoring dashboard

---

### Phase 2 — Smart Infrastructure

* Memory + CPU anomaly detection
* Auto firewall lockdown (`ufw`, `fail2ban`)
* AI-based diagnostics engine

---

### Phase 3 — Full PaaS

* One-click deployments:

  * WordPress
  * Next.js
  * Laravel
* Auto SSL provisioning (Let's Encrypt)
* Reverse proxy automation

---

### Phase 4 — Advanced Ops

* Full stack migration engine
* Cross-node restore system
* Role-based quarantine audits

---

# 🏁 Summary

This platform combines:

* Hosting Panel → like CyberPanel / Plesk
* PaaS → like Coolify / Dokploy
* Security Automation → infra-agent
* Backup Engine → dbbkp

👉 Result: **A unified DevOps control plane for infrastructure at scale**

---

# ⚡ Pro Tip

Add shortcuts:

```json
"scripts": {
  "db:generate": "pnpm --filter @dbbkp/db db:generate",
  "db:migrate": "pnpm --filter @dbbkp/db db:migrate",
  "db:seed": "pnpm --filter @dbbkp/db db:seed"
}
```

Then:

```bash
pnpm db:migrate
```
