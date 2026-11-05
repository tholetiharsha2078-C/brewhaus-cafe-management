# Brewhaus Coffee & Kitchen — Cafe Management System

A complete single-location cafe platform built entirely on Cloudflare: one Worker serves the React storefront and the `/api` backend, backed by D1, R2, and a Durable Object for realtime kitchen events.

Three interfaces share one database and one set of server-enforced permissions:

| Interface | Path | Purpose |
| --- | --- | --- |
| Customer site | `/` | Menu, reservations, table-QR ordering, checkout, live tracking, reviews, loyalty, AI menu guide |
| Kitchen display (KDS) | `/kitchen` | Large-text tablet board, item-level tracking, prep timers, allergy alerts, station routing, handover, history |
| Management workspace | `/admin` | Dashboard, reservations, orders, menu, payments, floor plan, customers, retention, finance, analytics, inventory, AI assistant, settings |

## Stack

- **Frontend:** React 19, Vite 8, React Router 7, lucide-react
- **Backend:** Hono on Cloudflare Workers
- **Data:** Cloudflare D1 (SQLite), R2 (images), Durable Objects + WebSockets (realtime), Workers AI with deterministic fallback
- **Auth:** PBKDF2 password hashes, opaque session cookies stored hashed in D1, separate staff/customer sessions, RBAC enforced server-side

## Live deployment

The current production deployment runs on Cloudflare Workers:

- **App:** https://brewhaus-cafe.tholetiharsha2078.workers.dev
- **D1:** `brewhaus-db` (APAC region) with both migrations applied
- **Durable Object:** `KitchenHub` for realtime kitchen events
- **Workers AI:** bound; rule-based fallback is used whenever the model is unavailable

> **Security:** the database auto-seeds demo content on the first request. Staff passwords were rotated immediately after the first deployment, so the demo staff passwords below are **local-only** and do not work in production. Never deploy without changing every staff password.

**R2 is not enabled on the account yet**, so the `IMAGES` binding is currently commented out in `wrangler.jsonc`. Menu/product imagery served from `public/seed` works normally; new image uploads will return `503` until R2 is activated. To finish enabling it:

```bash
npx wrangler r2 bucket create brewhaus-images
```

Then uncomment the `r2_buckets` block in `wrangler.jsonc` and run `npx wrangler deploy` again.

### Custom domain

In the Cloudflare dashboard, open **Workers & Pages → brewhaus-cafe → Settings → Domains & Routes → Add custom domain**, for example `cafe.yourdomain.com`, and follow the DNS prompt. No code change is required.

## Quick start (local)

```bash
npm install
npm run db:init        # apply D1 migrations locally
npm run dev:api        # Worker on http://127.0.0.1:8787 (local D1/R2/DO)
npm run dev            # Vite on http://127.0.0.1:5173 (proxies /api)
```

The database seeds itself on first request with ~45 days of realistic service data, so every dashboard figure is a real database computation.

To reset local data:

```bash
npm run db:reset
```

### Demo accounts (local development only)

| Role | Email | Password |
| --- | --- | --- |
| Owner | `admin@brewhaus.cafe` | `Admin@123` |
| Manager | `nisha@brewhaus.cafe` | `Manager@123` |
| Kitchen | `kitchen@brewhaus.cafe` | `Kitchen@123` |
| Kitchen supervisor | `meera@brewhaus.cafe` | `Kitchen@123` |
| Waiter | `waiter@brewhaus.cafe` | `Waiter@123` |
| Customer | `priya@example.com` | `Customer@123` |

These credentials exist only in a freshly seeded local database. Change them before exposing any deployment to the internet.

## Production

```bash
npm run deploy
```

Before deploying, create the real Cloudflare resources and update `wrangler.jsonc`:

1. `npx wrangler d1 create brewhaus-db` and set `database_id`.
2. `npx wrangler r2 bucket create brewhaus-images`.
3. Apply migrations remotely: `npx wrangler d1 migrations apply brewhaus-db --remote`.
4. Set secrets with `npx wrangler secret put …` (for example `RESEND_API_KEY` for password-reset email). Never put secrets in client code or `wrangler.jsonc` vars.
5. Optional: bind Workers AI (`AI`) as already declared in `wrangler.jsonc`. Without it, the assistant falls back to deterministic database-grounded answers.

`npm run build` outputs the SPA to `dist/`; the Worker serves it through the `ASSETS` binding with SPA fallback, while `/api/*` runs the Worker first.

## Key behaviour

- **Money** is stored in paise-equivalent numeric columns and rendered in INR with Indian digit grouping.
- **Orders** use one shared `createOrder` service for management, customer, and public routes. The server revalidates item availability, required options, prices, offers, loyalty, tax, and service charge.
- **Order lifecycle:** `pending → confirmed → preparing → ready → collected → served → completed`. The kitchen cannot mark an order served; an order can become ready only when every item is ready.
- **Reservations** use temporary holds with expiry and atomic conflict checks, preventing double booking of a table/slot.
- **Payments** are recorded as pending and verified manually by staff (cash, UPI, card, other) with full/partial refunds. No fake gateway success.
- **AI** never invents business figures: answers are grounded in queried database facts, with a rule-based fallback when Workers AI is unavailable (for example in local development).
- **Table QR ordering:** open any customer page with `?table=<id|label>`; the table is remembered for checkout.

## Repository layout

```
src/                 React application
  components/        Shared management shell and UI primitives
  lib/               Auth/toast/cart/realtime contexts and API client
  pages/admin/       Management workspace
  pages/kitchen/     Kitchen display
  pages/customer/    Storefront and account
  pages/auth/        Login, registration, password reset
worker/              Hono API, D1 queries, domain services
migrations/          D1 schema and seed migrations
public/seed/         Local product and venue imagery
```

## Verification

```bash
npm run build
```

Then exercise the flows locally: staff login and dashboard, reservation create/cancel with conflict handling, order statuses through the kitchen board, menu and floor-plan editing, payment verification/refund, inventory adjustments, customer ordering/tracking/reviews/loyalty, and the AI assistant fallback.
