# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page PWA "Sammelbuch" — a yearly bouldering tracker: one stamp per gym day, badges, statistics, a shareable year card. Design philosophy is radical simplicity — the main "Heute gebouldert" tap stays a single action. Grades/buddy-weeks are optional detail, entered only via "Vergangenen Tag nachtragen", never forced on the main tap. Preserve that calm when adding features.

- **Live:** https://angelocolaninno.github.io/bouldering-app-mit-db/ (GitHub Pages, served from `main`). The older `bouldering-sammelapp` repo/site is decommissioned (Pages disabled) — this repo is now the only official version.
- **Language:** UI text is German (de-CH).

## Architecture (the big picture)

The entire app is **one file: `Sammelbuch.html`** (~1300 lines). There is **no build step** — React 18 + ReactDOM + Babel Standalone are loaded from unpkg CDN and JSX is transpiled in the browser (`<script type="text/babel">`). You edit the HTML, commit, push — that's the whole pipeline.

- `index.html` is a 1-line redirect to `Sammelbuch.html`.
- `manifest.json` + `sw.js` + `icon-*.svg` make it an installable PWA.
- `Sammelbuch _standalone_.html` (1.9 MB) is an unrelated bundled artifact — **not** part of the deployment, do not edit/commit it.

`Sammelbuch.html` is organized into commented sections (search for the `// ───` banners): DATA/helpers → TWEAKS PANEL → BADGE EMBLEMS → VISUALIZATIONS → SCREENS → MOMENTS (animations) → `App()` (state + handlers) at the bottom, then `root.render(<App/>)` and SW registration.

State lives in `App()` and flows down via props. There is no router; `tab` state switches between the Sammeln / Erfolge / Jahr screens.

### Data model (localStorage, + optional Supabase cloud sync since v13)

All persistence is `localStorage` first, keyed per year so a new year starts fresh automatically (`YEAR = new Date().getFullYear()`):

- `sb-checkins-<year>` — JSON array of ISO day strings, e.g. `["2026-05-15"]` (the source of truth for "which days").
- `sb-levels-<year>` — **sparse** map `{iso: "leicht"|"stark"}`. Absence = `"normal"`. Backward-compatible: old data/backups without this key just read as normal.
- `sb-goal`, `sb-accent`, `sb-onboarded` — global settings.
- `sb-routes-<year>` — sparse map `{iso: {gradeKey: 1|2|3}}`, entered via the Grade-Chips in "Vergangenen Tag nachtragen". Grade bands + colors are `GRADES` (search for it) — 8 gym-typical bands (`bis 4c` … `ab 8a+`, plus `Guess the Grade`), shown as small dots on the day cell (`GradeDots`) and decoded by `GradeLegend` under the month grid.
- `sb-buddy-<year>` — array of ISO week keys (`"2026-W05"`) where you climbed with your buddy that week.
- `sb-activity-types` (global, not per-year) — user-defined activities (e.g. "Joggen") as `[{id,label,color}]`, managed in the Tweaks panel's "Aktivitäten" section (`TweakActivityEditor`).
- `sb-activities-<year>` — sparse map `{iso: [typeId, ...]}`. Logged via a pill row on the main Sammeln screen (`ActivityRow`, today only) — deliberately **not** gated behind a boulder check-in, since e.g. jogging happens on days you may not boulder. This is the one exception to "editing lives only in NachtragenDialog". Local-only, no Supabase table yet.
- `sb-buddy-name` (global) — the buddy's display name, set in the Tweaks panel's "Buddy Streak" section, independent of login.
- `sb-horoskop-seen` — today's ISO date once the `HoroskopMoment` full-screen quote has been shown/dismissed; gates it to once per day.

### Main-screen cards

`SammelnScreen` shows two optional cards between the Besuche/Streak/Monate stat row and the Jahr/Monat toggle, both hidden during demo mode and when browsing a past year (`!showDemo && !viewingPast`):
- **`BuddyStreakCard`** — flame icon, consecutive-weeks count (`computeBuddyStreak`), "Du"/buddy status dots for the current ISO week, and a one-tap "war auch dabei" confirm button that just calls the existing `toggleBuddyWeek`. Editing an arbitrary past week still lives in NachtragenDialog ("Mit Buddy diese Woche") — this card is only a quick-access shortcut for *this* week.
- **`HoroskopCard`** — a persistent inline card with `generateHoroskop()`'s date-seeded quote (same text all day, changes at midnight). A separate full-screen `HoroskopMoment` shows the same quote once per day, 900ms after app open, auto-dismissing after 12s or on tap. Deliberately **not** chained into any post-checkin prompt sequence — the main "Heute gebouldert" tap stays a single action.

**Cloud sync (Supabase, since v13):** logged-in users additionally dual-write every change to Supabase tables `check_ins`, `routes`, `user_settings`, `buddy_weeks` (RLS-protected, `user_id = auth.uid()`). Magic-link login via `AuthCard`; `dbMigrateLocal()` copies existing `localStorage` data into the cloud once on first login. Not logged in = pure localStorage, fully offline. Client + helper functions (`dbLoadYear`, `dbUpsertCheckin`, etc.) live near the top of `Sammelbuch.html` (search `SUPABASE_URL`). See [NOTES-db.md](NOTES-db.md) for the full design and open verification gaps.

`computeStats(checkins)` derives everything (total, streak, months, badges) from the checkins array. Levels are a presentation layer (dot color via `levelColor()`), never feed stats. Export/Import (Backup) grabs **all `sb-*` keys**, so new per-year keys are included automatically.

## Critical gotchas

- **Bump the service-worker cache on every change you intend to deploy.** `sw.js` serves `Sammelbuch.html` **cache-first**, so installed PWAs keep the old version until `CACHE_NAME` changes (currently `sammelbuch-v9` → bump to `-v10`, etc.). Forgetting this means users (and you, testing) silently see stale code. This is the #1 source of "my change didn't show up".
- **z-index / stacking:** `#root` has `z-index:1` (creates a stacking context), and `#tweaks-btn` (the gear) is a `<body>` child with `z-index:9998`, so it paints above everything inside `#root` regardless of their z-index. Past bug: the gear overlapped the panel's ✕ and ate the tap. Watch for this when positioning fixed overlays.
- **Editing surfaces:** the Monat view inside SammelnScreen is **read-only** (no `onToggle`/`onSetLevel` passed). Day add/remove/level editing happens only in the `NachtragenDialog` ("Vergangenen Tag nachtragen"). Both render the same `VizMonth` component — its `editable` flag is just `!!onToggle`.
- **Year is dynamic.** Don't hardcode 2026 again. Components take a `year` prop (default `YEAR`); the App can view past years via the `year` state / "Jahr" selector.

## Commands

```bash
# Local preview (static server). A .claude/launch.json defines this for the preview MCP.
python3 -m http.server 4178      # then open http://localhost:4178/Sammelbuch.html
```

There are **no tests, no linter, no package manager** — it's a static site.

### Verifying changes in the browser

Because the SW caches aggressively, a plain reload often shows stale code while testing. Force fresh load by unregistering the SW, clearing caches, and navigating with a cache-buster query (`Sammelbuch.html?v=<timestamp>`) — the SW's cache-first match is URL-based, so the query busts it.

### Deploy

GitHub Pages auto-deploys from `main`; a push goes live in ~1–2 min. Verify with:
```bash
curl -s "https://angelocolaninno.github.io/bouldering-sammelapp/sw.js?cb=$(date +%s)" | grep CACHE_NAME
```
On iPhone, an installed PWA updates by fully closing and reopening (sometimes twice) — no need to re-add to home screen. **Warn before suggesting removal of the PWA: deleting it on iOS can wipe localStorage (the user's check-ins). Recommend "Backup sichern" first.**
