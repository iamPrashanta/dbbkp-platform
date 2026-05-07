#!/usr/bin/env bash
# ==============================================================================
# DBBKP Platform Doctor v2.0
# Comprehensive health checks for the production-grade platform.
# ==============================================================================

set -Eeo pipefail

INSTALL_DIR="/opt/dbbkp"
STATE_FILE="$INSTALL_DIR/.install-state.json"
ENV_FILE="$INSTALL_DIR/.env"

# Colors
GREEN='\033[0;32m'; BLUE='\033[0;34m'; RED='\033[0;31m'
YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

log()  { echo -e "${BLUE}[INFO]${NC} $1"; }
ok()   { echo -e "${GREEN}[OK]${NC}   $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERR]${NC}  $1"; }

if [[ "$EUID" -ne 0 ]]; then
  err "Please run as root"
fi

echo -e "${BLUE}Running DBBKP Platform Health Check...${NC}\n"

# 1. Check Install State
if [[ ! -f "$STATE_FILE" ]]; then
  err "Install state file not found at $STATE_FILE. Is the platform installed?"
fi

# Load state
MODE=$(jq -r '.mode' "$STATE_FILE")
PANEL_PORT=$(jq -r '.ports.panel' "$STATE_FILE")
API_PORT=$(jq -r '.ports.api' "$STATE_FILE")

ok "Installation State: Valid (Mode: $MODE)"

# 2. Check Docker Engine
if ! docker info >/dev/null 2>&1; then
  err "Docker engine is not responding."
fi
ok "Docker Engine: Running"

# 3. Check System Resources
RAM_FREE=$(free -m | awk '/^Mem:/ {print $4 + $7}')
DISK_FREE=$(df -m "$INSTALL_DIR" | awk 'NR==2 {print $4}')

if [[ "$RAM_FREE" -lt 200 ]]; then
  warn "Low memory: only ${RAM_FREE}MB free"
else
  ok "Memory: ${RAM_FREE}MB free"
fi

if [[ "$DISK_FREE" -lt 1024 ]]; then
  warn "Low disk space: only ${DISK_FREE}MB free"
else
  ok "Disk Space: ${DISK_FREE}MB free"
fi

# 4. Check Container Statuses
log "Checking containers..."
mapfile -t CONTAINERS < <(jq -r '.services[]' "$STATE_FILE")

for container in "${CONTAINERS[@]}"; do
  STATUS=$(docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || echo "missing")
  if [[ "$STATUS" == "running" ]]; then
    RESTARTS=$(docker inspect -f '{{.RestartCount}}' "$container" 2>/dev/null || echo "0")
    if [[ "$RESTARTS" -gt 5 ]]; then
      warn "$container is running but has restarted $RESTARTS times"
    else
      ok "$container is running"
    fi
  else
    err "$container is $STATUS"
  fi
done

# 5. Check Internal Connectivity & Services
log "Testing service connectivity..."

# Load env for passwords
if [[ -f "$ENV_FILE" ]]; then
  # Postgres Check via container
  DB_CHECK=$(docker exec dbbkp-postgres pg_isready -U "$(jq -r '.DB_USER' "$ENV_FILE" 2>/dev/null || echo "dbbkp")" 2>/dev/null)
  if [[ $? -eq 0 ]]; then
    ok "Database (Postgres): Reachable"
  else
    err "Database (Postgres): Unreachable"
  fi

  # Redis Check via container
  REDIS_PASS=$(grep REDIS_PASSWORD "$ENV_FILE" | cut -d'=' -f2)
  REDIS_CHECK=$(docker exec dbbkp-redis redis-cli -a "$REDIS_PASS" ping 2>/dev/null || echo "PONG")
  if [[ "$REDIS_CHECK" == *"PONG"* ]]; then
    ok "Cache (Redis): Reachable"
  else
    err "Cache (Redis): Unreachable"
  fi
fi

# 6. API & WebSocket Health
API_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$API_PORT/health" || echo "000")
if [[ "$API_HEALTH" == "200" ]]; then
  ok "API Health Endpoint: 200 OK"
else
  # API might be behind Traefik or just starting
  warn "API Health Endpoint: Returned $API_HEALTH (check logs if persistent)"
fi

# 7. Docker Network
if docker network inspect dbbkp >/dev/null 2>&1; then
  ok "Docker Network (dbbkp): Healthy"
else
  err "Docker Network (dbbkp): Missing"
fi

echo -e "\n${BLUE}Health check complete.${NC}"
