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
npm run check
```

## Publish to GitHub Pages repo

```bash
npm run publish:pages
```

This publishes the built `dist/` output to the separate public Pages repository.

### Publish with custom repo path / remote

```bash
./scripts/publish-pages.sh /tmp/paper-moonlight-h5-pages git@github.com:<you>/paper-moonlight-h5-pages.git
```
