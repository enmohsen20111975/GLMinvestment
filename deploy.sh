#!/bin/bash
# ============================================
# EGX Platform - Deployment Script for Hostinger VPS
# ============================================

set -e

echo "🚀 EGX Platform Deployment"
echo "==========================="

# ---- 1. Install dependencies ----
echo ""
echo "📦 Step 1: Installing dependencies..."
if command -v bun &> /dev/null; then
    bun install --production
else
    npm install --production
fi

# ---- 2. Setup database directory ----
echo ""
echo "💾 Step 2: Setting up database..."
mkdir -p db
# Database is auto-created by sql.js on first run

# ---- 3. Generate Prisma client ----
echo ""
echo "🔧 Step 3: Generating Prisma client..."
if command -v bun &> /dev/null; then
    bunx prisma generate
else
    npx prisma generate
fi

# ---- 4. Build Next.js ----
echo ""
echo "🏗️ Step 4: Building Next.js (production)..."
if command -v bun &> /dev/null; then
    bun run build
else
    npm run build
fi

# ---- 5. Create PM2 ecosystem config ----
echo ""
echo "⚙️ Step 5: Creating PM2 config..."
cat > ecosystem.config.cjs << 'PM2EOF'
module.exports = {
  apps: [{
    name: 'egx-platform',
    script: 'node_modules/.bin/next',
    args: 'start -p 3000',
    cwd: __dirname,
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
}
PM2EOF

echo ""
echo "✅ Build complete!"
echo ""
echo "=========================="
echo "📝 NEXT STEPS:"
echo "=========================="
echo ""
echo "1. Copy .env.example to .env and edit it:"
echo "   cp .env.example .env"
echo "   nano .env"
echo ""
echo "2. Set your NextAuth secret:"
echo "   openssl rand -base64 32"
echo "   # Paste the result into NEXTAUTH_SECRET in .env"
echo ""
echo "3. Start with PM2:"
echo "   pm2 start ecosystem.config.cjs"
echo "   pm2 save"
echo "   pm2 startup"
echo ""
echo "4. Setup reverse proxy (Caddy recommended):"
echo "   caddy reverse-proxy --from yourdomain.com --to localhost:3000"
echo ""
echo "5. Or with Nginx:"
echo "   # Add your domain in /etc/nginx/sites-available/egx"
echo "   # Then: nginx -t && systemctl reload nginx"
echo ""
echo "🌐 Your site will be live at your domain!"
echo "=========================================="
