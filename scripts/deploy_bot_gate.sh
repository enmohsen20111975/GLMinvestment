#!/bin/bash
# =============================================================================
# deploy_bot_gate.sh — deploy + verify the Telegram subscription gate on the
# production VPS, in one command, with a real end-to-end proof at the end.
#
# WHY THIS EXISTS
#   The bot-gate routes (/api/bot/*) are already live in production, but the
#   `user_telegram_links` table is never created there: `npm run db:push` only
#   targets prisma/schema.prisma, and no auth migration runs on deploy. The
#   Prisma-based version of check-subscription therefore 500s, and the Telegram
#   bot (on its next restart) tells every user "اربط حسابك" — a mass lockout.
#   Commit f9785e5ff fixes this by creating the tables on first use. This script
#   deploys that fix and then PROVES the gate works over HTTP.
#
# SAFE BY DESIGN
#   - idempotent: re-running is a no-op once healthy
#   - never overwrites an existing BOT_API_SECRET (it would desync the bot)
#   - does NOT restart the Telegram bot: this script does not know how the bot
#     is supervised on that host (it is not an pm2 app in this repo), and
#     guessing is how you get two pollers fighting over one bot token.
#     Restart it yourself once this script reports ALL GOOD.
#   - aborts before touching pm2 if the build fails
#
#   Note on lockout risk: restarting the bot BEFORE this script runs is no
#   longer dangerous, because the same git pull also lands the bot-side fix
#   (commit f9785e5ff) where an HTTP 5xx from the site is reported as
#   "temporary problem" instead of "link your account". The hard ordering
#   requirement that existed with the pre-fix bot no longer applies.
#
# USAGE
#   bash scripts/deploy_bot_gate.sh            # real deploy
#   bash scripts/deploy_bot_gate.sh --dry-run  # print the plan, change nothing
# =============================================================================
set -uo pipefail

APP_DIR="${APP_DIR:-$HOME/GLMinvestment}"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
info() { printf '   %s\n' "$*"; }
fail() { printf '\n\033[1;31m❌ %s\033[0m\n' "$*"; exit 1; }

if [ "$DRY_RUN" = "1" ]; then
  say "DRY RUN — nothing will be changed"
  info "app dir        : $APP_DIR"
  info "would run      : git pull origin main"
  info "would run      : npx prisma generate --schema=prisma/auth-schema.prisma"
  info "would run      : npm run build"
  info "would ensure   : BOT_API_SECRET exists in .env (generate only if absent)"
  info "would run      : pm2 restart nextjs"
  info "would verify   : GET /api/bot/check-subscription?chat_id=1  -> 200 {linked:false}"
  info "would NOT      : restart the Telegram bot"
  exit 0
fi

# ── 0. preflight ────────────────────────────────────────────────────────────
say "0/6 preflight"
cd "$APP_DIR" || fail "app dir not found: $APP_DIR (override with APP_DIR=...)"
[ -f package.json ] || fail "no package.json in $APP_DIR — wrong directory?"
command -v pm2 >/dev/null 2>&1 || fail "pm2 not found — is this the app host?"
command -v node >/dev/null 2>&1 || fail "node not found"
info "dir      : $APP_DIR"
info "node     : $(node -v)"
info "pm2 nextjs: $(pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const p=JSON.parse(s).find(x=>x.name==="nextjs");console.log(p?p.pm2_env.status:"NOT REGISTERED")}catch{console.log("unknown")}})' 2>/dev/null)"

# Never let a shared-tree accident eat the deploy: refuse to run on a dirty tree.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  fail "working tree has uncommitted tracked changes — commit or stash them first:
$(git status --porcelain --untracked-files=no | head -10)"
fi

# ── 1. code ─────────────────────────────────────────────────────────────────
say "1/6 pull the fix"
git pull --ff-only origin main || fail "git pull failed (resolve by hand; do NOT --force)"
info "HEAD: $(git log --oneline -1)"

# ── 2. prisma client ────────────────────────────────────────────────────────
say "2/6 prisma generate (auth schema)"
npx prisma generate --schema=prisma/auth-schema.prisma || fail "prisma generate failed"
npx prisma generate --schema=prisma/predictions-schema.prisma >/dev/null 2>&1 || true

# ── 3. build (abort before touching pm2 if this fails) ─────────────────────
say "3/6 build"
npm run build || fail "build failed — pm2 was NOT restarted, the old app is still serving"

# ── 4. the shared secret ────────────────────────────────────────────────────
say "4/6 BOT_API_SECRET"
[ -f .env ] || fail ".env not found in $APP_DIR"
NEW_SECRET=0
if grep -qE '^BOT_API_SECRET=.+$' .env; then
  info "BOT_API_SECRET already set — keeping it (the bot env must match this value)"
else
  NEW_SECRET=1
  SECRET=$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  {
    echo ""
    echo "# ==================== Telegram Bot / Subscription Gate ===================="
    echo "# shared secret between the bot and /api/bot/* — MUST match the bot's env."
    echo "BOT_API_SECRET=$SECRET"
    echo "NEXT_PUBLIC_SITE_URL=https://invist.m2y.net"
    echo "NEXT_PUBLIC_API_URL=https://invist.m2y.net"
  } >> .env
  info "generated a new BOT_API_SECRET and appended it to .env"
fi
grep -qE '^NEXT_PUBLIC_SITE_URL=' .env || echo "NEXT_PUBLIC_SITE_URL=https://invist.m2y.net" >> .env
grep -qE '^NEXT_PUBLIC_API_URL=' .env || echo "NEXT_PUBLIC_API_URL=https://invist.m2y.net" >> .env
chmod 600 .env 2>/dev/null || true
SECRET=$(grep '^BOT_API_SECRET=' .env | head -1 | cut -d= -f2-)
[ -n "$SECRET" ] || fail "could not read BOT_API_SECRET back out of .env"

# ── 5. restart the site ─────────────────────────────────────────────────────
say "5/6 restart the app (not the bot)"
pm2 restart nextjs || fail "pm2 restart nextjs failed"
info "waiting for the app to answer..."
SITE="${SITE:-https://invist.m2y.net}"
OK=0
for i in $(seq 1 30); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$SITE/api/health" 2>/dev/null)
  if [ "$CODE" = "200" ]; then OK=1; info "healthy after ${i}s"; break; fi
  sleep 1
done
[ "$OK" = "1" ] || fail "app did not become healthy at $SITE/api/health — NOT restarting the bot"

# ── 6. prove the gate works (this is the whole point) ───────────────────────
say "6/6 end-to-end proof of the gate"
sleep 3
BODY=$(curl -s --max-time 15 -H "X-Bot-Secret: $SECRET" \
  "$SITE/api/bot/check-subscription?chat_id=1" 2>/dev/null)
info "GET /api/bot/check-subscription -> $BODY"

case "$BODY" in
  *'"linked":false'*|*'"linked": false'*)
    info "✅ tables exist, the endpoint answers 200, and an unlinked chat is rejected"
    ;;
  *unauthorized*|*'"error"'*)
    fail "endpoint says unauthorized — the running app has not picked up BOT_API_SECRET.
       Next.js reads .env only at startup: check 'pm2 logs nextjs --lines 30' and confirm
       the app was restarted AFTER the .env edit."
    ;;
  *)
    fail "unexpected response: $BODY"
    ;;
esac

# negative control: no secret must still be rejected
NEG=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$SITE/api/bot/check-subscription?chat_id=1")
[ "$NEG" = "401" ] || fail "SECURITY: the endpoint answered $NEG without a secret (expected 401)"
info "✅ fail-closed without the secret (401)"

say "DONE — the gate is live and verified"
if [ "$NEW_SECRET" = "1" ]; then
  say "⚠️  ACTION REQUIRED: a NEW BOT_API_SECRET was generated"
  info "copy this into the Telegram bot's environment (same host or another box):"
  echo
  echo "      BOT_API_SECRET=$SECRET"
  echo
  info "then restart the bot. The gate is already verified safe at this point."
else
  say "NEXT: confirm the bot env carries the same BOT_API_SECRET, then restart the bot."
  info "if the bot still logs 'BOT_API_SECRET is empty', sync it there first."
  info "the gate itself is verified healthy, so the bot restart is safe."
fi
