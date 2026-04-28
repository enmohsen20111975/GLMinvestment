# EGX Data API Service for VPS

This Python Flask service runs on your VPS to fetch live EGX stock market data from TradingView. It provides HTTP API endpoints that your Next.js app on Hostinger can call.

## Why This Architecture?

- **Hostinger shared hosting** doesn't support Python execution
- **VPS** has full Python support and can run heavy data processing
- **Next.js app** on Hostinger calls the VPS API for live data
- **Separation of concerns**: Frontend on Hostinger, data fetching on VPS

## Quick Deploy

1. **Copy files to your VPS:**
   ```bash
   scp -r vps-service/ root@YOUR_VPS_IP:/opt/egx-api/
   ```

2. **Run the deployment script:**
   ```bash
   ssh root@YOUR_VPS_IP
   cd /opt/egx-api
   chmod +x deploy.sh
   ./deploy.sh
   ```

3. **Configure your Next.js app:**
   Add to your Hostinger environment variables:
   ```
   EGX_VPS_API_URL=http://YOUR_VPS_IP:5000
   ```

## Manual Deploy

```bash
# On your VPS
sudo apt update
sudo apt install python3 python3-pip -y

# Create service directory
sudo mkdir -p /opt/egx-api
cd /opt/egx-api

# Copy files (or create them)
# egx_api_service.py
# requirements.txt

# Install dependencies
pip3 install -r requirements.txt
pip3 install tradingview-ta

# Test run
python3 egx_api_service.py

# Create systemd service (for auto-start)
sudo cp egx-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable egx-api
sudo systemctl start egx-api

# Check status
sudo systemctl status egx-api
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/stocks` | GET | Fetch all EGX stocks |
| `/api/stock/<symbol>` | GET | Fetch single stock |
| `/api/indices` | GET | Fetch EGX indices |
| `/api/gold` | GET | Fetch gold prices |
| `/api/sync` | POST | Full sync all data |
| `/api/search?q=COM` | GET | Search stocks |

## Example Usage

```bash
# Health check
curl http://YOUR_VPS_IP:5000/health

# Get all stocks
curl http://YOUR_VPS_IP:5000/api/stocks

# Get single stock
curl http://YOUR_VPS_IP:5000/api/stock/COMI

# Get indices
curl http://YOUR_VPS_IP:5000/api/indices

# Get gold prices
curl http://YOUR_VPS_IP:5000/api/gold

# Full sync
curl -X POST http://YOUR_VPS_IP:5000/api/sync
```

## Logs

```bash
# View logs
journalctl -u egx-api -f

# Restart service
sudo systemctl restart egx-api

# Stop service
sudo systemctl stop egx-api
```

## Security (Recommended)

For production, add a firewall rule and/or API key:

```bash
# Allow only your Hostinger server IP
sudo ufw allow from YOUR_HOSTINGER_IP to any port 5000
```

Or add API key authentication by modifying the Python code.

## Adding egxpy

If you have egxpy installed on your VPS:

```bash
# The service will auto-detect and use egxpy
# You can force egxpy usage:
curl "http://YOUR_VPS_IP:5000/api/stocks?egxpy=true"
```
