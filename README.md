## Splitly

A small, dynamic expense-sharing app built with React, TypeScript, Vite, and an Express API.

Accounts use name, email, and a minimum six-character password. Passwords are salted and hashed on the server; the client retains only a session token. Each account sees groups they create or are added to.

Group members must have existing Splitly accounts. Search by name or email when creating a group or adding a member.

### Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. The API uses the `PORT` value from `.env`, defaulting to port 3000.

### Server4

Copy `.env.example` to `.env`. During development, Vite proxies `/api/*` requests to the `SERVER4_URL` value when set, otherwise to the local API server on `PORT` (default 3000). Keep the API on a separate port from Vite (for example, 3000) and avoid pointing `SERVER4_URL` back at `http://localhost:5173`.

### Checks

```bash
npm run check
npm run build
```
