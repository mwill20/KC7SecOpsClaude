// Optional, bounded, local-only progress. Stores points per mission part and the highest hint used.
// Never stores query text, answers typed, or anything from the editor.
export const KEY = 'pier9.progress.v1';
const PARTS = { q: [0, 60], a: [0, 25], c: [0, 15] };
const MAX_BYTES = 16384;

export function emptyState() { return { v: 1, missions: {} }; }

export function validateState(raw, missionIds) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.v !== 1 || !raw.missions || typeof raw.missions !== 'object' || Array.isArray(raw.missions)) return null;
  const out = emptyState();
  for (const [id, rec] of Object.entries(raw.missions)) {
    if (!missionIds.has(id) || !rec || typeof rec !== 'object') return null;
    const clean = {};
    for (const [part, allowed] of Object.entries(PARTS)) { const v = rec[part] ?? 0; if (!allowed.includes(v)) return null; clean[part] = v; }
    const h = rec.h ?? 0; if (![0, 1, 2, 3].includes(h)) return null; clean.h = h;
    if (Object.keys(rec).some(k => !['q', 'a', 'c', 'h'].includes(k))) return null;
    out.missions[id] = clean;
  }
  return out;
}

export function createStore(missionIds, storage = safeStorage()) {
  let state = emptyState();
  let remember = false;
  if (storage) {
    try {
      const text = storage.getItem(KEY);
      if (text && text.length <= MAX_BYTES) { const parsed = validateState(JSON.parse(text), missionIds); if (parsed) { state = parsed; remember = true; } }
    } catch { /* unreadable storage: stay session-only */ }
  }
  const persist = () => { if (!remember || !storage) return; try { const text = JSON.stringify(state); if (text.length <= MAX_BYTES) storage.setItem(KEY, text); } catch { /* quota or blocked: keep in memory */ } };
  return {
    get remember() { return remember; },
    available: Boolean(storage),
    setRemember(on) { remember = Boolean(on); if (!remember) { try { storage?.removeItem(KEY); } catch { /* ignore */ } } else persist(); },
    get(id) { return state.missions[id] ?? { q: 0, a: 0, c: 0, h: 0 }; },
    record(id, part, points) {
      if (!missionIds.has(id) || !PARTS[part] || !PARTS[part].includes(points)) return;
      const cur = this.get(id); if (points <= cur[part]) return;
      state.missions[id] = { ...cur, [part]: points }; persist();
    },
    hint(id, level) { if (!missionIds.has(id) || ![1, 2, 3].includes(level)) return; const cur = this.get(id); if (level <= cur.h) return; state.missions[id] = { ...cur, h: level }; persist(); },
    total() { return Object.values(state.missions).reduce((s, m) => s + m.q + m.a + m.c, 0); },
    clear() { state = emptyState(); try { storage?.removeItem(KEY); } catch { /* ignore */ } },
    snapshot() { return JSON.parse(JSON.stringify(state)); },
  };
}

function safeStorage() {
  try { const s = globalThis.localStorage; const probe = '__pier9_probe__'; s.setItem(probe, '1'); s.removeItem(probe); return s; } catch { return null; }
}
