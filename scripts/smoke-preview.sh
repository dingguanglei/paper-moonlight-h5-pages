#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BASE_PORT="${SMOKE_PORT:-4174}"
HOST="127.0.0.1"
PORT="$BASE_PORT"

# 若默认端口被占用，自动尝试下一个可用端口，避免命中旧 preview 进程导致假阳性。
for try_port in $(seq "$BASE_PORT" $((BASE_PORT + 20))); do
  if ! ss -ltnH "sport = :$try_port" | grep -q .; then
    PORT="$try_port"
    break
  fi
done

URL="http://${HOST}:${PORT}/paper-moonlight-h5-pages/"

npm run build >/dev/null

npm run preview -- --host "$HOST" --port "$PORT" >/tmp/paper-moonlight-h5-smoke.log 2>&1 &
PREVIEW_PID=$!

cleanup() {
  kill "$PREVIEW_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for _ in {1..30}; do
  if curl -fsS "$URL" >/tmp/paper-moonlight-h5-smoke.html 2>/dev/null; then
    break
  fi

  if ! kill -0 "$PREVIEW_PID" >/dev/null 2>&1; then
    echo "❌ Smoke check failed: preview process exited unexpectedly."
    echo "See /tmp/paper-moonlight-h5-smoke.log"
    exit 1
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
