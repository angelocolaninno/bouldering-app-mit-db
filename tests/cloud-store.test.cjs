'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, CACHE_PREFIX } = require('../cloud-store.js');
const { emptySnapshot } = require('../data-model.js');

const copy = value => JSON.parse(JSON.stringify(value));
const USER_A = { id: 'account-a', email: 'a@example.com' };
const USER_B = { id: 'account-b', email: 'b@example.com' };

function memoryStorage() {
  const entries = new Map();
  return {
    entries,
    getItem(key) { return entries.get(key) || null; },
    setItem(key, value) { entries.set(key, value); }
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function withCheckin(date) {
  return Object.assign(emptySnapshot(), { checkins: [{ date, level: 'normal' }] });
}

function cache(storage, user, snapshot) {
  storage.setItem(CACHE_PREFIX + user.id, JSON.stringify({
    version: 2, userId: user.id, snapshot, lastSynced: '2026-09-27T08:00:00.000Z'
  }));
}

function sharedServer() {
  const accounts = new Map();
  const requests = [];
  return {
    accounts, requests,
    client(userId) {
      return {
        async rpc(name, args) {
          requests.push({ userId, name, args });
          const snapshot = copy(accounts.get(userId) || emptySnapshot());
          if (name === 'sammelbuch_mutate') {
            const command = args.command;
            assert.equal(command.expectedUserId, userId);
            if (command.kind === 'checkin') {
              snapshot.checkins = snapshot.checkins.filter(row => row.date !== command.date);
              snapshot.checkins.push({ date: command.date, level: command.level });
            } else if (command.kind === 'activityType') {
              snapshot.activityTypes.push({ id: command.id, label: command.label, color: command.color });
            } else if (command.kind === 'activity') {
              snapshot.activities.push({ date: command.date, typeId: command.typeId });
            } else if (command.kind === 'settings') {
              snapshot.settings = { goal: 52, accent: '#6b6862', buddy_name: '', onboarded: true, ...command.settings };
            } else throw new Error('Unbekannter Testbefehl');
            accounts.set(userId, snapshot);
          } else assert.equal(name, 'sammelbuch_snapshot');
          return { data: copy(snapshot), error: null };
        }
      };
    }
  };
}

test('setUser only changes local state; authentication and database work stay outside the auth callback', () => {
  let calls = 0;
  const updates = [];
  const store = createStore({ client: { rpc() { calls++; } }, onChange: value => updates.push(value) });
  assert.equal(store.getState().status, 'signed-out');
  assert.equal(store.getState().ready, false);
  store.setUser({ ...USER_A, access_token: 'must-never-be-stored' });
  assert.equal(calls, 0);
  assert.deepEqual(store.getState().user, USER_A);
  assert.equal(updates.length, 1);
  assert.equal(store.getState().busy, false);
});

test('two devices share bouldering, custom training, logged training and settings through the database', async () => {
  const server = sharedServer();
  const firstStorage = memoryStorage();
  const first = createStore({ client: server.client(USER_A.id), storage: firstStorage });
  const second = createStore({ client: server.client(USER_A.id), storage: memoryStorage() });
  first.setUser(USER_A);
  second.setUser(USER_A);
  assert.equal(await first.refresh(), true);
  assert.equal(await second.refresh(), true);
  assert.equal(await first.mutate({ kind: 'checkin', date: '2026-09-26', level: 'stark' }), true);
  assert.equal(await first.mutate({ kind: 'activityType', id: 'joggen', label: 'Joggen', color: '#2f6f47' }), true);
  assert.equal(await first.mutate({ kind: 'activity', date: '2026-09-27', typeId: 'joggen' }), true);
  assert.equal(await first.mutate({ kind: 'settings', settings: { goal: 80, buddy_name: 'Alex' } }), true);
  assert.equal(second.getState().snapshot.activities.length, 0);
  assert.equal(await second.refresh(), true);
  assert.deepEqual(second.getState().snapshot, first.getState().snapshot);
  assert.equal(second.getState().snapshot.activityTypes[0].label, 'Joggen');
  assert.deepEqual(second.getState().snapshot.activities, [{ date: '2026-09-27', typeId: 'joggen' }]);
  assert.equal(second.getState().snapshot.settings.goal, 80);
  const persisted = JSON.parse(firstStorage.getItem(CACHE_PREFIX + USER_A.id));
  assert.deepEqual(persisted.snapshot, first.getState().snapshot);
  assert.deepEqual(Object.keys(persisted).sort(), ['lastSynced', 'snapshot', 'userId', 'version']);
  assert.equal(first.getState().status, 'ready');
  assert.equal(first.getState().error, null);
  assert.ok(first.getState().lastSynced);
});

test('writes only become visible after database confirmation, and overlapping requests are rejected', async () => {
  const pending = deferred();
  let calls = 0;
  const initial = withCheckin('2026-09-20');
  const client = { rpc() { calls++; return calls === 1 ? Promise.resolve({ data: initial }) : pending.promise; } };
  const storage = memoryStorage();
  const store = createStore({ client, storage });
  store.setUser(USER_A);
  await store.refresh();
  const oldCache = storage.getItem(CACHE_PREFIX + USER_A.id);
  const writing = store.mutate({ kind: 'checkin', date: '2026-09-27', level: 'normal' });
  assert.equal(store.getState().busy, true);
  assert.equal(store.getState().status, 'syncing');
  assert.deepEqual(store.getState().snapshot, initial);
  assert.equal(storage.getItem(CACHE_PREFIX + USER_A.id), oldCache);
  assert.equal(await store.mutate({ kind: 'checkin', date: '2026-09-28' }), false);
  assert.equal(await store.refresh(), false);
  assert.equal(calls, 2);
  const confirmed = withCheckin('2026-09-27');
  pending.resolve({ data: confirmed, error: null });
  assert.equal(await writing, true);
  assert.deepEqual(store.getState().snapshot, confirmed);
  assert.equal(store.getState().busy, false);
});

test('RPC error responses never overwrite a confirmed snapshot or its cache', async () => {
  const storage = memoryStorage();
  const initial = withCheckin('2026-09-20');
  let result = { data: initial, error: null };
  const store = createStore({ client: { async rpc() { return result; } }, storage });
  store.setUser(USER_A);
  await store.refresh();
  const oldCache = storage.getItem(CACHE_PREFIX + USER_A.id);
  result = { data: emptySnapshot(), error: { message: 'Server nicht verfügbar', code: 'XX000' } };
  assert.equal(await store.mutate({ kind: 'checkin', date: '2026-09-27' }), false);
  assert.deepEqual(store.getState().snapshot, initial);
  assert.equal(storage.getItem(CACHE_PREFIX + USER_A.id), oldCache);
  assert.equal(store.getState().status, 'error');
  assert.match(store.getState().error, /Speicherung konnte nicht bestätigt/);
  assert.equal(store.getState().busy, false);
  assert.equal(await store.refresh(), false);
  assert.deepEqual(store.getState().snapshot, initial);
  assert.match(store.getState().error, /nicht geladen/);
});

test('a cached account stays read-only until its first successful database load', async () => {
  const storage = memoryStorage();
  const initial = withCheckin('2026-09-20');
  cache(storage, USER_A, initial);
  let calls = 0;
  const store = createStore({ storage, client: { async rpc() { calls++; return { error: { code: 'PGRST202' } }; } } });
  store.setUser(USER_A);
  assert.equal(store.getState().status, 'cached');
  assert.deepEqual(store.getState().snapshot, initial);
  assert.equal(store.getState().ready, false);
  assert.equal(await store.mutate({ kind: 'checkin', date: '2026-09-27' }), false);
  assert.equal(calls, 0);
  assert.equal(await store.refresh(), false);
  assert.equal(store.getState().ready, false);
  assert.match(store.getState().error, /Datenbank-Migration/);
  assert.deepEqual(store.getState().snapshot, initial);
});

test('account switch immediately clears the prior account and rejects its delayed load', async () => {
  const storage = memoryStorage();
  const first = deferred(), second = deferred();
  let calls = 0;
  const store = createStore({ storage, client: { rpc() { return ++calls === 1 ? first.promise : second.promise; } } });
  store.setUser(USER_A);
  const loadingA = store.refresh();
  store.setUser(USER_B);
  assert.deepEqual(store.getState().snapshot, emptySnapshot());
  assert.equal(store.getState().ready, false);
  assert.equal(store.getState().busy, false);
  const loadingB = store.refresh();
  second.resolve({ data: withCheckin('2026-09-22') });
  assert.equal(await loadingB, true);
  first.resolve({ data: withCheckin('2026-09-11') });
  assert.equal(await loadingA, false);
  assert.equal(store.getState().user.id, USER_B.id);
  assert.deepEqual(store.getState().snapshot, withCheckin('2026-09-22'));
  assert.equal(storage.getItem(CACHE_PREFIX + USER_A.id), null);
  assert.ok(storage.getItem(CACHE_PREFIX + USER_B.id));
});

test('late failures cannot clear a new account request or show a former account error', async () => {
  const first = deferred(), second = deferred();
  let calls = 0;
  const store = createStore({ client: { rpc() { return ++calls === 1 ? first.promise : second.promise; } } });
  store.setUser(USER_A);
  const loadingA = store.refresh();
  store.setUser(USER_B);
  const loadingB = store.refresh();
  first.reject(new Error('Fehler für Konto A'));
  assert.equal(await loadingA, false);
  assert.equal(store.getState().busy, true);
  assert.equal(store.getState().error, null);
  second.resolve({ data: emptySnapshot() });
  assert.equal(await loadingB, true);
});

test('signing out while a mutation is pending discards its response and clears private display data', async () => {
  const pending = deferred();
  let calls = 0;
  const storage = memoryStorage();
  const store = createStore({ storage, client: { rpc() { return ++calls === 1 ? Promise.resolve({ data: emptySnapshot() }) : pending.promise; } } });
  store.setUser(USER_A);
  await store.refresh();
  const saved = storage.getItem(CACHE_PREFIX + USER_A.id);
  const mutation = store.mutate({ kind: 'checkin', date: '2026-09-27' });
  store.setUser(null);
  assert.equal(store.getState().status, 'signed-out');
  assert.equal(store.getState().user, null);
  assert.deepEqual(store.getState().snapshot, emptySnapshot());
  pending.resolve({ data: withCheckin('2026-09-27') });
  assert.equal(await mutation, false);
  assert.equal(storage.getItem(CACHE_PREFIX + USER_A.id), saved);
  assert.equal(await store.mutate({ kind: 'checkin', date: '2026-09-28' }), false);
  assert.equal(calls, 2);
});

test('cache is scoped to its account and a mismatched or invalid cache is ignored', () => {
  const storage = memoryStorage();
  cache(storage, USER_A, withCheckin('2026-09-11'));
  const store = createStore({ storage, client: { rpc() {} } });
  store.setUser(USER_B);
  assert.deepEqual(store.getState().snapshot, emptySnapshot());
  storage.setItem(CACHE_PREFIX + USER_B.id, storage.getItem(CACHE_PREFIX + USER_A.id));
  store.setUser(null);
  store.setUser(USER_B);
  assert.deepEqual(store.getState().snapshot, emptySnapshot());
  cache(storage, USER_B, { activities: 'broken' });
  store.setUser(null);
  store.setUser(USER_B);
  assert.deepEqual(store.getState().snapshot, emptySnapshot());
  store.setUser(USER_A);
  assert.deepEqual(store.getState().snapshot, withCheckin('2026-09-11'));
  assert.equal(store.getState().ready, false);
});

test('offline refresh and edits do not send requests or alter the cached snapshot', async () => {
  const storage = memoryStorage();
  const initial = withCheckin('2026-09-20');
  cache(storage, USER_A, initial);
  let isOnline = false, calls = 0;
  const store = createStore({ storage, online: () => isOnline, client: { async rpc() { calls++; return { data: initial }; } } });
  store.setUser(USER_A);
  assert.equal(store.getState().status, 'offline');
  assert.equal(await store.refresh(), false);
  assert.equal(await store.mutate({ kind: 'checkin', date: '2026-09-27' }), false);
  assert.equal(calls, 0);
  assert.deepEqual(store.getState().snapshot, initial);
  isOnline = true;
  await store.refresh();
  assert.equal(store.getState().ready, true);
  isOnline = false;
  assert.equal(await store.mutate({ kind: 'checkin', date: '2026-09-27' }), false);
  assert.equal(calls, 1);
  assert.equal(store.getState().status, 'offline');
  assert.match(store.getState().error, /Internet/);
});

test('quota failures do not turn confirmed database loads or writes into failures', async () => {
  const server = sharedServer();
  const storage = { getItem() { throw new Error('Storage blocked'); }, setItem() { throw new Error('QuotaExceededError'); } };
  const store = createStore({ storage, client: server.client(USER_A.id) });
  store.setUser(USER_A);
  assert.equal(await store.refresh(), true);
  assert.equal(await store.mutate({ kind: 'checkin', date: '2026-09-27', level: 'normal' }), true);
  assert.deepEqual(store.getState().snapshot, withCheckin('2026-09-27'));
  assert.equal(store.getState().status, 'ready');
  assert.equal(store.getState().error, null);
  assert.equal(store.getState().busy, false);
});

test('empty or malformed RPC payloads cannot replace confirmed data', async () => {
  const initial = withCheckin('2026-09-20');
  let result = { data: initial };
  const store = createStore({ client: { async rpc() { return result; } } });
  store.setUser(USER_A);
  await store.refresh();
  for (const bad of [undefined, { data: null }, { data: {} }, { data: { ...emptySnapshot(), activities: 'broken' } }]) {
    result = bad;
    assert.equal(await store.refresh(), false);
    assert.deepEqual(store.getState().snapshot, initial);
    assert.equal(store.getState().busy, false);
  }
});

test('repeated authentication events for the same account preserve the request epoch and readiness', async () => {
  const pending = deferred();
  const store = createStore({ client: { rpc() { return pending.promise; } } });
  store.setUser(USER_A);
  const loading = store.refresh();
  store.setUser({ ...USER_A, email: 'updated@example.com' });
  assert.equal(store.getState().busy, true);
  pending.resolve({ data: emptySnapshot() });
  assert.equal(await loading, true);
  store.setUser(USER_A);
  assert.equal(store.getState().ready, true);
});

test('consumers cannot mutate database snapshots or user identity through getState', async () => {
  const store = createStore({ client: { async rpc() { return { data: withCheckin('2026-09-20') }; } } });
  store.setUser(USER_A);
  await store.refresh();
  assert.throws(() => { store.getState().snapshot.checkins.push({ date: '2026-09-27', level: 'normal' }); }, TypeError);
  assert.throws(() => { store.getState().user.id = USER_B.id; }, TypeError);
});
