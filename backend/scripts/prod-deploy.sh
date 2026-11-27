#!/bin/bash
# ── Bibix production deploy (LiteSpeed lsnode, NameHero) ─────────────────────
# Run from the cPanel terminal:
#   cd ~/bibixprojects && git fetch origin main && git show FETCH_HEAD:backend/scripts/prod-deploy.sh > /tmp/pd.sh && bash /tmp/pd.sh
#
# What it does: backs up the DB, resets the checkout to origin/main, installs
# backend deps (production only), restarts the lsnode worker(s) and waits for
# /api/health. Prints a short report at the end.

set -uo pipefail
ROOT="$HOME/bibixprojects"
DB="$ROOT/backend/data/monday.db"
BACKUP_DIR="$ROOT/backend/data/backups"
URL="https://bibix.ailabstech.com/api/health"
NPM=$(command -v npm || echo /usr/local/bin/npm)

say() { echo "[$(date '+%H:%M:%S')] $*"; }

# 1. DB backup (only if it looks healthy)
mkdir -p "$BACKUP_DIR"
if [ -f "$DB" ] && [ "$(head -c 15 "$DB")" = "SQLite format 3" ]; then
  cp "$DB" "$BACKUP_DIR/monday.db.predeploy.$(date +%Y%m%d_%H%M%S)" && say "DB backup saved"
  ls -1t "$BACKUP_DIR"/monday.db.predeploy.* 2>/dev/null | tail -n +6 | xargs rm -f 2>/dev/null || true
else
  say "WARNING: DB missing or not a valid SQLite file — continuing without backup"
fi

# 2. Code
cd "$ROOT" || { say "FAIL: $ROOT not found"; exit 1; }
BEFORE=$(git rev-parse --short HEAD)
git fetch -q origin main || { say "FAIL: git fetch"; exit 1; }
git reset -q --hard origin/main || { say "FAIL: git reset"; exit 1; }
AFTER=$(git rev-parse --short HEAD)
say "code: $BEFORE -> $AFTER ($(git log -1 --format=%s | cut -c1-70))"

# 3. Backend deps (adds ffmpeg-static for VideoVue if ffmpeg is not on the box)
cd "$ROOT/backend" && "$NPM" install --omit=dev --no-audit --no-fund 2>&1 | tail -2

# 4. ffmpeg availability (VideoVue uploads need it)
if command -v ffmpeg >/dev/null 2>&1; then
  say "ffmpeg: system $(ffmpeg -version 2>/dev/null | head -1 | cut -d' ' -f1-3)"
else
  FF=$(node -e "try{process.stdout.write(require('ffmpeg-static')||'')}catch(e){}" 2>/dev/null)
  if [ -n "$FF" ] && "$FF" -version >/dev/null 2>&1; then say "ffmpeg: ffmpeg-static OK ($FF)"; else say "ffmpeg: NOT AVAILABLE — VideoVue uploads will fail (set FFMPEG_PATH in backend/.env)"; fi
fi

# 5. Restart: kill the lsnode worker(s) for this app; LiteSpeed respawns on the next request
PIDS=$(pgrep -f "lsnode:$HOME/bibixprojects/backend" || true)
if [ -n "$PIDS" ]; then kill -9 $PIDS 2>/dev/null || true; say "killed lsnode pid(s): $(echo $PIDS | tr '\n' ' ')"; else say "no lsnode worker running (will start on first request)"; fi

# 6. Wait for the site
for i in $(seq 1 12); do
  sleep 3
  OUT=$(curl -s --max-time 8 "$URL" 2>/dev/null || true)
  if echo "$OUT" | grep -q '"status":"ok"'; then say "UP: $OUT"; break; fi
  [ "$i" = 12 ] && say "FAIL: site did not answer in time. Check ~/bibixprojects/backend/stderr.log"
done

# 7. VideoVue smoke checks
say "watch page:  HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 8 https://bibix.ailabstech.com/watch/test-link-check)"
say "videos api:  HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 8 https://bibix.ailabstech.com/api/videos) (401 expected)"
say "done"
