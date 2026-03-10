#!/usr/bin/env bash
set -euo pipefail

SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PAGES_DIR="${1:-/tmp/paper-moonlight-h5-pages}"
REMOTE_URL="${2:-git@github.com:dingguanglei/paper-moonlight-h5-pages.git}"

cd "$SRC_DIR"
npm run build
mkdir -p "$PAGES_DIR"
cd "$PAGES_DIR"
if [ ! -d .git ]; then
  git init
  git branch -M main
  git config user.name 'dingguanglei'
  git config user.email 'dingguanglei@users.noreply.github.com'
  git remote add origin "$REMOTE_URL"
fi
find "$PAGES_DIR" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
rsync -av --delete "$SRC_DIR/dist/" "$PAGES_DIR/"
printf '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=./index.html">' > "$PAGES_DIR/404.html"
cd "$PAGES_DIR"
git add .
if ! git diff --cached --quiet; then
  git commit -m "deploy: update github pages site"
  git push origin main
else
  echo 'No changes to publish.'
fi
