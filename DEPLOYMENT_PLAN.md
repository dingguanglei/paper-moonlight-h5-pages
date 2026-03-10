# Deployment Plan: Private Source Repo + Public Pages Repo

目标：
- **私有仓库**保存完整源码（持续开发）
- **公开 Pages 仓库**仅发布静态产物（`dist/`）

## Recommended Repository Layout

1. `paper-moonlight-h5-private` (GitHub Private)
   - Contains full source code
   - Main development branch (e.g. `main`)

2. `paper-moonlight-h5-pages` (GitHub Public)
   - Contains only static site files from `dist/`
   - Served by GitHub Pages (branch `main` root)

## Why split into two repos

- Keeps source history private.
- Public repo has no dev configs or accidental secrets.
- Easy rollback by force-updating static files only.

## Local workflow (minimal)

在私有仓库中开发：

```bash
npm install
npm run build
```

将 `dist/` 同步到公开 Pages 仓库（示例脚本逻辑）：

1. Build in private repo
2. Clone/update public pages repo to temp dir
3. Remove old files in public repo
4. Copy `dist/*` into public repo root
5. Commit + push

## If this machine cannot create GitHub repos directly

最小用户动作（一次性）：

1. 在 GitHub 网页端手动创建两个仓库：
   - Private: `paper-moonlight-h5-private`
   - Public: `paper-moonlight-h5-pages`
2. 在 Public 仓库 Settings → Pages：
   - Source: Deploy from a branch
   - Branch: `main` / `/root`
3. 把两个仓库 URL 发给代理（HTTPS 或 SSH 都可）

之后代理可继续完成：
- 绑定 remotes
- 推送私有源码
- 构建并发布 `dist` 到公开仓库

## Optional automation (later)

可在私有仓库配置 GitHub Action：
- On push to `main`
- `npm ci && npm run build`
- Publish `dist` to public repo (via deploy key / PAT with least privilege)

注意：不要把 PAT 明文写进仓库；使用 GitHub Secrets。
