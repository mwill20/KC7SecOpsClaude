import { FIELDS, zeroValue } from './catalog.js';
import { compileRegex, testRegex, parseCidr, ipInCidr } from './safety.js';

// Runs a parsed Search query against the fictional UDM dataset.
// Statistics rows carry the metadata.id values of the events behind them under this symbol key (not a column, not
// serialised), so the grader can point at example records when two tables differ.
export const MEMBERS = Symbol('members');
// Events are flat objects keyed by dotted UDM path. Missing fields read as UDM zero values.
const get = (e, f) => (Object.hasOwn(e, f) ? e[f] : zeroValue(f));

function compileFilter(node) {
  if (!node || node.type === 'true') return () => true;
  if (node.type === 'and') { const ks = node.children.map(compileFilter); return e => ks.every(k => k(e)); }
  if (node.type === 'or') { const ks = node.children.map(compileFilter); return e => ks.some(k => k(e)); }
  if (node.type === 'not') { const k = compileFilter(node.child); return e => !k(e); }
  const { field, op, value, nocase } = node;
  if (op === 'cidr') { const c = parseCidr(value.value); return e => ipInCidr(get(e, field), c); }
  if (op === 'regex' || op === 'not_regex') { const re = compileRegex(value.value, nocase); return e => testRegex(re, get(e, field)) === (op === 'regex'); }
  if (FIELDS[field] === 'number') {
    const v = value.value;
    return { '=': e => get(e, field) === v, '!=': e => get(e, field) !== v, '<': e => get(e, field) < v, '<=': e => get(e, field) <= v, '>': e => get(e, field) > v, '>=': e => get(e, field) >= v }[op];
  }
  const v = nocase ? String(value.value).toLowerCase() : value.value;
  const read = nocase ? e => String(get(e, field)).toLowerCase() : e => get(e, field);
  return op === '=' ? e => read(e) === v : e => read(e) !== v;
}

function aggregate(fn, values) {
  if (fn === 'count') return values.length;
  if (fn === 'count_distinct') return new Set(values).size;
  const nums = values.map(Number);
  if (fn === 'sum') return nums.reduce((a, b) => a + b, 0);
  if (fn === 'max') return nums.length ? Math.max(...nums) : 0;
  return nums.length ? Math.min(...nums) : 0;
}

export function execute(query, events, range = null) {
  const keep = compileFilter(query.filter);
  let rows = events;
  if (range) rows = rows.filter(e => e['metadata.event_timestamp.seconds'] >= range.start && e['metadata.event_timestamp.seconds'] <= range.end);
  rows = rows.filter(keep).sort((a, b) => a['metadata.event_timestamp.seconds'] - b['metadata.event_timestamp.seconds']);
  const scanned = rows.length;

  if (!query.match && !query.outcomes.length) return { kind: 'events', rows, count: rows.length, scanned };

  const keys = query.match?.keys ?? []; const window = query.match?.window ?? null;
  const groups = new Map();
  for (const e of rows) {
    const kv = keys.map(k => get(e, k));
    if (window) kv.push(Math.floor(e['metadata.event_timestamp.seconds'] / window) * window);
    const id = JSON.stringify(kv);
    if (!groups.has(id)) groups.set(id, { kv, events: [] });
    groups.get(id).events.push(e);
  }
  if (!query.match && !groups.size) groups.set('[]', { kv: [], events: [] });

  const columns = [...keys, ...(window ? ['window_start'] : []), ...query.outcomes.map(o => o.name)];
  let out = [];
  for (const g of groups.values()) {
    const row = {};
    keys.forEach((k, i) => { row[k] = g.kv[i]; });
    if (window) row.window_start = g.kv[keys.length];
    for (const o of query.outcomes) row[o.name] = aggregate(o.fn, g.events.map(e => get(e, o.field)));
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
  if (query.limit) out = out.slice(0, query.limit);
  return { kind: 'stats', columns, rows: out, count: out.length, scanned, ordered: query.order.length > 0 };
}
