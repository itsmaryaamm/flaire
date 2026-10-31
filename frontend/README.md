# Flaire frontend

React + TypeScript single-page app for Flaire, the finance department for AI employees. Built with Vite, Tailwind CSS v3, react-router-dom v6, axios, lucide-react icons and recharts for the spend chart.

Simulation only. No real money moves.

## Run

```bash
npm install
cp .env.example .env        # then edit VITE_API_URL if the backend is not on localhost:8000
npm run dev                 # http://localhost:5173
```

`VITE_API_URL` is the backend base URL including `/api/v1`. It defaults to `http://localhost:8000/api/v1` when unset. The app calls the API directly (CORS), there is no dev proxy.

Demo login: `demo@flaire.sa` / `demo1234`.

## Build

```bash
npm run build               # type-checks, then outputs dist/
npm run typecheck           # tsc --noEmit only
npm run preview             # serve dist/ locally
```

`vercel.json` contains the SPA rewrite so deep links work on Vercel.

## Layout

- `src/lib/api.ts` axios instance (bearer token from localStorage, 401 redirects to /login)
- `src/lib/money.ts` halalas to "SAR 1,234.50" and back
- `src/lib/auth.tsx` auth context (login, register, logout, current user and company)
- `src/types.ts` types matching `docs/API.md`
- `src/components/` small shared pieces: StatusPill, Money, Modal, KpiTile, EmptyState, etc.
- `src/pages/` one file per route
