#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[1/4] Lint + Build"
npm run check

echo "[2/4] Local preview smoke check"
npm run smoke

echo "[3/4] Secret pattern scan (tracked files)"
# 仅匹配“疑似真实密钥/令牌”形式，避免把变量名误报成泄露
# 忽略依赖、构建产物、git 元数据与示例文件
KEY_PATTERN='(sk-[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9_\-\.]{20,}|OPENAI_API_KEY\s*=\s*[^\s]+|API_KEY\s*=\s*[^\s]+)'
if git ls-files | grep -Ev '^(node_modules/|dist/|\.git/|\.env\.example$)' | xargs -r rg -n "$KEY_PATTERN"; then
  echo "❌ Found suspicious key/token-like content in tracked files."
  echo "Please remove/redact before publishing."
  exit 1
fi

echo "[4/4] Dist output check"
if [[ ! -f dist/index.html ]]; then
  echo "❌ dist/index.html not found. Build output missing."
  exit 1
fi

if ! rg -q '/paper-moonlight-h5-pages/' dist/index.html; then
  echo "⚠️ base path '/paper-moonlight-h5-pages/' not found in dist/index.html"
  echo "Please verify vite base config before GitHub Pages deployment."
else
  echo "✅ GitHub Pages base path looks correct."
fi

echo "✅ Preflight passed. Ready to push/deploy."
