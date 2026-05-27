# OfficerND Ticket Scraper

Scrapes open issues from OfficerND and inserts new ones into an existing Supabase `tasks` table.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: Supabase (`@supabase/supabase-js`)
- Scraping: Playwright (Chromium headless)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server/src/lib/scraper.ts` — Playwright login + issue extraction logic
- `artifacts/api-server/src/lib/supabase.ts` — Supabase client
- `artifacts/api-server/src/routes/scrape.ts` — POST /api/scrape route

## API Endpoints

- `POST /api/scrape` — logs into OfficerND, scrapes open issues, inserts new ones into the `tasks` table (skips duplicates by `ticket` number)
- `GET /api/healthz` — health check

## Supabase `tasks` table columns used

| Column | Value |
|---|---|
| title | Issue title from OfficerND |
| description | Issue description (if available) |
| ticket | OfficerND issue ID/number |
| link | Direct URL to the issue |
| completed | false |
| email_added | false |
| priority | normal |
| building | Kiln |
| rollover_count | 0 |
| recurring | false |
| archived | false |

## Architecture decisions

- No auto-ID sent to Supabase — the `tasks` table generates its own `id`
- Deduplication via `ticket` field: existing ticket numbers are fetched first, only new ones are inserted
- Pagination is handled automatically if OfficerND shows multiple pages
- `page.evaluate()` runs in browser context; typed as `any` internally to avoid DOM/Node type conflicts

## User preferences

- Insert into `tasks` table (not a custom tickets table)
- Supabase auto-generates the `id` — never send it from the scraper
- `building` defaults to `Kiln`, `priority` defaults to `normal`

## Secrets required

- `OFFICERND_EMAIL` — OfficerND login email
- `OFFICERND_PASSWORD` — OfficerND login password
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_ANON_KEY` — Supabase anon/public key
