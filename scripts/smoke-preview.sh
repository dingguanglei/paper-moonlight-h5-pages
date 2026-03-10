#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PORT="${SMOKE_PORT:-4174}"
HOST="127.0.0.1"
URL="http://${HOST}:${PORT}/paper-moonlight-h5-pages/"

npm run build >/dev/null

npm run preview -- --host "$HOST" --port "$PORT" >/tmp/paper-moonlight-h5-smoke.log 2>&1 &
PREVIEW_PID=$!

cleanup() {
  kill "$PREVIEW_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for _ in {1..20}; do
  if curl -fsS "$URL" >/tmp/paper-moonlight-h5-smoke.html 2>/dev/null; then
    break
  fi
  sleep 0.5
done

if [[ ! -s /tmp/paper-moonlight-h5-smoke.html ]]; then
  echo "❌ Smoke check failed: preview not reachable at $URL"
  echo "See /tmp/paper-moonlight-h5-smoke.log"
  exit 1
fi

if ! rg -q "<title>Sunlight</title>" /tmp/paper-moonlight-h5-smoke.html; then
  echo "❌ Smoke check failed: unexpected HTML content"
  exit 1
fi

echo "✅ Smoke check passed: $URL"
