# Deployment Plan: Single Public Repository

当前采用单仓模式：
- **公开仓库**同时保存源码与 GitHub Pages 部署配置
- 直接在 `main` 分支开发、提交、推送
- GitHub Actions 负责构建并部署页面

## Current repository

- Source + Pages repo: `paper-moonlight-h5-pages`

## Recommended workflow

```bash
npm install
npm run dev
npm run lint
npm run build
npm run preflight
git add .
git commit -m "feat: ..."
git push -u origin main
```

> 首次推送建议使用 `-u` 绑定上游分支，后续可直接 `git push`。

推送到 `main` 后，GitHub Pages workflow 会自动构建并部署。

新增保障：
- `CI` workflow（`.github/workflows/ci.yml`）会在 PR / push 时执行 `npm run check`，提前拦截构建或 lint 问题

## Pages URL

- `https://dingguanglei.github.io/paper-moonlight-h5-pages/`

## Security notes

- 本地测试 API key / base URL 等敏感信息放在 `.env` 中
- `.env`、`.env.*` 已在 `.gitignore` 中忽略
- 仓库内只保留 `.env.example` 作为模板

## Optional local publish script

如果需要在本地生成纯静态产物并同步到另一个目录，可用：

```bash
npm run publish:pages
```

这个脚本当前默认目标仍是 `paper-moonlight-h5-pages`。
