#!/bin/bash

set -uo pipefail

VERSION="3.0.0"
SCAN_PATHS=("/home" "/var/www")
JSON_MODE=0
AUTO_FIX=0
WEBHOOK_URL=""
RUN_MODE="full"

# Node identity & Redis configs
NODE_ID=$(hostname 2>/dev/null || echo "unknown")
NODE_ENV="production"
NODE_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")
REDIS_HOST="127.0.0.1"
REDIS_PORT="6379"
REDIS_PASS=""

# Load config if exists
[ -f /etc/infra-agent.conf ] && source /etc/infra-agent.conf

MALWARE_FOUND=0
MALWARE_COUNT=0
MALWARE_SAMPLES_JSON="[]"
BAD_PERMS=0
BACKUPS_EXPOSED=0
EXPOSED_FILES_JSON="[]"
SUSPICIOUS_REQUESTS=0
SCORE=0

# System stats
SYS_UPTIME=$(cat /proc/uptime 2>/dev/null | awk '{print int($1)}' || echo 0)
SYS_OS=$(grep PRETTY_NAME /etc/os-release 2>/dev/null | cut -d '"' -f 2 || echo "Linux")
SYS_CPU_USAGE=0
SYS_MEM_USAGE=0
SYS_DISK_JSON="[]"

# Services
SRV_WEB_TYPE="none"
SRV_WEB_STATUS="not_installed"
SRV_PHP_VER="not_installed"
SRV_PHP_MODE="none"
SRV_DB_TYPE="none"
SRV_DB_VER="not_installed"
SRV_DB_STATUS="not_installed"
SRV_PG_VER="not_installed"
SRV_PG_STATUS="not_installed"
SRV_REDIS_VER="not_installed"
SRV_REDIS_STATUS="not_installed"

# Attacks
ATTACKS_TOP_IPS_JSON="[]"
QUARANTINED_FILES_JSON="[]"

# Add args parsing
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --auto-fix) AUTO_FIX=1 ;;
        --json) JSON_MODE=1 ;;
        --webhook=*) WEBHOOK_URL="${1#*=}" ;;
        --webhook) WEBHOOK_URL="$2"; shift ;;
        --mode=*) RUN_MODE="${1#*=}" ;;
        --update) self_update; exit 0 ;;
        scan|version) COMMAND="$1" ;;
        *) echo "Usage: $0 [scan|version|--update] [--auto-fix] [--json] [--mode=health|disk|network|full] [--webhook URL]"; exit 1 ;;
    esac
    shift
done

COMMAND=${COMMAND:-scan}

if [ "$COMMAND" == "version" ]; then
    echo "infra-agent v$VERSION"
    exit 0
fi

check_dependencies() {
    for cmd in curl grep awk sed find xargs timeout python3; do
        command -v "$cmd" >/dev/null || warn "$cmd not found"
    done

    command -v dig >/dev/null || warn "dig not found (DNS checks limited)"
    command -v ufw >/dev/null || warn "ufw not found (IP blocking disabled)"
    command -v redis-cli >/dev/null || warn "redis-cli not found (Central features disabled)"
}

json_escape() {
    printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo '""'
}

redis_cmd() {
    if command -v redis-cli >/dev/null; then
        redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ${REDIS_PASS:+-a "$REDIS_PASS"} "$@" 2>/dev/null || true
    fi
}

emit_event() {
    local type="$1"
    local risk="$2"
    local timestamp=$(date +%s)
    
    local event_json=$(cat <<INNER_EOF
{
  "type": $(json_escape "$type"),
  "node": $(json_escape "$NODE_ID"),
  "timestamp": $timestamp,
  "risk_score": $risk
}
INNER_EOF
)
    # Log locally
    echo "$timestamp | $type | $NODE_ID | Risk: $risk" >> /tmp/infra_events.log
    
    # Push to Redis Queue
    redis_cmd RPUSH infra:events "$event_json" >/dev/null
}

heartbeat() {
    redis_cmd SET "infra:heartbeat:$NODE_ID" "$(date +%s)" EX 60 >/dev/null
}

# Print functions
print() {
    if [ "$JSON_MODE" -eq 1 ]; then return; fi
    echo -e "$3"
}

ok() { print "$1" "success" "\e[32m[+]\e[0m $1"; }
warn() { print "$1" "warn" "\e[33m[!]\e[0m $1"; }
err() { print "$1" "error" "\e[31m[x]\e[0m $1"; }
info() { print "$1" "info" "\e[34m[i]\e[0m $1"; }
step() { print "$1" "step" "\e[36m[→]\e[0m $1"; }

send_notification() {
    local message="$1"
    local url="${WEBHOOK_URL}"
    
    if [ -n "$url" ]; then
        curl -fsSL --max-time 5 -H "Content-Type: application/json" -d "{\"text\":\"$message\",\"content\":\"$message\"}" "$url" >/dev/null || true
    fi
}

self_update() {
    step "Self-Update Agent"
    local remote_url="https://raw.githubusercontent.com/iamPrashanta/dbbkp/main/infra-agent.sh"
    local script_path=$(command -v infra-agent || echo "$0")
    
    echo "This will securely fetch the latest version of infra-agent from GitHub."
    read -p "Are you sure you want to upgrade? (y/n): " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        return
    fi
    
    info "Downloading latest release from GitHub (raw)..."
    tmp_file=$(mktemp)

    if ! curl -fsSL "$remote_url" -o "$tmp_file"; then
        err "Download failed"
        return 1
    fi

    if ! grep -q "^#!/bin/bash" "$tmp_file"; then
        err "Downloaded file is invalid"
        rm -f "$tmp_file"
        return 1
    fi

    chmod +x "$tmp_file"

    if [ -w "$script_path" ]; then
        mv "$tmp_file" "$script_path"
    else
        sudo mv "$tmp_file" "$script_path"
    fi

    ok "Updated successfully"
    return 0
}

# -------------------------------
# QUARANTINE
# -------------------------------

QUARANTINE_DIR="/var/quarantine"

quarantine_file() {
    local file="$1"
    mkdir -p "$QUARANTINE_DIR" 2>/dev/null || true
    chmod 700 "$QUARANTINE_DIR" 2>/dev/null || true
    local qfile="$QUARANTINE_DIR/$(basename "$file").$(date +%s)"
    mv "$file" "$qfile" 2>/dev/null || return 1
    
    # Append to JSON array
    local escaped_qfile=$(json_escape "$qfile")
    if [ "$QUARANTINED_FILES_JSON" == "[]" ]; then
        QUARANTINED_FILES_JSON="[ $escaped_qfile ]"
    else
        QUARANTINED_FILES_JSON="${QUARANTINED_FILES_JSON%]}, $escaped_qfile ]"
    fi
    
    redis_cmd LPUSH "infra:quarantine:$NODE_ID" "$qfile" >/dev/null
}

# -------------------------------
# CORE DETECTIONS
# -------------------------------

detect_web_server() {
    step "Web Server"
    # Try systemctl first (works on real Linux), fall back to ps + command checks (WSL-safe)
    if systemctl is-active --quiet lsws 2>/dev/null || ps aux 2>/dev/null | grep -q '[l]sws'; then
        ok "LiteSpeed running"
        SRV_WEB_TYPE="litespeed"
        SRV_WEB_STATUS="running"
    elif systemctl is-active --quiet nginx 2>/dev/null || ps aux 2>/dev/null | grep -q '[n]ginx'; then
        ok "Nginx running"
        SRV_WEB_TYPE="nginx"
        SRV_WEB_STATUS="running"
    elif systemctl is-active --quiet apache2 2>/dev/null || ps aux 2>/dev/null | grep -qE '[a]pache2|[h]ttpd'; then
        ok "Apache running"
        SRV_WEB_TYPE="apache2"
        SRV_WEB_STATUS="running"
    elif command -v nginx >/dev/null 2>&1; then
        warn "Nginx installed but not running"
        SRV_WEB_TYPE="nginx"
        SRV_WEB_STATUS="stopped"
    elif command -v apache2 >/dev/null 2>&1 || command -v httpd >/dev/null 2>&1; then
        warn "Apache installed but not running"
        SRV_WEB_TYPE="apache2"
        SRV_WEB_STATUS="stopped"
    else
        warn "No web server detected"
        SRV_WEB_TYPE="none"
        SRV_WEB_STATUS="not_installed"
    fi
}

detect_php() {
    step "PHP"
    if command -v php >/dev/null 2>&1; then
        PHP_VERSION=$(php -r "echo PHP_VERSION;" 2>/dev/null || echo "unknown")
        ok "PHP CLI: $PHP_VERSION"
        SRV_PHP_VER="$PHP_VERSION"

        if [ "$SRV_WEB_TYPE" == "litespeed" ]; then
            SRV_PHP_MODE="lsapi"
        elif ls /run/php/ 2>/dev/null | grep -q fpm; then
            SRV_PHP_MODE="php-fpm"
        elif ps aux 2>/dev/null | grep -q '[p]hp-fpm'; then
            SRV_PHP_MODE="php-fpm"
        else
            SRV_PHP_MODE="cli"
        fi
    else
        warn "PHP not installed"
        SRV_PHP_VER="not_installed"
        SRV_PHP_MODE="none"
    fi
}

detect_mysql() {
    step "MySQL/MariaDB"
    # Check if process is running (ps fallback for WSL)
    local mysql_running=0
    systemctl is-active --quiet mysql 2>/dev/null && mysql_running=1
    systemctl is-active --quiet mariadb 2>/dev/null && mysql_running=1
    ps aux 2>/dev/null | grep -qE '[m]ysqld|[m]ariadbd' && mysql_running=1

    if command -v mysql >/dev/null 2>&1; then
        local version_str=$(mysql -V 2>/dev/null || echo "")
        if echo "$version_str" | grep -qi "mariadb"; then
            SRV_DB_TYPE="mariadb"
        else
            SRV_DB_TYPE="mysql"
        fi
        SRV_DB_VER=$(echo "$version_str" | grep -oP '\d+\.\d+\.\d+' | head -1 || echo "unknown")
        if [ "$mysql_running" -eq 1 ]; then
            ok "$SRV_DB_TYPE $SRV_DB_VER running"
            SRV_DB_STATUS="running"
        else
            warn "$SRV_DB_TYPE installed but not running"
            SRV_DB_STATUS="stopped"
        fi
    else
        warn "MySQL/MariaDB not installed"
        SRV_DB_TYPE="none"
        SRV_DB_VER="not_installed"
        SRV_DB_STATUS="not_installed"
    fi
}

detect_postgres() {
    step "PostgreSQL"
    local pg_running=0
    systemctl is-active --quiet postgresql 2>/dev/null && pg_running=1
    service postgresql status >/dev/null 2>&1 && pg_running=1
    ps aux 2>/dev/null | grep -q '[p]ostgres' && pg_running=1

    if command -v psql >/dev/null 2>&1; then
        local pg_ver=$(psql --version 2>/dev/null | grep -oP '\d+\.\d+' | head -1 || echo "unknown")
        SRV_PG_VER="$pg_ver"
        if [ "$pg_running" -eq 1 ]; then
            ok "PostgreSQL $pg_ver running"
            SRV_PG_STATUS="running"
        else
            warn "PostgreSQL installed but not running"
            SRV_PG_STATUS="stopped"
        fi
    else
        SRV_PG_VER="not_installed"
        SRV_PG_STATUS="not_installed"
        warn "PostgreSQL not installed"
    fi
}

detect_redis_server() {
    step "Redis"
    local redis_running=0
    systemctl is-active --quiet redis 2>/dev/null && redis_running=1
    systemctl is-active --quiet redis-server 2>/dev/null && redis_running=1
    ps aux 2>/dev/null | grep -q '[r]edis-server' && redis_running=1

    if command -v redis-cli >/dev/null 2>&1; then
        local ping=$(redis-cli -h "${REDIS_HOST:-127.0.0.1}" -p "${REDIS_PORT:-6379}" ping 2>/dev/null || echo "")
        if [ "$ping" = "PONG" ]; then
            local redis_ver=$(redis-cli --version 2>/dev/null | grep -oP '\d+\.\d+' | head -1 || echo "unknown")
            ok "Redis $redis_ver responding"
            SRV_REDIS_STATUS="running"
            SRV_REDIS_VER="$redis_ver"
        else
            warn "Redis CLI found but not responding"
            SRV_REDIS_STATUS="stopped"
            SRV_REDIS_VER="unknown"
        fi
    else
        SRV_REDIS_STATUS="not_installed"
        SRV_REDIS_VER="not_installed"
        warn "Redis not installed"
    fi
}

detect_vhost() {
    step "Virtual Hosts"
    # Nginx
    for f in /etc/nginx/sites-enabled/*; do
        [ -e "$f" ] || continue
        info "Checking $f (Nginx)"
        grep -q "\*" "$f" 2>/dev/null && ok "Wildcard configured" || true
        grep -q "public;" "$f" 2>/dev/null && ok "Laravel root OK" || true
    done
    
    # LiteSpeed
    for v in /usr/local/lsws/conf/vhosts/*; do
        [ -e "$v" ] || continue
        info "LiteSpeed vhost: $v"
        grep -q "\*" "$v" 2>/dev/null && ok "Wildcard configured" || true
        grep -q "public" "$v" 2>/dev/null && ok "Laravel root OK" || true
    done
}

detect_env() {
    step ".env Check"
    for p in "${SCAN_PATHS[@]}"; do
        [ -d "$p" ] || continue
        timeout 20s find "$p" -maxdepth 4 -name ".env" 2>/dev/null | while read env_file; do
            app_path=$(dirname "$env_file")
            info "Checking .env in $app_path"
            
            DB_HOST=$(grep "^DB_HOST=" "$env_file" 2>/dev/null | cut -d '=' -f2- | tr -d '\r' || true)
            DB_USER=$(grep "^DB_USERNAME=" "$env_file" 2>/dev/null | cut -d '=' -f2- | tr -d '\r' || true)
            DB_PASS=$(grep "^DB_PASSWORD=" "$env_file" 2>/dev/null | cut -d '=' -f2- | tr -d '\r' || true)
            DB_NAME=$(grep "^DB_DATABASE=" "$env_file" 2>/dev/null | cut -d '=' -f2- | tr -d '\r' || true)

            if [ -n "$DB_NAME" ] && [ -n "$DB_USER" ]; then
                info "DB: $DB_NAME@${DB_HOST:-localhost}"
                if [ -n "$DB_HOST" ] && [ -n "$DB_PASS" ]; then
                    if mysql --connect-timeout=3 -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" -e "USE $DB_NAME" >/dev/null 2>&1; then
                        ok "DB connection successful ($app_path)"
                    else
                        err "DB connection failed ($app_path)"
                    fi
                fi
            fi
        done || true
    done
}

detect_services() {
    step "Installed Services"
    if command -v dpkg >/dev/null; then
        dpkg -l | grep -E 'nginx|mysql|php|lsws' | awk '{print $2}' | while read svc; do
            info "$svc"
        done || true
    fi
}

detect_suspicious_services() {
    step "Suspicious Services"

    rm -f /tmp/suspicious_services.json

    local first=1

    systemctl list-units --type=service --all --no-pager 2>/dev/null | \
    awk '{print $1}' | while read svc; do

        [ -z "$svc" ] && continue

        SERVICE_INFO=$(systemctl cat "$svc" 2>/dev/null || true)

        SCORE=0

        echo "$SERVICE_INFO" | grep -qi "/tmp/" && SCORE=$((SCORE+40))
        echo "$SERVICE_INFO" | grep -qi "curl .*| bash" && SCORE=$((SCORE+50))
        echo "$SERVICE_INFO" | grep -qi "wget .*| sh" && SCORE=$((SCORE+50))
        echo "$SERVICE_INFO" | grep -qi "python .*http" && SCORE=$((SCORE+30))
        echo "$SERVICE_INFO" | grep -qi "node .*tmp" && SCORE=$((SCORE+30))

        if [ "$SCORE" -gt 30 ]; then
            warn "Suspicious service: $svc"

            local escaped=$(json_escape "$svc")
            local entry="{\"service\": $escaped, \"score\": $SCORE}"

            if [ "$first" -eq 1 ]; then
                echo "$entry" > /tmp/suspicious_services.json
                first=0
            else
                echo ", $entry" >> /tmp/suspicious_services.json
            fi
        fi
    done

    if [ -f /tmp/suspicious_services.json ]; then
        SUSPICIOUS_SERVICES_JSON="[$(cat /tmp/suspicious_services.json)]"
    else
        SUSPICIOUS_SERVICES_JSON="[]"
    fi
}

detect_suspicious_processes() {
    step "Suspicious Processes"

    ps aux --sort=-%cpu | head -n 30 | while read line; do

        echo "$line" | grep -Ei \
        "xmrig|kinsing|masscan|zmap|cryptominer|python -m http.server|nc -l|socat" \
        >/dev/null && warn "Suspicious process: $line"
    done
}

detect_permissions() {
    step "Permissions"
    for p in "${SCAN_PATHS[@]}"; do
        [ -d "$p" ] || continue
        timeout 20s find "$p" -maxdepth 4 -type d -name "storage" 2>/dev/null | while read store_dir; do
            OWNER=$(stat -c '%U' "$store_dir" 2>/dev/null || true)
            if [ -n "$OWNER" ] && [ "$OWNER" != "www-data" ] && [ "$OWNER" != "nobody" ]; then
                warn "storage owned by $OWNER ($store_dir)"
            else
                ok "storage permission OK ($store_dir)"
            fi
        done || true
    done
}

detect_cron() {
    step "Cron"
    crontab -l 2>/dev/null | grep artisan >/dev/null && ok "Scheduler configured" || warn "Scheduler missing"
}

detect_suspicious_crons() {

    step "Suspicious Cron Jobs"

    rm -f /tmp/suspicious_crons.json

    local first=1
    local TOTAL_CRON_THREATS=0

    scan_cron_content() {

        local content="$1"
        local owner="$2"
        local source="$3"

        echo "$content" | grep -Ev '^\s*#|^\s*$' | while read -r line; do

            local SCORE=0
            local REASONS=()

            echo "$line" | grep -Eiq "curl .*\\|.*bash" && {
                SCORE=$((SCORE+50))
                REASONS+=("curl|bash")
            }

            echo "$line" | grep -Eiq "wget .*\\|.*sh" && {
                SCORE=$((SCORE+50))
                REASONS+=("wget|sh")
            }

            echo "$line" | grep -Eiq "base64" && {
                SCORE=$((SCORE+40))
                REASONS+=("base64")
            }

            echo "$line" | grep -Eiq "/tmp/" && {
                SCORE=$((SCORE+30))
                REASONS+=("/tmp")
            }

            echo "$line" | grep -Eiq "nc |netcat|socat" && {
                SCORE=$((SCORE+50))
                REASONS+=("reverse-shell")
            }

            echo "$line" | grep -Eiq "python .*http" && {
                SCORE=$((SCORE+30))
                REASONS+=("python-http")
            }

            echo "$line" | grep -Eiq "bash -c|sh -c" && {
                SCORE=$((SCORE+25))
                REASONS+=("shell-exec")
            }

            echo "$line" | grep -Eiq "xmrig|minerd|kinsing" && {
                SCORE=$((SCORE+80))
                REASONS+=("crypto-miner")
            }

            echo "$line" | grep -Eiq "php .*tmp" && {
                SCORE=$((SCORE+40))
                REASONS+=("php-tmp")
            }

            echo "$line" | grep -Eiq "curl .*http|wget .*http" && {
                SCORE=$((SCORE+25))
                REASONS+=("remote-download")
            }

            if echo "$line" | grep -q "artisan schedule:run"; then

                APP_PATH=$(echo "$line" | grep -oP '/home/[^ ]+' | head -1 | sed 's|/artisan||')

                if [ -n "$APP_PATH" ]; then

                    for sched in \
                        "$APP_PATH/app/Console/Kernel.php" \
                        "$APP_PATH/routes/console.php"
                    do

                        [ -f "$sched" ] || continue

                        MATCHES=$(grep -Eni \
                        "shell_exec|exec\(|system\(|passthru|proc_open|popen|base64_decode|eval\(" \
                        "$sched" 2>/dev/null || true)

                        if [ -n "$MATCHES" ]; then
                            SCORE=$((SCORE+80))
                            REASONS+=("laravel-scheduler-shell")

                            warn "Dangerous Laravel scheduler detected"
                            echo "$MATCHES"
                        fi
                    done
                fi
            fi

            if [ "$SCORE" -gt 20 ]; then

                TOTAL_CRON_THREATS=$((TOTAL_CRON_THREATS+1))

                warn "Suspicious cron detected ($owner)"

                echo "--------------------------------------------"
                echo "User    : $owner"
                echo "Source  : $source"
                echo "Score   : $SCORE"
                echo "Reasons : ${REASONS[*]}"
                echo "Command : $line"
                echo "--------------------------------------------"

                local escaped_owner=$(json_escape "$owner")
                local escaped_source=$(json_escape "$source")
                local escaped_line=$(json_escape "$line")

                local entry=$(cat <<EOF
{
  "user": $escaped_owner,
  "source": $escaped_source,
  "score": $SCORE,
  "reasons": $(json_escape "${REASONS[*]}"),
  "command": $escaped_line
}
EOF
)

                if [ "$first" -eq 1 ]; then
                    echo "$entry" > /tmp/suspicious_crons.json
                    first=0
                else
                    echo ", $entry" >> /tmp/suspicious_crons.json
                fi
            fi
        done
    }

    #
    # /etc/crontab
    #

    [ -f /etc/crontab ] && \
    scan_cron_content \
    "$(cat /etc/crontab 2>/dev/null)" \
    "root" \
    "/etc/crontab"

    #
    # /etc/cron.d/*
    #

    for f in /etc/cron.d/*; do

        [ -f "$f" ] || continue

        scan_cron_content \
        "$(cat "$f" 2>/dev/null)" \
        "system" \
        "$f"
    done

    #
    # REAL HOSTING USERS
    #

    awk -F: '
    $3 >= 1000 &&
    $7 !~ /(nologin|false)/ {
        print $1
    }' /etc/passwd | while read -r user; do

        USER_CRON=$(crontab -u "$user" -l 2>/dev/null || true)

        [ -z "$USER_CRON" ] && continue

        info "Checking cron for user: $user"

        scan_cron_content \
        "$USER_CRON" \
        "$user" \
        "crontab -u $user"
    done

    #
    # ROOT CRON
    #

    ROOT_CRON=$(crontab -u root -l 2>/dev/null || true)

    [ -n "$ROOT_CRON" ] && \
    scan_cron_content \
    "$ROOT_CRON" \
    "root" \
    "crontab -u root"

    #
    # Final JSON
    #

    if [ -f /tmp/suspicious_crons.json ]; then
        SUSPICIOUS_CRONS_JSON="[$(cat /tmp/suspicious_crons.json)]"
    else
        SUSPICIOUS_CRONS_JSON="[]"
    fi

    if [ "$TOTAL_CRON_THREATS" -eq 0 ]; then
        ok "No suspicious cron jobs detected"
    else
        warn "$TOTAL_CRON_THREATS suspicious cron jobs detected"
    fi
}

detect_queue() {
    step "Queue Workers"
    if ps aux | grep -v grep | grep "queue:work" >/dev/null; then
        ok "Queue worker running"
    else
        warn "Queue worker NOT running"
    fi

    if command -v supervisorctl >/dev/null; then
        supervisorctl status 2>/dev/null | while read line; do
            info "$line"
        done || true
    fi
}

detect_ssl() {
    step "SSL"
    if [ -d /etc/letsencrypt/live ]; then
        for cert in /etc/letsencrypt/live/*; do
            [ -e "$cert" ] || continue
            info "Checking $cert"
            openssl x509 -enddate -noout -in "$cert/fullchain.pem" 2>/dev/null | while read line; do
                ok "$line"
            done || true
        done
    else
        warn "No SSL found in /etc/letsencrypt/live"
    fi
}


detect_seo_hijack() {

    step "SEO Spam Detection"

    local TMP_FILE="/tmp/seo_spam.ndjson"

    rm -f "$TMP_FILE"

    SEO_SPAM_JSON="[]"

    local SEO_PATTERN='(base64_decode\(|gzinflate\(|shell_exec\(|system\(|passthru\(|assert\()|(viagra|cialis|casino|porn|สล็อต|บาคาร่า)|(display[[:space:]]*:[[:space:]]*none.*href)|(document\.write\(unescape)|(atob\()'

    local MATCH_COUNT=0

    for p in "${SCAN_PATHS[@]}"; do

        [ -d "$p" ] || continue

        info "Scanning path: $p"

        while IFS= read -r -d '' file; do

            while IFS= read -r match_line; do

                MATCH_COUNT=$((MATCH_COUNT + 1))

                warn "SEO spam indicator found"

                echo "$match_line"

                FILE_PATH=$(echo "$match_line" | cut -d: -f1)
                LINE_NO=$(echo "$match_line" | cut -d: -f2)
                CONTENT=$(echo "$match_line" | cut -d: -f3- | head -c 300)

                cat >> "$TMP_FILE" <<EOF
{
  "file": $(json_escape "$FILE_PATH"),
  "line": $LINE_NO,
  "content": $(json_escape "$CONTENT")
}
EOF

                if [ "$MATCH_COUNT" -ge 50 ]; then
                    warn "SEO spam match limit reached (50)"
                    break 2
                fi

            done < <(
                grep -Ein "$SEO_PATTERN" "$file" 2>/dev/null || true
            )

        done < <(
            find "$p" \
                -type f \
                \( -name "*.php" -o -name "*.html" -o -name "*.js" \) \
                ! -path "*/vendor/*" \
                ! -path "*/node_modules/*" \
                ! -path "*/storage/*" \
                ! -path "*/public/build/*" \
                ! -path "*/bootstrap/cache/*" \
                -print0 2>/dev/null
        )

    done

    if [ -s "$TMP_FILE" ]; then

        SEO_SPAM_JSON="[$(
            paste -sd, "$TMP_FILE"
        )]"

        warn "$MATCH_COUNT SEO spam indicators detected"

    else

        SEO_SPAM_JSON="[]"

        ok "No SEO spam indicators found"

    fi
}

# -------------------------------
# ADVANCED CHECKS
# -------------------------------

detect_dns_cloudflare() {
    step "DNS / Cloudflare"
    for p in "${SCAN_PATHS[@]}"; do
        [ -d "$p" ] || continue
        timeout 20s find "$p" -maxdepth 4 -name ".env" 2>/dev/null | while read env_file; do
            DOMAIN=$(grep "^APP_URL=" "$env_file" 2>/dev/null | cut -d '=' -f2- | sed 's|https://||' | sed 's|http://||' | tr -d '"'\''\r' || true)
            if [ -n "$DOMAIN" ] && [ "$DOMAIN" != "localhost" ]; then
                RES=$(dig +short "$DOMAIN" 2>/dev/null | head -n1 || true)
                if curl -sI --max-time 5 "http://$DOMAIN" 2>/dev/null | grep -qi "cloudflare"; then
                    ok "Cloudflare detected ($DOMAIN)"
                else
                    info "Direct DNS: $RES ($DOMAIN)"
                fi
            fi
        done || true
    done
}

test_wildcard_routing() {
    step "Wildcard Routing"
    for p in "${SCAN_PATHS[@]}"; do
        [ -d "$p" ] || continue
        timeout 20s find "$p" -maxdepth 4 -name ".env" 2>/dev/null | while read env_file; do
            DOMAIN=$(grep "^APP_URL=" "$env_file" 2>/dev/null | cut -d '=' -f2- | sed 's|https://||' | sed 's|http://||' | tr -d '"'\''\r' || true)
            if [ -n "$DOMAIN" ] && [ "$DOMAIN" != "localhost" ]; then
                TEST_SUB="test.$DOMAIN"
                HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://$TEST_SUB" 2>/dev/null || true)
                if [ "$HTTP_CODE" == "200" ]; then
                    ok "Wildcard working ($TEST_SUB)"
                else
                    warn "Wildcard may not work ($TEST_SUB → $HTTP_CODE)"
                fi
            fi
        done || true
    done
}

check_disk_usage() {
    step "Disk Usage"
    rm -f /tmp/sys_disk.json
    local first=1

    # Only output rows where column 5 looks like a valid percentage (e.g. "47%")
    # This skips malformed WSL/Windows drive rows where columns shift
    df -h | grep -v "loop\|tmpfs\|udev\|overlay\|boot" \
        | awk 'NR>1 && $5 ~ /^[0-9]+%$/ {print $6 " " $5}' \
        | while read mount usage; do
            usage_num=$(echo "$usage" | tr -d '%')
            # Skip if usage_num is not a plain integer
            case "$usage_num" in
                ''|*[!0-9]*) continue ;;
            esac
            local escaped_mount=$(json_escape "$mount")
            local entry="{\"mount\": $escaped_mount, \"usage_percent\": $usage_num}"
            if [ "$first" -eq 1 ]; then
                echo "$entry" > /tmp/sys_disk.json
                first=0
            else
                echo ", $entry" >> /tmp/sys_disk.json
            fi
            info "Mount: $mount | Usage: $usage"
        done || true

    if [ -f /tmp/sys_disk.json ]; then
        SYS_DISK_JSON="[$(cat /tmp/sys_disk.json)]"
        rm -f /tmp/sys_disk.json
    else
        SYS_DISK_JSON="[]"
    fi
}

check_logs() {
    step "Logs"
    [ -f /var/log/nginx/error.log ] && tail -n 5 /var/log/nginx/error.log 2>/dev/null || true
    for p in "${SCAN_PATHS[@]}"; do
        [ -d "$p" ] || continue
        timeout 20s find "$p" -maxdepth 5 -name "laravel.log" 2>/dev/null | while read log_file; do
            info "Log: $log_file"
            tail -n 3 "$log_file" 2>/dev/null || true
        done || true
    done
}

detect_php_fpm_memory() {
    step "PHP-FPM Memory"
    ps aux | grep php-fpm | grep -v grep | awk '{sum+=$6} END {print "Total Memory KB:", sum}' | while read line; do
        info "$line"
    done || true
}

# -------------------------------
# SECURITY SCAN
# -------------------------------

run_heavy_security_scans() {
    step "Running Parallel Malware & Security Scans"
    
    MALWARE_FILE="/tmp/malware_found.txt"
    rm -f "$MALWARE_FILE"
    rm -f /tmp/malware_samples.json
    
    THREADS=$(nproc 2>/dev/null || echo 2)
    MALWARE_PATTERN="eval\(base64_decode|gzinflate|str_rot13|assert\(|shell_exec|system\("

    # Run parallel malware scan
    for p in "${SCAN_PATHS[@]}"; do
        [ -d "$p" ] || continue
        
        local DIR_HASH=$(stat -c %Y "$p" 2>/dev/null || echo 0)
        local PATH_HASH=$(echo -n "$p" | sha1sum | awk '{print $1}')
        local CACHE_KEY="infra:cache:scan:$PATH_HASH:$DIR_HASH"
        
        if command -v redis-cli >/dev/null && redis_cmd EXISTS "$CACHE_KEY" | grep -q "1"; then
            info "Cache hit: Skipping heavy scan for $p"
            continue
        fi

        info "Scanning path for malware: $p"
        timeout 60s find "$p" -type f -name "*.php" \
            ! -path "*/vendor/*" \
            ! -path "*/node_modules/*" \
            ! -path "*/storage/*" 2>/dev/null | xargs -P "$THREADS" grep -E -l "$MALWARE_PATTERN" >> "$MALWARE_FILE" 2>/dev/null || true
            
        if command -v redis-cli >/dev/null; then
            redis_cmd SET "$CACHE_KEY" 1 EX 3600 >/dev/null
        fi
    done
    
    if [ -s "$MALWARE_FILE" ]; then
        MALWARE_FOUND=1
        MALWARE_COUNT=$(wc -l < "$MALWARE_FILE" 2>/dev/null || echo 0)
        err "Possible malware detected ($MALWARE_COUNT files matched)"
        
        local first=1
        head -n 5 "$MALWARE_FILE" | while read f; do
            warn "Malware file: $f"
            local hash=$(sha1sum "$f" 2>/dev/null | awk '{print $1}' || echo "unknown")
            local escaped_f=$(json_escape "$f")
            local escaped_sig=$(json_escape "eval(base64_decode)")
            local entry="{\"file\": $escaped_f, \"signature\": $escaped_sig, \"hash\": \"sha1:$hash\"}"
            
            if [ "$first" -eq 1 ]; then
                echo "$entry" > /tmp/malware_samples.json
                first=0
            else
                echo ", $entry" >> /tmp/malware_samples.json
            fi
            
            if [ "$AUTO_FIX" -eq 1 ]; then
                quarantine_file "$f" && ok "Auto-Fixed: Quarantined $f"
            fi
        done || true
        
        if [ -f /tmp/malware_samples.json ]; then
            MALWARE_SAMPLES_JSON="[$(cat /tmp/malware_samples.json)]"
        fi
    else
        ok "No malware patterns found"
    fi
    
    # 777 permissions scan
    BAD_PERMS=0
    for p in "${SCAN_PATHS[@]}"; do
        [ -d "$p" ] || continue
        COUNT=$(timeout 30s find "$p" -type d -perm -777 2>/dev/null | wc -l)
        BAD_PERMS=$((BAD_PERMS+COUNT))
        if [ "$COUNT" -gt 0 ]; then
            timeout 30s find "$p" -type d -perm -777 2>/dev/null | head -n 5 | while read bad_dir; do
                err "777 directory: $bad_dir"
                if [ "$AUTO_FIX" -eq 1 ]; then
                    chmod 755 "$bad_dir"
                    ok "Auto-Fixed: chmod 755 $bad_dir"
                fi
            done || true
        fi
    done
    if [ "$BAD_PERMS" -eq 0 ]; then ok "No 777 permissions found"; fi
    
    # Exposed Backups scan
    rm -f /tmp/exposed_files.json
    BACKUPS_EXPOSED=0
    for p in "${SCAN_PATHS[@]}"; do
        [ -d "$p" ] || continue
        COUNT=$(timeout 30s find "$p" -type f \( -name "*.sql" -o -name "*.zip" -o -name "*.gz" \) 2>/dev/null | wc -l)
        BACKUPS_EXPOSED=$((BACKUPS_EXPOSED+COUNT))
        if [ "$COUNT" -gt 0 ]; then
            local first=1
            timeout 30s find "$p" -type f \( -name "*.sql" -o -name "*.zip" -o -name "*.gz" \) 2>/dev/null | head -n 5 | while read f; do
                warn "Exposed backup: $f"
                local escaped_f=$(json_escape "$f")
                if [ "$first" -eq 1 ]; then
                    echo "$escaped_f" > /tmp/exposed_files.json
                    first=0
                else
                    echo ", $escaped_f" >> /tmp/exposed_files.json
                fi
            done || true
        fi
    done
    if [ "$BACKUPS_EXPOSED" -eq 0 ]; then 
        ok "No exposed backups found"
    else
        if [ -f /tmp/exposed_files.json ]; then
            EXPOSED_FILES_JSON="[$(cat /tmp/exposed_files.json)]"
        fi
    fi
}

# -------------------------------
# ATTACK ANALYSIS
# -------------------------------

get_access_log() {
    LOGS=(
      "/usr/local/lsws/logs/access.log"
      "/var/log/nginx/access.log"
      "/var/log/apache2/access.log"
    )
    for l in "${LOGS[@]}"; do
        [ -f "$l" ] && echo "$l" && return
    done
    echo ""
}

detect_attackers() {
    step "Top Attackers"
    rm -f /tmp/top_ips.json
    LOG=$(get_access_log)
    if [ -n "$LOG" ]; then
        WHITELIST=("127.0.0.1" "YOUR_IP")

        local first=1
        awk '{print $1}' "$LOG" 2>/dev/null | sort | uniq -c | sort -nr | head -n 5 | while read count ip; do
            warn "$count requests from $ip"
            
            local escaped_ip=$(json_escape "$ip")
            local entry="{\"ip\": $escaped_ip, \"hits\": $count}"
            if [ "$first" -eq 1 ]; then
                echo "$entry" > /tmp/top_ips.json
                first=0
            else
                echo ", $entry" >> /tmp/top_ips.json
            fi
            
            if [ "$count" -gt 1000 ] && [ "$AUTO_FIX" -eq 1 ]; then
                # Check whitelist
                IS_WHITELISTED=0
                for w in "${WHITELIST[@]}"; do
                    if [ "$ip" == "$w" ]; then
                        IS_WHITELISTED=1
                        break
                    fi
                done
                
                if [ "$IS_WHITELISTED" -eq 0 ] && command -v ufw >/dev/null; then
                    ufw deny from "$ip" >/dev/null 2>&1 || true
                    ok "Auto-Fixed: Blocked IP $ip"
                else
                    info "Skipped blocking $ip (Whitelisted or ufw missing)"
                fi
            fi
        done || true
        
        if [ -f /tmp/top_ips.json ]; then
            ATTACKS_TOP_IPS_JSON="[$(cat /tmp/top_ips.json)]"
        fi
    else
        warn "No access log found"
    fi
}

detect_suspicious_requests() {
    step "Suspicious Requests"
    LOG=$(get_access_log)
    if [ -n "$LOG" ]; then
        PATTERN="phpunit|_ignition|eval|base64|shell|\.env"
        SUSPICIOUS_REQUESTS=$(grep -E -c "$PATTERN" "$LOG" 2>/dev/null || echo 0)
        
        if [ "$SUSPICIOUS_REQUESTS" -gt 0 ]; then
            err "Found $SUSPICIOUS_REQUESTS suspicious requests"
            grep -E "$PATTERN" "$LOG" 2>/dev/null | head -n 5 | while read line; do
                warn "$line"
            done || true
        else
            ok "No suspicious requests found"
        fi
    else
        warn "No access log found"
    fi
}

# -------------------------------
# PERFORMANCE
# -------------------------------

check_cpu() {
    step "CPU Usage"
    SYS_CPU_USAGE=$(top -bn1 | grep "Cpu(s)" | awk '{print ($2 + $4)}' 2>/dev/null || echo 0)
    local cpu_int=$(echo "$SYS_CPU_USAGE" | awk '{print int($1)}')
    if [ "$cpu_int" -gt 80 ]; then
        err "High CPU usage: $SYS_CPU_USAGE%"
    else
        ok "CPU OK: $SYS_CPU_USAGE%"
    fi
}

check_memory() {
    step "Memory Usage"
    SYS_MEM_USAGE=$(free | awk '/Mem/ {printf("%.2f"), $3/$2 * 100}' 2>/dev/null || echo 0)
    if awk "BEGIN {exit !($SYS_MEM_USAGE > 80)}"; then
        err "High memory usage: $SYS_MEM_USAGE%"
    else
        ok "Memory OK: $SYS_MEM_USAGE%"
    fi
}

# -------------------------------
# AUTO DISCOVER APPS
# -------------------------------

discover_apps() {
    step "Discovering Applications"
    for base in "${SCAN_PATHS[@]}"; do
        [ -d "$base" ] || continue
        timeout 20s find "$base" -maxdepth 4 -type f \( -name ".env" -o -name "composer.json" -o -name "package.json" -o -name "artisan" \) 2>/dev/null | while read file; do
            APP_DIR=$(dirname "$file")
            classify_app "$APP_DIR"
        done || true
    done
}

classify_app() {
    APP_PATH="$1"
    if [ -f "$APP_PATH/artisan" ]; then
        ok "Laravel app: $APP_PATH"
        [ -f "$APP_PATH/.env" ] && ok ".env exists" || err ".env missing"
        grep -q "APP_DEBUG=true" "$APP_PATH/.env" 2>/dev/null && warn "APP_DEBUG enabled" || true
    elif [ -f "$APP_PATH/composer.json" ]; then
        ok "PHP app: $APP_PATH"
    elif [ -f "$APP_PATH/package.json" ]; then
        ok "Node app: $APP_PATH"
    else
        info "Unknown app: $APP_PATH"
    fi
}

risk_score() {

    step "Risk Score"

    SCORE=0

    #
    # Malware
    #

    [ "${MALWARE_FOUND:-0}" -eq 1 ] && \
    SCORE=$((SCORE + 50))

    #
    # Dangerous permissions
    #

    [ "${BAD_PERMS:-0}" -gt 0 ] && \
    SCORE=$((SCORE + 20))

    #
    # Exposed backups
    #

    [ "${BACKUPS_EXPOSED:-0}" -gt 0 ] && \
    SCORE=$((SCORE + 20))

    #
    # Suspicious HTTP requests
    #

    [ "${SUSPICIOUS_REQUESTS:-0}" -gt 0 ] && \
    SCORE=$((SCORE + 15))

    #
    # Suspicious services
    #

    SVC_THREAT_COUNT=$(echo "${SUSPICIOUS_SERVICES_JSON:-[]}" \
        | grep -o '"service"' \
        | awk 'END{print NR+0}')

    if [ "$SVC_THREAT_COUNT" -gt 0 ]; then
        SCORE=$((SCORE + (SVC_THREAT_COUNT * 10)))
    fi

    #
    # Suspicious cron jobs
    #

    CRON_THREAT_COUNT=$(echo "${SUSPICIOUS_CRONS_JSON:-[]}" \
        | grep -o '"score"' \
        | awk 'END{print NR+0}')

    if [ "$CRON_THREAT_COUNT" -gt 0 ]; then
        SCORE=$((SCORE + (CRON_THREAT_COUNT * 15)))
    fi

    #
    # SEO spam
    #

    SEO_SPAM_COUNT=$(echo "${SEO_SPAM_JSON:-[]}" \
        | grep -o 'php\|html\|js' \
        | awk 'END{print NR+0}')

    if [ "$SEO_SPAM_COUNT" -gt 10 ]; then
        SCORE=$((SCORE + 40))
    elif [ "$SEO_SPAM_COUNT" -gt 0 ]; then
        SCORE=$((SCORE + 25))
    fi

    #
    # Clamp max score
    #

    if [ "$SCORE" -gt 100 ]; then
        SCORE=100
    fi

    #
    # Final severity
    #

    if [ "$SCORE" -ge 80 ]; then

        err "CRITICAL RISK ($SCORE)"

        emit_event "CRITICAL_RISK_DETECTED" "$SCORE"

    elif [ "$SCORE" -ge 50 ]; then

        err "HIGH RISK ($SCORE)"

        emit_event "HIGH_RISK_DETECTED" "$SCORE"

    elif [ "$SCORE" -ge 25 ]; then

        warn "MEDIUM RISK ($SCORE)"

    else

        ok "LOW RISK ($SCORE)"
    fi

    #
    # Console summary
    #

    info "Malware Count: ${MALWARE_COUNT:-0}"
    info "Cron Threats: ${CRON_THREAT_COUNT:-0}"
    info "Service Threats: ${SVC_THREAT_COUNT:-0}"
    info "SEO Spam Matches: ${SEO_SPAM_COUNT:-0}"
    info "Suspicious Requests: ${SUSPICIOUS_REQUESTS:-0}"
}

export_stack() {
    step "Exporting Stack"
    mkdir -p infra_dump
    cp -r /etc/nginx/sites-enabled infra_dump/nginx 2>/dev/null || true
    cp -r /etc/php infra_dump/php 2>/dev/null || true
    cp -r /etc/mysql infra_dump/mysql 2>/dev/null || true
    cp -r /usr/local/lsws/conf/vhosts infra_dump/lsws 2>/dev/null || true
    ok "Stack exported to infra_dump/"
}

generate_final_report() {

    local risk_level="low"

    if [ "$SCORE" -gt 70 ]; then
        risk_level="critical"
    elif [ "$SCORE" -gt 50 ]; then
        risk_level="high"
    elif [ "$SCORE" -gt 20 ]; then
        risk_level="medium"
    fi

    local auto_fix_bool="false"
    [ "${AUTO_FIX:-0}" -eq 1 ] && auto_fix_bool="true"

    local malware_bool="false"
    [ "${MALWARE_FOUND:-0}" -eq 1 ] && malware_bool="true"

    local started_at="${SCAN_STARTED_AT:-$(date +%s)}"
    local finished_at=$(date +%s)
    local duration=$((finished_at - started_at))

    # Ensure JSON vars always exist
    SUSPICIOUS_SERVICES_JSON=${SUSPICIOUS_SERVICES_JSON:-"[]"}
    SEO_SPAM_JSON=${SEO_SPAM_JSON:-"[]"}
    MALWARE_SAMPLES_JSON=${MALWARE_SAMPLES_JSON:-"[]"}
    EXPOSED_FILES_JSON=${EXPOSED_FILES_JSON:-"[]"}
    ATTACKS_TOP_IPS_JSON=${ATTACKS_TOP_IPS_JSON:-"[]"}
    QUARANTINED_FILES_JSON=${QUARANTINED_FILES_JSON:-"[]"}
    SYS_DISK_JSON=${SYS_DISK_JSON:-"[]"}
    DISCOVERED_APPS_JSON=${DISCOVERED_APPS_JSON:-"[]"}

    local json=$(cat <<INNER_EOF
{
  "version": "3.0.0",

  "scan": {
    "mode": $(json_escape "$RUN_MODE"),
    "started_at": $started_at,
    "finished_at": $finished_at,
    "duration_sec": $duration
  },

  "node": {
    "id": $(json_escape "$NODE_ID"),
    "hostname": $(json_escape "$NODE_ID"),
    "ip": $(json_escape "$NODE_IP"),
    "environment": $(json_escape "$NODE_ENV")
  },

  "system": {
    "os": $(json_escape "$SYS_OS"),
    "uptime_sec": ${SYS_UPTIME:-0},
    "cpu_usage_percent": ${SYS_CPU_USAGE:-0},
    "memory_usage_percent": ${SYS_MEM_USAGE:-0},
    "disk": $SYS_DISK_JSON
  },

  "services": {
    "webserver": {
      "type": $(json_escape "$SRV_WEB_TYPE"),
      "status": $(json_escape "$SRV_WEB_STATUS")
    },

    "php": {
      "version": $(json_escape "$SRV_PHP_VER"),
      "mode": $(json_escape "$SRV_PHP_MODE")
    },

    "mysql": {
      "type": $(json_escape "$SRV_DB_TYPE"),
      "version": $(json_escape "$SRV_DB_VER"),
      "status": $(json_escape "$SRV_DB_STATUS")
    },

    "postgresql": {
      "version": $(json_escape "$SRV_PG_VER"),
      "status": $(json_escape "$SRV_PG_STATUS")
    },

    "redis": {
      "version": $(json_escape "$SRV_REDIS_VER"),
      "status": $(json_escape "$SRV_REDIS_STATUS")
    },

    "service_threats": $SUSPICIOUS_SERVICES_JSON,
    "seo_spam": $SEO_SPAM_JSON
  },

  "security": {
      "risk_score": ${SCORE:-0},
      "risk_level": $(json_escape "$risk_level"),
    
      "cron_threats": $SUSPICIOUS_CRONS_JSON,
    
      "malware": {
        "found": $malware_bool,
        "count": ${MALWARE_COUNT:-0},
        "samples": $MALWARE_SAMPLES_JSON
      },
    
      "seo_hijack": {
        "matches": $SEO_SPAM_JSON
      },
    
      "permissions": {
        "world_writable_dirs": ${BAD_PERMS:-0}
      },
    
      "exposed_files": $EXPOSED_FILES_JSON
    },

  "attacks": {
    "top_ips": $ATTACKS_TOP_IPS_JSON,
    "suspicious_requests": ${SUSPICIOUS_REQUESTS:-0}
  },

  "actions": {
    "quarantined_files": $QUARANTINED_FILES_JSON,
    "auto_fix_applied": $auto_fix_bool
  },

  "applications": {
    "discovered": $DISCOVERED_APPS_JSON
  }
}
INNER_EOF
)

    # Validate JSON before output/storage
    if echo "$json" | python3 -m json.tool >/dev/null 2>&1; then

        if [ "$JSON_MODE" -eq 1 ]; then
            echo "$json" | python3 -m json.tool
        else
            step "Final Summary"

            info "Risk Level: $risk_level"
            info "Risk Score: ${SCORE:-0}"
            info "Malware Found: ${MALWARE_FOUND:-0}"
            info "SEO Spam Matches: $(echo "$SEO_SPAM_JSON" | grep -o '{' | awk 'END{print NR+0}')"
            info "Suspicious Services: $(echo "$SUSPICIOUS_SERVICES_JSON" | grep -o '{' | awk 'END{print NR+0}')"
            info "Suspicious Requests: ${SUSPICIOUS_REQUESTS:-0}"
            info "Bad Permissions: ${BAD_PERMS:-0}"
            info "Scan Duration: ${duration}s"
        fi

        # Save clean JSON to Redis
        redis_cmd SET "infra:report:$NODE_ID" "$json" EX 300 >/dev/null

    else
        err "Generated report JSON is invalid"
        return 1
    fi
}


run_all() {

    check_dependencies
    heartbeat

    # -------------------------------------------------
    # Lightweight Modes
    # -------------------------------------------------

    if [ "$RUN_MODE" == "health" ]; then

        check_cpu
        check_memory

        if [ "$JSON_MODE" -eq 1 ]; then
            cat <<EOF
{
  "cpu_usage_percent": ${SYS_CPU_USAGE:-0},
  "memory_usage_percent": ${SYS_MEM_USAGE:-0},
  "uptime_sec": ${SYS_UPTIME:-0}
}
EOF
        fi

        exit 0
    fi

    if [ "$RUN_MODE" == "disk" ]; then

        check_disk_usage

        if [ "$JSON_MODE" -eq 1 ]; then
            cat <<EOF
{
  "disk": ${SYS_DISK_JSON:-[]}
}
EOF
        fi

        exit 0
    fi

    if [ "$RUN_MODE" == "network" ]; then

        detect_dns_cloudflare
        test_wildcard_routing

        if [ "$JSON_MODE" -eq 1 ]; then
            cat <<EOF
{
  "status": "network_checks_completed"
}
EOF
        fi

        exit 0
    fi

    # -------------------------------------------------
    # Core Infrastructure Detection
    # -------------------------------------------------

    detect_web_server
    detect_php
    detect_mysql
    detect_postgres
    detect_redis_server

    detect_vhost
    detect_env
    detect_services
    detect_permissions
    detect_cron
    detect_queue
    detect_ssl

    # -------------------------------------------------
    # Network / DNS Checks
    # -------------------------------------------------

    detect_dns_cloudflare
    test_wildcard_routing

    # -------------------------------------------------
    # Performance Checks
    # -------------------------------------------------

    check_cpu
    check_memory
    check_disk_usage
    check_logs
    detect_php_fpm_memory

    # -------------------------------------------------
    # Security Scans
    # -------------------------------------------------

    run_heavy_security_scans

    detect_attackers
    detect_suspicious_requests

    detect_suspicious_services
    detect_suspicious_crons
    detect_suspicious_processes
    detect_seo_hijack

    # -------------------------------------------------
    # Application Discovery
    # -------------------------------------------------

    discover_apps

    # -------------------------------------------------
    # Final Risk Calculation
    # -------------------------------------------------

    risk_score

    # -------------------------------------------------
    # Export Config Snapshots
    # -------------------------------------------------

    export_stack

    # -------------------------------------------------
    # Generate Final JSON Report
    # -------------------------------------------------

    generate_final_report

    # -------------------------------------------------
    # Optional Webhook Notifications
    # -------------------------------------------------

    if [ -n "${WEBHOOK_URL:-}" ]; then

        step "Sending Webhook Report"

        MSG="🛡️ Infra Agent v$VERSION Scan Complete | Risk: $SCORE | Malware: $MALWARE_FOUND"

        send_notification "$MSG"

        ok "Webhook sent successfully"
    fi
}


cleanup() {
    rm -f /tmp/malware_found.txt
    rm -f /tmp/top_ips.json
    rm -f /tmp/exposed_files.json
}

trap cleanup EXIT

main() {
    run_all
}

main "$@"
