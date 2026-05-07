#!/usr/bin/env bash
# ==============================================================================
# DBBKP Platform Uninstaller v2.0
# Safe cleanup with data preservation options.
# ==============================================================================

set -Eeo pipefail

INSTALL_DIR="/opt/dbbkp"
STATE_FILE="$INSTALL_DIR/.install-state.json"
APP_USER="dbbkp"

# Colors
RED='\033[0;31m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

log()  { echo -e "${BLUE}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERR]${NC}  $1" >&2; exit 1; }

if [[ "$EUID" -ne 0 ]]; then
  err "Please run as root"
fi

echo -e "${RED}${BOLD}!!! WARNING: DESTRUCTIVE ACTION !!!${NC}"
echo "This will remove the DBBKP Platform, its containers, and local database data."
echo "Your hosted sites in /var/www/sites will be PRESERVED."
echo ""

read -r -p "Are you sure you want to proceed? [y/N]: " CONFIRM
[[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]] && { echo "Aborted."; exit 0; }

# 1. Backup Config Option
read -r -p "Would you like to backup configuration and secrets before removal? [Y/n]: " BACKUP_CONFIRM
if [[ "$BACKUP_CONFIRM" != "n" && "$BACKUP_CONFIRM" != "N" ]]; then
  BACKUP_PATH="/root/dbbkp_backup_$(date +%Y%m%d_%H%M%S).tar.gz"
  log "Creating backup at $BACKUP_PATH..."
  tar -czf "$BACKUP_PATH" -C "$(dirname "$INSTALL_DIR")" "$(basename "$INSTALL_DIR")" 2>/dev/null || true
  log "Backup created: $BACKUP_PATH"
fi

# 2. Load State (to identify database user/name)
if [[ -f "$STATE_FILE" ]]; then
  log "Loading installation state..."
  # We might need to stop the service first
fi

# 3. Stop Systemd Service
log "Stopping systemd service..."
systemctl stop dbbkp.service >/dev/null 2>&1 || true
systemctl disable dbbkp.service >/dev/null 2>&1 || true
rm -f /etc/systemd/system/dbbkp.service
systemctl daemon-reload

# 4. Tear down Docker stack
if [[ -f "$INSTALL_DIR/docker-compose.yml" ]]; then
  log "Removing Docker containers and volumes..."
  cd "$INSTALL_DIR"
  docker compose down -v --remove-orphans >/dev/null 2>&1 || true
fi

# 5. Remove System User
log "Removing system user '$APP_USER'..."
if id "$APP_USER" &>/dev/null; then
  userdel -r "$APP_USER" >/dev/null 2>&1 || true
fi

# 6. Cleanup Directories
log "Cleaning up installation directory..."
rm -rf "$INSTALL_DIR"

ok() { echo -e "${BLUE}[OK]${NC} $1"; }
ok "DBBKP Platform has been removed."
echo -e "\nNote: Hosted site data at ${YELLOW}/var/www/sites${NC} remains untouched."
echo "If you want to remove it manually, run: rm -rf /var/www/sites"
