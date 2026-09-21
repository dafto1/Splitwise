## Splitly

A small, dynamic expense-sharing app built with React, TypeScript, Vite, and an Express API.

### Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. The API starts on port 3001 and stores created data in `data/splitly.json`.

### Server4

Copy `.env.example` to `.env` and set `SERVER4_URL` to the Server4 origin. During development, Vite proxies `/api/*` requests to that URL; otherwise it uses the included local API server. The UI makes no requests to hardcoded group data.

### Checks

```bash
npm run check
npm run build
```
