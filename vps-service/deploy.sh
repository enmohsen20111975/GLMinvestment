#!/bin/bash
# ============================================================
# دليل الاستثمار - Deployment Script
# ============================================================
# سكربت النشر على الخادم الإنتاجي
# Usage: ./deploy.sh [option]
# Options:
#   --docker    Deploy with Docker
#   --systemd   Deploy with systemd (recommended for VPS)
#   --update    Update existing deployment
# ============================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="egx-backend"
APP_DIR="/opt/egx-platform"
SERVICE_PORT=8010
REPO_URL="https://github.com/YOUR_USERNAME/egx-investment-platform.git"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN} دليل الاستثمار - Deployer${NC}"
echo -e "${GREEN}========================================${NC}"

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}Please run as root or with sudo${NC}"
    exit 1
fi

# Install system dependencies
install_dependencies() {
    echo -e "${YELLOW}Installing system dependencies...${NC}"
    apt-get update
    apt-get install -y \
        python3 \
        python3-pip \
        python3-venv \
        nginx \
        supervisor \
        git \
        curl \
        certbot \
        python3-certbot-nginx
}

# Clone or update repository
setup_repository() {
    echo -e "${YELLOW}Setting up repository...${NC}"
    
    if [ -d "$APP_DIR" ]; then
        echo -e "${YELLOW}Updating existing installation...${NC}"
        cd $APP_DIR
        git pull origin main
    else
        echo -e "${YELLOW}Cloning repository...${NC}"
        mkdir -p $APP_DIR
        git clone $REPO_URL $APP_DIR
        cd $APP_DIR
    fi
}

# Setup Python environment
setup_python() {
    echo -e "${YELLOW}Setting up Python environment...${NC}"
    
    cd $APP_DIR/vps-service
    
    # Create virtual environment
    python3 -m venv venv
    
    # Activate and install dependencies
    source venv/bin/activate
    pip install --upgrade pip
    pip install -r requirements.txt
    pip install gunicorn
    
    # Create necessary directories
    mkdir -p data logs live_signals
    
    # Set permissions
    chmod -R 755 $APP_DIR
    chmod -R 777 data logs live_signals
}

# Setup Supervisor (Process Manager)
setup_supervisor() {
    echo -e "${YELLOW}Setting up Supervisor...${NC}"
    
    cat > /etc/supervisor/conf.d/egx-backend.conf << 'EOF'
[program:egx-backend]
command=/opt/egx-platform/vps-service/venv/bin/gunicorn --bind 0.0.0.0:8010 --workers 4 --threads 2 --timeout 120 --keep-alive 5 main:app
directory=/opt/egx-platform/vps-service
user=www-data
autostart=true
autorestart=true
startsecs=10
stopwaitsecs=30
stdout_logfile=/opt/egx-platform/logs/gunicorn.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=3
stderr_logfile=/opt/egx-platform/logs/gunicorn-error.log
stderr_logfile_maxbytes=10MB
stderr_logfile_backups=3
environment=PORT="8010",TZ="Africa/Cairo"
EOF

    # Reload supervisor
    supervisorctl reread
    supervisorctl update
    supervisorctl restart egx-backend
}

# Setup Nginx (Reverse Proxy)
setup_nginx() {
    echo -e "${YELLOW}Setting up Nginx...${NC}"
    
    # Ask for domain
    read -p "Enter your domain (e.g., egx.example.com): " DOMAIN
    
    cat > /etc/nginx/sites-available/egx-backend << EOF
server {
    listen 80;
    server_name $DOMAIN;
    
    # Redirect HTTP to HTTPS
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name $DOMAIN;
    
    # SSL certificates (will be configured by certbot)
    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    
    # SSL settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    
    # Proxy to Python backend
    location / {
        proxy_pass http://127.0.0.1:8010;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
    
    # Health check endpoint
    location /health {
        proxy_pass http://127.0.0.1:8010/health;
        access_log off;
    }
}
EOF

    # Enable site
    ln -sf /etc/nginx/sites-available/egx-backend /etc/nginx/sites-enabled/
    
    # Remove default site
    rm -f /etc/nginx/sites-enabled/default
    
    # Test nginx config
    nginx -t
    
    # Setup SSL with certbot
    echo -e "${YELLOW}Setting up SSL certificate...${NC}"
    certbot --nginx -d $DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN
    
    # Restart nginx
    systemctl restart nginx
}

# Setup SSL auto-renewal
setup_ssl_renewal() {
    echo -e "${YELLOW}Setting up SSL auto-renewal...${NC}"
    
    # Add cron job for certbot renewal
    (crontab -l 2>/dev/null; echo "0 0 * * * certbot renew --quiet") | crontab -
}

# Deploy with Docker
deploy_docker() {
    echo -e "${YELLOW}Deploying with Docker...${NC}"
    
    cd $APP_DIR/vps-service
    
    # Build and run
    docker-compose down
    docker-compose build --no-cache
    docker-compose up -d
    
    echo -e "${GREEN}Docker deployment complete!${NC}"
    echo -e "Backend running on: http://localhost:8010"
}

# Main deployment function
deploy_systemd() {
    echo -e "${GREEN}Starting deployment...${NC}"
    
    install_dependencies
    setup_repository
    setup_python
    setup_supervisor
    setup_nginx
    setup_ssl_renewal
    
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN} Deployment Complete!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo -e "Backend running on port: ${YELLOW}$SERVICE_PORT${NC}"
    echo -e "Health check: ${YELLOW}curl http://localhost:8010/health${NC}"
    echo -e "Logs: ${YELLOW}$APP_DIR/logs/${NC}"
    echo -e ""
    echo -e "Useful commands:"
    echo -e "  - Status: ${YELLOW}supervisorctl status egx-backend${NC}"
    echo -e "  - Restart: ${YELLOW}supervisorctl restart egx-backend${NC}"
    echo -e "  - Logs: ${YELLOW}tail -f $APP_DIR/logs/gunicorn.log${NC}"
}

# Update existing deployment
update_deployment() {
    echo -e "${YELLOW}Updating deployment...${NC}"
    
    cd $APP_DIR
    git pull origin main
    
    cd vps-service
    source venv/bin/activate
    pip install -r requirements.txt
    
    supervisorctl restart egx-backend
    
    echo -e "${GREEN}Update complete!${NC}"
}

# Parse arguments
case "${1:-}" in
    --docker)
        deploy_docker
        ;;
    --systemd)
        deploy_systemd
        ;;
    --update)
        update_deployment
        ;;
    *)
        echo "Usage: $0 {--docker|--systemd|--update}"
        exit 1
        ;;
esac
