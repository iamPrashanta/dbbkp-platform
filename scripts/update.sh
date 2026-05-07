#!/usr/bin/env bash
set -e

# ==============================================================================
# DBBKP Platform Updater
# ==============================================================================

INSTALL_DIR="/opt/dbbkp"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${BLUE}[INFO]${NC} $1"; }
ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
err()  { echo -e "${RED}[ERR]${NC} $1" >&2; exit 1; }

if [ "$EUID" -ne 0 ]; then
  err "Please run as root"
fi

if [ ! -d "$INSTALL_DIR" ]; then
    err "Platform does not seem to be installed in $INSTALL_DIR"
fi

log "Pulling latest platform images..."
cd "$INSTALL_DIR"
docker compose pull >/dev/null 2>&1

log "Applying updates..."
docker compose up -d >/dev/null 2>&1

# In the future, we could add database migration scripts here via a docker exec command
# docker exec dbbkp-panel pnpm drizzle-kit migrate

ok "Platform updated successfully!"
