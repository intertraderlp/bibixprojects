#!/bin/bash
# ── Deploy / enable the Chats module on a NameHero environment ───────────────
# Pulls main (fast-forward only), installs backend deps, writes the Chats env
# settings if missing, starts the Baileys worker + cron keep-alive, restarts
# the lsnode web app and checks the result. Safe to re-run.
#
# Production:  bash chats-deploy.sh
# Staging:     ROOT=$HOME/bibixprojects-staging APP_URL=https://staging.bibix.ailabstech.com BRANCH=staging WORKER_PORT=3003 bash chats-deploy.sh
set -uo pipefail

ROOT="${ROOT:-$HOME/bibixprojects}"
APP_URL="${APP_URL:-https://bibix.ailabstech.com}"
BRANCH="${BRANCH:-main}"
WORKER_PORT="${WORKER_PORT:-3002}"
ENV="$ROOT/backend/.env"
say() { echo "[chats-deploy] $*"; }

cd "$ROOT" || { say "FAIL: no $ROOT"; exit 1; }

say "1/6 git: fast-forward to origin/$BRANCH"
git fetch origin "$BRANCH" || exit 1
# server-built files under backend/public must not block the merge
git checkout -- backend/public 2>/dev/null || true
if ! git merge --ff-only "origin/$BRANCH"; then
  say "FAIL: cannot fast-forward. Local commits? Run: git log origin/$BRANCH..HEAD --oneline"; exit 1
fi
git log -1 --format='   now at %h %s'

say "2/6 npm install (backend)"
( cd backend && npm install --omit=dev --no-audit --no-fund 2>&1 | tail -2 ) || exit 1
node -e "require('$ROOT/backend/node_modules/@whiskeysockets/baileys/package.json'); console.log('   baileys ok')" || { say "FAIL: baileys not installed (Node >= 20 needed: node -v)"; exit 1; }

say "3/6 env settings in backend/.env"
touch "$ENV"
addenv() { grep -q "^$1=" "$ENV" || { echo "$1=$2" >> "$ENV"; echo "   added $1"; }; }
addenv CHATS_WORKER_URL "http://127.0.0.1:$WORKER_PORT"
addenv CHATS_WORKER_PORT "$WORKER_PORT"
addenv CHATS_APP_URL "$APP_URL"
addenv CHATS_WA_BROWSER "Bibix,Chrome,1.0.0"
grep -q "^CHATS_INTERNAL_SECRET=" "$ENV" || { echo "CHATS_INTERNAL_SECRET=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" >> "$ENV"; echo "   added CHATS_INTERNAL_SECRET"; }

say "4/6 worker process + cron keep-alive"
bash "$ROOT/backend/scripts/chats-worker.sh" restart
CRON_LINE="*/2 * * * * bash $ROOT/backend/scripts/chats-worker.sh >/dev/null 2>&1"
REBOOT_LINE="@reboot bash $ROOT/backend/scripts/chats-worker.sh >/dev/null 2>&1"
( crontab -l 2>/dev/null | grep -v "chats-worker.sh" ; echo "$CRON_LINE"; echo "$REBOOT_LINE" ) | crontab - && say "   crontab updated"

say "5/6 restart web app (lsnode)"
PIDS=$(pgrep -f "lsnode:$ROOT/backend" || true)
[ -n "$PIDS" ] && { echo "$PIDS" | xargs kill -9 2>/dev/null; say "   killed $PIDS"; } || say "   no lsnode process found (it starts on the next request)"

say "6/6 checks"
for i in 1 2 3 4 5 6; do
  sleep 3
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "$APP_URL/api/health" || echo 000)
  [ "$CODE" = "200" ] && break
done
echo "   $APP_URL/api/health → $CODE"
echo "   $APP_URL/chats/    → $(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$APP_URL/chats/")"
echo "   worker health      → $(curl -s --max-time 5 "http://127.0.0.1:$WORKER_PORT/health")"
say "done. Open $APP_URL/chats/ — sidebar → Chats; Admin → Users → module 'Chats' to grant access."
