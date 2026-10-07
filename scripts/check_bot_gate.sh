#!/bin/bash
# =============================================================================
# check_bot_gate.sh — is the Telegram subscription gate actually working on a
# live site? No SSH and no deploy needed; pure HTTP checks.
#
# Run it from anywhere, e.g. right after deploying, or when the bot behaves
# strangely and you need to know whether the site or the bot is at fault.
#
# USAGE
#   bash scripts/check_bot_gate.sh <BOT_API_SECRET> [SITE_URL]
#
#   bash scripts/check_bot_gate.sh "$SECRET"                          # prod
#   bash scripts/check_bot_gate.sh "$SECRET" http://localhost:3000     # local
#
# The secret is never written to disk and never echoed in full.
# =============================================================================
set -uo pipefail

SECRET="${1:-}"
SITE="${2:-https://invist.m2y.net}"

if [ -z "$SECRET" ]; then
  echo "usage: bash scripts/check_bot_gate.sh <BOT_API_SECRET> [SITE_URL]" >&2
  echo "       get it from the app host:  grep '^BOT_API_SECRET=' ~/GLMinvestment/.env" >&2
  exit 2
fi

pass=0; fail=0
ok()   { printf '   \033[32m✅\033[0m %s\n' "$*"; pass=$((pass+1)); }
bad()  { printf '   \033[1;31m❌\033[0m %s\n' "$*"; fail=$((fail+1)); }
head_() { printf '\n\033[1m%s\033[0m\n' "$*"; }

printf '\033[1mBot gate check\033[0m  site=%s  secret=%s…%s\n' \
  "$SITE" "${SECRET:0:4}" "${SECRET: -4}"

head_ "1. is the site up at all?"
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$SITE/api/health" 2>/dev/null)
[ "$CODE" = "200" ] && ok "/api/health -> 200" || bad "/api/health -> ${CODE:-no response} (site down or wrong URL)"

head_ "2. is the gate deployed?"
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$SITE/api/bot/nope-does-not-exist" 2>/dev/null)
[ "$CODE" = "404" ] && ok "unknown /api/bot/* route -> 404 (routing works)" || bad "expected 404, got $CODE"

CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$SITE/api/bot/check-subscription?chat_id=1" 2>/dev/null)
[ "$CODE" = "401" ] && ok "gate route exists and is fail-closed without a secret (401)" \
  || bad "expected 401 without a secret, got $CODE (route missing, or the site is erroring)"

head_ "3. does the secret work, and do the tables exist?"
BODY=$(curl -s --max-time 15 -H "X-Bot-Secret: $SECRET" "$SITE/api/bot/check-subscription?chat_id=1" 2>/dev/null)
case "$BODY" in
  *'"linked":false'*|*'"linked": false'*)
    ok "check-subscription -> 200 {linked:false}"
    ok "user_telegram_links table exists (this is the thing that breaks the bot)"
    ;;
  *unauthorized*)
    bad "secret rejected — the app has not restarted since BOT_API_SECRET was set in .env"
    ;;
  *internal_error*|*Error*|*error*)
    bad "endpoint errored: $BODY"
    bad "  -> most likely user_telegram_links is missing; deploy the fix (scripts/deploy_bot_gate.sh)"
    ;;
  "")
    bad "no response at all"
    ;;
  *)
    bad "unexpected: $BODY"
    ;;
esac

head_ "4. can the bot mint a link token?"
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -X POST \
  -H "X-Bot-Secret: $SECRET" -H 'content-type: application/json' \
  -d '{"chat_id":1,"username":"gatecheck"}' "$SITE/api/bot/link-token" 2>/dev/null)
[ "$CODE" = "200" ] && ok "link-token -> 200 (the '🔗 ربط حسابك' button will work)" \
  || bad "link-token -> $CODE (the bot's link button will be broken)"

head_ "5. summary"
if [ "$fail" -eq 0 ]; then
  printf '   \033[1;32mALL GOOD\033[0m — the gate works. Safe to (re)start the Telegram bot.\n\n'
  exit 0
fi
printf '   \033[1;31m%d problem(s)\033[0m found. Do NOT restart the bot yet.\n\n' "$fail"
exit 1
