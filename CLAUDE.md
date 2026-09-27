# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page PWA "Sammelbuch" — a yearly bouldering tracker: one stamp per gym day, badges, statistics, a shareable year card. Design philosophy is radical simplicity — the main "Heute gebouldert" tap stays a single action. Grades/buddy-weeks are optional detail, entered only via "Vergangenen Tag nachtragen", never forced on the main tap. Preserve that calm when adding features.

- **Live:** https://angelocolaninno.github.io/bouldering-app-mit-db/ (GitHub Pages, served from `main`). The older `bouldering-sammelapp` repo/site is decommissioned (Pages disabled) — this repo is now the only official version.
- **Language:** UI text is German (de-CH).

## Architecture (the big picture)

The interface and React app live in `Sammelbuch.html`; `data-model.js` validates old JSON/localStorage backups, and `cloud-store.js` handles account-scoped database snapshots and confirmed writes. There is **no production build step** — React 18 + ReactDOM + Babel Standalone are loaded from pinned CDNs and JSX is transpiled in the browser (`<script type="text/babel">`).

- `index.html` is a 1-line redirect to `Sammelbuch.html`.
- `manifest.json` + `sw.js` + `icon-*.svg` make it an installable PWA.
- `Sammelbuch _standalone_.html` (1.9 MB) is an unrelated bundled artifact — **not** part of the deployment, do not edit/commit it.

`Sammelbuch.html` is organized into commented sections (search for the `// ───` banners): DATA/helpers → TWEAKS PANEL → BADGE EMBLEMS → VISUALIZATIONS → SCREENS → MOMENTS (animations) → `App()` (state + handlers) at the bottom, then `root.render(<App/>)` and SW registration.

State lives in `App()` and flows down via props. There is no router; `tab` state switches between the Sammeln / Erfolge / Jahr screens.

### Data model (Supabase is the source of truth)

An account loads one authenticated snapshot across all years. Every edit calls the database first; the screen changes only after the RPC confirms the write. Offline, a signed-in user can read that account's last confirmed snapshot but can't edit it. Signed-out state has no access to cloud data or editing controls.

- `check_ins` — one Boulder day per user, including `level`.
- `routes` — grade-band counts by date.
- `buddy_weeks` — dates by ISO week.
- `user_settings` — goal, accent color, buddy name and onboarding state.
- `activity_types` — user-defined names and colors for activities such as running, push-ups and pull-ups.
- `activity_logs` — one activity per date. Training does not require a Boulder check-in; dates can be edited in the Nachtragen calendar.

`sammelbuch_snapshot` and `sammelbuch_mutate` are the only app data APIs. Both require an authenticated account; the mutation RPC verifies the expected user ID, performs an atomic account-scoped change, and returns the resulting snapshot. RLS is enabled on every data table.

`localStorage` is only a cache of confirmed cloud snapshots, partitioned by account (`sammelbuch-cache-v2:<user-id>`), plus local UI preferences. Old `sb-*` values are read-only import sources. Local data appears in a reviewable import panel after sign-in; it is never sent automatically. The backup exporter only writes validated app data, never Supabase auth/session keys. A v2 backup contains the canonical JSON snapshot. v1 backups and the former raw `sb-*` key-map format are still accepted.

### Main-screen cards

`SammelnScreen` shows two optional cards between the Besuche/Streak/Monate stat row and the Jahr/Monat toggle, both hidden during demo mode and when browsing a past year (`!showDemo && !viewingPast`):
- **`BuddyStreakCard`** — flame icon, consecutive-weeks count (`computeBuddyStreak`), "Du"/buddy status dots for the current ISO week, and a one-tap "war auch dabei" confirm button that just calls the existing `toggleBuddyWeek`. Editing an arbitrary past week still lives in NachtragenDialog ("Mit Buddy diese Woche") — this card is only a quick-access shortcut for *this* week.
- **`HoroskopCard`** — a persistent inline card with `generateHoroskop()`'s date-seeded quote (same text all day, changes at midnight). A separate full-screen `HoroskopMoment` shows the same quote once per day, 900ms after app open, auto-dismissing after 12s or on tap. Deliberately **not** chained into any post-checkin prompt sequence — the main "Heute gebouldert" tap stays a single action.

Magic-link login via `AuthCard`. A one-time backup import merges missing rows into the selected account and preserves existing database rows/settings. Refresh runs on focus, reconnect, and every 30 seconds so another device's edits appear without relogging. See [NOTES-db.md](NOTES-db.md) for schema and deployment notes.

`computeStats(checkins)` derives everything (total, streak, months, badges) from the checkins array. Levels are a presentation layer, never feed stats. `data-model.js` validates all dates, counts, types and settings at backup boundaries; only fields in its allowlist enter the database.

## Critical gotchas

- **Bump `APP_VERSION` and `CACHE_NAME` together** on every deploy. The service worker caches only the app shell and pinned public CDNs; never cache API/auth responses. A failed network write must remain visible as a database error.
- **z-index / stacking:** `#root` has `z-index:1` (creates a stacking context), and `#tweaks-btn` (the gear) is a `<body>` child with `z-index:9998`, so it paints above everything inside `#root` regardless of their z-index. Past bug: the gear overlapped the panel's ✕ and ate the tap. Watch for this when positioning fixed overlays.
- **Editing surfaces:** the Monat view inside SammelnScreen is **read-only** (no `onToggle`/`onSetLevel` passed). Day add/remove/level editing happens only in the `NachtragenDialog` ("Vergangenen Tag nachtragen"). Both render the same `VizMonth` component — its `editable` flag is just `!!onToggle`.
- **Year is dynamic.** Don't hardcode 2026 again. Components take a `year` prop (default `YEAR`); the App can view past years via the `year` state / "Jahr" selector.

## Commands

```bash
npm install
npm run dev       # http://localhost:4178/Sammelbuch.html
npm run check     # JSX/JavaScript syntax and service-worker version
npm test          # data validation, account cache and sync behavior
```

### Verifying changes in the browser

Because the SW caches aggressively, a plain reload often shows stale code while testing. Force fresh load by unregistering the SW, clearing caches, and navigating with a cache-buster query (`Sammelbuch.html?v=<timestamp>`) — the SW's cache-first match is URL-based, so the query busts it.

### Deploy

GitHub Pages auto-deploys from `main`. The migration filename matches the version recorded in the live database: `supabase/migrations/20260927081924_database_first_tracker.sql`. Verify with:
```bash
curl -s "https://angelocolaninno.github.io/bouldering-sammelapp/sw.js?cb=$(date +%s)" | grep CACHE_NAME
```
On iPhone, an installed PWA updates by fully closing and reopening (sometimes twice) — no need to re-add to home screen. **Warn before suggesting removal of the PWA: deleting it on iOS can wipe localStorage (the user's check-ins). Recommend "Backup sichern" first.**
