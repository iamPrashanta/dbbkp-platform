#!/usr/bin/env bash
set -euo pipefail

# ── Load ENV safely ──────────────────────────────────────────────────────────
if [ -f ".env" ]; then
  set -o allexport
  source .env
  set +o allexport
else
  echo "[error] .env file not found"
  exit 1
fi

# ── Validate ENV ─────────────────────────────────────────────────────────────
if [ -z "${DATABASE_URL:-}" ]; then
  echo "[error] DATABASE_URL is not set"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DB_PACKAGE="$ROOT_DIR/packages/db"

# ── Defaults ─────────────────────────────────────────────────────────────────
ADMIN_PASS="${ADMIN_PASSWORD:-$(openssl rand -base64 12)}"
ADMIN_USER="${ADMIN_USERNAME:-admin}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@dbbkp.local}"

log() { echo -e "\033[1;34m[setup]\033[0m $*"; }
ok()  { echo -e "\033[1;32m[ok]\033[0m $*"; }
warn(){ echo -e "\033[1;33m[warn]\033[0m $*"; }
err() { echo -e "\033[1;31m[err]\033[0m $*" >&2; exit 1; }

# ── Extract DB name safely ───────────────────────────────────────────────────
DB_NAME=$(echo "$DATABASE_URL" | sed -E 's|.*/([^/?]+).*|\1|')

# ── 1. Check PostgreSQL ──────────────────────────────────────────────────────
log "Checking PostgreSQL..."

if ! psql "$DATABASE_URL" -c "SELECT 1;" > /dev/null 2>&1; then
  log "Database not reachable. Attempting to create $DB_NAME..."

  BASE_URL=$(echo "$DATABASE_URL" | sed -E 's|/[^/]+$|/postgres|')

  psql "$BASE_URL" -c "CREATE DATABASE $DB_NAME;" 2>/dev/null || true
fi

ok "PostgreSQL reachable"

# ── 2. Run Drizzle schema ────────────────────────────────────────────────────
log "Running Drizzle schema push..."

cd "$ROOT_DIR"
pnpm install --frozen-lockfile 2>/dev/null || true

cd "$DB_PACKAGE"
DATABASE_URL="$DATABASE_URL" npx drizzle-kit push

ok "Schema applied"

# ── 3. Seed Admin ────────────────────────────────────────────────────────────
log "Seeding admin user ($ADMIN_USER)..."

cd "$ROOT_DIR"

if ! ADMIN_USERNAME="$ADMIN_USER" \
ADMIN_EMAIL="$ADMIN_EMAIL" \
ADMIN_PASSWORD="$ADMIN_PASS" \
DATABASE_URL="$DATABASE_URL" \
pnpm tsx scripts/seed-admin.ts; then

  warn "TS seed failed. Falling back to SQL..."

  HASH=$(node -e "const b=require('bcrypt'); b.hashSync('$ADMIN_PASS',10)" 2>/dev/null || echo "")

  if [ -n "$HASH" ]; then
    psql "$DATABASE_URL" -c "
      INSERT INTO users (id, email, password_hash)
      VALUES (gen_random_uuid(), '$ADMIN_EMAIL', '$HASH')
      ON CONFLICT (email) DO NOTHING;
    " 2>/dev/null || true
  else
    err "Failed to generate password hash"
  fi
fi

ok "Admin seeded"

# ── 4. Firewall ──────────────────────────────────────────────────────────────
if command -v ufw > /dev/null 2>&1; then
  log "Configuring firewall..."
  ufw allow 3000/tcp 2>/dev/null || true
  ufw allow 5173/tcp 2>/dev/null || true
  ufw allow 8091/tcp 2>/dev/null || true
  ok "Firewall configured"
fi

# ── Done ─────────────────────────────────────────────────────────────────────
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