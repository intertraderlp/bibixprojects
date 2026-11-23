#!/bin/bash
# ── Bibix Chats worker — start / keep alive ───────────────────────────────────
# The WhatsApp sessions (Baileys) must live in ONE long-lived Node process.
# LiteSpeed's lsnode web process is restarted/duplicated at will, so the
# sessions run here instead, and the web app talks to this process over
# localhost (CHATS_WORKER_URL in backend/.env).
#
# Usage:
#   bash backend/scripts/chats-worker.sh            # start if not running
#   bash backend/scripts/chats-worker.sh restart    # kill + start
#   bash backend/scripts/chats-worker.sh stop
#   bash backend/scripts/chats-worker.sh status
#
# Cron (keeps it alive, every 2 min + at reboot):
#   */2 * * * * bash $HOME/bibixprojects-staging/backend/scripts/chats-worker.sh >/dev/null 2>&1
#   @reboot     bash $HOME/bibixprojects-staging/backend/scripts/chats-worker.sh >/dev/null 2>&1
set -uo pipefail

BACKEND="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$BACKEND/data/chats-worker.log"
PIDFILE="$BACKEND/data/chats-worker.pid"
NODE="${NODE_BIN:-$(command -v node)}"
PORT="$(grep -E '^CHATS_WORKER_PORT=' "$BACKEND/.env" 2>/dev/null | cut -d= -f2)"; PORT="${PORT:-3002}"
mkdir -p "$BACKEND/data"

running() {
  if [ -f "$PIDFILE" ]; then
    local pid; pid=$(cat "$PIDFILE")
    if kill -0 "$pid" 2>/dev/null && ps -p "$pid" -o args= | grep -q "chats/worker.js"; then return 0; fi
  fi
  # fallback: anything already bound to the port with our script name
  pgrep -f "$BACKEND/src/chats/worker.js" >/dev/null 2>&1
}
start() {
  if running; then echo "chats-worker already running (pid $(pgrep -f "$BACKEND/src/chats/worker.js" | head -1))"; return 0; fi
  cd "$BACKEND" || exit 1
  nohup "$NODE" "$BACKEND/src/chats/worker.js" >>"$LOG" 2>&1 &
  echo $! >"$PIDFILE"
  sleep 2
  if curl -sf "http://127.0.0.1:$PORT/health" >/dev/null; then echo "chats-worker started (pid $(cat "$PIDFILE"), port $PORT)"; else echo "chats-worker failed to start — see $LOG"; tail -20 "$LOG"; return 1; fi
}
stop() {
  pkill -f "$BACKEND/src/chats/worker.js" 2>/dev/null && echo "chats-worker stopped" || echo "chats-worker not running"
  rm -f "$PIDFILE"
}
case "${1:-start}" in
  start)   start ;;
  stop)    stop ;;
  restart) stop; sleep 1; start ;;
  status)  if running; then echo "running"; curl -s "http://127.0.0.1:$PORT/health"; echo; else echo "not running"; fi ;;
  *)       echo "usage: $0 [start|stop|restart|status]"; exit 1 ;;
esac
