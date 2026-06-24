# Notiz: Datenbank / Cloud-Sync (geplant, noch nicht umgesetzt)

Ziel: Check-ins geräteübergreifend synchron + pro Nutzer, statt nur lokal in `localStorage`.
Aktuell ist alles `localStorage` (siehe `CLAUDE.md` → Datenmodell). Das bleibt der Fallback/Offline-Speicher.

## Backend-Entscheid: **Supabase** (gratis-Tier)
Warum: JS-Client per CDN nutzbar → **kein Build-Step nötig** (passt zur Single-File-App). Auth + Postgres + Row-Level-Security eingebaut. Gratis-Tier reicht locker.
- Caveat Gratis-Tier: Projekt pausiert nach ~1 Woche Inaktivität, wacht beim nächsten Aufruf auf (paar Sekunden). Für privat ok.
- Alternative gleichwertig: Firebase (Firestore + Auth).

## Connector-Status (wichtig)
- Es gibt einen offiziellen **Supabase-Connector** im claude.ai-Verzeichnis (Anthropic & Partner) — vom Nutzer **verbunden**.
- ABER: in der **Claude-Code-CLI-Umgebung ist er NICHT verfügbar** (Sichtbarkeits-Check `list_connectors` kam leer). Claude kann Supabase also **nicht** direkt von der Repo-Arbeit aus steuern.
- Vorgehen beim Bau: Claude liefert **Copy-paste-SQL** für den Supabase-SQL-Editor + verdrahtet den JS-Client im Code. (Der Connector ist nur in der claude.ai-Web-App nutzbar.)

## Was der Nutzer vor der Bau-Session bereitstellt
1. Supabase-Projekt anlegen (gratis, Region EU/Frankfurt).
2. Aus **Settings → API**: **Project-URL** + **anon public key** (anon-Key darf öffentlich im Client-Code stehen; RLS schützt die Daten).

## Geplante Tabellen

### `checkins` — eine Zeile pro Tag pro Nutzer
| Spalte | Typ | Hinweis |
|---|---|---|
| `user_id` | uuid → auth.users | Default `auth.uid()` |
| `day` | date | der Boulder-Tag |
| `level` | text | `leicht` / `normal` / `stark`, Default `normal`, CHECK-Constraint |
| `created_at` | timestamptz | Default `now()` |

- **unique (user_id, day)** → pro Tag genau ein Eintrag.
- Jahr/Streak/Statistik wie bisher aus den Zeilen berechnen (`extract(year from day)`). Kein „pro Jahr"-Key mehr nötig.

### `profiles` — Einstellungen pro Nutzer
| Spalte | Typ | |
|---|---|---|
| `user_id` | uuid (PK) → auth.users | |
| `goal` | int | Default 40 |
| `accent` | text | Akzentfarbe |
| `onboarded` | bool | Default false |

### Sicherheit
- RLS auf beiden Tabellen aktiviert.
- Policies: select/insert/update/delete nur wo `user_id = auth.uid()`.

### Auth
- Magic-Link per E-Mail (kein Passwort) — einfachste Variante.
- Optional „Mit Apple anmelden" für iOS-PWA.

## Migration (einmalig beim ersten Login)
App liest bestehende `localStorage`-Daten und schreibt sie in die DB, falls die Cloud für diesen User noch leer ist:
- `sb-checkins-<jahr>` → `checkins`-Zeilen (level aus `sb-levels-<jahr>`, sonst `normal`).
- `sb-goal` / `sb-accent` / `sb-onboarded` → `profiles`.
So gehen die bisherigen Einträge nicht verloren.

## Integration in die App (Stichworte für die Umsetzung)
- `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2">` (CDN, kein Build).
- `createClient(URL, ANON_KEY)`.
- Login-Screen / Auth-State; bei eingeloggtem User Cloud als Quelle, sonst localStorage-Fallback (offline-fähig halten).
- SW-Cache (`CACHE_NAME` + `APP_VERSION`) beim Deploy hochzählen.
