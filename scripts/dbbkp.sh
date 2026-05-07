#!/bin/bash

set -euo pipefail

VERSION="1.0.0"
JSON_MODE=0

# LOCK
LOCK_FILE="/tmp/dbbkp.lock"

exec 200>"$LOCK_FILE"
flock -n 200 || {
    echo "[!] Another dbbkp process is already running."
    exit 1
}

# ENV
HEADLESS=0

# Check and Load .env silently
if [ -f ".env" ]; then
    set -a
    source .env
    set +a
fi

# LOGGING
LOG_FILE="${ENV_LOG_FILE:-./dbbkp-run.log}"

# Helper to print and log colored status messages
log_to_file() {
    local plain_msg
    plain_msg=$(echo "$1" | sed -E 's/\x1B\[[0-9;]*[mGK]//g')
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $plain_msg" >> "$LOG_FILE"
}

cleanup() {
    rm -f "$LOCK_FILE"
}


json_escape() {
    printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null
}

print_msg() {
    local msg="$1"

    if [ "${JSON_MODE:-0}" -eq 1 ]; then
        echo "{\"status\":\"success\",\"message\":$(json_escape "$msg")}"
        return
    fi

    echo -e "\e[32m[+]\e[0m $msg"
    log_to_file "[SUCCESS] $msg"
}

print_err() {
    local msg="$1"

    if [ "${JSON_MODE:-0}" -eq 1 ]; then
        echo "{\"status\":\"error\",\"message\":$(json_escape "$msg")}"
        return
    fi

    echo -e "\e[31m[!]\e[0m $msg" >&2
    log_to_file "[ERROR] $msg"
}

print_info() {
    local msg="$1"

    if [ "${JSON_MODE:-0}" -eq 1 ]; then
        echo "{\"status\":\"info\",\"message\":$(json_escape "$msg")}"
        return
    fi

    echo -e "\e[34m[i]\e[0m $msg"
    log_to_file "[INFO] $msg"
}

print_warn() {
    local msg="$1"

    if [ "${JSON_MODE:-0}" -eq 1 ]; then
        echo "{\"status\":\"warn\",\"message\":$(json_escape "$msg")}"
        return
    fi

    echo -e "\e[33m[!]\e[0m $msg"
    log_to_file "[WARN] $msg"
}

print_step() {
    local msg="$1"

    if [ "${JSON_MODE:-0}" -eq 1 ]; then
        echo "{\"status\":\"step\",\"message\":$(json_escape "$msg")}"
        return
    fi

    echo -e "\e[36m[→]\e[0m $msg"
    log_to_file "[STEP] $msg"
}


# PASSWORD GENERATOR
generate_password() {
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -base64 32 | tr -d "=+/" | cut -c1-32
    else
        tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32
    fi
}

# DEP CHECK
check_dependencies() {
    for cmd in curl gzip; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            print_warn "$cmd not found (some features may fail)"
        fi
    done
}

check_dependencies

json_output() {
    if [ "$JSON_MODE" -eq 1 ]; then
        echo "{\"status\":\"$1\",\"message\":\"$2\"}"
        exit 0
    fi
}

# Retry mechanism helper
with_retry() {
    local command_func="$1"
    local max_attempts=${2:-3}
    local timeout=5
    local attempt=1
    local exitCode=0

    while (( attempt <= max_attempts ))
    do
        # Execute the passed string as a command
        if eval "$command_func"; then
            return 0
        else
            exitCode=$?
        fi

        if [[ $exitCode == 0 ]]; then
            break
        fi

        print_err "Operation failed (Exit $exitCode). Attempt $attempt/$max_attempts."
        if (( attempt < max_attempts )); then
            print_info "Retrying in $timeout seconds..."
            sleep $timeout
        else
            print_err "Operation permanently failed after $max_attempts attempts."
            return $exitCode
        fi
        (( attempt++ ))
    done

    return 0
}

# Checksum Verification Helper
generate_checksum() {
    local target_file="$1"
    if [ -f "$target_file" ]; then
        print_info "Generating SHA256 Checksum..."
        sha256sum "$target_file" | awk '{print $1}' > "${target_file}.sha256"
        print_msg "Checksum saved to: ${target_file}.sha256"
    fi
}

verify_file_size() {
    local target_file="$1"
    if [ ! -s "$target_file" ]; then
        print_err "File $target_file is empty!"
        return 1
    fi
    local fsize=$(stat -c%s "$target_file" 2>/dev/null || wc -c < "$target_file" 2>/dev/null || echo 0)
    # macOS/BSD stat compatibility fallback
    if [ "$fsize" = "" ] || [[ ! "$fsize" =~ ^[0-9]+$ ]]; then
        fsize=$(stat -f%z "$target_file" 2>/dev/null || echo 0)
    fi
    
    if [ "${fsize:-0}" -lt 50 ]; then
        print_err "File $target_file is suspiciously small ($fsize bytes). Likely an empty dump or failed connection."
        return 1
    fi
    return 0
}

# Webhook notification helper
send_notification() {
    local message="$1"
    local url="${ENV_WEBHOOK_URL}"
    
    if [ "$HEADLESS" -eq 1 ]; then
        if [ -n "$url" ]; then
            curl -fsSL -H "Content-Type: application/json" -d "{\"text\":\"$message\",\"content\":\"$message\"}" "$url" >/dev/null
            log_to_file "[WEBHOOK] Sent: $message"
        fi
        return
    fi
    
    # Interactive Mode
    if [ -z "$url" ]; then
        echo ""
        read -p "Do you want to send a Webhook notification (Slack/Discord) for this operation? (y/n) " SEND_NOTIF
        if [[ "$SEND_NOTIF" =~ ^[Yy]$ ]]; then
            read -e -p "Enter Webhook URL: " url
            ENV_WEBHOOK_URL="$url"
        else
            return
        fi
    fi
    
    if [ -n "$url" ]; then
        print_info "Sending notification..."
        curl -fsSL -H "Content-Type: application/json" -d "{\"text\":\"$message\",\"content\":\"$message\"}" "$url" >/dev/null
        print_msg "Notification ping sent."
        log_to_file "[WEBHOOK] Sent: $message"
    fi
}

# General DB Configuration Prompts
prompt_db_details() {
    if [ "$HEADLESS" -eq 1 ]; then
        DB_HOST=${ENV_DB_HOST:-localhost}
        DB_USER=$ENV_DB_USER
        DB_PASS=$ENV_DB_PASS
        DB_NAME=$ENV_DB_NAME
        
        if [ -z "$DB_USER" ] || [ -z "$DB_PASS" ] || [ -z "$DB_NAME" ]; then
            print_err "Headless mode requires ENV_DB_USER, ENV_DB_PASS, and ENV_DB_NAME to be set."
            exit 1
        fi
        return
    fi

    # Check if we have .env vars loaded
    if [ -n "$ENV_DB_NAME" ] || [ -n "$ENV_DB_USER" ]; then
        echo ""
        print_info "Found .env configuration!"
        echo "Do you want to proceed with these details?"
        echo "  DB Name  : [${ENV_DB_NAME}]"
        echo "  User     : [${ENV_DB_USER}]"
        echo "  Password : [*******]"
        echo "  Host     : [${ENV_DB_HOST:-localhost}]"
        
        read -p "Confirm? (y/n): " USE_ENV
        if [[ "$USE_ENV" =~ ^[Yy]$ ]]; then
            DB_HOST=${ENV_DB_HOST:-localhost}
            DB_USER=$ENV_DB_USER
            DB_PASS=$ENV_DB_PASS
            DB_NAME=$ENV_DB_NAME
            return
        fi
        echo ""
    fi

    read -e -p "Database Host (default: ${ENV_DB_HOST:-localhost}): " DB_HOST
    DB_HOST=${DB_HOST:-${ENV_DB_HOST:-localhost}}
    read -e -p "Database Username (default: ${ENV_DB_USER}): " DB_USER
    DB_USER=${DB_USER:-$ENV_DB_USER}
    read -s -p "Database Password (default: from .env if set): " DB_PASS
    DB_PASS=${DB_PASS:-$ENV_DB_PASS}
    echo ""
    read -e -p "Database Name (default: ${ENV_DB_NAME}): " DB_NAME
    DB_NAME=${DB_NAME:-$ENV_DB_NAME}
}

prompt_filename() {
    local default_name="$1"
    local var_to_set="$2"

    if [ "$HEADLESS" -eq 1 ]; then
        printf -v "$var_to_set" "%s" "$default_name"
        return
    fi

    local choice user_filename

    echo "Do you want to use auto-generated filename ($default_name) or manual input?"

    select choice in "Auto-generate" "Manual input"; do
        case $choice in
            "Auto-generate")
                printf -v "$var_to_set" "%s" "$default_name"
                break
                ;;
            "Manual input")
                read -e -p "Enter filename: " user_filename
                printf -v "$var_to_set" "%s" "$user_filename"
                break
                ;;
            *)
                echo "Invalid option"
                ;;
        esac
    done
}

prompt_migration_pause() {
    if [ "$HEADLESS" -eq 1 ]; then return; fi
    echo ""
    read -p "Do you want to run manual migrations on the app server first? (y/n) " PAUSE_MIGRATE
    if [[ "$PAUSE_MIGRATE" =~ ^[Yy]$ ]]; then
        echo "=================================================="
        echo "⛔ NOW RUN THIS FROM APP SERVER (e.g. npm run db:migrate):"
        echo "DATABASE_URL=postgres://$DB_USER:XXXX@$DB_HOST:5432/$DB_NAME npm run db:migrate"
        echo ""
        echo "After migration completes, press ENTER here."
        echo "=================================================="
        read -r
    fi
}

# --- DUMP / RESTORE EXECUTOR WRAPPERS (For Retry Logic) ---
do_mysql_dump() {
    if command -v pv &> /dev/null; then
        mysqldump -h "$DB_HOST" -u "$DB_USER" --no-tablespaces --single-transaction --quick --lock-tables=false --default-character-set=utf8mb4 "$DB_NAME" | gzip | pv > "$OUT_FILE"
    else
        mysqldump -h "$DB_HOST" -u "$DB_USER" --no-tablespaces --single-transaction --quick --lock-tables=false --default-character-set=utf8mb4 "$DB_NAME" | gzip > "$OUT_FILE"
    fi
    
    local exitCode=$?
    if [ $exitCode -eq 0 ]; then
        verify_file_size "$OUT_FILE"
        return $?
    fi
    return $exitCode
}

do_pgsql_data_dump() {
    if command -v pv &> /dev/null; then
        pg_dump -U "$DB_USER" -h "$DB_HOST" -a --inserts --rows-per-insert=1000 "$DB_NAME" | pv > "$DATA_FILE"
    else
        pg_dump -U "$DB_USER" -h "$DB_HOST" -a --inserts --rows-per-insert=1000 -v -f "$DATA_FILE" "$DB_NAME"
    fi
    
    local exitCode=$?
    if [ $exitCode -eq 0 ]; then
        verify_file_size "$DATA_FILE"
        return $?
    fi
    return $exitCode
}

do_pgsql_schema_dump() {
    if command -v pv &> /dev/null; then
        pg_dump -U "$DB_USER" -h "$DB_HOST" -F c -s "$DB_NAME" | pv > "$SCHEMA_FILE"
    else
        pg_dump -U "$DB_USER" -h "$DB_HOST" -F c -s -v -f "$SCHEMA_FILE" "$DB_NAME"
    fi
    
    local exitCode=$?
    if [ $exitCode -eq 0 ]; then
        verify_file_size "$SCHEMA_FILE"
        return $?
    fi
    return $exitCode
}

# CORE HANDLERS

mysql_backup() {
    print_info "--- MySQL Backup ---"
    prompt_db_details

    DATE=$(date +%F_%H-%M)
    RANDOM_ID=$(shuf -i 1000-9999 -n 1 2>/dev/null || echo $RANDOM)
    DEFAULT_FILE="backup_${DB_NAME}_${DATE}_${RANDOM_ID}.sql.gz"

    local OUT_FILE=""
    prompt_filename "$DEFAULT_FILE" "OUT_FILE"

    export MYSQL_PWD="$DB_PASS"

    print_step "Starting MySQL dump..."

    if with_retry "do_mysql_dump"; then
        print_msg "Backup saved to: $OUT_FILE"
        generate_checksum "$OUT_FILE"
        send_notification "✅ MySQL Backup for ${DB_NAME} completed successfully!"
    else
        print_err "Backup failed"
        export MYSQL_PWD=""
        return 1
    fi

    export MYSQL_PWD=""
}

mysql_restore() {
    print_info "--- MySQL Restore ---"
    prompt_db_details
    if [ "$HEADLESS" -eq 1 ]; then
        BACKUP_FILE=$HEADLESS_FILE
    else
        read -e -p "Enter backup file path (.sql.gz): " BACKUP_FILE
    fi
    if [ ! -f "$BACKUP_FILE" ]; then
        print_err "File $BACKUP_FILE not found!"
        exit 1
    fi
    export MYSQL_PWD="$DB_PASS"

    # Restores are typically not retried to prevent corrupting partial data.
    if command -v pv &> /dev/null; then
        pv "$BACKUP_FILE" | gunzip | mysql -h "$DB_HOST" -u "$DB_USER" --init-command="SET SESSION foreign_key_checks=0; SET SESSION unique_checks=0;" --max_allowed_packet=1G "$DB_NAME"
    else
        gunzip < "$BACKUP_FILE" | mysql -h "$DB_HOST" -u "$DB_USER" --init-command="SET SESSION foreign_key_checks=0; SET SESSION unique_checks=0;" --max_allowed_packet=1G "$DB_NAME"
    fi
    
    print_msg "Restore completed successfully."
    send_notification "✅ MySQL Restore for ${DB_NAME} completed successfully!"
    export MYSQL_PWD=""
}

pgsql_backup() {
    print_info "--- PostgreSQL Backup ---"
    prompt_db_details
    DATE=$(date +%F_%H-%M)
    RANDOM_ID=$(shuf -i 1000-9999 -n 1 2>/dev/null || echo $RANDOM)
    
    DEFAULT_DATA="data_${DB_NAME}_${DATE}_${RANDOM_ID}.sql"
    DEFAULT_SCHEMA="schema_${DB_NAME}_${DATE}_${RANDOM_ID}.backup"
    local DATA_FILE=""
    local SCHEMA_FILE=""
    
    print_info "Configuring Data Backup File..."
    prompt_filename "$DEFAULT_DATA" "DATA_FILE"
    print_info "Configuring Schema Backup File..."
    prompt_filename "$DEFAULT_SCHEMA" "SCHEMA_FILE"
    
    export PGPASSWORD="$DB_PASS"
    print_info "Taking Data backup (INSERT mode)..."
    if with_retry "do_pgsql_data_dump"; then
        print_msg "Data backup saved: $DATA_FILE"
        generate_checksum "$DATA_FILE"
    else
        print_err "Data backup failed"
        unset PGPASSWORD
        return 1
    fi
    
    print_info "Taking Schema backup (CUSTOM format)..."
    if with_retry "do_pgsql_schema_dump"; then
        print_msg "Schema backup saved: $SCHEMA_FILE"
        generate_checksum "$SCHEMA_FILE"
    else
        print_err "Schema backup failed"
        unset PGPASSWORD
        return 1
    fi
    
    unset PGPASSWORD
    send_notification "✅ PostgreSQL Data & Schema Backup for ${DB_NAME} completed successfully!"
}

pgsql_full_restore() {
    print_info "--- PostgreSQL Full Restore ---"
    prompt_db_details
    if [ "$HEADLESS" -eq 1 ]; then
        SCHEMA_FILE=$HEADLESS_SCHEMA
        DATA_FILE=$HEADLESS_FILE
    else
        read -e -p "Enter schema backup file: " SCHEMA_FILE
        read -e -p "Enter data backup file (.sql): " DATA_FILE
    fi
    
    export PGPASSWORD="$DB_PASS"
    echo "Dropping DB if exists..."
    dropdb -U "$DB_USER" -h "$DB_HOST" --if-exists "$DB_NAME"
    echo "Creating DB..."
    createdb -U "$DB_USER" -h "$DB_HOST" "$DB_NAME"
    
    echo "Restoring Schema..."
    if command -v pv &> /dev/null; then
        pv "$SCHEMA_FILE" | pg_restore -U "$DB_USER" -h "$DB_HOST" -d "$DB_NAME" --no-owner --no-privileges || true
    else
        pg_restore -U "$DB_USER" -h "$DB_HOST" -d "$DB_NAME" --no-owner --no-privileges "$SCHEMA_FILE" || true
    fi
    
    print_info "Restoring Data in FK-safe mode..."
    chmod o+r "$DATA_FILE" 2>/dev/null || true
    if command -v pv &> /dev/null; then
        ( echo "SET session_replication_role = replica;"; pv "$DATA_FILE"; echo "SET session_replication_role = DEFAULT;" ) | psql -U "$DB_USER" -h "$DB_HOST" -d "$DB_NAME"
    else
        psql -U "$DB_USER" -h "$DB_HOST" -d "$DB_NAME" <<EOF
SET session_replication_role = replica;
\i $DATA_FILE
SET session_replication_role = DEFAULT;
EOF
    fi

    echo "Fixing sequences..."
    pgsql_fix_sequences
    unset PGPASSWORD
    print_msg "Full Restore Completed!"
    send_notification "✅ PostgreSQL Full Restore for ${DB_NAME} completed successfully!"
}

pgsql_data_restore() {
    print_info "--- PostgreSQL Data Only Restore ---"
    prompt_db_details
    if [ "$HEADLESS" -eq 1 ]; then
        DATA_FILE=$HEADLESS_FILE
    else
        read -e -p "Enter data backup file (.sql): " DATA_FILE
    fi
    
    export PGPASSWORD="$DB_PASS"
    echo "Checking if database exists..."
    DB_EXISTS=$(psql -U "$DB_USER" -h "$DB_HOST" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" 2>/dev/null || true)
    
    if [ "$DB_EXISTS" = "1" ]; then
      print_info "Database '$DB_NAME' already exists. No drop performed."
    else
      print_info "Creating database '$DB_NAME'..."
      createdb -U "$DB_USER" -h "$DB_HOST" "$DB_NAME" || print_err "Failed createdb but proceeding anyway"
    fi
    
    prompt_migration_pause
    
    print_info "Restoring Data in FK-safe mode..."
    chmod o+r "$DATA_FILE" 2>/dev/null || true
    if command -v pv &> /dev/null; then
        ( echo "SET session_replication_role = replica;"; pv "$DATA_FILE"; echo "SET session_replication_role = DEFAULT;" ) | psql -U "$DB_USER" -h "$DB_HOST" -d "$DB_NAME"
    else
        psql -U "$DB_USER" -h "$DB_HOST" -d "$DB_NAME" <<EOF
SET session_replication_role = replica;
\i $DATA_FILE
SET session_replication_role = DEFAULT;
EOF
    fi

    echo "Fixing sequences..."
    pgsql_fix_sequences
    unset PGPASSWORD
    print_msg "Data Only Restore Completed!"
    send_notification "✅ PostgreSQL Data Only Restore for ${DB_NAME} completed successfully!"
}

pgsql_fix_sequences() {
    psql -U "$DB_USER" -h "$DB_HOST" -d "$DB_NAME" <<'EOF'
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN (
    SELECT
      c.relname AS table_name,
      a.attname AS column_name,
      pg_get_serial_sequence(
        quote_ident(n.nspname)||'.'||quote_ident(c.relname),
        a.attname
      ) AS seq_name,
      quote_ident(n.nspname)||'.'||quote_ident(c.relname) AS full_table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE c.relkind = 'r'
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND n.nspname = 'public'
      AND pg_get_serial_sequence(
        quote_ident(n.nspname)||'.'||quote_ident(c.relname),
        a.attname
      ) IS NOT NULL
  )
  LOOP
    EXECUTE format(
      'SELECT setval(%L, COALESCE((SELECT MAX(%I) FROM %s), 1), true)',
      r.seq_name,
      r.column_name,
      r.full_table_name
    );
  END LOOP;
END $$;
EOF
}


do_transfer_file() {
    local target_file="$1"
    case "$t_method" in
        "scp" ) scp -P "$SSH_PORT" -C "$target_file" "$T_DEST" ;;
        "rsync" ) rsync -avz -e "ssh -p $SSH_PORT" --progress "$target_file" "$T_DEST" ;;
        "AWS S3" ) aws s3 cp "$target_file" "$T_DEST" ;;
        "rclone (GDrive/Other)" ) rclone copy "$target_file" "$T_DEST" ;;
    esac
}

do_download_file() {
    local source_path="$1"
    case "$t_method" in
        "scp" ) scp -P "$SSH_PORT" -C "$source_path" "$T_DEST" ;;
        "rsync" ) rsync -avz -e "ssh -p $SSH_PORT" --progress "$source_path" "$T_DEST" ;;
        "AWS S3" ) aws s3 cp "$source_path" "$T_DEST" ;;
        "rclone (GDrive/Other)" ) rclone copy "$source_path" "$T_DEST" ;;
    esac
}

# Upload Handler
file_transfer() {
    print_info "--- Upload File (Cloud & Server) ---"
    
    if [ "$HEADLESS" -eq 1 ]; then
        T_FILE=$HEADLESS_FILE
        T_DEST=$HEADLESS_DEST
        t_method=$HEADLESS_METHOD
        SSH_PORT=${HEADLESS_PORT:-22}
    else
        read -e -p "Enter file to transfer/upload: " T_FILE
        echo "Select Transfer Method:"
        select t_method in "scp" "rsync" "AWS S3" "rclone (GDrive/Other)"; do
            case $t_method in
                "scp" | "rsync" )
                    read -e -p "Enter destination (e.g. root@192.168.1.1:/path/): " T_DEST
                    read -e -p "SSH Port (default: 22): " SSH_PORT
                    SSH_PORT=${SSH_PORT:-22}
                    break;;
                "AWS S3" )
                    read -e -p "Enter S3 Bucket (default: ${ENV_AWS_BUCKET}): " T_DEST
                    T_DEST=${T_DEST:-$ENV_AWS_BUCKET}
                    if [ -n "$ENV_AWS_ACCESS_KEY_ID" ]; then
                        export AWS_ACCESS_KEY_ID="$ENV_AWS_ACCESS_KEY_ID"
                        export AWS_SECRET_ACCESS_KEY="$ENV_AWS_SECRET_ACCESS_KEY"
                    fi
                    break;;
                "rclone (GDrive/Other)" )
                    read -e -p "Enter rclone remote path (default: ${ENV_RCLONE_REMOTE}): " T_DEST
                    T_DEST=${T_DEST:-$ENV_RCLONE_REMOTE}
                    break;;
            esac
        done
    fi

    # Set AWS creds if headless
    if [ "$HEADLESS" -eq 1 ] && [ "$t_method" == "AWS S3" ]; then
        if [ -n "$ENV_AWS_ACCESS_KEY_ID" ]; then
            export AWS_ACCESS_KEY_ID="$ENV_AWS_ACCESS_KEY_ID"
            export AWS_SECRET_ACCESS_KEY="$ENV_AWS_SECRET_ACCESS_KEY"
        fi
    fi

    print_info "Initiating transfer for primary file..."
    if with_retry "do_transfer_file '$T_FILE'"; then
        print_msg "Transfer completed"
    else
        print_err "Transfer failed"
        return 1
    fi
    
    # Check if a checksum file was created, and upload it as a sidecar
    if [ -f "${T_FILE}.sha256" ]; then
        print_info "Initiating transfer for Checksum sidecar file..."
        with_retry "do_transfer_file '${T_FILE}.sha256'"
    fi
    
    print_msg "Transfer protocol fully completed."
    send_notification "✅ File Upload to ${T_DEST} completed!"
}

# Download Handler
file_download() {
    print_info "--- Download File (Cloud & Server) ---"
    
    if [ "$HEADLESS" -eq 1 ]; then
        T_SRC=$HEADLESS_FILE
        T_DEST=$HEADLESS_DEST
        t_method=$HEADLESS_METHOD
        SSH_PORT=${HEADLESS_PORT:-22}
    else
        read -e -p "Enter remote source (e.g. root@192.168.1.1:/path/file.log): " T_SRC
        read -e -p "Enter local destination (default: ./): " T_DEST
        T_DEST=${T_DEST:-./}

        if [ -z "$T_SRC" ]; then
            print_err "Source cannot be empty."
            return 1
        fi

        if [ ! -d "$T_DEST" ]; then
            print_err "Destination directory does not exist: $T_DEST"
            return 1
        fi
        
        echo "Select Download Method:"
        select t_method in "scp" "rsync" "AWS S3" "rclone (GDrive/Other)"; do
            case $t_method in
                "scp" | "rsync" )
                    read -e -p "SSH Port (default: 22): " SSH_PORT
                    SSH_PORT=${SSH_PORT:-22}
                    break;;
                "AWS S3" )
                    if [ -n "$ENV_AWS_ACCESS_KEY_ID" ]; then
                        export AWS_ACCESS_KEY_ID="$ENV_AWS_ACCESS_KEY_ID"
                        export AWS_SECRET_ACCESS_KEY="$ENV_AWS_SECRET_ACCESS_KEY"
                    fi
                    break;;
                "rclone (GDrive/Other)" )
                    break;;
            esac
        done
    fi

    # Set AWS creds if headless
    if [ "$HEADLESS" -eq 1 ] && [ "$t_method" == "AWS S3" ]; then
        if [ -n "$ENV_AWS_ACCESS_KEY_ID" ]; then
            export AWS_ACCESS_KEY_ID="$ENV_AWS_ACCESS_KEY_ID"
            export AWS_SECRET_ACCESS_KEY="$ENV_AWS_SECRET_ACCESS_KEY"
        fi
    fi

    print_info "Initiating download for requested object..."
    if with_retry "do_download_file '$T_SRC'"; then
        print_msg "Download completed"
    else
        print_err "Download failed"
        return 1
    fi
    
    print_msg "Download protocol fully completed."
    send_notification "✅ File Download from ${T_SRC} completed!"
}


# Self-Update Handler
self_update() {
    print_info "--- Self-Update Agent ---"
    local remote_url="https://raw.githubusercontent.com/iamPrashanta/dbbkp/main/dbbkp.sh"
    local script_path=$(command -v dbbkp || echo "$0")
    
    echo "This will securely fetch the latest version of dbbkp from GitHub."
    read -p "Are you sure you want to upgrade? (y/n): " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        return
    fi
    
    print_info "Downloading latest release from GitHub (raw)..."
    tmp_file=$(mktemp)

    if ! curl -fsSL "$remote_url" -o "$tmp_file"; then
        print_err "Download failed"
        return 1
    fi

    if ! grep -q "^#!/bin/bash" "$tmp_file"; then
        print_err "Downloaded file is invalid"
        rm -f "$tmp_file"
        return 1
    fi

    chmod +x "$tmp_file"

    if [ -w "$script_path" ]; then
        mv "$tmp_file" "$script_path"
    else
        sudo mv "$tmp_file" "$script_path"
    fi

    print_msg "Updated successfully"
    return 0
}


# Headless Argument Parsing Loop
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --headless) HEADLESS=1 ;;
        --mode=*) HEADLESS_MODE="${1#*=}" ;;
        --file=*) HEADLESS_FILE="${1#*=}" ;;
        --schema=*) HEADLESS_SCHEMA="${1#*=}" ;;
        --dest=*) HEADLESS_DEST="${1#*=}" ;;
        --method=*) HEADLESS_METHOD="${1#*=}" ;;
        --port=*) HEADLESS_PORT="${1#*=}" ;;
        --update) self_update ;;
        --json) JSON_MODE=1 ;;
        --version) echo "dbbkp v$VERSION"; exit 0 ;;
        *) print_err "Unknown parameter passed: $1"; exit 1 ;;
    esac
    shift
done

# Execute Headless Mode directly
if [ "$HEADLESS" -eq 1 ]; then
    log_to_file "===== STARTED HEADLESS RUN: $HEADLESS_MODE ====="
    print_info "Running in HEADLESS mode: $HEADLESS_MODE"
    case $HEADLESS_MODE in
        "mysql-backup") mysql_backup ;;
        "mysql-restore") mysql_restore ;;
        "pgsql-backup") pgsql_backup ;;
        "pgsql-full-restore") pgsql_full_restore ;;
        "pgsql-data-restore") pgsql_data_restore ;;
        "upload") file_transfer ;;
        "download") file_download ;;
        *) print_err "Invalid headless mode specified. Use --mode=[mysql-backup|pgsql-backup|upload|download]"; exit 1 ;;
    esac
    exit 0
fi

# Main Menu (Interactive)
while true; do
    echo ""
    echo "======================================="
    echo "        DBBKP v$VERSION"
    echo "======================================="
    PS3="Please select a module: "
    options=("MySQL Backup" "MySQL Restore" "PostgreSQL Backup" "PostgreSQL Full Restore" "PostgreSQL Data Restore" "Upload File (Transfer)" "Download File" "Update Agent (GitHub)" "Exit")
    select opt in "${options[@]}"; do
        case $opt in
            "MySQL Backup") mysql_backup; break ;;
            "MySQL Restore") mysql_restore; break ;;
            "PostgreSQL Backup") pgsql_backup; break ;;
            "PostgreSQL Full Restore") pgsql_full_restore; break ;;
            "PostgreSQL Data Restore") pgsql_data_restore; break ;;
            "Upload File (Transfer)") file_transfer; break ;;
            "Download File") file_download; break ;;
            "Update Agent (GitHub)") self_update; break ;;
            "Exit") echo "Exiting."; exit 0 ;;
            *) echo "Invalid option $REPLY";;
        esac
    done
done
