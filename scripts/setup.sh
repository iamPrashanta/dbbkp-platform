#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# Load ENV safely
# ─────────────────────────────────────────────────────────────
if [ -f ".env" ]; then
  set -o allexport
  source .env
  set +o allexport
else
  echo "[error] .env file not found"
  exit 1
fi

# ─────────────────────────────────────────────────────────────
# Validate ENV
# ─────────────────────────────────────────────────────────────
if [ -z "${DATABASE_URL:-}" ]; then
  echo "[error] DATABASE_URL is not set"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DB_PACKAGE="$ROOT_DIR/packages/db"

# ─────────────────────────────────────────────────────────────
# Defaults
# ─────────────────────────────────────────────────────────────
ADMIN_PASS="${ADMIN_PASSWORD:-$(openssl rand -base64 12)}"
ADMIN_USER="${ADMIN_USERNAME:-admin}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@dbbkp.local}"

log()  { echo -e "\033[1;34m[setup]\033[0m $*"; }
ok()   { echo -e "\033[1;32m[ok]\033[0m $*"; }
warn() { echo -e "\033[1;33m[warn]\033[0m $*"; }
err()  { echo -e "\033[1;31m[err]\033[0m $*" >&2; exit 1; }

# ─────────────────────────────────────────────────────────────
# Extract DB name safely
# ─────────────────────────────────────────────────────────────
DB_NAME=$(echo "$DATABASE_URL" | sed -E 's|.*/([^/?]+).*|\1|')
BASE_URL=$(echo "$DATABASE_URL" | sed -E 's|/[^/]+$|/postgres|')

# ─────────────────────────────────────────────────────────────
# 1. Check PostgreSQL & Create DB if needed
# ─────────────────────────────────────────────────────────────
log "Checking PostgreSQL..."

if ! psql "$DATABASE_URL" -c "SELECT 1;" > /dev/null 2>&1; then
  log "Database $DB_NAME not reachable. Checking existence..."

  if ! psql "$BASE_URL" -tc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1; then
    log "Creating database $DB_NAME..."
    psql "$BASE_URL" -c "CREATE DATABASE $DB_NAME;"
  fi
fi

ok "PostgreSQL ready"

# ─────────────────────────────────────────────────────────────
# 2. Run Drizzle schema
# ─────────────────────────────────────────────────────────────
log "Running Drizzle schema push..."

cd "$ROOT_DIR"
pnpm install --frozen-lockfile >/dev/null 2>&1 || true

cd "$DB_PACKAGE"

if DATABASE_URL="$DATABASE_URL" npx drizzle-kit push; then
  ok "Schema applied"
else
  err "Drizzle schema push failed"
fi

# ─────────────────────────────────────────────────────────────
# 3. Seed Admin User
# ─────────────────────────────────────────────────────────────
log "Seeding admin user ($ADMIN_USER)..."

cd "$ROOT_DIR"

if ADMIN_USERNAME="$ADMIN_USER" \
   ADMIN_EMAIL="$ADMIN_EMAIL" \
   ADMIN_PASSWORD="$ADMIN_PASS" \
   DATABASE_URL="$DATABASE_URL" \
   pnpm tsx scripts/seed-admin.ts; then

  ok "Admin seeded via TS"

else
  warn "TS seed failed. Falling back to SQL..."

  HASH=$(pnpm tsx -e "import bcrypt from 'bcrypt'; console.log(await bcrypt.hash(process.argv[1], 10))" "$ADMIN_PASS" 2>/dev/null || echo "")

  if [ -n "$HASH" ]; then
    psql "$DATABASE_URL" -c "
      INSERT INTO users (id, email, password_hash)
      VALUES (gen_random_uuid(), '$ADMIN_EMAIL', '$HASH')
      ON CONFLICT (email) DO NOTHING;
    " >/dev/null 2>&1 || true

    ok "Admin seeded via SQL fallback"
  else
    err "Failed to generate password hash"
  fi
fi

# ─────────────────────────────────────────────────────────────
# 4. Pre-pull Docker images
# ─────────────────────────────────────────────────────────────
DOCKER_IMAGE_NODE="${PIPELINE_DOCKER_IMAGE_NODE:-node:20-alpine}"
DOCKER_IMAGE_PYTHON="${PIPELINE_DOCKER_IMAGE_PYTHON:-python:3.11-slim}"

if command -v docker >/dev/null 2>&1; then
  log "Pre-pulling Docker images..."
  docker pull "$DOCKER_IMAGE_NODE" >/dev/null 2>&1 || warn "Failed to pull $DOCKER_IMAGE_NODE"
  docker pull "$DOCKER_IMAGE_PYTHON" >/dev/null 2>&1 || warn "Failed to pull $DOCKER_IMAGE_PYTHON"
  ok "Docker images ready"
fi

# ─────────────────────────────────────────────────────────────
# 5. Firewall (optional)
# ─────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────
# Done
# ─────────────────────────────────────────────────────────────
IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

echo ""
echo "════════════════════════════════════════════════════"
echo "  DBBKP Platform Setup Complete"
echo "  Dashboard: http://$IP:5173"
echo "  API:       http://$IP:3000"
echo "  WS Logs:   ws://$IP:3000/ws/logs"
echo ""
echo "  Admin login:"
echo "    Username: $ADMIN_USER"
echo "    Password: $ADMIN_PASS"
echo "════════════════════════════════════════════════════"