const STORAGE_KEY = 'pet-the-dog.care';
const FULLNESS_LIFETIME_MS = 18 * 60 * 60 * 1000;
const SAVE_INTERVAL_MS = 10_000;
const PLAY_COOLDOWN_MS = 15_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SIZE_RESPONSE_DAYS = 3;
const CONDITION_RESPONSE_DAYS = 3.2;
const MAX_DOGS = 64;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const bounded = (value, fallback) => finite(value) ? Math.max(0, Math.min(100, value)) : fallback;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const timestamp = value => finite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const validId = id => typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{0,47}$/i.test(id);
// Keep the last persisted growth checkpoint out of the public/storage schema.
const checkpoint = (state, at = -1) => Object.defineProperty(state, '_growthCheckpoint', { value: at, writable: true });
const fresh = now => checkpoint({
  affection: 0, fullness: 46, updatedAt: now, lastPlayAt: null,
  adoptedAt: now, growthUpdatedAt: now, bodySize: 5, bodyCondition: 0,
});
const view = state => ({
  affection: Math.floor(state.affection + 1e-8),
  fullness: Math.max(0, Math.ceil(state.fullness - 1e-8)),
});

// Integrate the fullness history, including its linear decay to zero. The
// exponential response to a linear target is analytic, so frequent reads and
// one delayed read produce the same body condition. Actions never resize a dog.
function advanceGrowth(state, now) {
  const start = Math.max(state.growthUpdatedAt, state.updatedAt);
  const days = clamp((now - start) / DAY_MS, 0, 3650);
  const wasSize = state.bodySize, wasCondition = state.bodyCondition;
  if (days > 0) {
    const drain = 100 * DAY_MS / FULLNESS_LIFETIME_MS;
    const fullness = Math.max(0, state.fullness - drain * (start - state.updatedAt) / DAY_MS);
    const fed = Math.min(days, fullness / drain);
    const nourishment = .25 * fed + .75 * (fullness * fed - .5 * drain * fed * fed) / 100;
    const potential = 5 + 1.2 * (1 - Math.exp(-state.affection / 28));
    state.bodySize += Math.max(0, potential - state.bodySize) * -Math.expm1(-nourishment / SIZE_RESPONSE_DAYS);
    const tau = CONDITION_RESPONSE_DAYS, blend = -Math.expm1(-fed / tau);
    const target = .7 * (fullness - 50) / 50, slope = -.7 * drain / 50;
    state.bodyCondition = state.bodyCondition * (1 - blend) + target * blend + slope * (fed - tau * blend);
    state.bodyCondition += (-.7 - state.bodyCondition) * -Math.expm1(-(days - fed) / tau);
    state.bodySize = clamp(state.bodySize, 5, 6.2);
    state.bodyCondition = clamp(state.bodyCondition, -.7, .7);
  }
  state.growthUpdatedAt = now;
  return Math.abs(state.bodySize - wasSize) > 1e-10 || Math.abs(state.bodyCondition - wasCondition) > 1e-10;
}

const growthView = (state, now) => {
  const days = Math.max(0, (now - state.adoptedAt) / DAY_MS);
  const condition = state.bodyCondition < -.28 ? '体态轻盈' : state.bodyCondition > .25 ? '圆润一点' : '体态匀称';
  return { size: state.bodySize, width: 5 + state.bodyCondition, adoptedAt: state.adoptedAt, days,
    label: `相伴第 ${Math.floor(days) + 1} 天 · ${condition}` };
};

// Unsaved food is an increment over a decaying baseline, not a fresh meal on
// every retry. Both channels age together so hunger is never counted twice.
function pendingFullness(pending, now) {
  if (!pending?.fullness || !timestamp(pending.fullnessAt)) return 0;
  const consumed = 100 * clamp(now - pending.fullnessAt, 0, FULLNESS_LIFETIME_MS) / FULLNESS_LIFETIME_MS;
  return Math.max(0, pending.fullnessBase + pending.fullness - consumed) - Math.max(0, pending.fullnessBase - consumed);
}

// Affection is never deducted for absence. Body changes remain slow and bounded.
function advance(state, now) {
  const growthChanged = advanceGrowth(state, now);
  const elapsed = Math.max(0, Math.min(FULLNESS_LIFETIME_MS, now - state.updatedAt));
  const before = state.fullness;
  state.fullness = Math.max(0, state.fullness - 100 * elapsed / FULLNESS_LIFETIME_MS);
  // Re-anchor a clock rollback once; it cannot refill a dog or freeze it for days.
  state.updatedAt = now;
  if (state.lastPlayAt !== null && state.lastPlayAt > now) state.lastPlayAt = now;
  return before !== state.fullness || growthChanged;
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

  growth(id) {
    const now = this._now();
    const state = this._destroyed ? this._states.get(id) : this._entry(id, now);
    if (!this._destroyed) this._save(false, now);
    return growthView(state ?? fresh(now), now);
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
    const pending = this._pendingFor(id), carry = pendingFullness(pending, now);
    pending.fullnessBase = Math.max(0, state.fullness - carry);
    pending.fullnessAt = now;
    pending.fullness = carry + amount;
    state.fullness = Math.min(100, state.fullness + amount);
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
    if (state.updatedAt > now || state.growthUpdatedAt > now || (state.lastPlayAt !== null && state.lastPlayAt > now)) {
      this._repairClock = this._dirty = true;
    }
    if (advance(state, now)) this._dirty = true;
    if (!this._sessions.has(id)) this._sessions.set(id, { lastPetAt: now });
    return state;
  }

  _pendingFor(id) {
    if (!this._pending.has(id)) this._pending.set(id, { affection: 0, fullness: 0, fullnessBase: 0, fullnessAt: null });
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
    if (saved.version !== undefined && saved.version !== 0 && saved.version !== 1 && saved.version !== 2) {
      // Leave a future/incompatible format intact instead of overwriting it.
      this._foreignSchema = true;
      this._canSave = false;
      return null;
    }
    if (saved.version !== 2) this._dirty = true;
    // Also read unversioned { dogs: {...} } and legacy bare per-dog maps.
    const dogs = saved.dogs ?? saved;
    if (!dogs || typeof dogs !== 'object' || Array.isArray(dogs)) return new Map();
    const result = new Map();
    for (const [id, record] of Object.entries(dogs)) {
      if (result.size >= MAX_DOGS) break;
      if (!validId(id) || !record || typeof record !== 'object' || Array.isArray(record)) continue;
      if (!finite(record.affection) && !finite(record.fullness)) continue;
      if ((finite(record.updatedAt) && record.updatedAt > now) || (finite(record.growthUpdatedAt) && record.growthUpdatedAt > now) || (finite(record.lastPlayAt) && record.lastPlayAt > now)) {
        this._repairClock = this._dirty = true;
      }
      const hasGrowth = timestamp(record.adoptedAt) && timestamp(record.growthUpdatedAt) && finite(record.bodySize) && finite(record.bodyCondition);
      if (!hasGrowth) this._dirty = true;
      const state = checkpoint({
        affection: bounded(record.affection, 0),
        fullness: bounded(record.fullness, 46),
        updatedAt: finite(record.updatedAt) && record.updatedAt >= 0 ? Math.min(now, record.updatedAt) : now,
        lastPlayAt: finite(record.lastPlayAt) && record.lastPlayAt >= 0 ? Math.min(now, record.lastPlayAt) : null,
        adoptedAt: timestamp(record.adoptedAt) ? record.adoptedAt : now,
        growthUpdatedAt: hasGrowth ? Math.min(now, record.growthUpdatedAt) : now,
        bodySize: hasGrowth ? clamp(record.bodySize, 5, 6.2) : 5,
        bodyCondition: hasGrowth ? clamp(record.bodyCondition, -.7, .7) : 0,
      }, hasGrowth ? Math.min(now, record.growthUpdatedAt) : -1);
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
      // Size cannot shrink or double-count elapsed days across tabs. Prefer a
      // newer saved condition history over one extrapolated by a stale tab.
      local.adoptedAt = Math.min(local.adoptedAt, incoming.adoptedAt);
      local.bodySize = Math.max(local.bodySize, incoming.bodySize);
      if (incoming._growthCheckpoint > local._growthCheckpoint) {
        local.bodyCondition = incoming.bodyCondition;
        local._growthCheckpoint = incoming._growthCheckpoint;
      }
      const pending = this._pending.get(id);
      // Retain unsaved local increments while incorporating other tabs. All
      // fullness values are first moved to the same clock instant.
      local.affection = Math.min(100, Math.max(local.affection, incoming.affection + (pending?.affection ?? 0)));
      local.fullness = Math.min(100, incoming.fullness + pendingFullness(pending, now));
      if (pending?.fullness) {
        pending.fullness = local.fullness - incoming.fullness;
        pending.fullnessBase = incoming.fullness;
        pending.fullnessAt = now;
      }
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
      this._storage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, dogs }));
      for (const state of this._states.values()) state._growthCheckpoint = state.growthUpdatedAt;
      this._pending.clear();
      this._dirty = false;
      this._repairClock = false;
      this._canSave = true;
    } catch { this._canSave = false; }
  }
}
