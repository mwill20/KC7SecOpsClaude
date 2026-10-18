import { FIELDS, AGGREGATES, ARRAY_AGGREGATES, TIME_AGGREGATES, FUNCTIONS, TIME_ZONES, TIMESTAMP_FIELD, ALIASES, LIST_TYPES, LIMITS } from './catalog.js';
import { guardRegex, parseCidr } from './safety.js';

// Parses the YARA-L 2.0 *Search* subset this course teaches into a small AST.
// status: 'invalid' = broken syntax; 'unsupported' = may be valid Google syntax the trainer does not run.
//
// Expressions (the left side of a comparison, a placeholder's value, a match key, an aggregate's argument) are
// { kind: 'field', name } | { kind: 'lit', value, type } | { kind: 'fn', name, args: [expr], tz }. A reference-list
// test is { type: 'inlist', field: expr, list, listType, items, nocase }; the list's items are copied into the node at
// parse time, so the executor needs no access to content.
export class QueryError extends Error {
  constructor(code, status = 'invalid', detail = null) { super(code); this.code = code; this.status = status; this.detail = detail; }
}
const invalid = (code, detail) => { throw new QueryError(code, 'invalid', detail); };
const unsupported = (code, detail) => { throw new QueryError(code, 'unsupported', detail); };

const KEYWORDS = new Set(['and', 'or', 'not', 'nocase', 'events', 'match', 'outcome', 'condition', 'order', 'limit', 'dedup', 'by', 'over', 'every', 'asc', 'desc', 'any', 'all', 'in', 'cidr', 'regex']);
const SECTIONS = ['match', 'outcome', 'condition', 'dedup', 'order', 'limit'];
// Google's grouped fields, limited to the members this dataset carries.
export const GROUPED = Object.freeze({
  ip: ['principal.ip', 'target.ip'],
  hostname: ['principal.hostname', 'target.hostname'],
  user: ['principal.user.userid', 'target.user.userid'],
  domain: ['network.dns.questions.name', 'target.hostname'],
  file_path: ['principal.process.file.full_path', 'target.process.file.full_path', 'target.file.full_path'],
  email: ['network.email.from', 'network.email.to'],
});
const UNITS = { m: 60, minute: 60, minutes: 60, h: 3600, hour: 3600, hours: 3600, d: 86400, day: 86400, days: 86400 };
const LIST_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

// Data tables arrive from content as [{ name, columns: [{ name, type }], rows: [[...]] }]; the parser reads a Map of
// table name to a Map of column name to { type, items } (the column's values, read down the rows).
export function indexTables(raw) {
  if (raw instanceof Map) return raw;
  const out = new Map();
  for (const t of Array.isArray(raw) ? raw : []) {
    if (!t || typeof t.name !== 'string' || !LIST_NAME.test(t.name) || !Array.isArray(t.columns) || !Array.isArray(t.rows)) continue;
    const cols = new Map();
    t.columns.forEach((c, i) => { if (c && typeof c.name === 'string' && LIST_NAME.test(c.name) && LIST_TYPES.includes(c.type)) cols.set(c.name, { type: c.type, items: t.rows.map(r => String(r?.[i] ?? '')) }); });
    out.set(t.name, { name: t.name, columns: cols });
  }
  return out;
}

// Reference lists arrive from content as [{ name, type, items }] or as a name-keyed object; the parser reads a Map.
export function indexLists(raw) {
  if (raw instanceof Map) return raw;
  const out = new Map();
  const entries = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.entries(raw).map(([name, v]) => ({ name, ...v })) : [];
  for (const l of entries) if (l && typeof l.name === 'string' && LIST_NAME.test(l.name) && LIST_TYPES.includes(l.type) && Array.isArray(l.items)) out.set(l.name, { name: l.name, type: l.type, items: l.items.map(String) });
  return out;
}

// The display name of an expression: the field, or the function applied to its arguments. Deterministic, so two
// learners who write the same function get the same column and the grader can compare their tables.
export const exprName = x => x.kind === 'field' ? x.name : x.kind === 'lit' ? (x.type === 'string' ? JSON.stringify(x.value) : String(x.value)) : `${x.name}(${x.args.map(exprName).join(', ')})`;
export const exprType = x => x.kind === 'field' ? FIELDS[x.name] : x.kind === 'lit' ? x.type : FUNCTIONS[x.name].returns;

export function lex(text) {
  if (typeof text !== 'string') invalid('EMPTY_QUERY');
  if (new TextEncoder().encode(text).length > LIMITS.bytes) invalid('QUERY_TOO_LONG');
  // A Build starter marks its gap with ___. Name that before any other diagnostic, so the learner is told to fill
  // the gap rather than that ___ is an unknown field or an unsupported aggregate.
  const gap = text.indexOf('___'); if (gap !== -1) invalid('STARTER_GAP', gap);
  const out = []; let i = 0;
  const push = t => { out.push(t); if (out.length > LIMITS.tokens) invalid('QUERY_TOO_LONG'); };
  while (i < text.length) {
    const c = text[i], start = i;
    if (/\s/.test(c)) { i++; continue; }
    if (text.startsWith('//', i)) { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (text.startsWith('/*', i)) { const end = text.indexOf('*/', i + 2); if (end < 0) invalid('UNCLOSED_COMMENT', start); i = end + 2; continue; }
    if (c === '"') {
      let v = ''; i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\n') invalid('UNCLOSED_STRING', start);
        if (text[i] === '\\') { i++; if (!['\\', '"'].includes(text[i])) invalid('BAD_ESCAPE', start); }
        v += text[i++];
      }
      if (text[i] !== '"') invalid('UNCLOSED_STRING', start);
      i++; push({ kind: 'string', value: v, pos: start }); continue;
    }
    if (c === '/') {
      let v = ''; i++; let closed = false;
      while (i < text.length) {
        if (text[i] === '\n') break;
        if (text[i] === '\\') { v += text[i++]; if (i < text.length) v += text[i++]; continue; }
        if (text[i] === '/') { closed = true; i++; break; }
        v += text[i++];
      }
      if (!closed) invalid('UNCLOSED_REGEX', start);
      push({ kind: 'regex', value: v, pos: start }); continue;
    }
    if ('(),:'.includes(c)) { push({ kind: c, value: c, pos: start }); i++; continue; }
    if ('=!<>'.includes(c)) {
      let v = c; i++; if (text[i] === '=') { v += '='; i++; }
      if (!['=', '!=', '<', '<=', '>', '>='].includes(v)) invalid('BAD_OPERATOR', start);
      push({ kind: 'op', value: v, pos: start }); continue;
    }
    if (c === '%') {
      // %list_name: a reference list; %table_name.column_name: a data table column (Google: "Use reference lists and
      // data tables in YARA-L 2.0").
      let v = ''; i++; while (i < text.length && /[A-Za-z0-9_]/.test(text[i])) v += text[i++];
      if (!LIST_NAME.test(v)) invalid('BAD_LIST_NAME', start);
      let column = null;
      if (text[i] === '.') { i++; column = ''; while (i < text.length && /[A-Za-z0-9_]/.test(text[i])) column += text[i++]; if (!LIST_NAME.test(column)) invalid('BAD_LIST_NAME', start); }
      push({ kind: 'list', value: v, column, pos: start }); continue;
    }
    if (c === '|') unsupported('LOOKS_LIKE_KQL', start);
    if (c === '#') unsupported('COUNT_CHARACTER', start);
    if (c === '{' || c === '}') unsupported('LOOKS_LIKE_RULE', start);
    if (c === '*' || c === ';') unsupported('LOOKS_LIKE_SQL', start);
    if (/\d/.test(c)) {
      let v = ''; while (i < text.length && /\d/.test(text[i])) v += text[i++];
      if (text[i] === '.' && /\d/.test(text[i + 1] ?? '')) {
        // dotted number: an IP typed without quotes
        while (i < text.length && /[\d.]/.test(text[i])) v += text[i++];
        invalid('UNQUOTED_IP', start);
      }
      const unit = /^[a-z]+/i.exec(text.slice(i))?.[0];
      if (unit && UNITS[unit.toLowerCase()]) { i += unit.length; push({ kind: 'duration', value: Number(v) * UNITS[unit.toLowerCase()], text: v + unit, pos: start }); continue; }
      push({ kind: 'number', value: Number(v), pos: start }); continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      // hyphens stay inside a word so an unquoted hostname like PC-1 gets a "needs quotes" message
      let v = ''; while (i < text.length && /[A-Za-z0-9_.$-]/.test(text[i])) v += text[i++];
      push({ kind: v.startsWith('$') ? 'var' : 'word', value: v, pos: start }); continue;
    }
    invalid('UNEXPECTED_CHARACTER', { pos: start, char: c });
  }
  return out;
}

export function parseSearch(text, ctx = {}) {
  const lists = indexLists(ctx.lists), tables = indexTables(ctx.tables);
  const ts = lex(text); let p = 0, atoms = 0; const listRefs = { all: 0, regex: 0, cidr: 0 };
  const q = { filter: null, bindings: {}, eventVar: null, match: null, outcomes: [], condition: null, dedup: null, order: [], limit: null, lists: [], tables: [] };
  const peek = (k = 0) => ts[p + k];
  const kw = (t, w) => t && t.kind === 'word' && t.value.toLowerCase() === w;
  const take = w => { if (kw(peek(), w)) { p++; return true; } return false; };
  const need = (kind, code) => { const t = ts[p]; if (!t || t.kind !== kind) invalid(code, t?.pos ?? text.length); p++; return t; };
  const isSection = (k = 0) => peek(k)?.kind === 'word' && peek(k + 1)?.kind === ':' && [...SECTIONS, 'events', 'option', 'meta', 'rule', 'unselect'].includes(peek(k).value.toLowerCase());
  const isFn = t => t?.kind === 'word' && Object.hasOwn(FUNCTIONS, t.value.toLowerCase());

  // Accept Google's $e.field form: one event variable, stripped to the bare field. Aliases resolve to stored fields.
  const fieldName = t => {
    let v = t.value;
    if (t.kind === 'var') {
      const m = /^(\$[A-Za-z_][A-Za-z0-9_]*)\.(.+)$/.exec(v);
      if (!m) return null;
      if (q.eventVar && q.eventVar !== m[1]) unsupported('MULTI_EVENT', t.pos);
      q.eventVar = m[1]; v = m[2];
    }
    if (Object.hasOwn(ALIASES, v)) v = ALIASES[v];
    if (!Object.hasOwn(FIELDS, v)) invalid('UNKNOWN_FIELD', { pos: t.pos, field: v });
    return v;
  };
  // An operand before resolution: a placeholder, a grouped field, a field, or a function applied to operands.
  const operand = () => {
    const t = ts[p++];
    if (!t || !['var', 'word'].includes(t.kind)) invalid('EXPECTED_FIELD', t?.pos ?? text.length);
    if (t.kind === 'word' && KEYWORDS.has(t.value.toLowerCase())) invalid('EXPECTED_FIELD', t.pos);
    if (t.kind === 'var' && !t.value.includes('.')) return { kind: 'var', name: t.value, pos: t.pos };
    if (t.kind === 'word' && Object.hasOwn(GROUPED, t.value)) return { kind: 'group', name: t.value, pos: t.pos };
    if (isFn(t)) {
      const name = t.value.toLowerCase(); need('(', 'EXPECTED_PAREN'); const args = [];
      if (peek()?.kind !== ')') do { const a = peek(); if (a && ['string', 'number'].includes(a.kind)) { p++; args.push({ kind: 'lit', value: a.value, type: a.kind, pos: a.pos }); } else args.push(operand()); } while (peek()?.kind === ',' && p++);
      need(')', 'EXPECTED_PAREN');
      return { kind: 'fn', name, args, pos: t.pos };
    }
    if (t.kind === 'word' && /^(strings|math|timestamp|arrays|re|net|cast|hash|window)\.[a-z_]+$/.test(t.value)) unsupported('UNSUPPORTED_FUNCTION', { pos: t.pos, fn: t.value });
    return { kind: 'field', name: fieldName(t), pos: t.pos };
  };
  const literal = () => {
    const t = ts[p++];
    if (!t) invalid('EXPECTED_VALUE', text.length);
    if (t.kind === 'word' && /^[A-Z_]+$/.test(t.value)) invalid('UNQUOTED_ENUM', { pos: t.pos, word: t.value });
    // field = %table.column is the rule-engine data-table join; Search tests membership with in.
    if (t.kind === 'list') unsupported('LIST_AS_VALUE', { pos: t.pos, name: t.column ? `${t.value}.${t.column}` : t.value });
    if (!['string', 'number', 'regex'].includes(t.kind)) invalid('EXPECTED_VALUE', t.pos);
    return t;
  };
  const atom = () => { if (++atoms > LIMITS.atoms) invalid('QUERY_TOO_LONG'); };
  const startsOperand = t => t && (t.kind === 'var' || (t.kind === 'word' && (Object.hasOwn(FIELDS, t.value) || Object.hasOwn(ALIASES, t.value) || Object.hasOwn(GROUPED, t.value) || isFn(t) || /^(strings|math|timestamp|arrays|re|net|cast|hash|window)\.[a-z_]+$/.test(t.value))));

  const expression = (ctxName, depth = 0) => {
    if (depth > LIMITS.depth) invalid('QUERY_TOO_LONG');
    const unary = () => {
      if (take('not')) return { type: 'not', child: unary() };
      if (peek()?.kind === '(') { p++; const e = orExpr(); need(')', 'EXPECTED_PAREN'); return e; }
      take('any'); take('all');
      const t = peek();
      if (ctxName === 'filter' && kw(t, 're.regex')) {
        p++; need('(', 'EXPECTED_PAREN'); const f = operand(); need(',', 'EXPECTED_COMMA'); const v = literal(); need(')', 'EXPECTED_PAREN');
        if (!['string', 'regex'].includes(v.kind)) invalid('EXPECTED_VALUE', v.pos);
        const bad = guardRegex(v.value); if (bad) invalid(bad, v.pos);
        const nocase = take('nocase'); atom();
        return { type: 'cmp', field: f, op: 'regex', value: { kind: 'regex', value: v.value }, nocase, pos: t.pos };
      }
      if (ctxName === 'filter' && kw(t, 'net.ip_in_range_cidr')) {
        p++; need('(', 'EXPECTED_PAREN'); const f = operand(); need(',', 'EXPECTED_COMMA'); const v = literal(); need(')', 'EXPECTED_PAREN');
        if (v.kind !== 'string' || !parseCidr(v.value)) invalid('BAD_CIDR', v.pos);
        atom(); return { type: 'cmp', field: f, op: 'cidr', value: { kind: 'string', value: v.value }, nocase: false, pos: t.pos };
      }
      const left = operand();
      // Reference lists: field in %list, field in cidr %list, field in regex %list, field not in %list, nocase after.
      if (ctxName === 'filter' && (kw(peek(), 'in') || (kw(peek(), 'not') && kw(peek(1), 'in')))) {
        const negate = take('not'); take('in'); const inPos = ts[p - 1].pos;
        let keyword = null; if (take('cidr')) keyword = 'cidr'; else if (take('regex')) keyword = 'regex';
        const lt = ts[p++]; if (!lt || lt.kind !== 'list') invalid('EXPECTED_LIST', lt?.pos ?? text.length);
        const nocase = take('nocase');
        // Search limits per query (Google, verified 2026-10-18): at most 7 in statements, 4 of them regex, 2 cidr.
        if (++listRefs.all > LIMITS.listRefs) invalid('TOO_MANY_LISTS', inPos);
        if (keyword === 'regex' && ++listRefs.regex > LIMITS.regexListRefs) invalid('TOO_MANY_REGEX_LISTS', inPos);
        if (keyword === 'cidr' && ++listRefs.cidr > LIMITS.cidrListRefs) invalid('TOO_MANY_CIDR_LISTS', inPos);
        atom();
        const node = { type: 'inlist', field: left, list: lt.value, column: lt.column, keyword, nocase, pos: lt.pos };
        return negate ? { type: 'not', child: node } : node;
      }
      const opTok = ts[p++];
      if (!opTok || opTok.kind !== 'op') invalid('EXPECTED_OPERATOR', opTok?.pos ?? text.length);
      if (ctxName === 'filter' && startsOperand(peek())) {
        // placeholder binding: $x = field, $x = fn(field), or field = $x
        if (opTok.value !== '=') invalid('BINDING_OPERATOR', opTok.pos);
        const right = operand();
        const [v, f] = left.kind === 'var' ? [left, right] : [right, left];
        if (v.kind !== 'var' || !['field', 'fn'].includes(f.kind)) invalid('BINDING_SHAPE', opTok.pos);
        return { type: 'binding', name: v.name, value: f, pos: opTok.pos };
      }
      const v = literal();
      const nocase = ctxName === 'filter' && take('nocase');
      if (v.kind === 'regex') {
        if (opTok.value !== '=' && opTok.value !== '!=') invalid('REGEX_OPERATOR', opTok.pos);
        const bad = guardRegex(v.value); if (bad) invalid(bad, v.pos);
        atom(); return { type: 'cmp', field: left, op: opTok.value === '=' ? 'regex' : 'not_regex', value: { kind: 'regex', value: v.value }, nocase, pos: opTok.pos };
      }
      atom(); return { type: 'cmp', field: left, op: opTok.value, value: { kind: v.kind, value: v.value }, nocase, pos: opTok.pos };
    };
    const startsAtom = () => { const t = peek(); if (!t || isSection()) return false; if (t.kind === '(' || t.kind === 'var') return true; return t.kind === 'word' && !['or', 'by', 'over', 'asc', 'desc', 'nocase', 'in', 'cidr', 'regex'].includes(t.value.toLowerCase()); };
    const andExpr = () => {
      const kids = [unary()];
      while (true) {
        if (take('and')) kids.push(unary());
        else if (ctxName === 'filter' && startsAtom()) kids.push(unary()); // implicit AND between lines
        else break;
      }
      return kids.length === 1 ? kids[0] : { type: 'and', children: kids };
    };
    const orExpr = () => { const kids = [andExpr()]; while (take('or')) kids.push(andExpr()); return kids.length === 1 ? kids[0] : { type: 'or', children: kids }; };
    return orExpr();
  };

  if (!ts.length) invalid('EMPTY_QUERY');
  if (kw(peek(), 'rule') || kw(peek(), 'meta')) unsupported('LOOKS_LIKE_RULE', peek().pos);
  if (['select', 'from', 'where', 'index', 'search'].includes(String(peek().value).toLowerCase())) unsupported('LOOKS_LIKE_SQL', peek().pos);
  if (take('events')) need(':', 'EXPECTED_COLON');
  if (isSection()) invalid('MISSING_FILTER', peek().pos);
  q.filter = expression('filter');

  // Lift bindings out of the top-level AND chain.
  const lift = (n, top) => {
    if (n.type === 'binding') {
      if (!top) invalid('BINDING_CONTEXT', n.pos);
      if (q.bindings[n.name]) invalid('BINDING_DUPLICATE', n.pos);
      q.bindings[n.name] = n.value; return { type: 'true' };
    }
    if (n.type === 'and') return { ...n, children: n.children.map(c => lift(c, top)) };
    if (n.type === 'or') return { ...n, children: n.children.map(c => lift(c, false)) };
    if (n.type === 'not') return { ...n, child: lift(n.child, false) };
    return n;
  };
  q.filter = lift(q.filter, true);

  // Resolve an operand to an expression: placeholders to what they were set to, functions with their arguments
  // checked (Google: YARA-L 2.0 functions; the trainer renders UTC only).
  const resolve = (o, where, depth = 0) => {
    if (depth > 4) invalid('QUERY_TOO_LONG');
    if (o.kind === 'field') return { kind: 'field', name: o.name };
    if (o.kind === 'lit') return { kind: 'lit', value: o.value, type: o.type };
    if (o.kind === 'group') invalid('GROUPED_FIELD_HERE', { pos: o.pos, name: o.name, where });
    if (o.kind === 'var') { if (!q.bindings[o.name]) invalid('UNBOUND_VARIABLE', { pos: o.pos, name: o.name, where }); return resolve(q.bindings[o.name], where, depth + 1); }
    const name = o.name; const args = o.args.map(a => resolve(a, where, depth + 1));
    if (name.startsWith('timestamp.')) {
      if (!args.length || args.length > 2 || args[0].kind !== 'field' || args[0].name !== TIMESTAMP_FIELD) invalid('TIMESTAMP_FN_NEEDS_TIMESTAMP', { pos: o.pos, fn: name });
      let tz = 'UTC';
      if (args.length === 2) {
        if (args[1].kind !== 'lit' || args[1].type !== 'string') invalid('TIMEZONE_NEEDS_STRING', { pos: o.pos, fn: name });
        if (!TIME_ZONES.includes(args[1].value)) unsupported('TIMEZONE_UNSUPPORTED', { pos: o.pos, fn: name, zone: args[1].value });
        tz = args[1].value;
      }
      return { kind: 'fn', name, args: [args[0]], tz };
    }
    if (name === 'strings.concat') {
      if (args.length < 2) invalid('CONCAT_NEEDS_ARGS', { pos: o.pos, fn: name });
      if (args.length > LIMITS.concatArgs) invalid('QUERY_TOO_LONG');
      for (const a of args) if (a.kind === 'fn' && exprType(a) !== 'string' && exprType(a) !== 'number') invalid('STRING_FN_NEEDS_STRING', { pos: o.pos, fn: name });
      return { kind: 'fn', name, args };
    }
    // strings.to_lower, strings.to_upper: one string argument
    if (args.length !== 1 || args[0].kind === 'lit' || exprType(args[0]) === 'number') invalid('STRING_FN_NEEDS_STRING', { pos: o.pos, fn: name });
    return { kind: 'fn', name, args };
  };
  // A grouped field is an OR across its member fields (Google: "Search grouped fields").
  const expandGroups = n => {
    if (n.children) return { ...n, children: n.children.map(expandGroups) };
    if (n.child) return { ...n, child: expandGroups(n.child) };
    if ((n.type === 'cmp' || n.type === 'inlist') && n.field.kind === 'group') {
      const members = GROUPED[n.field.name].map(f => ({ ...n, field: { kind: 'field', name: f, pos: n.field.pos }, grouped: n.field.name }));
      return n.op === '!=' || n.op === 'not_regex' ? { type: 'and', children: members } : { type: 'or', children: members };
    }
    return n;
  };
  q.filter = expandGroups(q.filter);
  const typeCheck = n => {
    if (n.children) return n.children.forEach(typeCheck);
    if (n.child) return typeCheck(n.child);
    if (n.type === 'inlist') {
      n.field = resolve(n.field, 'filter'); const ft = exprType(n.field);
      let list, label = n.list;
      if (n.column) {
        // %table.column: a data table column, typed like a list. Unknown table and unknown column are named apart.
        label = `${n.list}.${n.column}`;
        const table = tables.get(n.list); if (!table) invalid('UNKNOWN_TABLE', { pos: n.pos, name: n.list, known: [...tables.keys()] });
        list = table.columns.get(n.column); if (!list) invalid('UNKNOWN_TABLE_COLUMN', { pos: n.pos, name: label, known: [...table.columns.keys()] });
        if (!q.tables.includes(n.list)) q.tables.push(n.list);
      } else {
        list = lists.get(n.list); if (!list) invalid('UNKNOWN_LIST', { pos: n.pos, name: n.list, known: [...lists.keys()], tables: [...tables.keys()] });
        if (!q.lists.includes(n.list)) q.lists.push(n.list);
      }
      if (n.keyword && n.keyword !== list.type) invalid('LIST_TYPE_MISMATCH', { pos: n.pos, name: label, listType: list.type, keyword: n.keyword });
      if (!n.keyword && list.type !== 'string') invalid('LIST_TYPE_MISMATCH', { pos: n.pos, name: label, listType: list.type, keyword: null });
      if (list.type === 'cidr') { if (ft !== 'ip') invalid('LIST_NEEDS_IP', { pos: n.pos, name: label }); if (n.nocase) invalid('NOCASE_ON_CIDR_LIST', n.pos); }
      else if (ft === 'number') invalid('LIST_ON_NUMBER', { pos: n.pos, name: label });
      n.listType = list.type; n.items = list.items.slice(); n.ftype = ft;
      return;
    }
    if (n.type !== 'cmp') return;
    n.field = resolve(n.field, 'filter'); const ft = exprType(n.field); n.ftype = ft;
    const label = exprName(n.field);
    if (n.op === 'cidr') { if (ft !== 'ip') invalid('CIDR_NEEDS_IP', { pos: n.pos, field: label }); return; }
    if (n.op === 'regex' || n.op === 'not_regex') { if (ft === 'number') invalid('REGEX_ON_NUMBER', { pos: n.pos, field: label }); return; }
    if (ft === 'number') { if (n.value.kind !== 'number') invalid('NUMBER_NEEDS_NUMBER', { pos: n.pos, field: label }); if (n.nocase) invalid('NOCASE_ON_NUMBER', n.pos); return; }
    if (n.value.kind !== 'string') invalid('STRING_NEEDS_QUOTES', { pos: n.pos, field: label });
    if (!['=', '!='].includes(n.op)) invalid('STRING_OPERATOR', { pos: n.pos, field: label });
  };
  typeCheck(q.filter);

  let last = -1;
  while (peek()) {
    const t = ts[p++]; const name = String(t.value).toLowerCase(); const rank = SECTIONS.indexOf(name);
    if (t.kind !== 'word' || rank < 0) { if (['option', 'unselect'].includes(name)) unsupported('UNSUPPORTED_SECTION', { pos: t.pos, section: name }); invalid('UNEXPECTED_TOKEN', t.pos); }
    if (rank <= last) invalid('SECTION_ORDER', { pos: t.pos, section: name }); last = rank;
    need(':', 'EXPECTED_COLON');
    if (name === 'match') {
      const ops = [operand()]; while (peek()?.kind === ',') { p++; ops.push(operand()); }
      if (ops.length > LIMITS.matchKeys) invalid('TOO_MANY_KEYS', t.pos);
      let window = null;
      if (take('over')) { if (!take('every')) unsupported('OVER_WINDOW', t.pos); }
      else take('by');
      if (peek()?.kind === 'duration') window = ts[p++].value;
      else if (peek()?.kind === 'word' && UNITS[peek().value.toLowerCase()]) window = UNITS[ts[p++].value.toLowerCase()];
      else if (last === 0 && peek() && !isSection() && peek().kind !== 'word') invalid('BAD_WINDOW', peek().pos);
      const keys = ops.map(k => resolve(k, 'match'));
      q.match = { keys, names: keys.map(exprName), window };
      if (new Set(q.match.names).size !== q.match.names.length) invalid('DUPLICATE_KEY', t.pos);
    } else if (name === 'outcome') {
      do {
        const v = ts[p++]; if (!v || v.kind !== 'var') invalid('OUTCOME_NAME', v?.pos ?? text.length);
        if (q.bindings[v.value]) invalid('OUTCOME_SHADOWS_BINDING', v.pos);
        const eq = ts[p++]; if (!eq || eq.value !== '=') invalid('EXPECTED_OPERATOR', eq?.pos ?? text.length);
        const fn = ts[p++]; if (!fn || fn.kind !== 'word') invalid('EXPECTED_AGGREGATE', fn?.pos ?? text.length);
        const fname = fn.value.toLowerCase();
        if (!AGGREGATES.includes(fname)) unsupported('UNSUPPORTED_AGGREGATE', { pos: fn.pos, fn: fn.value });
        need('(', 'EXPECTED_PAREN'); const arg = resolve(operand(), 'outcome'); need(')', 'EXPECTED_PAREN');
        const argName = exprName(arg);
        if (['sum', 'max', 'min'].includes(fname) && exprType(arg) !== 'number') invalid('AGGREGATE_NEEDS_NUMBER', { pos: fn.pos, fn: fname, field: argName });
        if (TIME_AGGREGATES.includes(fname) && (arg.kind !== 'field' || arg.name !== TIMESTAMP_FIELD)) invalid('TIME_AGGREGATE_NEEDS_TIMESTAMP', { pos: fn.pos, fn: fname, field: argName });
        if (q.outcomes.some(o => o.name === v.value)) invalid('DUPLICATE_OUTCOME', v.pos);
        q.outcomes.push({ name: v.value, fn: fname, field: arg, fieldName: argName, array: ARRAY_AGGREGATES.includes(fname), time: TIME_AGGREGATES.includes(fname) });
        if (q.outcomes.length > LIMITS.outcomes) invalid('QUERY_TOO_LONG');
      } while (peek()?.kind === 'var' && peek(1)?.value === '=');
    } else if (name === 'condition') {
      if (!q.match) invalid('CONDITION_NEEDS_MATCH', t.pos);
      q.condition = expression('condition');
      const check = n => {
        if (n.children) return n.children.forEach(check);
        if (n.child) return check(n.child);
        if (n.type !== 'cmp') invalid('CONDITION_SHAPE', n.pos);
        const o = n.field.kind === 'var' ? q.outcomes.find(x => x.name === n.field.name) : null;
        if (!o) invalid('CONDITION_UNKNOWN_OUTCOME', { pos: n.pos, name: n.field.name });
        if (o.array) invalid('CONDITION_ON_ARRAY', { pos: n.pos, name: o.name });
        if (n.value.kind !== 'number') invalid('CONDITION_NEEDS_NUMBER', n.pos);
        n.field = n.field.name;
      };
      check(q.condition);
    } else if (name === 'dedup') {
      // dedup (Google: "Deduplicate search results"): one row per distinct combination of the named fields. On an
      // event query the keys are event fields or placeholders; on an aggregated query they are match keys or
      // outcome names, applied after the outcomes are computed and the rows ordered. The first row survives.
      const ops = [operand()]; while (peek()?.kind === ',') { p++; ops.push(operand()); }
      if (ops.length > LIMITS.dedupKeys) invalid('TOO_MANY_KEYS', t.pos);
      const keys = ops.map(o => {
        if (o.kind === 'var' && q.outcomes.some(x => x.name === o.name)) return { name: o.name, outcome: o.name };
        const x = resolve(o, 'dedup'); const label = exprName(x);
        if (q.match || q.outcomes.length) { if (!q.match || !q.match.names.includes(label)) invalid('DEDUP_KEY_NOT_GROUPED', { pos: o.pos, name: label }); return { name: label, column: label }; }
        return { name: label, expr: x };
      });
      if (new Set(keys.map(k => k.name)).size !== keys.length) invalid('DUPLICATE_KEY', t.pos);
      q.dedup = { keys };
    } else if (name === 'order') {
      do {
        const v = ts[p++]; const o = v?.kind === 'var' ? q.outcomes.find(x => x.name === v.value) : null;
        if (!o) invalid('ORDER_UNKNOWN_OUTCOME', { pos: v?.pos ?? text.length, name: v?.value });
        if (o.array) invalid('ORDER_ON_ARRAY', { pos: v.pos, name: o.name });
        let dir = 'asc'; if (take('desc')) dir = 'desc'; else take('asc');
        q.order.push({ name: v.value, dir });
      } while (peek()?.kind === ',' && p++);
    } else {
      const v = ts[p++]; if (!v || v.kind !== 'number' || v.value < 1 || v.value > LIMITS.limitMax) invalid('BAD_LIMIT', v?.pos ?? text.length);
      q.limit = v.value;
    }
  }
  if (q.condition && !q.outcomes.length) invalid('CONDITION_NEEDS_MATCH');
  if (q.order.length && !q.outcomes.length) invalid('ORDER_UNKNOWN_OUTCOME', {});
  return q;
}
