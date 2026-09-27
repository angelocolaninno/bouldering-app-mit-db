(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SammelbuchData = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const GRADES = ['y', 'g', 'o', 'b', 'r', 'w', 'bl', 'p'];
  const LEVELS = ['leicht', 'normal', 'stark'];
  const DEFAULT_ACCENT = '#6b6862';
  const LEGACY_GLOBAL = new Set(['sb-goal', 'sb-accent', 'sb-buddy-name', 'sb-onboarded', 'sb-buddy-weeks', 'sb-activity-types']);
  const LEGACY_YEAR = /^sb-(checkins|levels|routes|buddy|activities)-(\d{4})$/;
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const fail = (message) => { throw new Error(`Ungültige Sammelbuch-Daten: ${message}`); };
  const record = (value, name) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} muss ein Objekt sein.`);
    return value;
  };
  const array = (value, name) => {
    if (!Array.isArray(value)) fail(`${name} muss eine Liste sein.`);
    if (value.length > 200000) fail(`${name} enthält zu viele Einträge.`);
    return value;
  };
  function text(value, name, max, allowEmpty = false) {
    if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()) || /[\u0000-\u001f\u007f]/.test(value)) fail(`${name} ist ungültig.`);
    return value;
  }
  function color(value, name) {
    if (typeof value !== 'string' || !/^#(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(value)) fail(`${name} muss eine Hex-Farbe sein.`);
    const hex = value.slice(1).toLowerCase();
    return '#' + (hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex);
  }
  function date(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('Datum muss YYYY-MM-DD entsprechen.');
    const [year, month, day] = value.split('-').map(Number);
    if (year < 1900 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) fail(`Datum ${value} existiert nicht.`);
    return value;
  }
  function week(value) {
    if (typeof value !== 'string' || !/^\d{4}-W\d{2}$/.test(value)) fail('Buddy-Woche muss YYYY-Www entsprechen.');
    const year = Number(value.slice(0, 4));
    const number = Number(value.slice(6));
    const firstDay = new Date(Date.UTC(year, 0, 1)).getUTCDay();
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const max = firstDay === 4 || (firstDay === 3 && leap) ? 53 : 52;
    if (year < 1900 || number < 1 || number > max) fail(`Buddy-Woche ${value} existiert nicht.`);
    return value;
  }
  function level(value) {
    if (!LEVELS.includes(value)) fail('Anstrengung muss leicht, normal oder stark sein.');
    return value;
  }
  function typeId(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) fail('Aktivitäts-ID muss aus Buchstaben, Ziffern, Bindestrichen oder Unterstrichen bestehen (maximal 200 Zeichen).');
    return value;
  }
  function settings(value) {
    if (value === null || value === undefined) return null;
    record(value, 'Einstellungen');
    const goal = own(value, 'goal') ? value.goal : 40;
    if (!Number.isInteger(goal) || goal < 1 || goal > 10000) fail('Jahresziel muss eine ganze Zahl zwischen 1 und 10000 sein.');
    const onboarded = own(value, 'onboarded') ? value.onboarded : false;
    if (typeof onboarded !== 'boolean') fail('Einführungsstatus muss true oder false sein.');
    return {
      goal,
      accent: color(own(value, 'accent') ? value.accent : DEFAULT_ACCENT, 'Akzentfarbe'),
      buddy_name: text(own(value, 'buddy_name') ? value.buddy_name : '', 'Buddy-Name', 100, true),
      onboarded,
    };
  }
  function emptySnapshot() {
    return { checkins: [], routes: [], buddyWeeks: [], settings: null, activityTypes: [], activities: [] };
  }
  function addUnique(map, key, row, name) {
    if (map.has(key) && JSON.stringify(map.get(key)) !== JSON.stringify(row)) fail(`${name} enthält widersprüchliche doppelte Einträge für ${key}.`);
    map.set(key, row);
  }
  function normalize(value) {
    record(value, 'Datensatz');
    const result = emptySnapshot();
    const checkins = new Map();
    array(value.checkins === undefined ? [] : value.checkins, 'Boulder-Einträge').forEach((row) => {
      record(row, 'Boulder-Eintrag');
      const normalized = { date: date(row.date), level: level(row.level === undefined ? 'normal' : row.level) };
      addUnique(checkins, normalized.date, normalized, 'Boulder-Liste');
    });
    const routes = new Map();
    array(value.routes === undefined ? [] : value.routes, 'Routen').forEach((row) => {
      record(row, 'Routen-Eintrag');
      const normalized = { date: date(row.date) };
      GRADES.forEach((key) => {
        const count = row[key] === undefined ? 0 : row[key];
        if (!Number.isInteger(count) || count < 0 || count > 3) fail(`Routenwert ${key} muss eine ganze Zahl von 0 bis 3 sein.`);
        normalized[key] = count;
      });
      addUnique(routes, normalized.date, normalized, 'Routen-Liste');
    });
    const types = new Map();
    array(value.activityTypes === undefined ? [] : value.activityTypes, 'Aktivitätstypen').forEach((row) => {
      record(row, 'Aktivitätstyp');
      const normalized = { id: typeId(row.id), label: text(row.label, 'Aktivitätsname', 100), color: color(row.color, 'Aktivitätsfarbe') };
      addUnique(types, normalized.id, normalized, 'Aktivitätstypen');
    });
    const activities = new Map();
    array(value.activities === undefined ? [] : value.activities, 'Trainings').forEach((row) => {
      record(row, 'Training');
      const normalized = { date: date(row.date), typeId: typeId(row.typeId) };
      activities.set(JSON.stringify([normalized.date, normalized.typeId]), normalized);
      if (!types.has(normalized.typeId)) {
        types.set(normalized.typeId, { id: normalized.typeId, label: `Aktivität ${normalized.typeId}`.slice(0, 100), color: DEFAULT_ACCENT });
      }
    });
    result.checkins = [...checkins.values()].sort((a, b) => compare(a.date, b.date));
    result.routes = [...routes.values()].sort((a, b) => compare(a.date, b.date));
    result.buddyWeeks = [...new Set(array(value.buddyWeeks === undefined ? [] : value.buddyWeeks, 'Buddy-Wochen').map(week))].sort();
    result.settings = settings(value.settings);
    result.activityTypes = [...types.values()].sort((a, b) => compare(a.id, b.id));
    result.activities = [...activities.values()].sort((a, b) => compare(a.date, b.date) || compare(a.typeId, b.typeId));
    return result;
  }
  function decode(value, name) {
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch { fail(`${name} enthält kein gültiges JSON.`); }
  }
  function isLegacyKey(key) { return LEGACY_GLOBAL.has(key) || LEGACY_YEAR.test(key); }
  function legacy(value) {
    record(value, 'Backup');
    const result = emptySnapshot();
    const checkins = new Map();
    const levels = new Map();
    const rawSettings = {};
    const requireYear = (day, year) => {
      date(day);
      if (day.slice(0, 4) !== year) fail(`Datum ${day} gehört nicht zum Speicherjahr ${year}.`);
      return day;
    };
    Object.keys(value).forEach((key) => {
      if (!isLegacyKey(key)) return;
      const raw = value[key];
      if (key === 'sb-goal') rawSettings.goal = decode(raw, key);
      else if (key === 'sb-accent') rawSettings.accent = raw;
      else if (key === 'sb-buddy-name') rawSettings.buddy_name = raw;
      else if (key === 'sb-onboarded') {
        if (![true, false, 1, 0, '1', '0', 'true', 'false', ''].includes(raw)) fail('Einführungsstatus ist ungültig.');
        rawSettings.onboarded = [true, 1, '1', 'true'].includes(raw);
      } else if (key === 'sb-activity-types') result.activityTypes = array(decode(raw, key), key);
      else if (key === 'sb-buddy-weeks') result.buddyWeeks.push(...array(decode(raw, key), key));
      else {
        const [, kind, year] = key.match(LEGACY_YEAR);
        const decoded = decode(raw, key);
        if (kind === 'checkins') {
          array(decoded, key).forEach((day) => checkins.set(requireYear(day, year), { date: day, level: 'normal' }));
        } else if (kind === 'buddy') {
          array(decoded, key).forEach((item) => {
            week(item);
            if (item.slice(0, 4) !== year) fail(`Woche ${item} gehört nicht zum Speicherjahr ${year}.`);
            result.buddyWeeks.push(item);
          });
        } else {
          Object.entries(record(decoded, key)).forEach(([day, entry]) => {
            requireYear(day, year);
            if (kind === 'levels') levels.set(day, level(entry));
            else if (kind === 'routes') {
              record(entry, `Routen am ${day}`);
              if (Object.keys(entry).some((grade) => !GRADES.includes(grade))) fail(`Unbekannte Routenfarbe am ${day}.`);
              result.routes.push({ ...entry, date: day });
            } else if (kind === 'activities') {
              array(entry, `Trainings am ${day}`).forEach((id) => result.activities.push({ date: day, typeId: id }));
            }
          });
        }
      }
    });
    levels.forEach((entry, day) => {
      if (!checkins.has(day)) fail(`Anstrengung am ${day} hat keinen Boulder-Eintrag.`);
      checkins.get(day).level = entry;
    });
    result.checkins = [...checkins.values()];
    if (Object.keys(rawSettings).length) result.settings = rawSettings;
    return normalize(result);
  }
  function parseBackup(value) {
    if (typeof value === 'string') value = decode(value, 'Backup');
    record(value, 'Backup');
    if (own(value, 'app') || own(value, 'version') || own(value, 'data')) {
      if (value.app !== 'sammelbuch') fail('Diese Datei gehört nicht zu Sammelbuch.');
      if (value.version === 1) return legacy(value.data);
      if (value.version === 2) return normalize(value.data);
      fail('Diese Backup-Version wird nicht unterstützt.');
    }
    return legacy(value);
  }
  function readLegacy(storage) {
    const values = Object.create(null);
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (typeof key === 'string' && isLegacyKey(key)) values[key] = storage.getItem(key);
    }
    return legacy(values);
  }
  function hasData(snapshot) {
    return snapshot.settings != null || ['checkins', 'routes', 'buddyWeeks', 'activityTypes', 'activities'].some((key) => snapshot[key].length > 0);
  }
  function years(snapshot, currentYear = new Date().getFullYear()) {
    const result = new Set([Number(currentYear)]);
    ['checkins', 'routes', 'activities'].forEach((key) => snapshot[key].forEach((row) => result.add(Number(row.date.slice(0, 4)))));
    snapshot.buddyWeeks.forEach((item) => result.add(Number(item.slice(0, 4))));
    return [...result].sort((a, b) => b - a);
  }
  function yearView(snapshot, year) {
    const prefix = `${year}-`;
    const checkins = snapshot.checkins.filter((row) => row.date.startsWith(prefix));
    const result = {
      checkins: checkins.map((row) => row.date),
      levels: Object.fromEntries(checkins.filter((row) => row.level !== 'normal').map((row) => [row.date, row.level])),
      routes: {},
      buddyWeeks: snapshot.buddyWeeks.filter((item) => item.startsWith(prefix)),
      activities: {},
      goal: snapshot.settings ? snapshot.settings.goal : 40,
      accent: snapshot.settings ? snapshot.settings.accent : DEFAULT_ACCENT,
      buddyName: snapshot.settings ? snapshot.settings.buddy_name : '',
      onboarded: snapshot.settings ? snapshot.settings.onboarded : false,
    };
    snapshot.routes.filter((row) => row.date.startsWith(prefix)).forEach((row) => {
      const counts = Object.fromEntries(GRADES.filter((key) => row[key] > 0).map((key) => [key, row[key]]));
      if (Object.keys(counts).length) result.routes[row.date] = counts;
    });
    snapshot.activities.filter((row) => row.date.startsWith(prefix)).forEach((row) => {
      if (!own(result.activities, row.date)) result.activities[row.date] = [];
      result.activities[row.date].push(row.typeId);
    });
    return result;
  }
  function backup(snapshot) {
    return { app: 'sammelbuch', version: 2, exportedAt: new Date().toISOString(), data: normalize(snapshot) };
  }
  return { parseBackup, validateSnapshot: normalize, readLegacy, hasData, emptySnapshot, years, yearView, backup };
});
