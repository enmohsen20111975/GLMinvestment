# VPS Deploy Script | سكربت النشر على VPS

> `deploy_vps.sh` — Syncs modified Python analyzers + cleaned databases
> from the laptop to the remote VPS, restarts the backend service, runs
> the historical backfill, and verifies health.
>
> يزامن ملفات المحللات المعدّلة + قواعد البيانات النظيفة من اللابتوب
> إلى VPS، يعيد تشغيل الخدمة، يشغّل التعبئة التاريخية، ويتحقق من الصحة.

---

## 📦 Files | الملفات

| File | Purpose |
|------|---------|
| `deploy_vps.sh` | The deployment script (executable) |
| `VPS_DEPLOY_README.md` | This document |

---

## ✅ Prerequisites | المتطلبات المسبقة

### On the laptop (this machine)

1. **SSH key access to the VPS** — you must be able to run
   `ssh user@vps-host` without a password.
   ```bash
   # Generate a key if you don't have one
   ssh-keygen -t ed25519 -C "deploy@laptop"

   # Copy it to the VPS
   ssh-copy-id user@vps-host
   ```

2. **rsync** installed:
   ```bash
   # Debian/Ubuntu
   sudo apt install rsync
   # macOS (usually pre-installed, or)
   brew install rsync
   ```

3. **ssh** client:
   ```bash
   sudo apt install openssh-client
   ```

4. **curl** (used for the health check from inside the VPS — usually
   pre-installed on Ubuntu).

### On the VPS

1. The project must already be deployed at `/opt/egx-platform/`
   (run `vps-service/deploy.sh --systemd` once first if not).

2. The remote user must have **passwordless sudo** for `supervisorctl`,
   or be `root`:
   ```bash
   # On the VPS, as root:
   echo "deploy ALL=(ALL) NOPASSWD: /usr/bin/supervisorctl" > /etc/sudoers.d/egx-deploy
   chmod 440 /etc/sudoers.d/egx-deploy
   ```

3. The Python virtualenv must exist at
   `/opt/egx-platform/vps-service/venv/`.

4. `curl` must be installed on the VPS for the health check.

---

## 🚀 Usage | الاستخدام

### Basic | أساسي

```bash
cd /home/z/my-project
./vps-service/scripts/deploy_vps.sh --host 203.0.113.10
```
This will:
- Use SSH user `root` (default)
- Sync to `/opt/egx-platform/`
- Restart `egx-backend`
- Run backfill with `--days 30 --markets EGX`
- Hit `http://localhost:8010/health`

### Dry-run preview | معاينة

```bash
./vps-service/scripts/deploy_vps.sh --host vps.example.com --dry-run
```
Prints every command that *would* be run, without touching the VPS.

### Custom user and path | مستخدم ومسار مخصص

```bash
./vps-service/scripts/deploy_vps.sh \
  --host vps.example.com \
  --user deploy \
  --path /opt/egx-platform
```

### Env vars | متغيرات البيئة

```bash
export VPS_HOST=vps.example.com
export VPS_USER=deploy
export VPS_PATH=/opt/egx-platform
./vps-service/scripts/deploy_vps.sh
```

### Skip parts | تخطّي أجزاء

```bash
# Sync only Python files (skip databases)
./vps-service/scripts/deploy_vps.sh --host vps.example.com --no-db

# Sync but don't run backfill
./vps-service/scripts/deploy_vps.sh --host vps.example.com --no-backfill

# Restart service only, no sync of any kind
./vps-service/scripts/deploy_vps.sh --host vps.example.com \
  --no-db --no-backfill
```

### Custom backfill | تعبئة مخصّصة

```bash
# 60 days, multiple markets
./vps-service/scripts/deploy_vps.sh --host vps.example.com \
  --days 60 --markets "EGX KSA QSE"
```

---

## 📋 All options | كل الخيارات

| Flag | Default | Description |
|------|---------|-------------|
| `--host HOST` | `$VPS_HOST` or prompt | VPS hostname or IP |
| `--user USER` | `root` | SSH user |
| `--path PATH` | `/opt/egx-platform` | Remote project path |
| `--days N` | `30` | Backfill days |
| `--markets LIST` | `EGX` | Space-separated market list |
| `--dry-run` | off | Preview only, no changes |
| `--no-db` | off | Skip database sync |
| `--no-backfill` | off | Skip backfill step |
| `--no-restart` | off | Skip service restart |
| `--help`, `-h` | — | Show help |

---

## 🔧 What it does step-by-step | ماذا يفعل خطوة بخطوة

1. **Check prerequisites** (rsync, ssh, curl are installed).
2. **Resolve VPS host** from `--host`, `$VPS_HOST` env var, `~/.ssh/config`,
   or interactive prompt.
3. **Verify local files exist**:
   - `vps-service/analyzers/persona_gambler.py`
   - `vps-service/analyzers/persona_investor.py`
   - `vps-service/scripts/backfill_historical_predictions.py`
   - `db/stocks.db`
   - `db/predictions.db`
4. **Test SSH connectivity** to `${VPS_USER}@${VPS_HOST}`.
5. **Sync via rsync over SSH**:
   - Analyzer files → `${VPS_PATH}/vps-service/analyzers/`
   - Script files → `${VPS_PATH}/vps-service/scripts/`
   - Database files → `${VPS_PATH}/db/` (creates the dir if missing,
     sets `chmod 664` and `chown www-data` on them).
6. **Restart the backend service**:
   ```bash
   sudo supervisorctl restart egx-backend
   ```
   Waits 5 seconds for the service to stabilize.
7. **Run the backfill on the VPS**:
   ```bash
   cd /opt/egx-platform/vps-service
   source venv/bin/activate
   python scripts/backfill_historical_predictions.py --days 30 --markets EGX
   ```
8. **Health check** via SSH:
   ```bash
   curl -sS --max-time 10 http://localhost:8010/health
   ```
9. **Print summary** showing every file synced and every command run,
   with green ✓ for successes and red ✗ for failures.

---

## 🎨 Output colors | ألوان المخرجات

| Color | Meaning |
|-------|---------|
| 🟢 Green `[✓]` | Success |
| 🟡 Yellow `[⚠]` | Warning / dry-run / skipped |
| 🔴 Red `[✗]` | Error (printed to stderr) |
| 🔵 Blue `▶` | Step header |
| 🟣 Magenta | Muted info / next steps |

---

## 🛠 Troubleshooting | استكشاف الأخطاء

### `ssh is not installed`
Install it:
```bash
sudo apt install openssh-client
```

### `SSH connection failed`
- Check that you can SSH manually: `ssh user@vps-host`
- Make sure your SSH key is authorized on the VPS.
- If you see a host-key prompt, the script auto-accepts new hosts
  (`StrictHostKeyChecking=accept-new`). To disable, set
  `StrictHostKeyChecking=no` (not recommended).

### `Failed to restart egx-backend`
- Check supervisor logs:
  ```bash
  ssh user@vps-host 'sudo supervisorctl status egx-backend'
  ssh user@vps-host 'tail -50 /opt/egx-platform/logs/gunicorn-error.log'
  ```
- Verify the user has sudo rights for `supervisorctl`.

### `Backfill failed`
The deployment will still be live — only historical predictions will be
incomplete. Re-run manually:
```bash
ssh user@vps-host
cd /opt/egx-platform/vps-service
source venv/bin/activate
python scripts/backfill_historical_predictions.py --days 30 --markets EGX
```

### `Health check FAILED`
The service may be down. Inspect:
```bash
ssh user@vps-host 'sudo supervisorctl status egx-backend'
ssh user@vps-host 'sudo lsof -i :8010'
ssh user@vps-host 'tail -100 /opt/egx-platform/logs/gunicorn-error.log'
```

### Database sync is slow
`stocks.db` is ~80 MB. Over a slow link this can take minutes. If you
only need to push Python changes, use `--no-db`.

---

## 📝 Notes | ملاحظات

- The script uses `set -e` and exits on the first error.
- The backfill step is **non-fatal**: if it fails, the deployment
  continues to the health check (so you can still verify the service is
  up).
- The health check tolerates several JSON response formats:
  `{"status": "ok"}`, `{"status": "healthy"}`, plain text `ok`, etc.
- Database files are synced with `chmod 664` and `chown www-data:www-data`
  so gunicorn (running as `www-data` per the supervisor config) can read
  and write them.
- WAL files (`*-wal`, `*-shm`) are NOT synced — only the main `.db`
  files. SQLite will recreate the WAL on first write.
- The script auto-accepts new SSH host keys via
  `StrictHostKeyChecking=accept-new`. For a stricter policy, edit the
  `ssh` options in the script.

---

## 🔗 Related files | ملفات ذات صلة

- `vps-service/deploy.sh` — initial VPS setup (installs deps, nginx,
  supervisor, SSL).
- `vps-service/DEPLOYMENT.md` — full deployment guide (Docker, manual,
  Nginx, certbot).
- `vps-service/scripts/backfill_historical_predictions.py` — the
  backfill script that runs on the VPS.
- `vps-service/analyzers/persona_gambler.py` — gambler persona (fixed:
  support→support_level, resistance→resistance_level, BUY threshold 35→25).
- `vps-service/analyzers/persona_investor.py` — investor persona
  (fixed: price_history helpers, technical scoring, BUY threshold 40→28).
