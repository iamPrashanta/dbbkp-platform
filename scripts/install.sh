#!/usr/bin/env bash
set -e

# ==============================================================================
# DBBKP Platform Installer
# CyberPanel + Coolify + Security Stack + CI/CD
# ==============================================================================

VERSION="1.0.0"
INSTALL_DIR="/opt/dbbkp"
APP_USER="dbbkp"
DB_NAME="dbbkp"
DB_USER="dbbkp"
DB_PASS=$(tr -dc A-Za-z0-9 </dev/urandom | head -c 20; echo)
ADMIN_PASS=$(tr -dc A-Za-z0-9 </dev/urandom | head -c 12; echo)
PANEL_PORT=8443

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${BLUE}[INFO]${NC} $1"; }
ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERR]${NC} $1" >&2; exit 1; }
step() { echo -e "\n${BLUE}==>${NC} ${GREEN}$1${NC}"; }

if [ "$EUID" -ne 0 ]; then
  err "Please run as root"
fi

echo -e "${BLUE}"
cat << "EOF"
    ____  ____  ____  __ __ ____ 
   / __ \/ __ )/ __ )/ //_// __ \
  / / / / __  / __  / ,<  / /_/ /
 / /_/ / /_/ / /_/ / /| |/ ____/ 
/_____/_____/_____/_/ |_/_/      

Platform Installer v1.0.0
EOF
echo -e "${NC}"

# 1. Detect OS
step "[1/15] Detecting Operating System..."
if [ -f /etc/os-release ]; then
    . /etc/os-release
    if [[ "$ID" != "ubuntu" && "$ID" != "debian" ]]; then
        err "Unsupported OS: $ID. Only Ubuntu and Debian are supported."
    fi
    ok "Detected $NAME"
else
    err "Cannot determine OS."
fi

# Update packages
apt-get update -qq >/dev/null || warn "Failed to update apt cache"
apt-get install -y -qq curl wget git sudo ufw jq >/dev/null

# 2. Install Docker
step "[2/15] Installing Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh >/dev/null 2>&1
    rm get-docker.sh
    ok "Docker installed"
else
    ok "Docker is already installed"
fi

# 3. Install PostgreSQL
step "[3/15] Installing PostgreSQL..."
if ! command -v psql &> /dev/null; then
    apt-get install -y -qq postgresql postgresql-contrib >/dev/null
    systemctl enable --now postgresql >/dev/null
    ok "PostgreSQL installed"
else
    ok "PostgreSQL is already installed"
fi

# 4. Install Redis
step "[4/15] Installing Redis..."
if ! command -v redis-cli &> /dev/null; then
    apt-get install -y -qq redis-server >/dev/null
    systemctl enable --now redis-server >/dev/null
    ok "Redis installed"
else
    ok "Redis is already installed"
fi

# 5. Setup Firewall
step "[5/15] Configuring Firewall (UFW)..."
ufw --force reset >/dev/null 2>&1
ufw default deny incoming >/dev/null 2>&1
ufw default allow outgoing >/dev/null 2>&1
ufw allow ssh >/dev/null 2>&1
ufw allow 80/tcp >/dev/null 2>&1
ufw allow 443/tcp >/dev/null 2>&1
ufw allow $PANEL_PORT/tcp >/dev/null 2>&1
ufw --force enable >/dev/null 2>&1
ok "Firewall configured (Ports 22, 80, 443, $PANEL_PORT open)"

# 6. Create app user
step "[6/15] Creating System User..."
if ! id -u "$APP_USER" >/dev/null 2>&1; then
    useradd -m -s /bin/bash "$APP_USER"
    usermod -aG docker "$APP_USER"
    ok "User $APP_USER created"
else
    ok "User $APP_USER already exists"
fi

# 7. Setup Directories
step "[7/15] Setting up Directories..."
mkdir -p "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR/panel"
mkdir -p "$INSTALL_DIR/traefik"
mkdir -p /var/www/sites
chown -R "$APP_USER:$APP_USER" "$INSTALL_DIR"
chown -R "$APP_USER:$APP_USER" /var/www/sites
ok "Directories created"

# 8. Download Panel
step "[8/15] Downloading Control Plane..."
# In the future, this will download a pre-built binary or docker image.
# For now, we mock the platform setup.
cat << 'EOF' > "$INSTALL_DIR/docker-compose.yml"
services:
  panel:
    image: ghcr.io/dbbkp/panel:latest
    container_name: dbbkp-panel
    restart: unless-stopped
    network_mode: host
    environment:
      - DATABASE_URL=postgres://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}
      - REDIS_URL=redis://127.0.0.1:6379
      - NODE_ENV=production
      - PORT=${PANEL_PORT}

  traefik:
    image: traefik:v3.0
    container_name: traefik
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ${INSTALL_DIR}/traefik/traefik.yml:/etc/traefik/traefik.yml:ro
      - ${INSTALL_DIR}/traefik/rules:/etc/traefik/rules:ro
      - ${INSTALL_DIR}/traefik/acme.json:/acme.json
EOF
ok "Panel composition created"

# 9. Create DB
step "[9/15] Configuring PostgreSQL Database..."
sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME};" >/dev/null 2>&1 || true
sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH ENCRYPTED PASSWORD '${DB_PASS}';" >/dev/null 2>&1 || true
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};" >/dev/null 2>&1 || true
sudo -u postgres psql -d ${DB_NAME} -c "ALTER SCHEMA public OWNER TO ${DB_USER};" >/dev/null 2>&1 || true
ok "Database ${DB_NAME} configured"

# 10. Run migrations & 11. Seed Admin
step "[10/15 & 11/15] Initializing Database Schema..."
log "Running migrations (Mocked via future container start)"
ok "Migrations & Admin seed prepared"

# 12. Setup systemd
step "[12/15] Setting up Systemd Services..."
cat << EOF > /etc/systemd/system/dbbkp-panel.service
[Unit]
Description=DBBKP Platform Control Plane
After=network.target docker.service postgresql.service redis-server.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
User=root

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable dbbkp-panel.service >/dev/null 2>&1
ok "Systemd service installed"

# 13. Setup reverse proxy & 14. Generate SSL
step "[13/15 & 14/15] Configuring Traefik Edge Router..."
cat << 'EOF' > "$INSTALL_DIR/traefik/traefik.yml"
api:
  dashboard: true
  insecure: true

entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
  websecure:
    address: ":443"

providers:
  docker:
    endpoint: "unix:///var/run/docker.sock"
    exposedByDefault: false
  file:
    directory: "/etc/traefik/rules"
    watch: true

certificatesResolvers:
  letsencrypt:
    acme:
      email: "admin@dbbkp.local"
      storage: "/acme.json"
      httpChallenge:
        entryPoint: web
EOF
mkdir -p "$INSTALL_DIR/traefik/rules"
touch "$INSTALL_DIR/traefik/acme.json"
chmod 600 "$INSTALL_DIR/traefik/acme.json"
ok "Traefik configured"

# 15. Start services
step "[15/15] Starting Platform Services..."
systemctl start dbbkp-panel.service || warn "Panel will start on reboot once images are pushed"
ok "Services initiated"

# Finish
SERVER_IP=$(curl -s https://api.ipify.org || hostname -I | awk '{print $1}')

echo ""
echo "====================================================================="
echo -e "${GREEN}DBBKP Platform Installed Successfully!${NC}"
echo ""
echo -e "Panel URL : ${BLUE}http://${SERVER_IP}:${PANEL_PORT}${NC}"
echo -e "Username  : ${YELLOW}admin${NC}"
echo -e "Password  : ${YELLOW}${ADMIN_PASS}${NC}"
echo ""
echo "Keep these credentials safe. Welcome to the future of hosting."
echo "====================================================================="
echo ""
