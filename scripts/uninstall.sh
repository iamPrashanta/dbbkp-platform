#!/usr/bin/env bash
set -e

# ==============================================================================
# DBBKP Platform Uninstaller
# ==============================================================================

INSTALL_DIR="/opt/dbbkp"
APP_USER="dbbkp"
DB_NAME="dbbkp"
DB_USER="dbbkp"

# Colors
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERR]${NC} $1" >&2; exit 1; }

if [ "$EUID" -ne 0 ]; then
  err "Please run as root"
fi

echo -e "${RED}"
echo "WARNING: This will completely remove the DBBKP Platform, including the panel, database, and all configurations."
echo "User data in /var/www/sites will NOT be removed automatically to prevent data loss."
echo -e "${NC}"
read -p "Are you sure you want to proceed? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Uninstallation aborted."
    exit 1
fi

echo "Stopping services..."
systemctl stop dbbkp-panel.service >/dev/null 2>&1 || true
systemctl disable dbbkp-panel.service >/dev/null 2>&1 || true

echo "Removing Docker containers..."
if [ -f "$INSTALL_DIR/docker-compose.yml" ]; then
    docker compose -f "$INSTALL_DIR/docker-compose.yml" down -v >/dev/null 2>&1 || true
fi

echo "Removing Database..."
if command -v psql &> /dev/null; then
    sudo -u postgres psql -c "DROP DATABASE IF EXISTS ${DB_NAME};" >/dev/null 2>&1 || true
    sudo -u postgres psql -c "DROP USER IF EXISTS ${DB_USER};" >/dev/null 2>&1 || true
fi

echo "Removing Systemd Service..."
rm -f /etc/systemd/system/dbbkp-panel.service
systemctl daemon-reload

echo "Removing Install Directory..."
rm -rf "$INSTALL_DIR"

echo "Removing User..."
userdel -r "$APP_USER" >/dev/null 2>&1 || true

echo "Uninstallation complete."
