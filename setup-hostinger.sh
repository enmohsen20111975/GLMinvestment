#!/bin/bash
# ========================================
# EGX Investment Platform - Hostinger Setup
# ========================================
# Run this script via SSH on your Hostinger VPS/Cloud server
# Usage: bash setup-hostinger.sh
# ========================================

set -e

echo "=========================================="
echo "  EGX Platform - Hostinger Deployment"
echo "=========================================="

# Configuration
PROJECT_DIR="$HOME/egx-platform"
GITHUB_REPO="https://github.com/enmohsen20111975/GLMinvestment.git"
NODE_VERSION="20"
PORT=3000

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Step 1: Check system requirements
echo ""
echo -e "${YELLOW}[1/8] Checking system requirements...${NC}"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}Node.js not found! Installing...${NC}"
    
    # Try to install Node.js via nvm
    if [ -f "$HOME/.nvm/nvm.sh" ]; then
        source "$HOME/.nvm/nvm.sh"
        nvm install $NODE_VERSION
        nvm use $NODE_VERSION
        nvm alias default $NODE_VERSION
    elif command -v nvm &> /dev/null; then
        nvm install $NODE_VERSION
        nvm use $NODE_VERSION
    else
        echo -e "${YELLOW}Installing NVM and Node.js...${NC}"
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
        nvm install $NODE_VERSION
        nvm use $NODE_VERSION
        nvm alias default $NODE_VERSION
    fi
else
    NODE_VER=$(node -v)
    echo -e "${GREEN}Node.js found: $NODE_VER${NC}"
fi

# Check npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}npm not found!${NC}"
    exit 1
fi
echo -e "${GREEN}npm: $(npm -v)${NC}"

# Check git
if ! command -v git &> /dev/null; then
    echo -e "${RED}Git not found!${NC}"
    exit 1
fi
echo -e "${GREEN}git: $(git --version)${NC}"

# Step 2: Clone or update the repository
echo ""
echo -e "${YELLOW}[2/8] Setting up project files...${NC}"

if [ -d "$PROJECT_DIR" ]; then
    echo "Project directory exists. Updating..."
    cd "$PROJECT_DIR"
    git pull origin main
else
    echo "Cloning repository..."
    git clone "$GITHUB_REPO" "$PROJECT_DIR"
    cd "$PROJECT_DIR"
fi

# Step 3: Verify package.json exists
echo ""
echo -e "${YELLOW}[3/8] Verifying package.json...${NC}"

if [ ! -f "package.json" ]; then
    echo -e "${RED}ERROR: package.json not found in $(pwd)!${NC}"
    echo "Current directory contents:"
    ls -la
    exit 1
fi
echo -e "${GREEN}package.json found ✅${NC}"

# Step 4: Install dependencies
echo ""
echo -e "${YELLOW}[4/8] Installing dependencies...${NC}"
npm install --production=false

# Step 5: Ensure sql.js WASM binary is available
echo ""
echo -e "${YELLOW}[5/8] Setting up sql.js WASM...${NC}"

SQLJS_WASM="node_modules/sql.js/dist/sql-wasm.wasm"
if [ -f "$SQLJS_WASM" ]; then
    echo -e "${GREEN}sql.js WASM binary found ✅${NC}"
else
    echo -e "${YELLOW}Downloading sql.js WASM binary...${NC}"
    mkdir -p node_modules/sql.js/dist
    curl -L -o "$SQLJS_WASM" https://sql.js.org/dist/sql-wasm.wasm
fi

# Step 6: Copy static assets for standalone output
echo ""
echo -e "${YELLOW}[6/8] Preparing static assets...${NC}"

# These will be needed after build
if [ -d "public" ]; then
    echo -e "${GREEN}public/ directory ready ✅${NC}"
else
    mkdir -p public
    echo -e "${YELLOW}Created empty public/ directory${NC}"
fi

# Step 7: Build the project
echo ""
echo -e "${YELLOW}[7/8] Building Next.js project (webpack mode)...${NC}"
NODE_ENV=production npm run build

# Verify build output
if [ ! -f ".next/standalone/server.js" ]; then
    echo -e "${RED}ERROR: Build failed! server.js not found.${NC}"
    exit 1
fi

# Copy public and static assets to standalone
echo "Copying static assets to standalone build..."
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static 2>/dev/null || true

# Copy db directory to standalone
if [ -d "db" ]; then
    cp -r db .next/standalone/db
    echo -e "${GREEN}Database files copied ✅${NC}"
else
    mkdir -p .next/standalone/db
    echo -e "${YELLOW}Created empty db/ directory${NC}"
fi

# Copy sql.js dist (entire directory — CRITICAL: sql-wasm.js + sql-wasm.wasm both needed)
SQLJS_DIST="node_modules/sql.js/dist"
if [ -d "$SQLJS_DIST" ]; then
    mkdir -p .next/standalone/node_modules/sql.js/dist
    cp -r "$SQLJS_DIST"/* .next/standalone/node_modules/sql.js/dist/
    echo -e "${GREEN}sql.js dist copied ($(ls \"$SQLJS_DIST\" | wc -l) files) ✅${NC}"
else
    echo -e "${YELLOW}sql.js/dist not found, downloading...${NC}"
    mkdir -p node_modules/sql.js/dist
    curl -L -o node_modules/sql.js/dist/sql-wasm.js https://sql.js.org/dist/sql-wasm.js
    curl -L -o node_modules/sql.js/dist/sql-wasm.wasm https://sql.js.org/dist/sql-wasm.wasm
    mkdir -p .next/standalone/node_modules/sql.js/dist
    cp -r node_modules/sql.js/dist/* .next/standalone/node_modules/sql.js/dist/
fi

# Also copy sql.js package.json for require('sql.js') resolution
if [ -f "node_modules/sql.js/package.json" ]; then
    cp node_modules/sql.js/package.json .next/standalone/node_modules/sql.js/
fi

# Step 8: Setup PM2 and start
echo ""
echo -e "${YELLOW}[8/8] Setting up process manager...${NC}"

# Check if pm2 is installed
if ! command -v pm2 &> /dev/null; then
    echo "Installing PM2..."
    npm install -g pm2
fi

# Create production ecosystem config
cat > "$PROJECT_DIR/ecosystem.prod.cjs" << 'ECOFILE'
module.exports = {
  apps: [{
    name: 'egx-platform',
    script: 'server.js',
    cwd: '__PROJECT_DIR__/.next/standalone',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      HOSTNAME: '0.0.0.0',
    },
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    min_uptime: '10s',
    restart_delay: 5000,
    error_file: '__PROJECT_DIR__/logs/error.log',
    out_file: '__PROJECT_DIR__/logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  }]
};
ECOFILE

# Replace project directory placeholder
sed -i "s|__PROJECT_DIR__|$PROJECT_DIR|g" "$PROJECT_DIR/ecosystem.prod.cjs"

# Create logs directory
mkdir -p "$PROJECT_DIR/logs"

# Stop existing process if running
pm2 stop egx-platform 2>/dev/null || true
pm2 delete egx-platform 2>/dev/null || true

# Start the application
cd "$PROJECT_DIR"
pm2 start ecosystem.prod.cjs
pm2 save

echo ""
echo "=========================================="
echo -e "${GREEN}  🎉 Deployment Complete!${NC}"
echo "=========================================="
echo ""
echo "Application running at: http://localhost:$PORT"
echo ""
echo "Useful commands:"
echo "  pm2 logs egx-platform    - View logs"
echo "  pm2 restart egx-platform - Restart"
echo "  pm2 stop egx-platform    - Stop"
echo ""
echo "Note: Make sure to upload egx_investment.db to:"
echo "  $PROJECT_DIR/.next/standalone/db/"
echo ""
