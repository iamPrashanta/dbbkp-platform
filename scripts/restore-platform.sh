#!/usr/bin/env bash
set -e

# ==============================================================================
# DBBKP Platform Restore Tool
# ==============================================================================

INSTALL_DIR="/opt/dbbkp"
DB_NAME="dbbkp"

# Colors
RED='\033[0;31m'
NC='\033[0m'
err()  { echo -e "${RED}[ERR]${NC} $1" >&2; exit 1; }

if [ "$EUID" -ne 0 ]; then
  err "Please run as root"
fi

if [ -z "$1" ]; then
    echo "Usage: $0 <path_to_backup.tar.gz>"
    exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
    err "Backup file $BACKUP_FILE not found"
fi

echo "Stopping services..."
docker compose -f "$INSTALL_DIR/docker-compose.yml" down >/dev/null 2>&1 || true

echo "Restoring configurations..."
tar -xzf "$BACKUP_FILE" -C /

DB_DUMP=$(tar -tzf "$BACKUP_FILE" | grep -E 'db_.*\.sql')

if [ -n "$DB_DUMP" ]; then
    echo "Restoring database..."
    tar -xzf "$BACKUP_FILE" "$DB_DUMP"
    sudo -u postgres psql "$DB_NAME" < "$DB_DUMP" >/dev/null
    rm -f "$DB_DUMP"
fi

echo "Starting services..."
docker compose -f "$INSTALL_DIR/docker-compose.yml" up -d >/dev/null

echo "Platform restored successfully!"
