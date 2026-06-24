# Supabase einrichten (einmalig, ~5 Min)

Das ist der einzige Teil, den nur du machen kannst. Danach läuft Cloud-Sync.

## 1. Projekt anlegen
1. Auf **https://supabase.com** mit GitHub einloggen.
2. **New project** → Name z. B. `sammelbuch`, Region **Frankfurt (EU Central)**, ein DB-Passwort setzen (irgendwo notieren), Plan **Free**.
3. Warten, bis das Projekt bereit ist (~1–2 Min).

## 2. Schema anlegen
1. Linke Leiste → **SQL Editor** → **New query**.
2. Inhalt von [`supabase-setup.sql`](supabase-setup.sql) einfügen → **Run**.
3. Sollte „Success" zeigen (Tabellen `checkins` + `profiles` mit RLS).

## 3. E-Mail-Login aktivieren
1. Linke Leiste → **Authentication** → **Providers** → **Email** ist standardmäßig an (Magic Link). Nichts weiter nötig.
2. **Authentication → URL Configuration**: bei **Site URL** und **Redirect URLs** die App-URL eintragen:
   - `https://angelocolaninno.github.io/bouldering-app-mit-db/Sammelbuch.html`
   - (fürs lokale Testen zusätzlich `http://localhost:4179/Sammelbuch.html`)

## 4. Schlüssel holen
**Settings → API**, diese zwei Werte kopieren:
- **Project URL** (z. B. `https://abcd.supabase.co`)
- **anon public** key (langer Token — darf öffentlich im Code stehen, ist dafür gedacht; RLS schützt die Daten)

## 5. In die App eintragen
In `Sammelbuch.html` ganz oben die zwei Konstanten füllen:
```js
const SUPABASE_URL = 'https://abcd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGci...';   // anon public key
```
Leer lassen = reiner localStorage-Betrieb wie bisher. Sobald beide gefüllt sind, schaltet sich Login + Cloud-Sync automatisch ein.

---
Wenn du URL + anon-Key hast: hier reinschreiben oder mir geben, dann teste ich Login/Sync/Migration mit dir gemeinsam und wir mergen den Branch `feature/supabase-sync` nach `main`.
