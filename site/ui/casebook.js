// The Casebook: one analyst notebook per case. Optional, bounded, local-only, and stored separately from progress
// (key pier9.casebook.v1). This module is pure: the data model, the validator for stored state, the deterministic
// note check and the Markdown export. The DOM lives in casebook-ui.js; nothing here renders or executes anything.
//
// Shape of the stored state:
//   { v: 1, cases: { [caseId]: { scope, evidence[], timeline[], hypothesis[], pivot[], gap[], determination,
//                                 remediation[], handoff, seq, nextRef } } }
// Lists hold entries with a stable id; Evidence entries also carry a stable number n (#1, #2 ...) that is never
// reused, so references from other tabs stay valid when an entry is deleted. scope, determination and handoff are
// single objects (or null). Unknown or malformed stored state is ignored and left in place, never executed or echoed.
export const KEY = 'pier9.casebook.v1';
export const MAX_BYTES = 98304;          // 96 KB for every casebook together
export const MAX_STRING = 4000;          // one field
export const MAX_ENTRIES = 200;          // one list
export const MAX_LIST_ITEMS = 50;        // records or refs on one entry

export const KINDS = ['scope', 'evidence', 'timeline', 'hypothesis', 'pivot', 'gap', 'determination', 'remediation', 'handoff'];
export const KIND_LABEL = { scope: 'Scope', evidence: 'Evidence', timeline: 'Timeline', hypothesis: 'Hypotheses', pivot: 'Pivots', gap: 'Gaps', determination: 'Determination', remediation: 'Remediation', handoff: 'Handoff' };
export const ENTRY_LABEL = { scope: 'Scope', evidence: 'Evidence entry', timeline: 'Timeline entry', hypothesis: 'Hypothesis', pivot: 'Pivot', gap: 'Gap', determination: 'Determination', remediation: 'Remediation item', handoff: 'Handoff ticket' };
export const LISTS = ['contain', 'eradicate', 'recover', 'harden'];
export const LIST_LABEL = { contain: 'Contain', eradicate: 'Eradicate', recover: 'Recover', harden: 'Harden' };
export const LIST_TEACH = {
  contain: 'Stop the bleeding now: block, isolate, disable access. Reversible and fast.',
  eradicate: 'Remove what the attacker left: tasks, scripts, stolen credentials.',
  recover: 'Return systems and people to normal: rebuild, verify, notify.',
  harden: 'Make the same path fail next time: controls, logging, policy. These become the engineering ticket.',
};
export const CONFIDENCE = ['high', 'medium', 'low'];
export const STATUS = ['open', 'supported', 'refuted'];
export const VERDICTS = ['confirmed', 'benign', 'inconclusive'];
export const VERDICT_LABEL = { confirmed: 'Confirmed incident', benign: 'Benign activity', inconclusive: 'Inconclusive' };
export const URGENCY = ['now', 'today', 'this-week'];
export const SINGLE = new Set(['scope', 'determination', 'handoff']);

// One field spec per kind. The UI builds its forms from this, the validator checks stored state against it and the
// note check reads required fields from it. Types: text, textarea, time (HH:MM or a range), select, records
// (metadata.id list), refs (Evidence numbers), ref (one Evidence number), source ({ query, range }), check (boolean).
export const FIELDS = {
  scope: [
    { key: 'question', label: 'Question asked', type: 'textarea', required: true, hint: 'In the words of the person who asked it.' },
    { key: 'requestedBy', label: 'Requested by', type: 'text', required: true },
    { key: 'window', label: 'Time window (UTC)', type: 'time', required: true, hint: 'HH:MM to HH:MM, UTC. The range the answer covers.' },
    { key: 'inScope', label: 'In scope', type: 'textarea', required: true },
    { key: 'outScope', label: 'Out of scope', type: 'textarea', required: true, hint: 'What you were not asked, and will not conclude.' },
  ],
  evidence: [
    { key: 'time', label: 'Time (UTC)', type: 'time', required: true, hint: 'HH:MM, or a range such as 19:05 to 19:10.' },
    { key: 'source', label: 'Source', type: 'source', required: true, hint: 'The query and the time range it ran against. Another analyst reruns this.' },
    { key: 'observation', label: 'Observation', type: 'textarea', required: true, hint: 'What the records show. One claim. No verdicts.' },
    { key: 'records', label: 'Records (metadata.id)', type: 'records', required: true, hint: 'At least one record ID from your results.' },
    { key: 'confidence', label: 'Confidence', type: 'select', options: CONFIDENCE, required: true },
    { key: 'where', label: 'Where to find it', type: 'text', required: false, hint: 'Event type and field in SecOps, for the reader at 3 a.m.' },
  ],
  timeline: [
    { key: 'time', label: 'Time (UTC)', type: 'time', required: true },
    { key: 'fact', label: 'Fact', type: 'textarea', required: true, hint: 'One thing that happened, as the records show it.' },
    { key: 'ref', label: 'Evidence ref (#)', type: 'ref', required: true, hint: 'The Evidence entry this fact comes from.' },
  ],
  hypothesis: [
    { key: 'statement', label: 'Statement', type: 'textarea', required: true, hint: 'The story that would explain the facts, written as a story.' },
    { key: 'status', label: 'Status', type: 'select', options: STATUS, required: true },
    { key: 'supporting', label: 'Supporting refs (#)', type: 'refs', required: false },
    { key: 'contradicting', label: 'Contradicting refs (#)', type: 'refs', required: false },
    { key: 'testNext', label: 'Test next', type: 'text', required: false, hint: 'The query or source that would move this to supported or refuted.' },
  ],
  pivot: [
    { key: 'text', label: 'Pivot', type: 'textarea', required: true, hint: 'The next thing to look at, and what would make it worth looking at.' },
    { key: 'done', label: 'Done', type: 'check', required: false },
  ],
  gap: [
    { key: 'text', label: 'Gap', type: 'textarea', required: true, hint: 'What the logs could not show you.' },
    { key: 'why', label: 'Why it matters', type: 'textarea', required: true },
  ],
  determination: [
    { key: 'verdict', label: 'Determination', type: 'select', options: VERDICTS, labels: VERDICT_LABEL, required: true },
    { key: 'confidence', label: 'Confidence', type: 'select', options: CONFIDENCE, required: true },
    { key: 'refs', label: 'Deciding evidence refs (#)', type: 'refs', required: true },
    { key: 'summary', label: 'Summary', type: 'textarea', required: true, hint: 'Two plain-language sentences a board member could read.' },
  ],
  remediation: [
    { key: 'list', label: 'List', type: 'select', options: LISTS, labels: LIST_LABEL, required: true },
    { key: 'text', label: 'Action', type: 'textarea', required: true },
    { key: 'refs', label: 'Answers evidence refs (#)', type: 'refs', required: true },
    { key: 'owner', label: 'Owner role', type: 'text', required: true, hint: 'A role, not a name: network engineer, station manager, HR.' },
    { key: 'urgency', label: 'Urgency', type: 'select', options: URGENCY, required: true },
  ],
  handoff: [
    { key: 'problem', label: 'Problem statement', type: 'textarea', required: true },
    { key: 'assets', label: 'Affected assets and accounts', type: 'textarea', required: true },
    { key: 'refs', label: 'Evidence refs (#)', type: 'refs', required: true },
    { key: 'controls', label: 'Proposed controls', type: 'textarea', required: true, hint: 'Usually your Harden list.' },
    { key: 'detections', label: 'Detection ideas', type: 'textarea', required: true, hint: 'What a rule should look for, in words. Not a query.' },
    { key: 'acceptance', label: 'Acceptance criteria', type: 'textarea', required: true, hint: 'How the engineer proves it is fixed.' },
    { key: 'openQuestions', label: 'Open questions', type: 'textarea', required: false },
  ],
};
const PREFIX = { evidence: 'e', timeline: 't', hypothesis: 'h', pivot: 'p', gap: 'g', remediation: 'r' };
const spec = kind => FIELDS[kind] ?? null;

export function emptyState() { return { v: 1, cases: {} }; }
export function emptyCase() { return { scope: null, evidence: [], timeline: [], hypothesis: [], pivot: [], gap: [], determination: null, remediation: [], handoff: null, seq: 0, nextRef: 1 }; }

// ---------- times ----------
const HM = '(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?';
const TIME_RE = new RegExp(`^(${HM})(?:\\s*(?:-|–|to)\\s*(${HM}))?$`);
export const isTime = s => typeof s === 'string' && TIME_RE.test(s.trim());
// Minutes since the start of the case's day, so a night that crosses midnight sorts 18:00 before 02:00.
export function timeKey(s, dayStartHour = 0) {
  const m = TIME_RE.exec(String(s ?? '').trim()); if (!m) return Number.POSITIVE_INFINITY;
  const [h, mi] = m[1].split(':').map(Number); let v = h * 60 + mi; if (h < dayStartHour) v += 1440; return v;
}

// ---------- validation of stored state ----------
const isStr = (v, max = MAX_STRING) => typeof v === 'string' && v.length <= max;
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const CASE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ENTRY_ID = /^[a-z]\d{1,6}$/;

function validField(f, v) {
  if (v === undefined || v === null) return true; // an unset field is allowed in storage; the note check reports it
  switch (f.type) {
    case 'text': case 'textarea': case 'time': return isStr(v);
    case 'select': return v === '' || f.options.includes(v);
    case 'check': return typeof v === 'boolean';
    case 'ref': return v === null || isInt(v, 1, 999999);
    case 'refs': return Array.isArray(v) && v.length <= MAX_LIST_ITEMS && v.every(x => isInt(x, 1, 999999));
    case 'records': return Array.isArray(v) && v.length <= MAX_LIST_ITEMS && v.every(x => isStr(x, 40));
    case 'source': return v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k => ['query', 'range'].includes(k)) && isStr(v.query ?? '') && isStr(v.range ?? '', 200);
    default: return false;
  }
}
function validEntry(kind, e, withId) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return false;
  const allowed = new Set(spec(kind).map(f => f.key)); if (withId) { allowed.add('id'); if (kind === 'evidence') allowed.add('n'); }
  if (Object.keys(e).some(k => !allowed.has(k))) return false;
  if (withId && (!isStr(e.id, 8) || !ENTRY_ID.test(e.id))) return false;
  if (kind === 'evidence' && withId && !isInt(e.n, 1, 999999)) return false;
  return spec(kind).every(f => validField(f, e[f.key]));
}
export function validateCase(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = emptyCase();
  const keys = new Set([...KINDS, 'seq', 'nextRef']);
  if (Object.keys(raw).some(k => !keys.has(k))) return null;
  if (!isInt(raw.seq ?? 0, 0, 999999) || !isInt(raw.nextRef ?? 1, 1, 999999)) return null;
  out.seq = raw.seq ?? 0; out.nextRef = raw.nextRef ?? 1;
  for (const kind of KINDS) {
    const v = raw[kind];
    if (SINGLE.has(kind)) { if (v === undefined || v === null) continue; if (!validEntry(kind, v, false)) return null; out[kind] = { ...v }; continue; }
    if (v === undefined) continue;
    if (!Array.isArray(v) || v.length > MAX_ENTRIES) return null;
    const ids = new Set();
    for (const e of v) { if (!validEntry(kind, e, true) || ids.has(e.id)) return null; ids.add(e.id); }
    out[kind] = v.map(e => JSON.parse(JSON.stringify(e)));
  }
  return out;
}
export function validateState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.v !== 1 || !raw.cases || typeof raw.cases !== 'object' || Array.isArray(raw.cases)) return null;
  if (Object.keys(raw).some(k => !['v', 'cases'].includes(k))) return null;
  const out = emptyState();
  for (const [id, cb] of Object.entries(raw.cases)) { if (!CASE_ID.test(id)) return null; const c = validateCase(cb); if (!c) return null; out.cases[id] = c; }
  return out;
}

// ---------- sanitising learner input before it enters the state ----------
// Returns { ok: true, entry } or { ok: false, reason }. Only keys in the field spec survive; strings are trimmed
// and bounded; refs become integers; records are deduplicated. Nothing is interpreted.
export function sanitize(kind, fields) {
  const sp = spec(kind); if (!sp) return { ok: false, reason: 'KIND' };
  if (!fields || typeof fields !== 'object') return { ok: false, reason: 'SHAPE' };
  const out = {};
  for (const f of sp) {
    const v = fields[f.key];
    if (f.type === 'check') { out[f.key] = Boolean(v); continue; }
    if (f.type === 'ref') { const n = toRef(v); out[f.key] = n; continue; }
    if (f.type === 'refs') { const list = toRefs(v); if (list.length > MAX_LIST_ITEMS) return { ok: false, reason: 'TOO_MANY' }; out[f.key] = list; continue; }
    if (f.type === 'records') { const list = toRecords(v); if (list === null) return { ok: false, reason: 'TOO_LONG' }; if (list.length > MAX_LIST_ITEMS) return { ok: false, reason: 'TOO_MANY' }; out[f.key] = list; continue; }
    if (f.type === 'source') { const q = str(v?.query), r = str(v?.range); if (q === null || r === null || r.length > 200) return { ok: false, reason: 'TOO_LONG' }; out[f.key] = { query: q, range: r }; continue; }
    if (f.type === 'select') { const s = str(v) ?? ''; out[f.key] = f.options.includes(s) ? s : ''; continue; }
    const s = str(v); if (s === null) return { ok: false, reason: 'TOO_LONG' }; out[f.key] = s;
  }
  return { ok: true, entry: out };
}
const str = v => { if (v === undefined || v === null) return ''; const s = String(v).trim(); return s.length > MAX_STRING ? null : s; };
const toRef = v => { if (Number.isInteger(v) && v >= 1) return v; const m = /^\s*#?\s*(\d{1,6})\s*$/.exec(String(v ?? '')); return m ? Number(m[1]) : null; };
export const toRefs = v => { const parts = Array.isArray(v) ? v : String(v ?? '').split(/[,\s;]+/); const out = []; for (const p of parts) { const n = toRef(p); if (n && !out.includes(n)) out.push(n); } return out; };
const toRecords = v => { const parts = Array.isArray(v) ? v : String(v ?? '').split(/[,\s;]+/); const out = []; for (const p of parts) { const s = String(p ?? '').trim(); if (!s) continue; if (s.length > 40) return null; if (!out.includes(s)) out.push(s); } return out; };
export const isBlank = entry => !entry || allBlank(entry);
const allBlank = e => Object.values(e).every(v => v === '' || v === null || v === false || (Array.isArray(v) && !v.length) || (v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(x => x === '')));

// ---------- the store ----------
export function createCasebook(storage = safeStorage()) {
  let state = emptyState();
  let remember = false;
  if (storage) {
    try {
      const text = storage.getItem(KEY);
      if (text && text.length <= MAX_BYTES) { const parsed = validateState(JSON.parse(text)); if (parsed) { state = parsed; remember = true; } }
    } catch { /* unreadable storage: stay session-only */ }
  }
  const size = s => JSON.stringify(s).length;
  const persist = () => { if (!remember || !storage) return; try { const text = JSON.stringify(state); if (text.length <= MAX_BYTES) storage.setItem(KEY, text); } catch { /* quota or blocked: keep in memory */ } };
  const caseOf = id => state.cases[id] ?? emptyCase();
  // Every mutation builds the next state, refuses it if it would pass the byte bound, and commits otherwise.
  const commit = (id, next) => { const candidate = { ...state, cases: { ...state.cases, [id]: next } }; if (size(candidate) > MAX_BYTES) return { ok: false, reason: 'FULL' }; state = candidate; persist(); return { ok: true }; };
  const listeners = new Set();
  const notify = () => { for (const fn of listeners) fn(); };
  return {
    get remember() { return remember; },
    available: Boolean(storage),
    setRemember(on) { remember = Boolean(on); if (!remember) { try { storage?.removeItem(KEY); } catch { /* ignore */ } } else persist(); notify(); },
    bytes() { return size(state); },
    max: MAX_BYTES,
    cases() { return Object.keys(state.cases); },
    get(id) { return JSON.parse(JSON.stringify(caseOf(id))); },
    isEmpty(id) { const c = caseOf(id); return KINDS.every(k => SINGLE.has(k) ? !c[k] : !c[k].length); },
    setSingle(id, kind, fields) {
      if (!SINGLE.has(kind) || !CASE_ID.test(id)) return { ok: false, reason: 'KIND' };
      const s = sanitize(kind, fields); if (!s.ok) return s;
      const r = commit(id, { ...caseOf(id), [kind]: isBlank(s.entry) ? null : s.entry }); if (r.ok) { notify(); return { ok: true, entry: s.entry }; } return r;
    },
    add(id, kind, fields) {
      if (SINGLE.has(kind) || !spec(kind) || !CASE_ID.test(id)) return { ok: false, reason: 'KIND' };
      const s = sanitize(kind, fields); if (!s.ok) return s;
      if (isBlank(s.entry)) return { ok: false, reason: 'BLANK' };
      const c = caseOf(id); if (c[kind].length >= MAX_ENTRIES) return { ok: false, reason: 'TOO_MANY' };
      const entry = { id: PREFIX[kind] + (c.seq + 1), ...s.entry }; if (kind === 'evidence') entry.n = c.nextRef;
      const r = commit(id, { ...c, seq: c.seq + 1, nextRef: kind === 'evidence' ? c.nextRef + 1 : c.nextRef, [kind]: [...c[kind], entry] });
      if (r.ok) { notify(); return { ok: true, entry }; } return r;
    },
    update(id, kind, entryId, fields) {
      if (SINGLE.has(kind) || !spec(kind)) return { ok: false, reason: 'KIND' };
      const c = caseOf(id); const at = c[kind].findIndex(e => e.id === entryId); if (at < 0) return { ok: false, reason: 'MISSING' };
      const s = sanitize(kind, fields); if (!s.ok) return s;
      const entry = { id: entryId, ...s.entry }; if (kind === 'evidence') entry.n = c[kind][at].n;
      const list = c[kind].slice(); list[at] = entry;
      const r = commit(id, { ...c, [kind]: list }); if (r.ok) { notify(); return { ok: true, entry }; } return r;
    },
    remove(id, kind, entryId) {
      if (SINGLE.has(kind) || !spec(kind)) return { ok: false, reason: 'KIND' };
      const c = caseOf(id); if (!c[kind].some(e => e.id === entryId)) return { ok: false, reason: 'MISSING' };
      const r = commit(id, { ...c, [kind]: c[kind].filter(e => e.id !== entryId) }); if (r.ok) notify(); return r;
    },
    clearCase(id) { const cases = { ...state.cases }; delete cases[id]; state = { ...state, cases }; if (Object.keys(cases).length) persist(); else { try { storage?.removeItem(KEY); } catch { /* ignore */ } } notify(); },
    clear() { state = emptyState(); try { storage?.removeItem(KEY); } catch { /* ignore */ } notify(); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    snapshot() { return JSON.parse(JSON.stringify(state)); },
  };
}
function safeStorage() {
  try { const s = globalThis.localStorage; const probe = '__pier9_cb_probe__'; s.setItem(probe, '1'); s.removeItem(probe); return s; } catch { return null; }
}

// ---------- the deterministic note check ----------
// Structure only: required fields, time format, record IDs that exist in the dataset, references that point at an
// Evidence entry that exists, a supported hypothesis with support, a remediation item tied to evidence, and no
// claim words without a record on the same entry. It does not read the quality of the thinking, and it never
// compares the text against a model answer.
export const CLAIM_WORDS = ['proves', 'definitely', 'obviously', 'clearly', 'must have'];
const CLAIM_RE = new RegExp('\\b(' + CLAIM_WORDS.map(w => w.replace(' ', '\\s+')).join('|') + ')\\b', 'i');
export const RULES = {
  MISSING_FIELD: f => `${f} is empty.`,
  BAD_TIME: f => `${f} must be HH:MM in UTC, or a range such as 19:05 to 19:10.`,
  NO_RECORDS: () => 'Cite at least one metadata.id from your results.',
  UNKNOWN_RECORD: id => `Record ${id} is not in the dataset. Copy the ID from an open record.`,
  BAD_REF: n => `Reference #${n} does not point at an existing Evidence entry.`,
  NEEDS_REF: f => `${f} needs at least one Evidence entry (#n).`,
  NEEDS_SUPPORT: () => 'A supported hypothesis needs at least one supporting Evidence reference.',
  NEEDS_CONTRA: () => 'A refuted hypothesis needs at least one contradicting Evidence reference.',
  NEEDS_TEST: () => 'An open hypothesis needs a "test next": what would move it to supported or refuted.',
  BAD_ENUM: (f, opts) => `${f} must be one of: ${opts.join(', ')}.`,
  CLAIM_WORD: w => `"${w}" is a claim. Cite a record on this entry, or write what the record shows instead.`,
};
export function checkEntry(kind, entry, ctx = {}) {
  const sp = spec(kind); const problems = []; const push = (code, ...args) => problems.push({ code, message: RULES[code](...args) });
  if (!sp) return [{ code: 'KIND', message: 'Unknown entry kind.' }];
  if (!entry) return sp.filter(f => f.required).map(f => ({ code: 'MISSING_FIELD', message: RULES.MISSING_FIELD(f.label) }));
  const refs = ctx.evidenceRefs ?? new Set(); const eventIds = ctx.eventIds ?? null;
  for (const f of sp) {
    const v = entry[f.key];
    const blank = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) || (f.type === 'source' && !(v.query ?? '').trim());
    if (f.required && blank) {
      if (f.type === 'records') push('NO_RECORDS');
      else if (f.type === 'refs' || f.type === 'ref') push('NEEDS_REF', f.label);
      else push('MISSING_FIELD', f.label);
      continue;
    }
    if (blank) continue;
    if (f.type === 'time' && !isTime(v)) push('BAD_TIME', f.label);
    if (f.type === 'select' && !f.options.includes(v)) push('BAD_ENUM', f.label, f.options);
    if (f.type === 'records' && eventIds) for (const id of v) if (!eventIds.has(id)) push('UNKNOWN_RECORD', id);
    if (f.type === 'refs') for (const n of v) if (!refs.has(n)) push('BAD_REF', n);
    if (f.type === 'ref' && !refs.has(v)) push('BAD_REF', v);
  }
  if (kind === 'hypothesis') {
    if (entry.status === 'supported' && !(entry.supporting ?? []).length) push('NEEDS_SUPPORT');
    if (entry.status === 'refuted' && !(entry.contradicting ?? []).length) push('NEEDS_CONTRA');
    if (entry.status === 'open' && !(entry.testNext ?? '').trim()) push('NEEDS_TEST');
  }
  // Claim words are allowed only when the same entry carries a record: records on an Evidence entry, or a valid
  // Evidence reference on a Timeline entry (whose Evidence entry carries the records).
  const claimText = kind === 'evidence' ? entry.observation : kind === 'timeline' ? entry.fact : null;
  if (claimText) {
    const m = CLAIM_RE.exec(claimText);
    const hasRecord = kind === 'evidence' ? (entry.records ?? []).length > 0 : refs.has(entry.ref);
    if (m && !hasRecord) push('CLAIM_WORD', m[1]);
  }
  return problems;
}
export const evidenceRefs = casebook => new Set((casebook?.evidence ?? []).map(e => e.n));
export const contextFor = (casebook, eventIds) => ({ eventIds, evidenceRefs: evidenceRefs(casebook) });

// ---------- a mission's "Log it" ----------
// logIt: { kind, prompt, mustInclude: [token, ...], list? }. A token may offer alternatives separated by |.
// Passes when one entry of that kind (and list, for remediation) passes the structure check and carries every
// token somewhere in its text. Tokens are things the learner already has on the desk (an IP, a record ID, a time),
// never a model sentence.
export const entryText = entry => flatten(entry).join('\n').toLowerCase();
const flatten = v => v === null || v === undefined ? [] : Array.isArray(v) ? v.flatMap(flatten) : typeof v === 'object' ? Object.values(v).flatMap(flatten) : typeof v === 'boolean' ? [] : [String(v)];
const norm = s => s.toLowerCase().replace(/\s+/g, ' ').trim();
export const hasToken = (text, token) => token.split('|').map(norm).filter(Boolean).some(alt => norm(text).includes(alt));
export function checkLogIt(logIt, casebook, ctx) {
  const kind = logIt.kind; const label = ENTRY_LABEL[kind] ?? kind;
  const candidates = SINGLE.has(kind) ? (casebook[kind] ? [casebook[kind]] : []) : (casebook[kind] ?? []).filter(e => !logIt.list || e.list === logIt.list);
  const listLabel = logIt.list ? `${LIST_LABEL[logIt.list]} ` : '';
  if (!candidates.length) return { ok: false, entry: null, failures: [], missing: logIt.mustInclude.slice(), message: `No ${listLabel}${label.toLowerCase()} yet. Open the Casebook and add one.` };
  const scored = candidates.map(entry => { const failures = checkEntry(kind, entry, ctx); const text = entryText(entry); const missing = logIt.mustInclude.filter(t => !hasToken(text, t)); return { entry, failures, missing, score: failures.length + missing.length }; });
  const best = scored.find(s => s.score === 0) ?? scored.sort((a, b) => a.score - b.score)[0];
  const name = kind === 'evidence' ? `Evidence #${best.entry.n}` : label;
  if (best.score === 0) return { ok: true, entry: best.entry, failures: [], missing: [], message: `${name} passes the structure check and carries what this mission asked for.` };
  const parts = [];
  if (best.failures.length) parts.push(best.failures.map(f => f.message).join(' '));
  if (best.missing.length) parts.push(`Still missing from the entry: ${best.missing.map(t => t.split('|')[0]).join(', ')}.`);
  return { ok: false, entry: best.entry, failures: best.failures, missing: best.missing, message: `${name} does not pass yet. ${parts.join(' ')}` };
}

// ---------- plain-text views ----------
export const sortTimeline = (entries, dayStartHour = 0) => entries.slice().sort((a, b) => timeKey(a.time, dayStartHour) - timeKey(b.time, dayStartHour) || a.id.localeCompare(b.id));
const refList = refs => (refs ?? []).length ? (refs ?? []).map(n => '#' + n).join(', ') : '—';
const lines = (...xs) => xs.flat().filter(x => x !== null && x !== undefined).join('\n');

const verdictLine = d => d ? `${VERDICT_LABEL[d.verdict] ?? (d.verdict || '(none)')} (confidence ${d.confidence || '—'}; refs ${refList(d.refs)})` : '(not written)';
export function handoffText(casebook, caseInfo = {}) {
  const h = casebook.handoff; const title = caseInfo.title ?? caseInfo.id ?? 'case';
  const section = (name, body) => `${name}\n${body && body.trim() ? body.trim() : '(not written)'}`;
  return lines(
    `Engineering handoff: ${title}`,
    `Determination: ${verdictLine(casebook.determination)}`,
    '',
    section('Problem statement', h?.problem), '',
    section('Affected assets and accounts', h?.assets), '',
    `Evidence refs: ${refList(h?.refs)}`, '',
    section('Proposed controls', h?.controls), '',
    section('Detection ideas', h?.detections), '',
    section('Acceptance criteria', h?.acceptance), '',
    section('Open questions', h?.openQuestions),
  );
}

export function toMarkdown(casebook, caseInfo = {}) {
  const dayStart = caseInfo.dayStartHour ?? 0; const title = caseInfo.title ?? caseInfo.id ?? 'Casebook';
  const s = casebook.scope, d = casebook.determination, h = casebook.handoff;
  const md = [`# Casebook: ${title}`, '', 'Written in the Pier Nine trainer. Everything below is the analyst\'s own notes about a fictional case; times are UTC.', ''];
  md.push('## Scope', '');
  if (s) md.push(`- Question asked: ${s.question}`, `- Requested by: ${s.requestedBy}`, `- Time window (UTC): ${s.window}`, `- In scope: ${s.inScope}`, `- Out of scope: ${s.outScope}`); else md.push('_Not written._');
  md.push('', '## Evidence', '');
  if (!casebook.evidence.length) md.push('_No entries._');
  for (const e of casebook.evidence) {
    md.push(`### #${e.n} · ${e.time || '—'} · confidence ${e.confidence || '—'}`, '', e.observation || '_(no observation)_', '', `- Records: ${e.records.length ? e.records.join(', ') : '—'}`, `- Source range: ${e.source.range || '—'}`);
    if (e.where) md.push(`- Where to find it: ${e.where}`);
    md.push('', '```', e.source.query || '(no query)', '```', '');
  }
  md.push('## Timeline', '');
  const tl = sortTimeline(casebook.timeline, dayStart);
  if (!tl.length) md.push('_No entries._');
  for (const t of tl) md.push(`- ${t.time || '—'} · ${t.fact} (#${t.ref ?? '—'})`);
  md.push('', '## Hypotheses', '');
  if (!casebook.hypothesis.length) md.push('_No entries._');
  for (const x of casebook.hypothesis) md.push(`- **${x.status || 'open'}** · ${x.statement}`, `  - Supporting: ${refList(x.supporting)} · Contradicting: ${refList(x.contradicting)}` + (x.testNext ? ` · Test next: ${x.testNext}` : ''));
  md.push('', '## Pivots', '');
  if (!casebook.pivot.length) md.push('_No entries._');
  for (const p of casebook.pivot) md.push(`- [${p.done ? 'x' : ' '}] ${p.text}`);
  md.push('', '## Gaps', '');
  if (!casebook.gap.length) md.push('_No entries._');
  for (const g of casebook.gap) md.push(`- ${g.text}`, `  - Why it matters: ${g.why}`);
  md.push('', '## Determination', '');
  if (d) md.push(`**${VERDICT_LABEL[d.verdict] ?? (d.verdict || '—')}** · confidence ${d.confidence || '—'} · decided by ${refList(d.refs)}`, '', d.summary); else md.push('_Not written._');
  md.push('', '## Remediation', '');
  for (const list of LISTS) {
    const items = casebook.remediation.filter(r => r.list === list);
    md.push(`### ${LIST_LABEL[list]}`, '');
    if (!items.length) md.push('_No items._');
    for (const r of items) md.push(`- ${r.text} · answers ${refList(r.refs)} · owner: ${r.owner || '—'} · urgency: ${r.urgency || '—'}`);
    md.push('');
  }
  md.push('## Handoff', '', '```', handoffText(casebook, caseInfo), '```', '');
  return md.join('\n');
}
