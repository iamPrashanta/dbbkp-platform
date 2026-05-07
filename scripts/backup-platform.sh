#!/usr/bin/env bash
set -e

# ==============================================================================
# DBBKP Platform Backup Tool
# ==============================================================================

INSTALL_DIR="/opt/dbbkp"
BACKUP_DIR="/var/backups/dbbkp"
DB_NAME="dbbkp"
DATE=$(date +%Y-%m-%d_%H-%M-%S)
BACKUP_FILE="$BACKUP_DIR/platform_backup_$DATE.tar.gz"
DB_DUMP="$BACKUP_DIR/db_$DATE.sql"

mkdir -p "$BACKUP_DIR"

echo "Creating platform backup..."

# 1. Backup DB
echo "Backing up PostgreSQL database..."
if command -v pg_dump &> /dev/null; then
    sudo -u postgres pg_dump "$DB_NAME" > "$DB_DUMP"
else
    echo "pg_dump not found, skipping database backup."
fi

# 2. Backup Configs
echo "Backing up configurations..."
tar -czf "$BACKUP_FILE" "$INSTALL_DIR" "$DB_DUMP" 2>/dev/null

rm -f "$DB_DUMP"

echo "Backup completed successfully!"
echo "Backup stored at: $BACKUP_FILE"
