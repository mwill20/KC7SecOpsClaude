import { FIELDS, zeroValue, LIMITS, TIMESTAMP_FIELD, ENTITY_TIMESTAMP_FIELD, isEntityField } from './catalog.js';
import { compileRegex, testRegex, parseCidr, ipInCidr, guardRegex } from './safety.js';

// Runs a parsed Search query against the fictional UDM dataset.
// Statistics rows carry the metadata.id values of the events behind them under this symbol key (not a column, not
// serialised), so the grader can point at example records when two tables differ. Join rows also carry the count of
// distinct events per event variable under COUNTS, which condition: reads as #var.
export const MEMBERS = Symbol('members');
export const COUNTS = Symbol('counts');
// Events are flat objects keyed by dotted UDM path. Missing fields read as UDM zero values.
const get = (e, f) => (Object.hasOwn(e, f) ? e[f] : zeroValue(f));
// Entity records are valid over an interval (Google: entity records are valid over a time range); events at an instant.
const ENTITY_START = 'graph.metadata.interval.start_time.seconds', ENTITY_END = 'graph.metadata.interval.end_time.seconds';
const tsOf = e => (Object.hasOwn(e, TIMESTAMP_FIELD) ? e[TIMESTAMP_FIELD] : e[ENTITY_TIMESTAMP_FIELD] ?? 0);
const isEntity = e => !Object.hasOwn(e, TIMESTAMP_FIELD) && Object.hasOwn(e, ENTITY_TIMESTAMP_FIELD);
const inRange = (e, range) => !range || (isEntity(e) ? e[ENTITY_START] <= range.end && e[ENTITY_END] >= range.start : tsOf(e) >= range.start && tsOf(e) <= range.end);
const byTime = (a, b) => tsOf(a) - tsOf(b) || String(a['metadata.id']).localeCompare(String(b['metadata.id']));

// Evaluates an expression (field, literal or function) for one event. Time functions read the timestamp in UTC; the
// parser has already refused any other zone. Google documents get_hour as 0 to 23, get_minute as 0 to 59 and
// get_date as YYYY-MM-DD. A join expression is read through the part that belongs to the record's event variable.
export function evalExpr(e, x, evar = null) {
  if (x.kind === 'field') return get(e, x.name);
  if (x.kind === 'lit') return x.value;
  if (x.kind === 'join') { const part = x.parts.find(pp => pp.evar === evar) ?? x.parts[0]; return evalExpr(e, part.expr, evar); }
  const args = x.args.map(a => evalExpr(e, a, evar));
  switch (x.name) {
    case 'timestamp.get_hour': return new Date(Number(args[0]) * 1000).getUTCHours();
    case 'timestamp.get_minute': return new Date(Number(args[0]) * 1000).getUTCMinutes();
    case 'timestamp.get_date': return new Date(Number(args[0]) * 1000).toISOString().slice(0, 10);
    case 'strings.to_lower': return String(args[0]).toLowerCase();
    case 'strings.to_upper': return String(args[0]).toUpperCase();
    case 'strings.concat': return args.map(String).join('');
    default: throw Object.assign(new Error('UNEXPECTED'), { code: 'UNEXPECTED', status: 'invalid' });
  }
}

// Reference list and data-table column membership (Google: "Use reference lists and data tables in YARA-L 2.0"):
// string items compare whole values (nocase lowers both sides), CIDR items test an IP against every range, regex items
// test every pattern through the same guard as learner regex. An item that fails the guard is skipped, never compiled.
function compileList(node) {
  const { listType, items, nocase } = node;
  if (listType === 'cidr') { const cidrs = items.map(parseCidr).filter(Boolean); return v => cidrs.some(c => ipInCidr(v, c)); }
  if (listType === 'regex') { const res = items.filter(p => !guardRegex(p)).map(p => compileRegex(p, nocase)); return v => res.some(re => testRegex(re, v)); }
  const set = new Set(items.map(v => nocase ? v.toLowerCase() : v));
  return v => set.has(nocase ? String(v).toLowerCase() : String(v));
}

function compileFilter(node) {
  if (!node || node.type === 'true') return () => true;
  if (node.type === 'and') { const ks = node.children.map(compileFilter); return e => ks.every(k => k(e)); }
  if (node.type === 'or') { const ks = node.children.map(compileFilter); return e => ks.some(k => k(e)); }
  if (node.type === 'not') { const k = compileFilter(node.child); return e => !k(e); }
  const { field, op, value, nocase } = node;
  const read = e => evalExpr(e, field);
  if (node.type === 'inlist') { const test = compileList(node); return e => test(read(e)); }
  if (op === 'cidr') { const c = parseCidr(value.value); return e => ipInCidr(read(e), c); }
  if (op === 'regex' || op === 'not_regex') { const re = compileRegex(value.value, nocase); return e => testRegex(re, read(e)) === (op === 'regex'); }
  const ftype = node.ftype ?? (field.kind === 'field' ? FIELDS[field.name] : 'string');
  if (ftype === 'number') {
    const v = value.value;
    return { '=': e => read(e) === v, '!=': e => read(e) !== v, '<': e => read(e) < v, '<=': e => read(e) <= v, '>': e => read(e) > v, '>=': e => read(e) >= v }[op];
  }
  const v = nocase ? String(value.value).toLowerCase() : value.value;
  const readS = nocase ? e => String(read(e)).toLowerCase() : read;
  return op === '=' ? e => readS(e) === v : e => readS(e) !== v;
}

// Aggregates (Google: "Analyze search data with statistics"). array keeps every value in time order and
// array_distinct the distinct values, both cut at LIMITS.arrayMax as Search cuts at 1,000. earliest and latest are
// the smallest and largest timestamp; count_distinct counts the empty string as a value until it is filtered.
function aggregate(fn, values) {
  if (fn === 'count') return values.length;
  if (fn === 'count_distinct') return new Set(values).size;
  if (fn === 'array') return values.slice(0, LIMITS.arrayMax);
  if (fn === 'array_distinct') return [...new Set(values)].slice(0, LIMITS.arrayMax);
  const nums = values.map(Number);
  if (fn === 'sum') return nums.reduce((a, b) => a + b, 0);
  if (fn === 'max' || fn === 'latest') return nums.length ? Math.max(...nums) : 0;
  return nums.length ? Math.min(...nums) : 0;
}

// dedup: keep the first row for each distinct combination of key values, in the order the rows already have
// (time order for events, the order section for statistics).
function dedupRows(rows, keyOf) {
  const seen = new Set(); const out = [];
  for (const r of rows) { const k = JSON.stringify(keyOf(r)); if (seen.has(k)) continue; seen.add(k); out.push(r); }
  return out;
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// condition, order, dedup and limit on a statistics table, shared by single-event and join queries.
function finishStats(query, out) {
  if (query.condition) {
    const test = n => {
      if (n.type === 'and') return r => n.children.map(test).every(k => k(r));
      if (n.type === 'or') return r => n.children.map(test).some(k => k(r));
      if (n.type === 'not') { const k = test(n.child); return r => !k(r); }
      const v = n.value.value, f = n.field, read = n.count ? r => r[COUNTS]?.[n.count] ?? 0 : r => r[f];
      return { '=': r => read(r) === v, '!=': r => read(r) !== v, '<': r => read(r) < v, '<=': r => read(r) <= v, '>': r => read(r) > v, '>=': r => read(r) >= v }[n.op];
    };
    const t = test(query.condition); out = out.filter(t);
  }
  if (query.order.length) out.sort((a, b) => { for (const o of query.order) { const c = cmp(a[o.name], b[o.name]); if (c) return o.dir === 'desc' ? -c : c; } return cmp(JSON.stringify(a), JSON.stringify(b)); });
  else out.sort((a, b) => cmp(JSON.stringify(a), JSON.stringify(b)));
  if (query.dedup) out = dedupRows(out, r => query.dedup.keys.map(k => r[k.outcome ?? k.column]));
  if (query.limit) out = out.slice(0, query.limit);
  return out;
}
const timeColsOf = query => query.outcomes.filter(o => o.time || (['min', 'max'].includes(o.fn) && [TIMESTAMP_FIELD, ENTITY_TIMESTAMP_FIELD].includes(o.fieldName))).map(o => o.name);

// Entities: the bundled entity records (graph.* fields), passed by the caller beside the events. A single-variable
// query reads one source or the other; a join may read one of each.
export function execute(query, events, range = null, entities = []) {
  if (query.vars?.length > 1) return executeJoin(query, events, entities, range);
  const keep = compileFilter(query.filter);
  let rows = query.entityQuery ? entities : events;
  rows = rows.filter(e => inRange(e, range) && keep(e)).sort(byTime);
  const scanned = rows.length;
  const kind = query.entityQuery ? 'entities' : 'events';

  if (!query.match && !query.outcomes.length) {
    if (query.dedup) rows = dedupRows(rows, e => query.dedup.keys.map(k => evalExpr(e, k.expr)));
    return { kind, rows, count: rows.length, scanned, deduped: Boolean(query.dedup) };
  }

  const keys = query.match?.keys ?? []; const names = query.match?.names ?? []; const window = query.match?.window ?? null;
  const groups = new Map();
  for (const e of rows) {
    const kv = keys.map(k => evalExpr(e, k));
    if (window) kv.push(Math.floor(tsOf(e) / window) * window);
    const id = JSON.stringify(kv);
    if (!groups.has(id)) groups.set(id, { kv, events: [] });
    groups.get(id).events.push(e);
  }
  if (!query.match && !groups.size) groups.set('[]', { kv: [], events: [] });

  const columns = [...names, ...(window ? ['window_start'] : []), ...query.outcomes.map(o => o.name)];
  let out = [];
  for (const g of groups.values()) {
    const row = {};
    names.forEach((k, i) => { row[k] = g.kv[i]; });
    if (window) row.window_start = g.kv[keys.length];
    for (const o of query.outcomes) row[o.name] = aggregate(o.fn, g.events.map(e => evalExpr(e, o.field)));
    Object.defineProperty(row, MEMBERS, { value: g.events.map(e => e['metadata.id']), enumerable: false });
    out.push(row);
  }
  out = finishStats(query, out);
  return { kind: 'stats', columns, rows: out, count: out.length, scanned, ordered: query.order.length > 0, deduped: Boolean(query.dedup), arrayCols: query.outcomes.filter(o => o.array).map(o => o.name), timeCols: timeColsOf(query), source: kind };
}

// Multi-event join (Google: "Use conditions in search and dashboards"): two event variables, each with its own filter,
// joined where every shared placeholder is equal. With `match: $key over N` two events belong together when they are
// within N of each other (either order); with `by N` / `over every N` when they fall in the same clock-aligned bucket;
// with no window, anywhere in the selected range. An entity record joins an event that falls inside its validity
// interval. Each row is one group of the match keys: its outcomes aggregate each variable's matched events, and #var
// is the number of distinct events of that variable in the group. Groups with no matched pair are not rows.
function executeJoin(query, events, entities, range) {
  const [v1, v2] = query.vars;
  const sourceOf = v => (query.varKinds[v] === 'entity' ? entities : events);
  const cands = {};
  for (const v of query.vars) { const keep = compileFilter(query.filters[v]); cands[v] = sourceOf(v).filter(e => inRange(e, range) && keep(e)).sort(byTime); }
  const scanned = cands[v1].length + cands[v2].length;
  const partFor = (key, v) => key.parts.find(pp => pp.evar === v).expr;
  const joinKey = (e, v) => JSON.stringify(query.joinKeys.map(k => evalExpr(e, partFor(k, v))));
  const index = new Map();
  for (const b of cands[v2]) { const k = joinKey(b, v2); if (!index.has(k)) index.set(k, []); index.get(k).push(b); }
  const window = query.match?.window ?? null, over = query.match?.windowKind === 'over';
  const together = (a, b) => {
    if (isEntity(a) || isEntity(b)) { const [ent, ev] = isEntity(a) ? [a, b] : [b, a]; return tsOf(ev) >= ent[ENTITY_START] && tsOf(ev) <= ent[ENTITY_END]; }
    if (!window) return true;
    if (over) return Math.abs(tsOf(a) - tsOf(b)) <= window;
    return Math.floor(tsOf(a) / window) === Math.floor(tsOf(b) / window);
  };
  const bucket = e => (window && !over ? Math.floor((isEntity(e) ? 0 : tsOf(e)) / window) * window : null);
  const keys = query.match.keys, names = query.match.names;
  const groups = new Map();
  for (const a of cands[v1]) {
    for (const b of index.get(joinKey(a, v1)) ?? []) {
      if (!together(a, b)) continue;
      const kv = keys.map(k => evalExpr(a, k, v1));
      if (window && !over) kv.push(bucket(isEntity(a) ? b : a));
      const id = JSON.stringify(kv);
      if (!groups.has(id)) groups.set(id, { kv, sets: { [v1]: new Map(), [v2]: new Map() } });
      const g = groups.get(id); g.sets[v1].set(a['metadata.id'], a); g.sets[v2].set(b['metadata.id'], b);
    }
  }
  const bucketed = Boolean(window && !over);
  const columns = [...names, ...(bucketed ? ['window_start'] : []), ...query.outcomes.map(o => o.name)];
  let out = [];
  for (const g of groups.values()) {
    const row = {};
    names.forEach((k, i) => { row[k] = g.kv[i]; });
    if (bucketed) row.window_start = g.kv[keys.length];
    const lists = Object.fromEntries(query.vars.map(v => [v, [...g.sets[v].values()].sort(byTime)]));
    for (const o of query.outcomes) row[o.name] = aggregate(o.fn, lists[o.evar].map(e => evalExpr(e, o.field, o.evar)));
    Object.defineProperty(row, MEMBERS, { value: query.vars.flatMap(v => lists[v].map(e => e['metadata.id'])), enumerable: false });
    Object.defineProperty(row, COUNTS, { value: Object.fromEntries(query.vars.map(v => [v, lists[v].length])), enumerable: false });
    out.push(row);
  }
  out = finishStats(query, out);
  return { kind: 'stats', columns, rows: out, count: out.length, scanned, ordered: query.order.length > 0, deduped: Boolean(query.dedup), arrayCols: query.outcomes.filter(o => o.array).map(o => o.name), timeCols: timeColsOf(query), joined: query.vars.slice(), joinOn: query.joinKeys.map(k => k.name), window: window ? { seconds: window, kind: over ? 'over' : 'bucket' } : null, source: query.vars.some(v => query.varKinds[v] === 'entity') ? 'entities' : 'events' };
}
