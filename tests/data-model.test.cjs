const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../data-model.js');

function storage(values) {
  const keys = Object.keys(values);
  return { length: keys.length, key: (i) => keys[i], getItem: (key) => values[key] };
}
function v2(data) { return { app: 'sammelbuch', version: 2, data }; }

test('empty browser data stays empty, while explicit settings count as data', () => {
  const empty = model.readLegacy(storage({ unrelated: 'value' }));
  assert.deepEqual(empty, model.emptySnapshot());
  assert.equal(model.hasData(empty), false);
  assert.equal(model.hasData(model.parseBackup({ 'sb-goal': '60' })), true);
  assert.deepEqual(model.yearView(empty, 2026), {
    checkins: [], levels: {}, routes: {}, buddyWeeks: [], activities: {},
    goal: 40, accent: '#6b6862', buddyName: '', onboarded: false,
  });
});

test('legacy wrapped backups merge buddy lists and preserve training-only and route-only years', () => {
  const snapshot = model.parseBackup({ app: 'sammelbuch', version: 1, data: {
    'sb-checkins-2026': '["2026-09-25","2026-09-25"]',
    'sb-levels-2026': { '2026-09-25': 'stark' },
    'sb-routes-2023': '{"2023-12-20":{"g":3}}',
    'sb-buddy-weeks': '["2020-W53","2026-W39"]',
    'sb-buddy-2026': ['2026-W38', '2026-W39'],
    'sb-activity-types': [{ id: 'jogging', label: 'Joggen', color: '#ABC' }],
    'sb-activities-2025': '{"2025-12-20":["jogging","jogging","deleted-type"]}',
    'sb-goal': '60', 'sb-accent': '#abc', 'sb-buddy-name': 'Alex', 'sb-onboarded': '1',
  } });
  assert.deepEqual(snapshot.checkins, [{ date: '2026-09-25', level: 'stark' }]);
  assert.deepEqual(snapshot.buddyWeeks, ['2020-W53', '2026-W38', '2026-W39']);
  assert.deepEqual(model.years(snapshot, 2026), [2026, 2025, 2023, 2020]);
  assert.equal(snapshot.routes[0].g, 3);
  assert.equal(snapshot.activityTypes.find((type) => type.id === 'jogging').color, '#aabbcc');
  assert.deepEqual(snapshot.activityTypes.find((type) => type.id === 'deleted-type'), { id: 'deleted-type', label: 'Aktivität deleted-type', color: '#6b6862' });
  assert.equal(snapshot.activities.length, 2);
  assert.equal(model.yearView(snapshot, 2026).levels['2026-09-25'], 'stark');
  assert.deepEqual(model.yearView(snapshot, 2023).routes, { '2023-12-20': { g: 3 } });
  assert.deepEqual(model.yearView(snapshot, 2025).activities, { '2025-12-20': ['deleted-type', 'jogging'] });
});

test('auth tokens and unrelated sb keys are never parsed, exported, or treated as user data', () => {
  const values = {
    'sb-spjjxmoutbqubakvshpm-auth-token': '{not even valid JSON',
    'sb-other-secret': 'secret', 'sb-horoskop-seen': '2026-09-27',
  };
  const snapshot = model.readLegacy(storage(values));
  assert.equal(model.hasData(snapshot), false);
  assert.deepEqual(model.parseBackup(values), model.emptySnapshot());
  const output = JSON.stringify(model.backup({ ...snapshot, 'sb-auth-token': 'secret' }));
  assert.equal(output.includes('secret'), false);
  assert.equal(output.includes('token'), false);
});

test('v2 roundtrip preserves all user data and detached routes', () => {
  const input = v2({
    checkins: [{ date: '2024-02-29', level: 'leicht' }],
    routes: [{ date: '2023-03-01', y: 2, bl: 1 }],
    buddyWeeks: ['2026-W39'],
    settings: { goal: 45, accent: '#123456', buddy_name: '', onboarded: true },
    activityTypes: [{ id: 'pullup', label: 'Klimmzüge', color: '#123' }],
    activities: [{ date: '2022-01-01', typeId: 'pullup' }],
  });
  const normalized = model.parseBackup(input);
  const exported = model.backup(normalized);
  assert.equal(exported.version, 2);
  assert.equal(typeof exported.exportedAt, 'string');
  assert.deepEqual(model.parseBackup(JSON.stringify(exported)), normalized);
  assert.deepEqual(model.years(normalized, 2026), [2026, 2024, 2023, 2022]);
});

test('identical duplicate rows are deduplicated, conflicting rows are rejected', () => {
  const row = { date: '2026-09-27', level: 'normal' };
  const snapshot = model.parseBackup(v2({ checkins: [row, row], routes: [{ date: row.date, y: 1 }, { date: row.date, y: 1 }], activities: [{ date: row.date, typeId: 'run' }, { date: row.date, typeId: 'run' }] }));
  assert.equal(snapshot.checkins.length, 1);
  assert.equal(snapshot.routes.length, 1);
  assert.equal(snapshot.activities.length, 1);
  assert.throws(() => model.parseBackup(v2({ checkins: [row, { ...row, level: 'stark' }] })), /widersprüchlich/);
  assert.throws(() => model.parseBackup(v2({ activityTypes: [{ id: 'run', label: 'Run', color: '#fff' }, { id: 'run', label: 'Other', color: '#fff' }] })), /widersprüchlich/);
});

test('malformed dates and ISO weeks are rejected rather than rolled forward', () => {
  for (const day of ['2025-02-29', '2026-02-30', '2026-13-01', '2026-01-00', '2026-1-01', '2026-09-27T00:00:00Z', '0000-01-01']) {
    assert.throws(() => model.parseBackup(v2({ checkins: [{ date: day }] })), /Datum/);
  }
  for (const value of ['2021-W53', '2026-W00', '2026-W54', '2026-W1']) {
    assert.throws(() => model.parseBackup(v2({ buddyWeeks: [value] })), /Woche/);
  }
  assert.deepEqual(model.parseBackup(v2({ buddyWeeks: ['2020-W53', '2026-W53'] })).buddyWeeks, ['2020-W53', '2026-W53']);
});

test('invalid populated local data aborts import rather than silently dropping it', () => {
  for (const values of [
    { 'sb-checkins-2026': 'not json' },
    { 'sb-checkins-2026': '{}' },
    { 'sb-activities-2026': '{"2026-09-27":"run"}' },
    { 'sb-checkins-2026': '["2025-01-01"]' },
    { 'sb-levels-2026': '{"2026-09-27":"stark"}' },
    { 'sb-routes-2026': '{"2026-09-27":{"unknown":1}}' },
  ]) assert.throws(() => model.readLegacy(storage(values)), /Ungültige/);
});

test('activity, settings, level, and route validation reject unsafe or unsupported values', () => {
  for (const data of [
    { activityTypes: [{ id: '', label: 'Run', color: '#fff' }] },
    { activityTypes: [{ id: 'joggen täglich', label: 'Run', color: '#fff' }] },
    { activityTypes: [{ id: 'run', label: 'a'.repeat(101), color: '#fff' }] },
    { activityTypes: [{ id: 'run', label: 'Run', color: 'red' }] },
    { activities: [{ date: '2026-09-27', typeId: {} }] },
    { settings: { goal: 0 } }, { settings: { goal: 1.5 } }, { settings: { goal: '40' } },
    { settings: { onboarded: 'true' } }, { settings: { accent: 'url(https://example.com)' } },
    { checkins: [{ date: '2026-09-27', level: 'hard' }] },
    { routes: [{ date: '2026-09-27', g: 4 }] },
    { routes: [{ date: '2026-09-27', g: '2' }] },
  ]) assert.throws(() => model.parseBackup(v2(data)), /Ungültige/);
  assert.throws(() => model.parseBackup({ app: 'other', version: 1, data: {} }), /nicht zu Sammelbuch/);
  assert.throws(() => model.parseBackup({ app: 'sammelbuch', version: 3, data: {} }), /Version/);
});

test('normalization produces deterministic canonical ordering and does not mutate local storage', () => {
  const types = [{ id: 'z', label: 'Joggen', color: '#ABC' }, { id: 'a', label: 'Klimmzüge', color: '#123456' }];
  const days = [{ date: '2026-09-27', typeId: 'z' }, { date: '2025-01-01', typeId: 'a' }];
  const first = model.validateSnapshot({ activityTypes: types, activities: days });
  const second = model.validateSnapshot({ activities: [...days].reverse(), activityTypes: [...types].reverse() });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(types[0].color, '#ABC');
  const values = { 'sb-buddy-weeks': '["2026-W39"]', 'sb-goal': '40' };
  const before = JSON.stringify(values);
  model.readLegacy(storage(values));
  assert.equal(JSON.stringify(values), before);
});
