# Sunlight

A static, browser-only paper reading web app for AI-assisted paper reading.

## Features

- Upload PDF (button + drag-and-drop)
- Import PDF from URL (supports direct PDF URL and arXiv `abs` URL auto-conversion)
- Parse PDF text in-browser with pdf.js
- Side-by-side reading / translation view
- AI-generated summary
- Automatic highlighting for:
  - novelty
  - method
  - result
  - limitation
- Tag filtering + keyword search in reader
- PDF-grounded Q&A + recent Q&A history
- User-supplied Base URL / Model / API Key
- No login
- No backend
- Static hosting friendly

## Security Notes

- No API key is hardcoded in source, git, or README.
- API key is entered by user at runtime and stored only in browser `localStorage`.
- A `清空本地 API Key` button is provided for quick cleanup on shared devices.
- This app calls an OpenAI-compatible `/chat/completions` endpoint directly from the browser.

## Tech

- React + Vite
- TypeScript
- pdfjs-dist

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Lint

```bash
npm run lint
```

## Release preflight (recommended)

```bash
npm run preflight
```

This will run:
- lint + build checks
- local preview smoke check (ensure built site can be served)
- tracked-file secret pattern scan (avoid leaking test API key/base URL)
- build output base path verification for GitHub Pages

## Deploy to GitHub Pages (recommended)

This project uses a **single public repository** workflow:

- Develop on `main`
- Push to `main`
- GitHub Actions deploys Pages automatically

```bash
git push origin main
```

Detailed notes: see `DEPLOYMENT_PLAN.md`.

For repository collaboration hygiene and branch/protection recommendations, see `GITHUB_REPO_ORGANIZATION.md`.

## Optional legacy publish script

If you still need to sync `dist/` to another repo/directory manually:

```bash
npm run publish:pages
# or
./scripts/publish-pages.sh /tmp/paper-moonlight-h5-pages git@github.com:<you>/paper-moonlight-h5-pages.git
```
