# Live Sports Tracker · Sideline

**[Open the interactive website](https://sideline-yis4u-live-sports.zhenyea08.chatgpt.site)**

The website opens the dashboard directly. The GitHub repository contains the source code and this setup guide.

The hosted version currently uses clearly labeled sample scores and device-local favorites. Real scores need the server-side API-Sports key. PostgreSQL profile syncing is available in the Node.js app below and is not configured on the hosted Worker.

A multi-sport match center built with Next.js, TypeScript, React, and PostgreSQL. Follow football, basketball, and baseball fixtures, browse standings and player leaders, and save teams to your profile.

This repository is Project 1 of five separate projects. Development of Movie Night Matcher, AI Travel Planner, Campus Study Spot Finder, and Habit Tracker That Grows a Garden belongs in separate conversations and repositories. See [project conversation prompts](docs/project-conversations.md) for the handoff to each new chat.

## What works

- Match center with sport, date, status, and team search filters.
- Live, upcoming, finished, and postponed fixtures with match details.
- League standings and player leaderboards.
- Guest favorites saved on the current device.
- PostgreSQL accounts, password sign-in, persistent favorite teams, and update preferences.
- In-app game-day updates for your saved teams.
- A clearly labeled demo experience when no sports API key is configured.

Match dates are selected in UTC; match times are displayed in the browser's local timezone. The dashboard refreshes every 60 seconds. Provider responses are cached for 60 seconds per sport/date/configuration to reduce API usage.

## Run the demo

### Hosted website build

The public website reuses the same React dashboard through a self-contained Sites Worker. Its build includes the frontend and server-side sports adapter; it does not require a Next.js server.

```sh
npm ci
npm run build:site
npm run validate:site
npm run preview:site
```

The local hosted preview opens at <http://localhost:8787>. It supports browsing all three sports and saving favorites on the current device. Account syncing needs the PostgreSQL-backed Node.js deployment described below. API-Sports secrets belong in the hosting platform's runtime secret settings.

### Next.js development

Use Node.js 22 or newer and npm.

```sh
npm ci
npm run dev
```

Open <http://localhost:3000>. Without environment variables, sample scores and statistics are explicitly labeled as demo data. Guest favorites work without a database. Creating an account requires PostgreSQL.

## Enable accounts with PostgreSQL

Docker Compose is the simplest local setup; an existing PostgreSQL instance also works.

```sh
cp .env.example .env.local
docker compose up -d db
npm run db:migrate
npm run dev
```

The included database binds only to `127.0.0.1:5432` and stores its data in a named Docker volume. The example password is for local development. Use a distinct strong password for any other environment.

`npm run db:migrate` loads `.env.local`, applies SQL files in `db/migrations` in order, and records completed migrations. It can be run again safely. Stop the local database with `docker compose stop db`; `docker compose down` removes the container while retaining the named volume.

Accounts use salted scrypt password hashes and opaque cookie sessions. Only session token hashes are stored in PostgreSQL. Session cookies are HttpOnly, SameSite=Lax, and Secure in production. Account writes require a matching application origin. Favorite-team queries are scoped to the signed-in account.

## Connect live sports data

Create an [API-Sports](https://api-sports.io/) account and enable the subscriptions needed for each sport. In `.env.local`, set `API_SPORTS_KEY` and the league and season values for the sports you want to use. The key stays on the server; never prefix it with `NEXT_PUBLIC_` or commit it.

| Sport      | API host                      | Example league        | Example season |
| ---------- | ----------------------------- | --------------------- | -------------- |
| Football   | `v3.football.api-sports.io`   | `39` — Premier League | `2026`         |
| Basketball | `v1.basketball.api-sports.io` | `12` — NBA            | `2026-2027`    |
| Baseball   | `v1.baseball.api-sports.io`   | `1` — MLB             | `2026`         |

These values are configuration examples. Verify the league IDs, season format, data coverage, and subscription access in the provider's current documentation. Allow outbound HTTPS to the relevant hosts on your deployment platform. A key alone does not guarantee access to all three products.

With a key configured, missing sport settings or provider failures produce an explicit error. The application does not silently replace failed live requests with demo scores. Empty fixture dates remain empty. Live football player leaders use the top-scorers endpoint. Live basketball and baseball player leaderboards are not yet integrated; their sample player data is available only in demo mode.

The live adapters could not be verified against a subscribed API during development because provider credentials and outbound access were unavailable. Check each configured sport with your subscription before treating the application as a production score service. Live scores are polling-based and remain subject to provider coverage, delay, quotas, and availability.

Live dashboard requests share a per-process limit of 30 requests per minute; cached requests also count. Requests over that limit receive HTTP 429 with a 60-second retry interval. Each uncached football query makes three provider requests; basketball and baseball make two. This guard does not replace the provider's quotas or a shared gateway limiter across multiple application instances. Demo requests do not use the live limiter.

## Configuration

| Variable                                    | Purpose                                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                              | PostgreSQL connection string. Leave unset for guest-only use.                                           |
| `APP_ORIGIN`                                | Exact public application origin, such as `https://sports.example.com`. Set this behind a reverse proxy. |
| `API_SPORTS_KEY`                            | Server-only API-Sports key. Leave empty for demo mode.                                                  |
| `FOOTBALL_LEAGUE_ID`, `FOOTBALL_SEASON`     | Football competition and season.                                                                        |
| `BASKETBALL_LEAGUE_ID`, `BASKETBALL_SEASON` | Basketball competition and season.                                                                      |
| `BASEBALL_LEAGUE_ID`, `BASEBALL_SEASON`     | Baseball competition and season.                                                                        |

## Checks and production build

```sh
npm run typecheck
npm test
npm run build
npm start
```

GitHub Actions runs the type check, unit tests, and production build on pushes and pull requests. Database migrations are a separate deployment step and are not run automatically during the application build.

### Database integration checks

Use a disposable PostgreSQL database whose name contains `test`. The integration check applies migrations twice to verify that repeat runs are safe, tests account/session/favorite ownership behavior, and removes the accounts it creates. It skips when `TEST_DATABASE_URL` is unset.

For the included local database:

```sh
docker compose exec db createdb -U sideline sideline_test
TEST_DATABASE_URL='postgresql://sideline:local_dev_password@127.0.0.1:5432/sideline_test' npm run test:db
```

Create `sideline_test` once; omit the `createdb` command when it already exists. Use a separate test database instead of pointing this check at your normal application data.

### Browser checks

Install Playwright's browser once, then run the dashboard checks:

```sh
npx playwright install chromium
API_SPORTS_KEY='' npm run test:e2e
```

The suite in `tests/e2e/dashboard.spec.ts` covers sport/date/status navigation, search, guest favorites, updates, dialogs, provider error recovery, and mobile behavior. It starts the development server at `http://127.0.0.1:3000` unless an existing server is available. These checks expect demo data, so keep `API_SPORTS_KEY` empty in the tested server.

The account browser flow is opt-in. First migrate a disposable database using the integration command above. Stop any existing development server, then run:

```sh
DATABASE_URL='postgresql://sideline:local_dev_password@127.0.0.1:5432/sideline_test' \
APP_ORIGIN='http://127.0.0.1:3000' E2E_ACCOUNTS=1 API_SPORTS_KEY='' npm run test:e2e
```

The account flow creates a test profile, so use only the disposable database. Without `E2E_ACCOUNTS=1`, the account browser test is skipped. On Linux CI, use `npx playwright install --with-deps chromium` to include required system libraries.

The GitHub Actions workflow is configured to run unit checks, PostgreSQL integration checks, the production build, and all browser checks against a disposable PostgreSQL 17 service. Its first remote run remains the source of truth for the GitHub Actions result.

Deploy to a Node.js host with PostgreSQL connectivity. Configure environment variables in the host's secret settings, use HTTPS, set `APP_ORIGIN`, apply migrations before serving traffic, and use your database provider's recommended verified TLS connection settings. Keep `.env.local` and database data out of Git.

## Current limits

- Game-day updates appear inside the app. Email, browser push, and background notification delivery are not implemented.
- Password reset, email verification, social sign-in, and account recovery are not implemented.
- Request limits are bounded and process-local. Add a shared gateway limiter before scaling to multiple instances or opening a high-traffic public service.
- Each sport displays one configured competition. Changing competition settings is a server configuration task.
- Demo favorites use demo team IDs and remain separate from provider team IDs.

The intended GitHub repository is `yis4u/live-sports-tracker`. No paid API subscription or hosting purchase is required to explore the demo.
