import { FIELDS, zeroValue, LIMITS } from './catalog.js';
import { compileRegex, testRegex, parseCidr, ipInCidr, guardRegex } from './safety.js';

// Runs a parsed Search query against the fictional UDM dataset.
// Statistics rows carry the metadata.id values of the events behind them under this symbol key (not a column, not
// serialised), so the grader can point at example records when two tables differ.
export const MEMBERS = Symbol('members');
// Events are flat objects keyed by dotted UDM path. Missing fields read as UDM zero values.
const get = (e, f) => (Object.hasOwn(e, f) ? e[f] : zeroValue(f));

// Evaluates an expression (field, literal or function) for one event. Time functions read the timestamp in UTC; the
// parser has already refused any other zone. Google documents get_hour as 0 to 23, get_minute as 0 to 59 and
// get_date as YYYY-MM-DD.
export function evalExpr(e, x) {
  if (x.kind === 'field') return get(e, x.name);
  if (x.kind === 'lit') return x.value;
  const args = x.args.map(a => evalExpr(e, a));
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

// Reference list membership (Google: "Use reference lists"): string lists compare whole values (nocase lowers both
// sides), CIDR lists test an IP against every range, regex lists test every pattern through the same guard as learner
// regex. A list item that fails the guard is skipped rather than compiled.
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

export function execute(query, events, range = null) {
  const keep = compileFilter(query.filter);
  let rows = events;
  if (range) rows = rows.filter(e => e['metadata.event_timestamp.seconds'] >= range.start && e['metadata.event_timestamp.seconds'] <= range.end);
  rows = rows.filter(keep).sort((a, b) => a['metadata.event_timestamp.seconds'] - b['metadata.event_timestamp.seconds']);
  const scanned = rows.length;

  if (!query.match && !query.outcomes.length) {
    if (query.dedup) rows = dedupRows(rows, e => query.dedup.keys.map(k => evalExpr(e, k.expr)));
    return { kind: 'events', rows, count: rows.length, scanned, deduped: Boolean(query.dedup) };
  }

  const keys = query.match?.keys ?? []; const names = query.match?.names ?? []; const window = query.match?.window ?? null;
  const groups = new Map();
  for (const e of rows) {
    const kv = keys.map(k => evalExpr(e, k));
    if (window) kv.push(Math.floor(e['metadata.event_timestamp.seconds'] / window) * window);
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
  if (query.condition) {
    const test = n => {
      if (n.type === 'and') return r => n.children.map(test).every(k => k(r));
      if (n.type === 'or') return r => n.children.map(test).some(k => k(r));
      if (n.type === 'not') { const k = test(n.child); return r => !k(r); }
      const v = n.value.value, f = n.field;
      return { '=': r => r[f] === v, '!=': r => r[f] !== v, '<': r => r[f] < v, '<=': r => r[f] <= v, '>': r => r[f] > v, '>=': r => r[f] >= v }[n.op];
    };
    const t = test(query.condition); out = out.filter(t);
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  if (query.order.length) out.sort((a, b) => { for (const o of query.order) { const c = cmp(a[o.name], b[o.name]); if (c) return o.dir === 'desc' ? -c : c; } return cmp(JSON.stringify(a), JSON.stringify(b)); });
  else out.sort((a, b) => cmp(JSON.stringify(a), JSON.stringify(b)));
  if (query.dedup) out = dedupRows(out, r => query.dedup.keys.map(k => r[k.outcome ?? k.column]));
  if (query.limit) out = out.slice(0, query.limit);
  const arrayCols = query.outcomes.filter(o => o.array).map(o => o.name), timeCols = query.outcomes.filter(o => o.time || (['min', 'max'].includes(o.fn) && o.fieldName === 'metadata.event_timestamp.seconds')).map(o => o.name);
  return { kind: 'stats', columns, rows: out, count: out.length, scanned, ordered: query.order.length > 0, deduped: Boolean(query.dedup), arrayCols, timeCols };
}
