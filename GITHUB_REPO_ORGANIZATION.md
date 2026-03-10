# GitHub 仓库整理方案（可执行）

目标：把 `paper-moonlight-h5-pages` 维持在“可持续迭代 + 可直接发布”的状态。

## 1) 分支与保护（手动一次性配置）

建议在 GitHub 仓库设置里为 `main` 开启：
- Require pull request before merging
- Require status checks to pass（至少 CI）
- Require linear history（可选）
- Restrict force pushes

> 当前仓库 CI 已具备（`.github/workflows/ci.yml`）。

## 2) 协作入口模板（已落地）

已新增：
- `.github/pull_request_template.md`
- `.github/ISSUE_TEMPLATE/bug_report.md`
- `.github/ISSUE_TEMPLATE/feature_request.md`

作用：统一描述粒度，减少“信息不全导致的往返沟通”。

## 3) 发布前检查（已落地）

默认发布前执行：
```bash
npm run preflight
```

覆盖：
- lint + build
- 本地 preview smoke
- 敏感信息 pattern 扫描
- Pages base path 检查

## 4) 推荐提交策略

- 功能分支命名：`feat/*`、`fix/*`、`chore/*`
- 合并策略：Squash merge（保持主线整洁）
- 提交信息：`type: summary`（如 `feat: add page translation cache`）

## 5) 后续可选增强

- 增加 E2E（Playwright）覆盖“上传 PDF → 自动分析 → 提问”主链路
- 增加 Dependabot（自动依赖更新）
- 增加 CODEOWNERS（如后续多人协作）
