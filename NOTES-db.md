# Datenbank und geräteübergreifende Speicherung

**Status: umgesetzt.** Das Projekt `spjjxmoutbqubakvshpm` verwendet Supabase in `eu-west-2`. Die produktive Datenbank-Erweiterung für Aktivitäten und die App-RPCs ist am 27. September 2026 eingespielt. Die Änderungen an der App müssen noch in `main` übernommen werden, bevor GitHub Pages sie auf den Geräten ausliefert.

## Architektur

Supabase ist die einzige schreibbare Quelle für Boulder-Tage, Routen, Buddy-Wochen, Kontoeinstellungen sowie Trainingsarten und Trainingstage. Nach dem Magic-Link-Login lädt die App einen privaten Snapshot über alle Jahre. Eine Änderung gilt erst dann als gespeichert, wenn die Datenbank sie bestätigt hat. Bei fehlender Verbindung bleibt der letzte bestätigte Snapshot nur lesbar.

`localStorage` wird ausschliesslich als kontogetrennter Cache und als Quelle für eine bewusst ausgelöste einmalige Datenübernahme verwendet. Lokale JSON-Backups enthalten nur geprüfte App-Daten, keine Supabase-Sitzungen. Die Übernahme ergänzt fehlende Einträge; vorhandene Datenbankeinträge und Einstellungen behalten Vorrang.

## Tabellen und Zugriff

- `check_ins`: Boulder-Datum und Intensität.
- `routes`: Routen-Zählungen pro Boulder-Datum.
- `buddy_weeks`: bestätigte Wochen.
- `user_settings`: Jahresziel, Akzentfarbe, Buddy-Name und Einrichtungsstatus.
- `activity_types`: private Aktivitätsnamen und Farben.
- `activity_logs`: private Trainingsdaten je Aktivitätsart und Datum.

Alle Tabellen nutzen Row-Level Security und beschränken Zugriff auf `auth.uid()`. Die App lädt und schreibt Daten über `sammelbuch_snapshot` und `sammelbuch_mutate`. Beide Funktionen verlangen ein angemeldetes Konto; Schreibaufträge prüfen zusätzlich die erwartete Benutzer-ID.

Das Schema liegt in `supabase/migrations/20260927081924_database_first_tracker.sql`. Der Versionsname stimmt mit dem Eintrag in der produktiven Supabase-Migrationsliste überein.

## Lokale Entwicklung

```bash
npm install
npm run dev
npm run check
npm test
```

Beim Deploy müssen `APP_VERSION` in `Sammelbuch.html` und `CACHE_NAME` in `sw.js` gemeinsam erhöht werden. Der Service Worker darf keine Supabase-/Auth-Anfragen zwischenspeichern.
