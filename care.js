const STORAGE_KEY = 'pet-the-dog.care';
const FULLNESS_LIFETIME_MS = 18 * 60 * 60 * 1000;
const SAVE_INTERVAL_MS = 10_000;
const PLAY_COOLDOWN_MS = 15_000;
const MAX_DOGS = 64;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const bounded = (value, fallback) => finite(value) ? Math.max(0, Math.min(100, value)) : fallback;
const validId = id => typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{0,47}$/i.test(id);
const fresh = now => ({ affection: 0, fullness: 46, updatedAt: now, lastPlayAt: null });
const view = state => ({
  affection: Math.floor(state.affection + 1e-8),
  fullness: Math.max(0, Math.ceil(state.fullness - 1e-8)),
});

// Fullness alone changes while away. Affection is never deducted for absence.
function advance(state, now) {
  const elapsed = Math.max(0, Math.min(FULLNESS_LIFETIME_MS, now - state.updatedAt));
  const before = state.fullness;
  state.fullness = Math.max(0, state.fullness - 100 * elapsed / FULLNESS_LIFETIME_MS);
  // Re-anchor a clock rollback once; it cannot refill a dog or freeze it for days.
  state.updatedAt = now;
  if (state.lastPlayAt !== null && state.lastPlayAt > now) state.lastPlayAt = now;
  return before !== state.fullness;
}

export class DogCare {
  constructor({ storage, clock = () => Date.now() } = {}) {
    this._clock = typeof clock === 'function' ? clock : () => Date.now();
    this._fallbackNow = Date.now();
    this._storage = null;
    try {
      const candidate = storage === undefined ? globalThis.localStorage : storage;
      if (candidate && typeof candidate.getItem === 'function' && typeof candidate.setItem === 'function') {
        this._storage = candidate;
      }
    } catch { /* Storage access itself may be denied by the browser. */ }
    this._canSave = Boolean(this._storage);
    this._foreignSchema = false;
    this._repairClock = false;
    this._dirty = false;
    this._destroyed = false;
    this._pending = new Map();
    this._sessions = new Map();
    const now = this._now();
    this._lastSaveAt = now;
    this._states = this._readStored(now) ?? new Map();
    this._window = typeof window === 'undefined' ? null : window;
    this._document = typeof document === 'undefined' ? null : document;
    this._onPageHide = () => this._save(true, this._now());
    this._onVisibility = () => { if (this._document?.hidden) this._onPageHide(); };
    this._window?.addEventListener('pagehide', this._onPageHide);
    this._document?.addEventListener('visibilitychange', this._onVisibility);
  }

  get canSave() { return this._canSave; }

  get(id) {
    const now = this._now();
    const state = this._destroyed ? this._states.get(id) : this._entry(id, now);
    if (!this._destroyed) this._save(false, now);
    return view(state ?? fresh(now));
  }

  pet(id, seconds) {
    if (this._destroyed || !finite(seconds) || seconds < 0) return;
    const now = this._now();
    const state = this._entry(id, now);
    if (!state) return;
    const session = this._sessions.get(id);
    const elapsed = Math.max(0, (now - session.lastPetAt) / 1000);
    session.lastPetAt = now;
    // Eligible time comes from the UI. Stale frames, offline gaps and repeated
    // calls at the same clock instant cannot award an instant affection jump.
    const eligible = Math.min(seconds, elapsed, 2);
    if (eligible > 0) this._creditAffection(id, state, eligible / 7);
    this._save(false, now);
  }

  feed(id, kind) {
    if (this._destroyed || (kind !== 'treat' && kind !== 'meal')) return false;
    const now = this._now();
    this._mergeStored(now);
    const state = this._entry(id, now);
    const amount = kind === 'treat' ? 17 : 36;
    if (!state || state.fullness + amount > 100 + 1e-8) {
      this._save(false, now);
      return false;
    }
    state.fullness = Math.min(100, state.fullness + amount);
    this._pendingFor(id).fullness += amount;
    this._creditAffection(id, state, kind === 'treat' ? 2 : 4);
    this._dirty = true;
    this._save(true, now);
    return true;
  }

  play(id) {
    if (this._destroyed) return false;
    const now = this._now();
    this._mergeStored(now);
    const state = this._entry(id, now);
    if (!state || (state.lastPlayAt !== null && now - state.lastPlayAt < PLAY_COOLDOWN_MS)) {
      this._save(false, now);
      return false;
    }
    state.lastPlayAt = now;
    this._creditAffection(id, state, 2);
    this._dirty = true;
    this._save(true, now);
    return true;
  }

  destroy() {
    if (this._destroyed) return;
    this._save(true, this._now());
    this._window?.removeEventListener('pagehide', this._onPageHide);
    this._document?.removeEventListener('visibilitychange', this._onVisibility);
    this._destroyed = true;
  }

  _now() {
    try {
      const value = this._clock();
      if (finite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER) this._fallbackNow = value;
    } catch { /* A failed clock read must not damage existing state. */ }
    return this._fallbackNow;
  }

  _entry(id, now) {
    if (!validId(id)) return null;
    let state = this._states.get(id);
    if (!state) {
      // A different tab may have met this dog since this instance was opened.
      this._mergeStored(now);
      state = this._states.get(id);
    }
    if (!state) {
      if (this._states.size >= MAX_DOGS) return null;
      state = fresh(now);
      this._states.set(id, state);
      this._dirty = true;
    }
    if (state.updatedAt > now || (state.lastPlayAt !== null && state.lastPlayAt > now)) {
      this._repairClock = this._dirty = true;
    }
    if (advance(state, now)) this._dirty = true;
    if (!this._sessions.has(id)) this._sessions.set(id, { lastPetAt: now });
    return state;
  }

  _pendingFor(id) {
    if (!this._pending.has(id)) this._pending.set(id, { affection: 0, fullness: 0 });
    return this._pending.get(id);
  }

  _creditAffection(id, state, amount) {
    const gain = Math.min(100 - state.affection, amount);
    if (gain <= 0) return;
    state.affection += gain;
    this._pendingFor(id).affection += gain;
    this._dirty = true;
  }

  _readStored(now) {
    if (!this._storage || this._foreignSchema) return null;
    let raw;
    try { raw = this._storage.getItem(STORAGE_KEY); }
    catch { this._canSave = false; return null; }
    if (raw === null || raw === undefined || raw === '') return new Map();
    if (typeof raw !== 'string' || raw.length > 65_536) return new Map();
    let saved;
    try { saved = JSON.parse(raw); } catch { return new Map(); }
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return new Map();
    if (saved.version !== undefined && saved.version !== 0 && saved.version !== 1) {
      // Leave a future/incompatible format intact instead of overwriting it.
      this._foreignSchema = true;
      this._canSave = false;
      return null;
    }
    // Also read unversioned { dogs: {...} } and legacy bare per-dog maps.
    const dogs = saved.dogs ?? saved;
    if (!dogs || typeof dogs !== 'object' || Array.isArray(dogs)) return new Map();
    const result = new Map();
    for (const [id, record] of Object.entries(dogs)) {
      if (result.size >= MAX_DOGS) break;
      if (!validId(id) || !record || typeof record !== 'object' || Array.isArray(record)) continue;
      if (!finite(record.affection) && !finite(record.fullness)) continue;
      if ((finite(record.updatedAt) && record.updatedAt > now) || (finite(record.lastPlayAt) && record.lastPlayAt > now)) {
        this._repairClock = this._dirty = true;
      }
      const state = {
        affection: bounded(record.affection, 0),
        fullness: bounded(record.fullness, 46),
        updatedAt: finite(record.updatedAt) && record.updatedAt >= 0 ? Math.min(now, record.updatedAt) : now,
        lastPlayAt: finite(record.lastPlayAt) && record.lastPlayAt >= 0 ? Math.min(now, record.lastPlayAt) : null,
      };
      advance(state, now);
      result.set(id, state);
    }
    return result;
  }

  _mergeStored(now) {
    const remote = this._readStored(now);
    if (remote === null) return false;
    for (const [id, incoming] of remote) {
      const local = this._states.get(id);
      if (!local) {
        if (this._states.size < MAX_DOGS) this._states.set(id, incoming);
        continue;
      }
      advance(local, now);
      const pending = this._pending.get(id);
      // Retain unsaved local increments while incorporating other tabs. All
      // fullness values are first moved to the same clock instant.
      local.affection = Math.min(100, Math.max(local.affection, incoming.affection + (pending?.affection ?? 0)));
      local.fullness = Math.min(100, incoming.fullness + (pending?.fullness ?? 0));
      if (incoming.lastPlayAt !== null) local.lastPlayAt = Math.max(local.lastPlayAt ?? 0, incoming.lastPlayAt);
    }
    return true;
  }

  _save(force, now) {
    if (!this._dirty || this._destroyed) return;
    const elapsed = now - this._lastSaveAt;
    if (!force && !this._repairClock && elapsed >= 0 && elapsed < SAVE_INTERVAL_MS) return;
    this._lastSaveAt = now;
    if (!this._mergeStored(now)) return;
    const dogs = Object.fromEntries(this._states);
    try {
      this._storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, dogs }));
      this._pending.clear();
      this._dirty = false;
      this._repairClock = false;
      this._canSave = true;
    } catch { this._canSave = false; }
  }
}
