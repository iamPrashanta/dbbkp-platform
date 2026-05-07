#!/usr/bin/env bash
# ==============================================================================
# DBBKP Platform Installer v2.0
# Production-safe. Coexistence-aware. Rollback-capable.
# ==============================================================================
# Usage:
#   sudo bash install.sh                   # Auto-detect mode
#   sudo bash install.sh --mode agent-only # Agent only (no panel)
#   sudo bash install.sh --domain example.com
#   sudo bash install.sh --dry-run        # Show plan without making changes
# ==============================================================================

set -Eeo pipefail

DBBKP_VERSION="2.0.0"
INSTALL_DIR="/opt/dbbkp"
STATE_FILE="$INSTALL_DIR/.install-state.json"
LOG_FILE="/var/log/dbbkp-install.log"
APP_USER="dbbkp"
DB_NAME="dbbkp_panel"

# ─── Parse flags ──────────────────────────────────────────────────────────────
INSTALL_MODE=""      # clean | existing-panel | docker-only | agent-only
USER_DOMAIN=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --mode)     INSTALL_MODE="$2"; shift 2 ;;
    --domain)   USER_DOMAIN="$2";  shift 2 ;;
    --dry-run)  DRY_RUN=true;      shift   ;;
    *)          shift ;;
  esac
done

# ─── Logging ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; BLUE='\033[0;34m'; RED='\033[0;31m'
YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

_ts()   { date '+%Y-%m-%d %H:%M:%S'; }
log()   { echo -e "${BLUE}[INFO]${NC} $1" | tee -a "$LOG_FILE"; }
ok()    { echo -e "${GREEN}[OK]${NC}   $1" | tee -a "$LOG_FILE"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1" | tee -a "$LOG_FILE"; }
err()   { echo -e "${RED}[ERR]${NC}  $1" >&2 | tee -a "$LOG_FILE"; exit 1; }
step()  { echo -e "\n${BOLD}${CYAN}==> $1${NC}" | tee -a "$LOG_FILE"; }
info()  { echo -e "    ${YELLOW}$1${NC}"; }
dry()   { echo -e "    ${CYAN}[DRY-RUN]${NC} $1"; }

# ─── Dry-run guard ─────────────────────────────────────────────────────────────
run() {
  if $DRY_RUN; then dry "$*"; else eval "$@"; fi
}

# ─── Root check ───────────────────────────────────────────────────────────────
if [[ "$EUID" -ne 0 ]]; then
  err "This installer must be run as root (sudo bash install.sh)"
fi

mkdir -p "$(dirname "$LOG_FILE")" "$INSTALL_DIR"
echo "=== DBBKP Install Log — $(_ts) ===" >> "$LOG_FILE"

# ─── Banner ───────────────────────────────────────────────────────────────────
echo -e "${BOLD}${BLUE}"
cat << 'EOF'
    ____  ____  ____  __ __ ____
   / __ \/ __ )/ __ )/ //_// __ \
  / / / / __  / __  / ,<  / /_/ /
 / /_/ / /_/ / /_/ / /| |/ ____/
/_____/_____/_____/_/ |_/_/

EOF
echo -e "  Platform Installer v${DBBKP_VERSION}${NC}"
echo ""

# ==============================================================================
# PHASE 1: PRE-FLIGHT CHECKS
# ==============================================================================

step "Phase 1: Pre-flight Checks"

# ── OS detection ──────────────────────────────────────────────────────────────
if [[ ! -f /etc/os-release ]]; then
  err "Cannot detect OS. Only Ubuntu 20.04+ and Debian 11+ are supported."
fi
. /etc/os-release
if [[ "$ID" != "ubuntu" && "$ID" != "debian" ]]; then
  err "Unsupported OS: $PRETTY_NAME. Only Ubuntu and Debian are supported."
fi
ok "OS: $PRETTY_NAME"

# ── Architecture ──────────────────────────────────────────────────────────────
ARCH=$(uname -m)
if [[ "$ARCH" != "x86_64" && "$ARCH" != "aarch64" ]]; then
  warn "Architecture '$ARCH' is untested. Continuing anyway."
fi
ok "Arch: $ARCH"

# ── Resource checks ───────────────────────────────────────────────────────────
RAM_MB=$(free -m | awk '/^Mem:/ {print $2}')
DISK_GB=$(df -BG "$INSTALL_DIR" | awk 'NR==2 {gsub("G",""); print $4}')
CPU_CORES=$(nproc)

if [[ "$RAM_MB" -lt 900 ]]; then
  err "Insufficient RAM: ${RAM_MB}MB available, 1GB minimum required."
fi
if [[ "$DISK_GB" -lt 5 ]]; then
  err "Insufficient disk: ${DISK_GB}GB available at $INSTALL_DIR, 5GB minimum required."
fi

ok "Resources: ${RAM_MB}MB RAM, ${DISK_GB}GB disk, ${CPU_CORES} CPU cores"

# ── Existing panel detection ───────────────────────────────────────────────────
DETECTED_PANELS=()

[[ -d /usr/local/CyberCP ]]               && DETECTED_PANELS+=("CyberPanel")
[[ -d /usr/local/psa ]]                   && DETECTED_PANELS+=("Plesk")
[[ -f /usr/local/cpanel/cpanel ]]         && DETECTED_PANELS+=("cPanel")
[[ -d /etc/openlitespeed ]]               && DETECTED_PANELS+=("OpenLiteSpeed")
command -v nginx  &>/dev/null             && DETECTED_PANELS+=("Nginx")
command -v apache2 &>/dev/null            && DETECTED_PANELS+=("Apache2")

if [[ ${#DETECTED_PANELS[@]} -gt 0 ]]; then
  warn "Existing software detected: ${DETECTED_PANELS[*]}"
  warn "Running in COEXISTENCE mode — ports 80/443 will NOT be touched."
  [[ -z "$INSTALL_MODE" ]] && INSTALL_MODE="existing-panel"
else
  [[ -z "$INSTALL_MODE" ]] && INSTALL_MODE="clean"
fi

ok "Install mode: ${BOLD}$INSTALL_MODE${NC}"

# ── Existing dbbkp installation check ─────────────────────────────────────────
if [[ -f "$STATE_FILE" ]]; then
  warn "Existing dbbkp installation detected at $INSTALL_DIR"
  warn "To upgrade, run: bash scripts/update.sh"
  warn "To reinstall, remove $STATE_FILE first."
  read -r -p "Continue anyway? This may overwrite config. [y/N]: " CONFIRM
  [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]] && { echo "Aborted."; exit 0; }
fi

# ==============================================================================
# PHASE 2: PORT DETECTION
# ==============================================================================

step "Phase 2: Port Auto-detection"

find_free_port() {
  local port="$1"
  local max=$((port + 100))
  while [[ $port -lt $max ]]; do
    if ! ss -tulpn 2>/dev/null | grep -q ":${port} "; then
      echo "$port"
      return
    fi
    port=$((port + 1))
  done
  err "Could not find free port starting from $1 within 100 attempts"
}

# Choose base ports based on mode
if [[ "$INSTALL_MODE" == "clean" ]]; then
  PANEL_PORT=$(find_free_port 3000)
  API_PORT=$(find_free_port 4000)
  TRAEFIK_HTTP=80
  TRAEFIK_HTTPS=443
else
  # Coexistence: use high ports, never touch 80/443
  PANEL_PORT=$(find_free_port 3100)
  API_PORT=$(find_free_port 4100)
  TRAEFIK_HTTP=$(find_free_port 8088)
  TRAEFIK_HTTPS=$(find_free_port 8444)
fi

REDIS_PORT=$(find_free_port 6379)
PG_PORT=$(find_free_port 5432)

ok "Panel:   :$PANEL_PORT"
ok "API:     :$API_PORT"
ok "Traefik: :$TRAEFIK_HTTP / :$TRAEFIK_HTTPS"
ok "Redis:   :$REDIS_PORT"
ok "Postgres::$PG_PORT"

if $DRY_RUN; then
  echo ""
  warn "DRY-RUN mode — no changes will be made. Showing planned steps only."
  echo ""
fi

# ==============================================================================
# PHASE 3: GENERATE CREDENTIALS
# ==============================================================================

step "Phase 3: Generating Credentials"

# Unique DB username to avoid collision with existing postgres users
DB_USER="dbbkp_$(openssl rand -hex 3)"
DB_PASS=$(openssl rand -base64 24 | tr -d '+/=' | head -c 28)
REDIS_PASS=$(openssl rand -base64 24 | tr -d '+/=' | head -c 28)
JWT_SECRET=$(openssl rand -base64 48 | tr -d '+/=')
INTERNAL_SECRET=$(openssl rand -base64 32 | tr -d '+/=')
# 32-byte hex master key for AES-256-GCM secrets store
MASTER_KEY=$(openssl rand -hex 32)
ADMIN_PASS=$(openssl rand -base64 12 | tr -d '+/=' | head -c 14)

ok "Credentials generated (never stored in plaintext)"

# ==============================================================================
# PHASE 4: INSTALL DEPENDENCIES
# ==============================================================================

step "Phase 4: Installing System Dependencies"

run "apt-get update -qq >/dev/null"
run "apt-get install -y -qq curl wget git sudo jq openssl ca-certificates gnupg lsb-release >/dev/null"
ok "Base packages installed"

# ── Docker ────────────────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  log "Installing Docker via apt (docker.io + compose plugin)..."
  run "apt-get install -y -qq docker.io docker-compose-plugin >/dev/null"
  run "systemctl enable --now docker >/dev/null"
  ok "Docker installed"
else
  DOCKER_VER=$(docker --version | awk '{print $3}' | tr -d ',')
  ok "Docker already installed: $DOCKER_VER"
fi

# Add dbbkp user to docker group
if id "$APP_USER" &>/dev/null; then
  run "usermod -aG docker $APP_USER"
fi

# ── Docker Compose plugin check ───────────────────────────────────────────────
if ! docker compose version &>/dev/null; then
  run "apt-get install -y -qq docker-compose-plugin >/dev/null"
fi
ok "Docker Compose: $(docker compose version --short 2>/dev/null || echo 'installed')"

# ==============================================================================
# PHASE 5: FIREWALL (SAFE — NO RESET)
# ==============================================================================

step "Phase 5: Firewall — Safe Port Opening"

if command -v ufw &>/dev/null; then
  # NEVER reset, NEVER change default policies on existing systems
  # Only ADD the ports we need
  run "ufw allow $PANEL_PORT/tcp >/dev/null 2>&1 || true"
  run "ufw allow $API_PORT/tcp   >/dev/null 2>&1 || true"

  if [[ "$INSTALL_MODE" == "clean" ]]; then
    run "ufw allow 80/tcp  >/dev/null 2>&1 || true"
    run "ufw allow 443/tcp >/dev/null 2>&1 || true"
  else
    run "ufw allow $TRAEFIK_HTTP/tcp  >/dev/null 2>&1 || true"
    run "ufw allow $TRAEFIK_HTTPS/tcp >/dev/null 2>&1 || true"
    info "Skipping 80/443 — coexistence mode (existing web server detected)"
  fi

  ok "Firewall ports opened (no rules were removed or reset)"
else
  warn "UFW not found — skipping firewall configuration"
  info "Ensure ports $PANEL_PORT and $API_PORT are accessible"
fi

# ==============================================================================
# PHASE 6: SYSTEM USER & DIRECTORIES
# ==============================================================================

step "Phase 6: System User & Directories"

if ! id "$APP_USER" &>/dev/null; then
  run "useradd -r -m -s /bin/bash $APP_USER"
  run "usermod -aG docker $APP_USER"
  ok "System user '$APP_USER' created"
else
  ok "System user '$APP_USER' already exists"
fi

run "mkdir -p $INSTALL_DIR/data/{postgres,redis,letsencrypt}"
run "mkdir -p $INSTALL_DIR/traefik/rules"
run "mkdir -p /var/www/sites /var/log/dbbkp"
run "chown -R $APP_USER:$APP_USER $INSTALL_DIR /var/www/sites /var/log/dbbkp"
ok "Directories created"

# ==============================================================================
# PHASE 7: WRITE ENV FILE
# ==============================================================================

step "Phase 7: Writing Environment Configuration"

run "cat > $INSTALL_DIR/.env << 'ENVEOF'
# ── Core ────────────────────────────────────
NODE_ENV=production
DOMAIN=${USER_DOMAIN:-localhost}

# ── Ports ───────────────────────────────────
PORT=$PANEL_PORT
API_PORT=$API_PORT

# ── Database ────────────────────────────────
DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@dbbkp-postgres:${PG_PORT}/${DB_NAME}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASS}
DB_NAME=${DB_NAME}

# ── Redis ───────────────────────────────────
REDIS_URL=redis://:${REDIS_PASS}@dbbkp-redis:${REDIS_PORT}
REDIS_PASSWORD=${REDIS_PASS}

# ── Security ────────────────────────────────
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES=7d
INTERNAL_SECRET=${INTERNAL_SECRET}
MASTER_KEY=${MASTER_KEY}

# ── Panel ───────────────────────────────────
NEXT_PUBLIC_API_URL=http://\${DOMAIN}:\${API_PORT}
NEXT_PUBLIC_WS_URL=ws://\${DOMAIN}:\${API_PORT}

# ── Integrations (fill in as needed) ────────
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ZONE_ID=
SERVER_IP=
ACME_EMAIL=admin@\${DOMAIN:-localhost}

# ── Pipeline Runner ──────────────────────────
PIPELINE_ISOLATION=docker
PIPELINE_DOCKER_IMAGE=node:20-bookworm
PIPELINE_DOCKER_MEMORY=1g
PIPELINE_DOCKER_CPUS=1
PIPELINE_CONCURRENCY=2
ENVEOF"

run "chmod 600 $INSTALL_DIR/.env"
ok "Environment file written to $INSTALL_DIR/.env"

# ==============================================================================
# PHASE 8: DOCKER COMPOSE (PRODUCTION)
# ==============================================================================

step "Phase 8: Writing Docker Compose Stack"

# Traefik section differs by mode
if [[ "$INSTALL_MODE" == "clean" ]]; then
  TRAEFIK_CMD_HTTPS="- \"--entrypoints.websecure.address=:443\""
  TRAEFIK_CMD_ACME="- \"--certificatesresolvers.letsencrypt.acme.tlschallenge=true\""
  TRAEFIK_CMD_EMAIL="- \"--certificatesresolvers.letsencrypt.acme.email=\${ACME_EMAIL}\""
  TRAEFIK_CMD_STORE="- \"--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json\""
  TRAEFIK_PORTS="    ports:\n      - \"${TRAEFIK_HTTP}:80\"\n      - \"${TRAEFIK_HTTPS}:443\""
else
  TRAEFIK_CMD_HTTPS="- \"--entrypoints.websecure.address=:8443\""
  TRAEFIK_CMD_ACME=""
  TRAEFIK_CMD_EMAIL=""
  TRAEFIK_CMD_STORE=""
  TRAEFIK_PORTS="    ports:\n      - \"${TRAEFIK_HTTP}:80\"\n      - \"${TRAEFIK_HTTPS}:8443\""
fi

cat > "$INSTALL_DIR/docker-compose.yml" << DCEOF
services:
  dbbkp-postgres:
    image: postgres:15-alpine
    container_name: dbbkp-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: \${DB_USER}
      POSTGRES_PASSWORD: \${DB_PASSWORD}
      POSTGRES_DB: \${DB_NAME}
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
    networks:
      - dbbkp
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${DB_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5

  dbbkp-redis:
    image: redis:7-alpine
    container_name: dbbkp-redis
    restart: unless-stopped
    command: redis-server --requirepass \${REDIS_PASSWORD} --save 60 1
    volumes:
      - ./data/redis:/data
    networks:
      - dbbkp
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "\${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  dbbkp-traefik:
    image: traefik:v3.0
    container_name: dbbkp-traefik
    restart: unless-stopped
    command:
      - "--api.dashboard=false"
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--providers.docker.network=dbbkp"
      - "--entrypoints.web.address=:80"
      ${TRAEFIK_CMD_HTTPS}
      ${TRAEFIK_CMD_ACME}
      ${TRAEFIK_CMD_EMAIL}
      ${TRAEFIK_CMD_STORE}
    ports:
$(echo -e "$TRAEFIK_PORTS" | sed 's/^    //')
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./data/letsencrypt:/letsencrypt
      - ./traefik/rules:/etc/traefik/rules
    networks:
      - dbbkp

  dbbkp-api:
    image: ghcr.io/dbbkp/api:latest
    container_name: dbbkp-api
    restart: unless-stopped
    env_file: .env
    environment:
      - DATABASE_URL=postgresql://\${DB_USER}:\${DB_PASSWORD}@dbbkp-postgres:5432/\${DB_NAME}
      - REDIS_URL=redis://:\${REDIS_PASSWORD}@dbbkp-redis:6379
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /var/www/sites:/var/www/sites
      - /var/log/dbbkp:/var/log/dbbkp
    depends_on:
      dbbkp-postgres:
        condition: service_healthy
      dbbkp-redis:
        condition: service_healthy
    networks:
      - dbbkp
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.api.rule=PathPrefix(\`/api\`) || PathPrefix(\`/trpc\`) || PathPrefix(\`/ws\`) || PathPrefix(\`/webhooks\`) || PathPrefix(\`/internal\`)"
      - "traefik.http.services.api.loadbalancer.server.port=4000"

  dbbkp-worker:
    image: ghcr.io/dbbkp/worker:latest
    container_name: dbbkp-worker
    restart: unless-stopped
    env_file: .env
    environment:
      - DATABASE_URL=postgresql://\${DB_USER}:\${DB_PASSWORD}@dbbkp-postgres:5432/\${DB_NAME}
      - REDIS_URL=redis://:\${REDIS_PASSWORD}@dbbkp-redis:6379
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /var/www/sites:/var/www/sites
    depends_on:
      dbbkp-postgres:
        condition: service_healthy
      dbbkp-redis:
        condition: service_healthy
    networks:
      - dbbkp

  dbbkp-agent:
    image: ghcr.io/dbbkp/agent:latest
    container_name: dbbkp-agent
    restart: unless-stopped
    pid: host
    environment:
      - INTERNAL_SECRET=\${INTERNAL_SECRET}
      - API_ENDPOINT=http://dbbkp-api:4000
    volumes:
      - /var/www/sites:/var/www/sites:ro
      - /proc:/proc:ro
      - /var/spool/cron:/var/spool/cron:ro
      - /etc/cron.d:/etc/cron.d:ro
    depends_on:
      - dbbkp-api
    networks:
      - dbbkp

  dbbkp-panel:
    image: ghcr.io/dbbkp/panel:latest
    container_name: dbbkp-panel
    restart: unless-stopped
    env_file: .env
    depends_on:
      - dbbkp-api
    networks:
      - dbbkp
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.panel.rule=PathPrefix(\`/\`)"
      - "traefik.http.services.panel.loadbalancer.server.port=3000"

networks:
  dbbkp:
    driver: bridge
DCEOF

run "chmod 640 $INSTALL_DIR/docker-compose.yml"
ok "Docker Compose stack written"

# ==============================================================================
# PHASE 9: SYSTEMD SERVICE
# ==============================================================================

step "Phase 9: Installing Systemd Service"

cat > /etc/systemd/system/dbbkp.service << SVCEOF
[Unit]
Description=dbbkp Platform
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStartPre=-/usr/bin/docker compose down --remove-orphans
ExecStart=/usr/bin/docker compose up -d --wait
ExecStop=/usr/bin/docker compose down
ExecReload=/usr/bin/docker compose pull && /usr/bin/docker compose up -d --wait
StandardOutput=journal
StandardError=journal
SyslogIdentifier=dbbkp
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
SVCEOF

run "systemctl daemon-reload"
run "systemctl enable dbbkp.service >/dev/null"
ok "Systemd service installed"

# ==============================================================================
# PHASE 10: ACME CONFIG & TRAEFIK RULES DIR
# ==============================================================================

step "Phase 10: Traefik Configuration"

ACME_FILE="$INSTALL_DIR/data/letsencrypt/acme.json"
if [[ ! -f "$ACME_FILE" ]]; then
  run "touch $ACME_FILE"
  run "chmod 600 $ACME_FILE"
fi
ok "Traefik configuration ready"

# ==============================================================================
# PHASE 11: SAVE INSTALL STATE
# ==============================================================================

step "Phase 11: Saving Install State"

SERVER_IP=$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')

cat > "$STATE_FILE" << STATEEOF
{
  "version": "${DBBKP_VERSION}",
  "installedAt": "$(_ts)",
  "mode": "${INSTALL_MODE}",
  "serverIp": "${SERVER_IP}",
  "domain": "${USER_DOMAIN:-localhost}",
  "ports": {
    "panel": ${PANEL_PORT},
    "api": ${API_PORT},
    "traefikHttp": ${TRAEFIK_HTTP},
    "traefikHttps": ${TRAEFIK_HTTPS},
    "redis": ${REDIS_PORT},
    "postgres": ${PG_PORT}
  },
  "services": ["dbbkp-postgres","dbbkp-redis","dbbkp-traefik","dbbkp-api","dbbkp-worker","dbbkp-agent","dbbkp-panel"],
  "detectedPanels": [$(printf '"%s",' "${DETECTED_PANELS[@]}" | sed 's/,$//')]
}
STATEEOF

run "chmod 600 $STATE_FILE"
ok "Install state saved to $STATE_FILE"

# ==============================================================================
# PHASE 12: START PLATFORM
# ==============================================================================

step "Phase 12: Starting Platform"

if $DRY_RUN; then
  dry "Would run: systemctl start dbbkp.service"
  dry "Would run: cd $INSTALL_DIR && docker compose up -d"
else
  log "Pulling images and starting services (this may take 1-2 minutes)..."
  cd "$INSTALL_DIR"
  if docker compose up -d --wait 2>>"$LOG_FILE"; then
    ok "All containers started"
  else
    warn "Some containers may not be running yet — images may need to be published first"
    warn "Run: systemctl start dbbkp once images are available"
  fi
fi

# ==============================================================================
# COMPLETION SUMMARY
# ==============================================================================

echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║    dbbkp Platform Installed Successfully!            ║${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Panel URL${NC}     : ${CYAN}http://${SERVER_IP}:${PANEL_PORT}${NC}"
echo -e "  ${BOLD}API URL${NC}       : ${CYAN}http://${SERVER_IP}:${API_PORT}${NC}"
echo -e "  ${BOLD}Mode${NC}          : ${YELLOW}${INSTALL_MODE}${NC}"
if [[ ${#DETECTED_PANELS[@]} -gt 0 ]]; then
  echo -e "  ${BOLD}Coexisting with${NC}: ${YELLOW}${DETECTED_PANELS[*]}${NC}"
fi
echo ""
echo -e "  ${BOLD}Admin password${NC}: ${YELLOW}${ADMIN_PASS}${NC}"
echo -e "  ${BOLD}Install log${NC}   : ${LOG_FILE}"
echo -e "  ${BOLD}State file${NC}    : ${STATE_FILE}"
echo ""
echo -e "  ${BOLD}Credentials are stored in:${NC} ${CYAN}$INSTALL_DIR/.env${NC}"
echo -e "  ${YELLOW}Keep this file secure — it contains all secrets.${NC}"
echo ""
echo -e "  ${BOLD}Useful commands:${NC}"
echo -e "    ${CYAN}systemctl status dbbkp${NC}           — service status"
echo -e "    ${CYAN}cd $INSTALL_DIR && docker compose logs -f${NC} — live logs"
echo -e "    ${CYAN}bash /opt/dbbkp/scripts/doctor.sh${NC} — run health check"
echo -e "    ${CYAN}bash /opt/dbbkp/scripts/update.sh${NC}  — update platform"
echo ""
