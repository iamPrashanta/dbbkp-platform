#!/bin/bash

# ==============================================================================
# seed-pg.sh - Dummy Database Seeder
# ==============================================================================

# Default local connection
DB_ADMIN=${ENV_DB_ADMIN:-postgres}
DB_HOST=${ENV_DB_HOST:-localhost}

echo "[i] Creating dummy user and database..."

# Ignore errors if they already exist
psql -U "$DB_ADMIN" -h "$DB_HOST" -d postgres -c "CREATE USER gui_test_user WITH PASSWORD 'testpass';" 2>/dev/null || true
psql -U "$DB_ADMIN" -h "$DB_HOST" -d postgres -c "CREATE DATABASE gui_db OWNER gui_test_user;" 2>/dev/null || true

echo "[i] Seeding dummy data..."
export PGPASSWORD="testpass"

psql -U gui_test_user -h "$DB_HOST" -d gui_db <<EOF
CREATE TABLE IF NOT EXISTS demo_users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO demo_users (username) VALUES 
('alice_demo'),
('bob_demo'),
('charlie_demo'),
('diana_demo')
ON CONFLICT DO NOTHING;
EOF

unset PGPASSWORD
echo "[+] Seeding complete! Database 'gui_db' is ready for backup testing."
