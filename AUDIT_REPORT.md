📊 Codebase Health & Audit Report

## 1. Executive Summary

The Stockscope codebase is an ambitious, Next.js (App Router) based application designed for stock screening, portfolio management, and advanced analytics. It has a strong UI layer built with Tailwind CSS and numerous React components handling complex data visualization. However, the application currently suffers from significant architectural drift, excessive technical debt, and a lack of clear separation of concerns between client and server layers. Many pages are improperly marked as `"use client"` while performing data fetches or session checks, circumventing the benefits of Next.js Server Components. Additionally, the build system and test suites are currently broken due to TypeScript definition errors and misconfigured ESM/Jest integrations.

Overall Health Score: **45/100**

## 2. Architecture & Tech Stack Summary

- **Frontend:** Next.js (App Router), React 19, Tailwind CSS v4, Lucide React (icons), and Chart.js/Recharts for visualization.
- **Backend/API:** Next.js API Routes (Serverless Functions) built within the Next.js `app/api` directory.
- **Data Layer:** Prisma ORM connected to MongoDB.
- **Authentication:** NextAuth.js (v4) using JWT and Google Provider.
- **Infrastructure & Integrations:** Midtrans & Stripe for payments, Redis for rate limiting (ioredis), Socket.io for real-time alerts.

*Note: The prompt initially suggested a Python/FastAPI backend and PostgreSQL. The audit confirms that this is purely a Node.js/Next.js stack using MongoDB.*

## 3. Test Suite & Build Status

*Note: The findings below are based on manual code inspection and local run attempts. Exact error logs are not persisted in source control; CI should be configured to upload test artifacts as pipeline outputs rather than checking them in.*

- **Linting/Type Checking:** **Likely failing** (based on code inspection)
  - **`tsc --noEmit`**: Expected to fail due to missing type declarations for `react-slider`, `react-table`, and `react-modal`, plus a Chart.js v3/v4 mismatch. The `chart.js` peer dependency conflict has since been resolved by upgrading to v4.x.
  - **`eslint`**: Expected to produce numerous errors and warnings based on observed patterns: pervasive use of `@typescript-eslint/no-explicit-any`, missing `key` props in iterators (`ScreenerTable.tsx`), and unused variables.
- **Backend Tests:** **Could not execute**
  - Jest tests could not run due to an ESM/CommonJS interop issue (`SyntaxError: Cannot use import statement outside a module`). The `ts-jest` configuration appears to be missing or misaligned with the project's ESM settings.
- **Frontend/E2E Tests:** **Could not execute** (Playwright webServer timeout observed locally)
  - Playwright tests timed out during web-server setup because `server.ts` instantiates `PrismaClient` at module load and `prisma/schema.prisma` reads `env("DATABASE_URL")`, which is not set in the test environment. `DATABASE_URL` should be provided via `.env.local` or the CI environment (or the `webServer.env` block in `playwright.config.ts`) so the dev server can start successfully.

## 4. 🚨 Critical Issues (Immediate Action Required)

- **Test Suite Breakage (ESM/Jest):** All unit and E2E tests are failing to run.
  - *Path:* `tests/e2e/*.spec.ts`, `tests/api/*.test.ts`
  - *Action:* Migrate Jest config to support ESM or configure `ts-jest` properly.
- **TypeScript & Build Failure:** Missing types for fundamental UI libraries.
  - *Path:* `src/components/features/screener/*`
  - *Action:* `npm i -D @types/react-slider @types/react-table @types/react-modal`
- **Security - Unsafe ID Generation:** ~~Cryptographically insecure ID generation is used for rate-limiting tokens and Midtrans order IDs.~~ **Fixed:** `Math.random()` replaced with `crypto.randomUUID()` in `src/lib/rate-limit.ts` and `uuidv4()` in `app/api/transactions/route.ts`.
- **Security - Weak Admin Authorization:** ~~Admin checks rely on a simple string suffix (`endsWith('@stockscope.com')`) rather than an explicit role/claim in the database.~~ **Fixed:** An `isAdmin Boolean @default(false)` field has been added to the `User` model in `prisma/schema.prisma` and the admin check in `app/api/transactions/route.ts` now reads `user.isAdmin`.
- **Broken Dependency Tree:** ~~Conflicting peer dependencies exist between `react-chartjs-2@5.3.1` (requires Chart.js v4) and `chart.js@3.9.1`.~~ **Fixed:** `chart.js` upgraded to `^4.5.1` in `package.json`.

## 5. ⚠️ Tech Debt & Code Health (Medium Priority)

- **Client vs. Server Component Misuse:** Many top-level page components (e.g., `app/[locale]/alerts/page.tsx`, `app/[locale]/profile/page.tsx`) are marked as `"use client"` and utilize `useSession()`. This forces client-side rendering for entire pages, bypassing SEO and initial load performance benefits.
- **Pervasive `any` Types:** Strong typing is abandoned in critical services and analytics trackers.
  - *Path:* `src/lib/analytics/tracker.ts`, `app/api/admin/billing/route.ts` (using `any` for `where` clauses).
- **Duplicate Logic (Authentication):** `getServerSession(authOptions)` is called redundantly across dozens of API routes. This should be extracted into a reusable `withAuth` middleware or helper function.
- **Dead/Commented Code:** There are lingering mock implementations and commented-out premium tier checks.
  - *Path:* `app/api/stocks/route.ts`, `server.ts` (Socket.io mock polling).
- **Missing Iterator Keys:** React arrays are being rendered without unique keys, which can cause hydration and rendering bugs.
  - *Path:* `src/components/features/screener/ScreenerTable.tsx`.

## 6. ⚡ Performance Bottlenecks

- **N+1 Database Queries:** In `app/api/admin/billing/route.ts`, the code fetches transactions and then does a secondary bulk fetch for users, mapping them in memory. While better than a pure loop, it misses Prisma's native `include` capability, which handles the JOIN at the database level.
- **Bcrypt Hashing on API Requests:** API keys are hashed with bcrypt. While there is a Redis cache in place (`cacheValidatedApiKey`), a cache miss requires an O(N) scan of all active API keys and a bcrypt comparison for each, which is an immediate DDoS vector.
  - *Path:* `src/lib/api-key-middleware.ts` (line 62).
- **Synchronous Polling in Server:** A `setInterval` block inside `server.ts` performs database lookups every 15 seconds to mock an external API and trigger socket events. This locks the main Node thread and will not scale horizontally.

## 7. Strategic Action Plan (Next Steps)

1. **Fix the Build & Dependency Conflicts:**
   - ~~Resolve the `react-chartjs-2` vs `chart.js` version conflict.~~ **Done** — `chart.js` upgraded to v4.5.1.
   - Install missing `@types` for UI libraries to ensure `tsc` passes cleanly.
2. **Restore the Test Pipeline:**
   - Fix Jest ESM configuration (add `jest.config.ts` or adjust `tsconfig.json` for testing).
   - Supply `DATABASE_URL` to the test environment (e.g., via `.env.local` or `playwright.config.ts` `webServer.env`) to allow Playwright web-server spin-up.
3. **Remediate Security Vulnerabilities:**
   - ~~Replace all instances of `Math.random()` with `uuidv4()`.~~ **Done** — replaced with `crypto.randomUUID()` / `uuidv4()`.
   - ~~Implement an explicit `isAdmin` boolean on the Prisma `User` model and replace the email suffix hack.~~ **Done** — `isAdmin Boolean @default(false)` added to schema; admin check updated.
4. **Refactor Architecture & Data Fetching:**
   - Migrate `page.tsx` files to Server Components, moving `use client` directives down to specific interactive UI leaves (e.g., `<AlertForm />`, `<ProfileSettings />`).
   - Create a centralized `lib/auth/utils.ts` for session fetching to DRY up the API routes.
5. **Optimize Database Queries:**
   - Refactor `findMany` calls in admin billing to use Prisma's `include` syntax for related User records.
   - Restructure API Key storage to use a rapid lookup index (e.g., storing a fast hash or prefix separately) rather than scanning the whole table on cache misses.
