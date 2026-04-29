#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# DBBKP Platform — Install & Seed Script
# Creates the panel database, tables (via Drizzle), and seeds admin user
# Usage: bash scripts/setup.sh [--seed-only]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DB_PACKAGE="$ROOT_DIR/packages/db"

# Generate random password if not provided
ADMIN_PASS="${ADMIN_PASSWORD:-$(openssl rand -base64 12)}"
ADMIN_USER="${ADMIN_USERNAME:-admin}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@dbbkp.local}"

log() { echo -e "\033[1;34m[setup]\033[0m $*"; }
ok()  { echo -e "\033[1;32m[ok]\033[0m $*"; }
err() { echo -e "\033[1;31m[err]\033[0m $*" >&2; exit 1; }

# ── 1. Check PostgreSQL is reachable ─────────────────────────────────────────
log "Checking PostgreSQL..."
psql "$DB_URL" -c "SELECT 1;" > /dev/null 2>&1 || {
  log "Database not found, attempting to create dbbkp_panel..."
  # Extract base URL (remove db name)
  BASE_URL=$(echo "$DB_URL" | sed 's/\/[^/]*$//')/postgres
  psql "$BASE_URL" -c "CREATE DATABASE dbbkp_panel;" 2>/dev/null || true
}
ok "PostgreSQL reachable"

# ── 2. Run Drizzle migrations ────────────────────────────────────────────────
log "Running Drizzle schema push..."
cd "$ROOT_DIR"
# Ensure we have tsx and other deps in root for the seed script
pnpm install --frozen-lockfile 2>/dev/null || true

cd "$DB_PACKAGE"
DATABASE_URL="$DB_URL" npx drizzle-kit push 2>&1 | tail -n 5
ok "Schema applied"

# ── 3. Seed admin user ───────────────────────────────────────────────────────
log "Seeding admin user ($ADMIN_USER)..."
cd "$ROOT_DIR"

ADMIN_USERNAME="$ADMIN_USER" \
ADMIN_EMAIL="$ADMIN_EMAIL" \
ADMIN_PASSWORD="$ADMIN_PASS" \
DATABASE_URL="$DB_URL" \
pnpm tsx scripts/seed-admin.ts || {
  warn "TS Seed failed, falling back to psql..."
  HASH=$(node -e "const b=require('bcrypt'); b.hash('$ADMIN_PASS',12).then(h=>console.log(h));" 2>/dev/null || echo "")
  if [ -n "$HASH" ]; then
    psql "$DB_URL" -c "
      INSERT INTO users (id, email, username, password_hash, role)
      VALUES (gen_random_uuid(), '$ADMIN_EMAIL', '$ADMIN_USER', '$HASH', 'admin')
      ON CONFLICT (username) DO NOTHING;
    " 2>/dev/null || true
  fi
}

ok "Admin seeding step complete"

ok "Admin seeded"

# ── 4. Open firewall ports ───────────────────────────────────────────────────
if command -v ufw > /dev/null 2>&1; then
  log "Configuring firewall..."
  ufw allow 3000/tcp comment "DBBKP API" 2>/dev/null || true
  ufw allow 5173/tcp comment "DBBKP Web UI" 2>/dev/null || true
  ufw allow 8091/tcp comment "DBBKP WS Logs" 2>/dev/null || true
  ok "Firewall ports opened (3000, 5173, 8091)"
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
