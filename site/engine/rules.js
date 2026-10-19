import { lex, parseTokens, QueryError, RULE_SECTIONS } from './parser.js';
import { compileFilter, compileCondition, aggregate, evalExpr, timeColsOf, byTime, tsOf, inRange, MEMBERS, COUNTS } from './executor.js';
import { LIMITS, RULE_META_REQUIRED, RULE_SEVERITIES, RULE_OPTIONS } from './catalog.js';

// Rule mode: the trainer's subset of a YARA-L 2.0 detection rule, run against the fictional dataset the way the rule
// engine would run it over the case window: one sliding window per match key, one detection per key per window hit.
// Facts followed (verified by the owner's reviewer on 2026-10-18 against Google's live pages, recorded in catalog.js):
// the rule shape is rule name { meta: ... events: ... match: $key over N  outcome: ... condition: ... }; every field
// carries its event variable; match uses over N, a sliding window; condition is mandatory; Search and rules run on
// different engines and their counts differ; match variables skip zero values unless options: allow_zero_values = true;
// an event joins a data-table row with $e.field = %table.column; lists and tables are usable in events and outcome.
//
// Subset accepted here: meta with at least author, description and severity; events with $e (or $e1 and $e2 joined
// by a shared placeholder); match with one to four keys over N; outcome with the Search aggregates; condition with
// $e, #e, outcome comparisons, and/or/not; options with allow_zero_values. Everything else that is valid in a rule
// (a rule without match, non-existence conditions, entity variables, sliding windows longer than 48 hours, other
// options) is reported as unsupported with a plain message; broken shapes are invalid.
const invalid = (code, detail) => { throw new QueryError(code, 'invalid', detail); };
const unsupported = (code, detail) => { throw new QueryError(code, 'unsupported', detail); };
const RULE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export function parseRule(text, ctx = {}) {
  const ts = lex(text, { rule: true });
  if (!ts.length) invalid('EMPTY_QUERY');
  let p = 0;
  const kw = (t, w) => t && t.kind === 'word' && t.value.toLowerCase() === w;
  const head = ts[0];
  if (!kw(head, 'rule')) {
    // A Search body or a bare section on the rule desk: say what a rule starts with.
    if (head.kind === '{' || head.kind === '}') invalid('RULE_BRACE', head.pos);
    invalid('RULE_NEEDS_ENVELOPE', head.pos);
  }
  p++;
  const nameTok = ts[p++];
  if (!nameTok || nameTok.kind !== 'word' || !RULE_NAME.test(nameTok.value) || RULE_SECTIONS.includes(nameTok.value.toLowerCase())) invalid('RULE_NAME', nameTok?.pos ?? text.length);
  if (ts[p]?.kind !== '{') invalid('RULE_BRACE', ts[p]?.pos ?? text.length);
  p++;
  // Split the body into sections by `word :` at the top level. A second brace inside the body is a stray one.
  const sections = []; let cur = null;
  for (; p < ts.length; p++) {
    const t = ts[p];
    if (t.kind === '}') break;
    if (t.kind === '{') invalid('RULE_BRACE', t.pos);
    if (t.kind === 'word' && ts[p + 1]?.kind === ':' && RULE_SECTIONS.includes(t.value.toLowerCase())) {
      cur = { name: t.value.toLowerCase(), pos: t.pos, tokens: [] }; sections.push(cur); p++; continue;
    }
    if (!cur) invalid('RULE_SECTION_FIRST', t.pos);
    cur.tokens.push(t);
  }
  if (ts[p]?.kind !== '}') invalid('RULE_BRACE', text.length);
  if (p !== ts.length - 1) invalid(ts[p + 1].kind === '}' ? 'RULE_BRACE' : 'UNEXPECTED_TOKEN', ts[p + 1].pos);
  // Order and uniqueness: meta, events, match, outcome, condition, options.
  let last = -1; const seen = new Set();
  for (const s of sections) {
    const rank = RULE_SECTIONS.indexOf(s.name);
    if (seen.has(s.name)) invalid('RULE_SECTION_TWICE', { pos: s.pos, section: s.name });
    if (rank <= last) invalid('RULE_SECTION_ORDER', { pos: s.pos, section: s.name });
    seen.add(s.name); last = rank;
  }
  const by = Object.fromEntries(sections.map(s => [s.name, s]));
  if (!by.meta) invalid('RULE_NEEDS_META', head.pos);
  if (!by.events) invalid('RULE_NEEDS_EVENTS', head.pos);
  if (!by.match) unsupported('RULE_NEEDS_MATCH', head.pos);
  if (!by.condition) invalid('RULE_NEEDS_CONDITION', head.pos);

  // meta: key = "value" lines; author, description and severity at least.
  const meta = {};
  const mt = by.meta.tokens;
  for (let i = 0; i < mt.length; i += 3) {
    const k = mt[i], eq = mt[i + 1], v = mt[i + 2];
    if (!k || k.kind !== 'word' || !/^[a-z][a-z0-9_]*$/.test(k.value)) invalid('RULE_META_SHAPE', k?.pos ?? by.meta.pos);
    if (!eq || eq.kind !== 'op' || eq.value !== '=') invalid('RULE_META_SHAPE', eq?.pos ?? k.pos);
    if (!v || v.kind !== 'string') invalid('RULE_META_STRING', { pos: v?.pos ?? k.pos, name: k.value });
    if (Object.hasOwn(meta, k.value)) invalid('RULE_META_TWICE', { pos: k.pos, name: k.value });
    if (!v.value.trim()) invalid('RULE_META_EMPTY', { pos: v.pos, name: k.value });
    if (v.value.length > LIMITS.ruleMetaValue) invalid('QUERY_TOO_LONG');
    meta[k.value] = v.value;
  }
  for (const k of RULE_META_REQUIRED) if (!Object.hasOwn(meta, k)) invalid('RULE_META_MISSING', { pos: by.meta.pos, name: k });
  if (!RULE_SEVERITIES.includes(meta.severity.toUpperCase())) invalid('RULE_SEVERITY', { pos: by.meta.pos, name: meta.severity });

  // options: name = true|false; only the documented option the trainer runs.
  const options = { allow_zero_values: false };
  if (by.options) {
    const ot = by.options.tokens;
    for (let i = 0; i < ot.length; i += 3) {
      const k = ot[i], eq = ot[i + 1], v = ot[i + 2];
      if (!k || k.kind !== 'word') invalid('RULE_OPTION_SHAPE', k?.pos ?? by.options.pos);
      if (!Object.hasOwn(RULE_OPTIONS, k.value)) unsupported('RULE_UNKNOWN_OPTION', { pos: k.pos, name: k.value });
      if (!eq || eq.kind !== 'op' || eq.value !== '=') invalid('RULE_OPTION_SHAPE', eq?.pos ?? k.pos);
      if (!v || v.kind !== 'word' || !['true', 'false'].includes(v.value.toLowerCase())) invalid('RULE_OPTION_VALUE', { pos: v?.pos ?? k.pos, name: k.value });
      options[k.value] = v.value.toLowerCase() === 'true';
    }
  }

  // The body: events, match, outcome and condition tokens, in order, parsed by the Search parser in rule mode.
  const body = [];
  for (const name of ['events', 'match', 'outcome', 'condition']) {
    const s = by[name]; if (!s) continue;
    if (!s.tokens.length) invalid('RULE_SECTION_EMPTY', { pos: s.pos, section: name });
    body.push({ kind: 'word', value: name, pos: s.pos }, { kind: ':', value: ':', pos: s.pos }, ...s.tokens);
  }
  const query = parseTokens(body, text, ctx, { rule: true });
  if (!query.match?.window || query.match.windowKind !== 'over') invalid('RULE_NEEDS_WINDOW', by.match.pos);
  if (query.match.window > LIMITS.ruleWindowMax) unsupported('RULE_WINDOW_TOO_LONG', { pos: by.match.pos });
  if (!query.condition) invalid('RULE_NEEDS_CONDITION', by.condition.pos);
  return { name: nameTok.value, meta, options, query, window: query.match.window };
}

// Evaluates a parsed rule over the events in range. Per match key the window slides from the first unconsumed event:
// the events of that key within [t0, t0 + N] are one evaluation; if the condition holds they are one detection and the
// window moves past them, otherwise it moves to the next event. Zero key values ('' and 0) are skipped unless
// allow_zero_values is set, as Google's match variables do.
export function executeRule(rule, events, range = null) {
  const q = rule.query; const N = rule.window; const multi = q.vars.length > 1;
  const zeroOk = Boolean(rule.options?.allow_zero_values);
  const isZero = v => v === '' || v === 0 || v === undefined || v === null;
  const cands = {};
  let scanned = 0;
  for (const v of q.vars) { const keep = compileFilter(multi ? q.filters[v] : q.filter); cands[v] = events.filter(e => inRange(e, range) && keep(e)).sort(byTime); scanned += cands[v].length; }
  const keys = q.match.keys, names = q.match.names;
  // Key values of an event, read through its variable (a join key names one part per variable).
  const keyOf = (e, v) => { const vals = keys.map(k => evalExpr(e, k, v)); if (!zeroOk && vals.some(isZero)) return null; return vals; };
  const groups = new Map();
  for (const v of q.vars) for (const e of cands[v]) { const kv = keyOf(e, v); if (!kv) continue; const id = JSON.stringify(kv); if (!groups.has(id)) groups.set(id, { kv, events: [] }); groups.get(id).events.push({ e, v }); }
  const test = compileCondition(q.condition);
  const out = [];
  for (const g of groups.values()) {
    const evs = g.events.sort((a, b) => byTime(a.e, b.e));
    let i = 0;
    while (i < evs.length) {
      const t0 = tsOf(evs[i].e); const end = t0 + N;
      let j = i; while (j < evs.length && tsOf(evs[j].e) <= end) j++;
      const win = evs.slice(i, j);
      const row = {};
      names.forEach((k, idx) => { row[k] = g.kv[idx]; });
      row.window_start = t0; row.window_end = end;
      const perVar = Object.fromEntries(q.vars.map(v => [v, win.filter(x => x.v === v).map(x => x.e)]));
      for (const o of q.outcomes) { const src = multi ? perVar[o.evar] : win.map(x => x.e); row[o.name] = aggregate(o.fn, src.map(e => evalExpr(e, o.field, o.evar))); }
      Object.defineProperty(row, COUNTS, { value: Object.fromEntries(q.vars.map(v => [v, perVar[v].length])), enumerable: false });
      Object.defineProperty(row, MEMBERS, { value: win.map(x => x.e['metadata.id']), enumerable: false });
      if (test(row)) { out.push(row); i = j; } else i++;
    }
  }
  out.sort((a, b) => a.window_start - b.window_start || String(JSON.stringify(names.map(k => a[k]))).localeCompare(JSON.stringify(names.map(k => b[k]))));
  const columns = [...names, 'window_start', 'window_end', ...q.outcomes.map(o => o.name)];
  return { kind: 'detections', columns, rows: out, count: out.length, scanned, source: 'events', ordered: true, arrayCols: q.outcomes.filter(o => o.array).map(o => o.name), timeCols: timeColsOf(q), rule: { name: rule.name, meta: rule.meta, options: rule.options, window: N, vars: q.vars.slice(), keys: names.slice() } };
}

export function runRule(text, events, range, ctx = {}) {
  try {
    const rule = parseRule(text, ctx);
    const result = executeRule(rule, events, range);
    return { ok: true, rule, result };
  } catch (error) {
    if (error instanceof QueryError) return { ok: false, status: error.status, code: error.code, detail: error.detail };
    if (error?.code) return { ok: false, status: error.status ?? 'invalid', code: error.code, detail: null };
    return { ok: false, status: 'invalid', code: 'UNEXPECTED', detail: null };
  }
}

// The seconds, inside a window, at which a clock time HH:MM first falls (the case's day may cross midnight).
export function clockToSeconds(hhmm, window) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm ?? '').trim()); if (!m || !window) return null;
  const want = Number(m[1]) * 60 + Number(m[2]);
  for (let t = Math.floor(window.start / 60) * 60; t <= window.end; t += 60) { const d = new Date(t * 1000); if (d.getUTCHours() * 60 + d.getUTCMinutes() === want) return t; }
  return null;
}
const sameKey = (row, names, key) => names.length === key.length && names.every((n, i) => String(row[n]) === String(key[i]));

// Grades a rule the detection-engineering way: the authored must-fire key must be detected in a window that covers the
// authored minute, and the authored must-not-fire key must produce no detection. Every other detection is a false
// positive the learner reads; the count is returned, never scored. cases: { mustFire: { key: [...], at: 'HH:MM' },
// mustNotFire: { key: [...] } }; ctx.window is the case window the clock time is read in.
export function gradeRuleCases(result, cases, window) {
  const names = result.rule.keys;
  if (!cases?.mustFire?.key || names.length !== cases.mustFire.key.length) return { correct: false, reason: 'RULE_KEY_SHAPE', keys: names.length, expected: cases?.mustFire?.key?.length ?? 0 };
  const at = clockToSeconds(cases.mustFire.at, window);
  const fired = result.rows.filter(r => sameKey(r, names, cases.mustFire.key));
  const hit = fired.find(r => at === null || (Math.floor(r.window_start / 60) <= Math.floor(at / 60) && Math.floor(at / 60) <= Math.floor(r.window_end / 60)));
  const noisy = cases.mustNotFire?.key ? result.rows.filter(r => sameKey(r, names, cases.mustNotFire.key)) : [];
  const falsePositives = result.rows.filter(r => !sameKey(r, names, cases.mustFire.key)).length;
  const base = { detections: result.count, falsePositives, mustFire: cases.mustFire, mustNotFire: cases.mustNotFire ?? null, firedElsewhere: fired.length };
  if (!hit && noisy.length) return { correct: false, reason: 'RULE_MISSED_AND_NOISY', ...base };
  if (!hit) return { correct: false, reason: fired.length ? 'RULE_WRONG_WINDOW' : 'RULE_MISSED', ...base };
  if (noisy.length) return { correct: false, reason: 'RULE_NOISY', ...base };
  return { correct: true, reason: 'RULE_FIRES', ...base };
}
