(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data-model.js'));
  else root.SammelbuchCloud = factory(root.SammelbuchData);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (defaultModel) {
  'use strict';

  const CACHE_PREFIX = 'sammelbuch-cache-v2:';
  const OFFLINE_ERROR = 'Du bist offline. Deine zuletzt geladenen Daten bleiben sichtbar. Änderungen sind erst mit Internet möglich.';

  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  }

  function messageFor(error, writing) {
    const code = error && error.code;
    if (code === 'PGRST202' || code === '42883') {
      return 'Die Datenbank ist noch nicht für die neue App eingerichtet. Bitte die Datenbank-Migration ausführen und erneut laden.';
    }
    if (code === 'PGRST301' || code === 'PGRST302' || code === '42501' || (error && error.status === 401)) {
      return 'Deine Anmeldung ist abgelaufen oder der Datenzugriff fehlt. Bitte melde dich erneut an.';
    }
    const detail = error && typeof error.message === 'string' ? error.message : '';
    const prefix = writing
      ? 'Die Speicherung konnte nicht bestätigt werden. Bitte neu laden, bevor du es erneut versuchst.'
      : 'Deine Daten konnten nicht geladen werden. Bitte versuche es erneut.';
    return detail ? prefix + ' ' + detail : prefix;
  }

  /**
   * Database-first state. Cache entries only contain confirmed database snapshots.
   * setUser is synchronous and never calls Auth or RPC APIs; call refresh separately.
   * refresh/mutate resolve to true only when this account received a valid response.
   */
  function createStore(options) {
    options = options || {};
    const client = options.client;
    const model = options.model || defaultModel;
    const storage = options.storage;
    const online = options.online || function () {
      return typeof navigator === 'undefined' || navigator.onLine !== false;
    };
    const onChange = options.onChange || function () {};
    if (!model || typeof model.emptySnapshot !== 'function' || typeof model.validateSnapshot !== 'function') throw new Error('SammelbuchData fehlt.');
    if (!client || typeof client.rpc !== 'function') throw new Error('Supabase-Verbindung fehlt.');

    let epoch = 0;
    let state = freeze({
      user: null,
      snapshot: model.emptySnapshot(),
      status: 'signed-out',
      error: null,
      ready: false,
      busy: false,
      lastSynced: null
    });

    function connected() {
      try { return online() !== false; } catch (_) { return false; }
    }

    function update(patch) {
      state = freeze(Object.assign({}, state, patch));
      // A render failure must not turn an acknowledged database write into a failure.
      try { onChange(state); } catch (error) {
        if (typeof console !== 'undefined' && console.error) console.error('Sammelbuch: Ansicht konnte nicht aktualisiert werden.', error);
      }
    }

    function parseSnapshot(value) {
      // Imports may fill in old optional fields, but an RPC/cache must be complete.
      const lists = ['checkins', 'routes', 'buddyWeeks', 'activityTypes', 'activities'];
      if (!value || typeof value !== 'object' || Array.isArray(value)
          || lists.some(key => !Array.isArray(value[key]))
          || !Object.prototype.hasOwnProperty.call(value, 'settings')
          || (value.settings !== null && (typeof value.settings !== 'object' || Array.isArray(value.settings)))) {
        throw new Error('Die Datenbank-Antwort ist unvollständig oder ungültig.');
      }
      return freeze(model.validateSnapshot(value));
    }

    function readCache(userId) {
      if (!storage) return null;
      try {
        const raw = storage.getItem(CACHE_PREFIX + userId);
        if (!raw) return null;
        const cached = JSON.parse(raw);
        if (cached.version !== 2 || cached.userId !== userId) return null;
        const snapshot = parseSnapshot(cached.snapshot);
        const lastSynced = typeof cached.lastSynced === 'string' && Number.isFinite(Date.parse(cached.lastSynced))
          ? cached.lastSynced : null;
        return { snapshot, lastSynced };
      } catch (_) { return null; }
    }

    function writeCache(userId, snapshot, lastSynced) {
      if (!storage) return;
      try {
        storage.setItem(CACHE_PREFIX + userId, JSON.stringify({ version: 2, userId, snapshot, lastSynced }));
      } catch (_) {
        // Private browsing / full storage must not obscure a successful DB write.
      }
    }

    function setUser(user) {
      const safeUser = user && typeof user.id === 'string' && user.id.length
        ? { id: user.id, email: typeof user.email === 'string' ? user.email : null } : null;
      if (safeUser && state.user && safeUser.id === state.user.id) {
        update({ user: safeUser });
        return state;
      }
      epoch += 1;
      const cached = safeUser ? readCache(safeUser.id) : null;
      const isOnline = connected();
      update({
        user: safeUser,
        snapshot: cached ? cached.snapshot : model.emptySnapshot(),
        status: !safeUser ? 'signed-out' : !isOnline ? 'offline' : cached ? 'cached' : 'loading',
        error: safeUser && !isOnline ? OFFLINE_ERROR : null,
        ready: false,
        busy: false,
        lastSynced: cached ? cached.lastSynced : null
      });
      return state;
    }

    async function request(writing, command) {
      if (!state.user || state.busy) return false;
      if (!connected()) {
        update({ status: 'offline', error: OFFLINE_ERROR });
        return false;
      }
      if (writing && !state.ready) {
        update({ status: 'error', error: 'Bitte lade zuerst deine Daten aus der Datenbank. Lokale Daten sind bis dahin nur lesbar.' });
        return false;
      }
      const requestEpoch = epoch;
      const userId = state.user.id;
      const current = function () { return epoch === requestEpoch && state.user && state.user.id === userId; };
      update({ busy: true, status: writing ? 'syncing' : 'loading', error: null });
      if (!current()) return false;
      try {
        const result = writing
          ? await client.rpc('sammelbuch_mutate', { command: Object.assign({}, command, { expectedUserId: userId }) })
          : await client.rpc('sammelbuch_snapshot', { expected_user_id: userId });
        if (!current()) return false;
        if (!result || result.error) throw (result && result.error) || new Error('Die Datenbank hat keine Antwort geliefert.');
        const snapshot = parseSnapshot(result.data);
        const lastSynced = new Date().toISOString();
        writeCache(userId, snapshot, lastSynced);
        update({ snapshot, lastSynced, status: 'ready', error: null, ready: true, busy: false });
        return true;
      } catch (error) {
        if (!current()) return false;
        const isOnline = connected();
        update({ status: isOnline ? 'error' : 'offline', error: isOnline ? messageFor(error, writing) : OFFLINE_ERROR, busy: false });
        return false;
      }
    }

    return Object.freeze({
      setUser,
      refresh: function () { return request(false); },
      mutate: function (command) { return request(true, command); },
      getState: function () { return state; }
    });
  }

  return Object.freeze({ createStore, CACHE_PREFIX });
}));
