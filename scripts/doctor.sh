#!/usr/bin/env bash
set -e

# ==============================================================================
# DBBKP Platform Doctor
# ==============================================================================

INSTALL_DIR="/opt/dbbkp"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${BLUE}[INFO]${NC} $1"; }
ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERR]${NC} $1"; }

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}[ERR]${NC} Please run as root" >&2
  exit 1
fi

echo -e "${BLUE}Running DBBKP Platform Diagnostics...${NC}\n"

# 1. Check Docker
if command -v docker &> /dev/null; then
    if docker info >/dev/null 2>&1; then
        ok "Docker is installed and running"
    else
        err "Docker is installed but not running"
    fi
else
    err "Docker is not installed"
fi

# 2. Check PostgreSQL
if systemctl is-active --quiet postgresql; then
    ok "PostgreSQL service is active"
else
    warn "PostgreSQL service is not active"
fi

# 3. Check Redis
if systemctl is-active --quiet redis-server; then
    ok "Redis service is active"
else
    warn "Redis service is not active"
fi

# 4. Check Containers
if [ -d "$INSTALL_DIR" ]; then
    PANEL_STATE=$(docker inspect -f '{{.State.Status}}' dbbkp-panel 2>/dev/null || echo "missing")
    if [ "$PANEL_STATE" == "running" ]; then
        ok "Panel container is running"
    else
        err "Panel container is $PANEL_STATE"
    fi

    TRAEFIK_STATE=$(docker inspect -f '{{.State.Status}}' traefik 2>/dev/null || echo "missing")
    if [ "$TRAEFIK_STATE" == "running" ]; then
        ok "Traefik container is running"
    else
        err "Traefik container is $TRAEFIK_STATE"
    fi
else
    err "Install directory $INSTALL_DIR not found"
fi

echo ""
echo "Diagnostics complete."
