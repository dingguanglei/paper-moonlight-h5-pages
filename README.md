# Paper Moonlight H5

A static, browser-only paper reading web app inspired by Moonlight.

## Features

- Upload a PDF or load a PDF from URL
- Parse PDF text in-browser with pdf.js
- Side-by-side reading / translation view
- AI-generated summary
- Automatic highlighting for:
  - novelty
  - method
  - result
  - limitation
- PDF-grounded Q&A
- User-supplied Base URL / Model / API Key
- No login
- No backend
- Static hosting friendly

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

## Notes

This app calls an OpenAI-compatible `/chat/completions` endpoint directly from the browser.
Users should provide their own API key and compatible base URL.
