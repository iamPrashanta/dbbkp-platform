#!/bin/bash

set -euo pipefail

VERSION="1.0.0"
ROOT_PATH="/var/www/html"
JSON_MODE=0

print() { echo -e "$1"; }

ok() { print "\e[32m[+]\e[0m $1"; }
warn() { print "\e[33m[!]\e[0m $1"; }
err() { print "\e[31m[x]\e[0m $1"; }
info() { print "\e[34m[i]\e[0m $1"; }
step() { print "\e[36m[→]\e[0m $1"; }

# -------------------------------
# CORE DETECTIONS
# -------------------------------

detect_web_server() {
    step "Web Server"
    if systemctl is-active --quiet nginx; then
        ok "Nginx running"
    elif systemctl is-active --quiet apache2; then
        ok "Apache running"
    else
        warn "No web server detected"
    fi
}

detect_php() {
    step "PHP"

    PHP_VERSION=$(php -r "echo PHP_VERSION;")
    ok "PHP CLI: $PHP_VERSION"

    ls /run/php/ 2>/dev/null | grep fpm || warn "No PHP-FPM sockets found"

    if [[ "$PHP_VERSION" == 8.4* ]]; then
        warn "PHP 8.4 detected (may break Laravel deps)"
    fi

    php -m | grep curl >/dev/null || warn "Missing ext-curl"
    php -m | grep mbstring >/dev/null || warn "Missing ext-mbstring"
}

detect_mysql() {
    step "MySQL"

    if command -v mysql >/dev/null; then
        ok "$(mysql -V)"
    else
        warn "MySQL not installed"
    fi
}

detect_vhost() {
    step "Virtual Hosts"

    for f in /etc/nginx/sites-enabled/* 2>/dev/null; do
        info "Checking $f"

        grep -q "\*" "$f" && ok "Wildcard configured"
        grep -q "public;" "$f" && ok "Laravel root OK"
    done
}

detect_env() {
    step ".env Check"

    if [ -f "$ROOT_PATH/.env" ]; then
        ok ".env found"

        DB_HOST=$(grep DB_HOST "$ROOT_PATH/.env" | cut -d '=' -f2)
        DB_USER=$(grep DB_USERNAME "$ROOT_PATH/.env" | cut -d '=' -f2)
        DB_PASS=$(grep DB_PASSWORD "$ROOT_PATH/.env" | cut -d '=' -f2)
        DB_NAME=$(grep DB_DATABASE "$ROOT_PATH/.env" | cut -d '=' -f2)

        info "DB: $DB_NAME@$DB_HOST"

        # DB Connection Test
        if mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" -e "USE $DB_NAME" >/dev/null 2>&1; then
            ok "DB connection successful"
        else
            err "DB connection failed"
        fi
    else
        err ".env missing"
    fi
}

detect_services() {
    step "Installed Services"
    dpkg -l | grep -E 'nginx|mysql|php' | awk '{print $2}' | while read svc; do
        info "$svc"
    done
}

detect_permissions() {
    step "Permissions"

    if [ -d "$ROOT_PATH/storage" ]; then
        OWNER=$(stat -c '%U' "$ROOT_PATH/storage")

        if [ "$OWNER" != "www-data" ]; then
            warn "storage owned by $OWNER"
        else
            ok "storage permission OK"
        fi
    fi
}

detect_cron() {
    step "Cron"

    crontab -l 2>/dev/null | grep artisan && ok "Scheduler configured" || warn "Scheduler missing"
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
        done
    fi
}

detect_ssl() {
    step "SSL"

    if [ -d /etc/letsencrypt/live ]; then
        for cert in /etc/letsencrypt/live/*; do
            info "Checking $cert"

            openssl x509 -enddate -noout -in "$cert/fullchain.pem" 2>/dev/null | while read line; do
                ok "$line"
            done
        done
    else
        warn "No SSL found"
    fi
}

# -------------------------------
# ADVANCED CHECKS
# -------------------------------

detect_dns_cloudflare() {
    step "DNS / Cloudflare"

    DOMAIN=$(grep APP_URL "$ROOT_PATH/.env" | cut -d '=' -f2 | sed 's|https://||')

    if [ -z "$DOMAIN" ]; then
        warn "APP_URL not found"
        return
    fi

    RES=$(dig +short "$DOMAIN" | head -n1)

    if curl -sI "http://$DOMAIN" | grep -qi "cloudflare"; then
        ok "Cloudflare detected"
    else
        info "Direct DNS: $RES"
    fi
}

test_wildcard_routing() {
    step "Wildcard Routing"

    DOMAIN=$(grep APP_URL "$ROOT_PATH/.env" | cut -d '=' -f2 | sed 's|https://||')

    TEST_SUB="test.$DOMAIN"

    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://$TEST_SUB")

    if [ "$HTTP_CODE" == "200" ]; then
        ok "Wildcard working ($TEST_SUB)"
    else
        warn "Wildcard may not work ($TEST_SUB → $HTTP_CODE)"
    fi
}

check_disk_usage() {
    step "Disk Usage"

    df -h | while read line; do
        info "$line"
    done
}

check_logs() {
    step "Logs"

    tail -n 5 /var/log/nginx/error.log 2>/dev/null || true
    tail -n 5 "$ROOT_PATH/storage/logs/laravel.log" 2>/dev/null || true
}

detect_php_fpm_memory() {
    step "PHP-FPM Memory"

    ps aux | grep php-fpm | grep -v grep | awk '{sum+=$6} END {print "Total Memory KB:", sum}' | while read line; do
        info "$line"
    done
}

# -------------------------------
# EXPORT STACK
# -------------------------------

export_stack() {
    step "Exporting Stack"

    mkdir -p infra_dump

    cp -r /etc/nginx/sites-enabled infra_dump/nginx 2>/dev/null || true
    cp -r /etc/php infra_dump/php 2>/dev/null || true
    cp -r /etc/mysql infra_dump/mysql 2>/dev/null || true

    ok "Stack exported to infra_dump/"
}

# -------------------------------
# RUN ALL
# -------------------------------

run_all() {
    detect_web_server
    detect_php
    detect_mysql
    detect_vhost
    detect_env
    detect_services
    detect_permissions
    detect_cron
    detect_queue
    detect_ssl

    detect_dns_cloudflare
    test_wildcard_routing
    check_disk_usage
    check_logs
    detect_php_fpm_memory

    export_stack
}

# -------------------------------
# ENTRY
# -------------------------------

case "${1:-scan}" in
    scan) run_all ;;
    version) echo "infra-agent v$VERSION" ;;
    *) echo "Usage: $0 [scan|version]" ;;
esac
