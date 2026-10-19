import { FIELDS, AGGREGATES, ARRAY_AGGREGATES, TIME_AGGREGATES, FUNCTIONS, TIME_ZONES, TIMESTAMP_FIELD, TIMESTAMP_FIELDS, ALIASES, LIST_TYPES, LIMITS, isEntityField } from './catalog.js';
import { guardRegex, parseCidr } from './safety.js';

// Parses the YARA-L 2.0 *Search* subset this course teaches into a small AST.
// status: 'invalid' = broken syntax; 'unsupported' = may be valid Google syntax the trainer does not run.
//
// Expressions (the left side of a comparison, a placeholder's value, a match key, an aggregate's argument) are
// { kind: 'field', name, evar } | { kind: 'lit', value, type } | { kind: 'fn', name, args: [expr], tz } |
// { kind: 'join', name, parts: [{ evar, expr }] } (a placeholder two event variables both set: the join key).
// A reference-list or data-table test is { type: 'inlist', field: expr, list, column, listType, items, nocase }; the
// items are copied into the node at parse time, so the executor needs no access to content.
//
// Rule mode (Google: YARA-L 2.0 rule syntax; the facts the trainer follows were verified by the owner's reviewer on
// 2026-10-18 against the live pages): parseTokens(..., { rule: true }) parses the body of a detection rule, where every
// field is written with an event variable ($e.metadata.event_type), match: takes `$key over N` (a sliding window),
// condition: is mandatory and may read $e / #e on a single-variable rule, and an event joins a data-table row with
// `$e.field = %table.column`, whose other columns an outcome may then read (%table.other). site/engine/rules.js parses
// the envelope (rule name { meta: ... options: ... }) and hands the sections here.
//
// Event variables (Google: "Use conditions in search and dashboards", verified 2026-10-18): a query may name one event
// variable ($e.field, or none) and runs as a single-event query, or two ($e1, $e2) joined by placeholders both set,
// grouped by those placeholders in match: with an optional `over N` window (events for the same key within N of each
// other). condition: then takes #var (the count of distinct events of that variable), $var (#var > 0) and outcome
// comparisons. Non-existence conditions (#var = 0, not $var) and three or more variables are reported as unsupported.
export class QueryError extends Error {
  constructor(code, status = 'invalid', detail = null) { super(code); this.code = code; this.status = status; this.detail = detail; }
}
const invalid = (code, detail) => { throw new QueryError(code, 'invalid', detail); };
const unsupported = (code, detail) => { throw new QueryError(code, 'unsupported', detail); };

const KEYWORDS = new Set(['and', 'or', 'not', 'nocase', 'events', 'match', 'outcome', 'condition', 'order', 'limit', 'dedup', 'by', 'over', 'every', 'asc', 'desc', 'any', 'all', 'in', 'cidr', 'regex']);
// Sections a rule has that a Search query does not.
export const RULE_SECTIONS = Object.freeze(['meta', 'events', 'match', 'outcome', 'condition', 'options']);
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
const FN_SHAPE = /^(strings|math|timestamp|arrays|re|net|cast|hash|window)\.[a-z_]+$/;

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
// learners who write the same function get the same column and the grader can compare their tables. A join key is
// named by the fields it joins (one name when both events set the same field), never by the learner's placeholder.
// A joined data-table column (rule mode) is named %table.column and is read through the event field it was joined on.
export const exprName = x => x.kind === 'field' ? x.name : x.kind === 'lit' ? (x.type === 'string' ? JSON.stringify(x.value) : String(x.value)) : x.kind === 'join' ? x.name : x.kind === 'tablecol' ? `%${x.table}.${x.column}` : `${x.name}(${x.args.map(exprName).join(', ')})`;
export const exprType = x => x.kind === 'field' ? FIELDS[x.name] : x.kind === 'lit' ? x.type : x.kind === 'join' ? exprType(x.parts[0].expr) : x.kind === 'tablecol' ? 'string' : FUNCTIONS[x.name].returns;
// The event variables an expression reads (none for a literal; a join reads every part's).
const evarsOf = x => x.kind === 'field' ? (x.evar ? [x.evar] : []) : x.kind === 'lit' ? [] : x.kind === 'join' ? x.parts.map(p => p.evar) : x.kind === 'tablecol' ? evarsOf(x.joinField) : [...new Set(x.args.flatMap(evarsOf))];

// opts.rule: braces are tokens (the rule envelope) instead of the sign of a rule pasted into the Search desk.
export function lex(text, opts = {}) {
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
    if (c === '#') {
      // #var: the count of distinct events an event variable matched (Google: conditions page). Only condition: reads it.
      let v = ''; i++; while (i < text.length && /[A-Za-z0-9_]/.test(text[i])) v += text[i++];
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) unsupported('COUNT_CHARACTER', start);
      push({ kind: 'count', value: '$' + v, pos: start }); continue;
    }
    if (c === '|') unsupported('LOOKS_LIKE_KQL', start);
    if (c === '{' || c === '}') { if (!opts.rule) unsupported('LOOKS_LIKE_RULE', start); push({ kind: c, value: c, pos: start }); i++; continue; }
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

export function parseSearch(text, ctx = {}) { return parseTokens(lex(text), text, ctx); }

// Parses a token list (from lex) as a Search query, or as the body of a rule with opts.rule. text is the source the
// positions refer to.
export function parseTokens(ts, text, ctx = {}, opts = {}) {
  const lists = indexLists(ctx.lists), tables = indexTables(ctx.tables);
  const rule = Boolean(opts.rule);
  let p = 0, atoms = 0; const listRefs = { all: 0, regex: 0, cidr: 0 };
  // Search caps in tests at 7/4/2 per query; rules at 10/5/5 (Google, verified 2026-10-18).
  const listMax = rule ? { all: LIMITS.ruleListRefs, regex: LIMITS.ruleRegexListRefs, cidr: LIMITS.ruleCidrListRefs } : { all: LIMITS.listRefs, regex: LIMITS.regexListRefs, cidr: LIMITS.cidrListRefs };
  // bindings: placeholder name -> [{ evar, value }], one entry per event variable that sets it. vars: the event
  // variables named, in order of first appearance; filters: per-variable filter on a multi-event query.
  // tableJoins (rule mode): table name -> { field, column }, the event field a data table was joined on and the column.
  const q = { rule, filter: null, bindings: {}, vars: [], varKinds: {}, filters: null, entityQuery: false, match: null, outcomes: [], condition: null, dedup: null, order: [], limit: null, lists: [], tables: [], tableJoins: {} };
  const peek = (k = 0) => ts[p + k];
  const kw = (t, w) => t && t.kind === 'word' && t.value.toLowerCase() === w;
  const take = w => { if (kw(peek(), w)) { p++; return true; } return false; };
  const need = (kind, code) => { const t = ts[p]; if (!t || t.kind !== kind) invalid(code, t?.pos ?? text.length); p++; return t; };
  const isSection = (k = 0) => peek(k)?.kind === 'word' && peek(k + 1)?.kind === ':' && [...SECTIONS, 'events', 'option', 'options', 'meta', 'rule', 'unselect'].includes(peek(k).value.toLowerCase());
  const isFn = t => t?.kind === 'word' && Object.hasOwn(FUNCTIONS, t.value.toLowerCase());
  const noteVar = (v, pos) => { if (!q.vars.includes(v)) { if (q.vars.length >= LIMITS.eventVars) unsupported('TOO_MANY_EVENT_VARS', { pos, name: v, max: LIMITS.eventVars }); q.vars.push(v); } };

  // Accept Google's $e.field form: the variable is kept on the field node. Aliases resolve to stored fields.
  const fieldName = t => {
    let v = t.value, evar = null;
    if (t.kind === 'var') {
      const m = /^(\$[A-Za-z_][A-Za-z0-9_]*)\.(.+)$/.exec(v);
      if (!m) return null;
      evar = m[1]; v = m[2];
    }
    if (Object.hasOwn(ALIASES, v)) v = ALIASES[v];
    if (!Object.hasOwn(FIELDS, v)) invalid('UNKNOWN_FIELD', { pos: t.pos, field: v });
    // In a rule every field is written with its event variable (Google: rule syntax, verified 2026-10-18).
    if (rule && !evar) invalid('FIELD_NEEDS_VARIABLE', { pos: t.pos, field: v });
    if (evar) { noteVar(evar, t.pos); const kind = isEntityField(v) ? 'entity' : 'event'; if (q.varKinds[evar] && q.varKinds[evar] !== kind) invalid('ENTITY_MIX', { pos: t.pos, name: evar }); if (rule && kind === 'entity') unsupported('ENTITY_IN_RULE', { pos: t.pos, name: evar }); q.varKinds[evar] = kind; }
    return { name: v, evar };
  };
  // An operand before resolution: a placeholder, a grouped field, a field, or a function applied to operands.
  const operand = () => {
    const t = ts[p++];
    if (t?.kind === 'count') unsupported('COUNT_CHARACTER', t.pos);
    // Rule mode: %table.column as an operand reads the joined row's column (resolve checks the table was joined).
    if (t?.kind === 'list' && rule) { if (!t.column) invalid('TABLE_JOIN_NEEDS_COLUMN', { pos: t.pos, name: t.value }); return { kind: 'tablecol', table: t.value, column: t.column, pos: t.pos }; }
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
    if (t.kind === 'word' && FN_SHAPE.test(t.value)) unsupported('UNSUPPORTED_FUNCTION', { pos: t.pos, fn: t.value });
    const f = fieldName(t);
    return { kind: 'field', name: f.name, evar: f.evar, pos: t.pos };
  };
  const literal = () => {
    const t = ts[p++];
    if (!t) invalid('EXPECTED_VALUE', text.length);
    if (t.kind === 'word' && /^[A-Z_]+$/.test(t.value)) invalid('UNQUOTED_ENUM', { pos: t.pos, word: t.value });
    // field = %table.column is the rule-engine data-table join; Search tests membership with in. Rule mode runs the join.
    if (t.kind === 'list') { if (rule) return t; unsupported('LIST_AS_VALUE', { pos: t.pos, name: t.column ? `${t.value}.${t.column}` : t.value }); }
    if (!['string', 'number', 'regex'].includes(t.kind)) invalid('EXPECTED_VALUE', t.pos);
    return t;
  };
  const atom = () => { if (++atoms > LIMITS.atoms) invalid('QUERY_TOO_LONG'); };
  const startsOperand = t => t && (t.kind === 'var' || (t.kind === 'word' && (Object.hasOwn(FIELDS, t.value) || Object.hasOwn(ALIASES, t.value) || Object.hasOwn(GROUPED, t.value) || isFn(t) || FN_SHAPE.test(t.value))));
  // The one event variable an operand reads before resolution (a placeholder reads none yet).
  const operandVars = o => o.kind === 'field' ? (o.evar ? [o.evar] : []) : o.kind === 'fn' ? [...new Set(o.args.flatMap(operandVars))] : o.kind === 'tablecol' ? operandVars(q.tableJoins[o.table]?.field ?? { kind: 'lit' }) : [];
  let joins = 0;

  const expression = (ctxName, depth = 0) => {
    if (depth > LIMITS.depth) invalid('QUERY_TOO_LONG');
    const unary = () => {
      if (take('not')) return { type: 'not', child: unary() };
      if (peek()?.kind === '(') { p++; const e = orExpr(); need(')', 'EXPECTED_PAREN'); return e; }
      take('any'); take('all');
      const t = peek();
      if (ctxName === 'condition') {
        // #var op number, or a bare $var meaning #var > 0 (Google: "$var is #var > 0").
        if (t?.kind === 'count' || (t?.kind === 'var' && !t.value.includes('.') && q.vars.includes(t.value))) {
          p++; const name = t.value;
          if (!q.vars.includes(name)) invalid('UNKNOWN_EVENT_VAR', { pos: t.pos, name, known: q.vars });
          if (q.vars.length < 2 && !rule) unsupported('COUNT_CHARACTER', t.pos);
          if (t.kind === 'var' && peek()?.kind !== 'op') { atom(); return { type: 'cmp', count: name, op: '>', value: { kind: 'number', value: 0 }, pos: t.pos }; }
          const opTok = ts[p++]; if (!opTok || opTok.kind !== 'op') invalid('EXPECTED_OPERATOR', opTok?.pos ?? text.length);
          const v = ts[p++]; if (!v || v.kind !== 'number') invalid('CONDITION_NEEDS_NUMBER', v?.pos ?? text.length);
          atom(); return { type: 'cmp', count: name, op: opTok.value, value: { kind: 'number', value: v.value }, pos: t.pos };
        }
      }
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
      // Reference lists and data tables: field in %list, in cidr %list, in regex %list, field not in %list, nocase after.
      if (ctxName === 'filter' && (kw(peek(), 'in') || (kw(peek(), 'not') && kw(peek(1), 'in')))) {
        const negate = take('not'); take('in'); const inPos = ts[p - 1].pos;
        let keyword = null; if (take('cidr')) keyword = 'cidr'; else if (take('regex')) keyword = 'regex';
        const lt = ts[p++]; if (!lt || lt.kind !== 'list') invalid('EXPECTED_LIST', lt?.pos ?? text.length);
        const nocase = take('nocase');
        // Search limits per query (Google, verified 2026-10-18): at most 7 in statements, 4 of them regex, 2 cidr.
        if (++listRefs.all > listMax.all) invalid('TOO_MANY_LISTS', inPos);
        if (keyword === 'regex' && ++listRefs.regex > listMax.regex) invalid('TOO_MANY_REGEX_LISTS', inPos);
        if (keyword === 'cidr' && ++listRefs.cidr > listMax.cidr) invalid('TOO_MANY_CIDR_LISTS', inPos);
        atom();
        const node = { type: 'inlist', field: left, list: lt.value, column: lt.column, keyword, nocase, pos: lt.pos };
        return negate ? { type: 'not', child: node } : node;
      }
      const opTok = ts[p++];
      if (!opTok || opTok.kind !== 'op') invalid('EXPECTED_OPERATOR', opTok?.pos ?? text.length);
      if (ctxName === 'filter' && startsOperand(peek())) {
        // placeholder binding: $x = field, $x = fn(field), field = $x; or $e1.field = $e2.field, a join written directly
        if (opTok.value !== '=') invalid('BINDING_OPERATOR', opTok.pos);
        const right = operand();
        if (left.kind !== 'var' && right.kind !== 'var') {
          const lv = operandVars(left), rv = operandVars(right);
          if (lv.length === 1 && rv.length === 1 && lv[0] !== rv[0] && ['field', 'fn'].includes(left.kind) && ['field', 'fn'].includes(right.kind)) {
            const name = '$_join' + (++joins);
            return { type: 'and', children: [{ type: 'binding', name, value: left, pos: opTok.pos }, { type: 'binding', name, value: right, pos: opTok.pos }] };
          }
          invalid('BINDING_SHAPE', opTok.pos);
        }
        const [v, f] = left.kind === 'var' ? [left, right] : [right, left];
        if (v.kind !== 'var' || !['field', 'fn'].includes(f.kind)) invalid('BINDING_SHAPE', opTok.pos);
        return { type: 'binding', name: v.name, value: f, pos: opTok.pos };
      }
      const v = literal();
      if (v.kind === 'list') {
        // Rule mode: $e.field = %table.column joins the event to the table rows whose column equals the field.
        if (opTok.value !== '=') invalid('TABLE_JOIN_OPERATOR', opTok.pos);
        if (!v.column) invalid('TABLE_JOIN_NEEDS_COLUMN', { pos: v.pos, name: v.value });
        if (ctxName !== 'filter') invalid('EXPECTED_VALUE', v.pos);
        if (++listRefs.all > listMax.all) invalid('TOO_MANY_LISTS', opTok.pos);
        atom(); return { type: 'tablejoin', field: left, table: v.value, column: v.column, pos: v.pos };
      }
      const nocase = ctxName === 'filter' && take('nocase');
      if (v.kind === 'regex') {
        if (opTok.value !== '=' && opTok.value !== '!=') invalid('REGEX_OPERATOR', opTok.pos);
        const bad = guardRegex(v.value); if (bad) invalid(bad, v.pos);
        atom(); return { type: 'cmp', field: left, op: opTok.value === '=' ? 'regex' : 'not_regex', value: { kind: 'regex', value: v.value }, nocase, pos: opTok.pos };
      }
      atom(); return { type: 'cmp', field: left, op: opTok.value, value: { kind: v.kind, value: v.value }, nocase, pos: opTok.pos };
    };
    const startsAtom = () => { const t = peek(); if (!t || isSection()) return false; if (t.kind === '(' || t.kind === 'var' || t.kind === 'count') return true; return t.kind === 'word' && !['or', 'by', 'over', 'asc', 'desc', 'nocase', 'in', 'cidr', 'regex'].includes(t.value.toLowerCase()); };
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

  // Lift bindings out of the top-level AND chain. A placeholder may be set once per event variable: set twice by the
  // same event it is a duplicate; set by two events it is the join key.
  const lift = (n, top) => {
    if (n.type === 'binding') {
      if (!top) invalid('BINDING_CONTEXT', n.pos);
      const vars = operandVars(n.value); if (vars.length > 1) unsupported('MIXED_EVENT_VARS', { pos: n.pos, name: n.name });
      const evar = vars[0] ?? null;
      const list = (q.bindings[n.name] ??= []);
      if (list.some(b => b.evar === evar)) invalid('BINDING_DUPLICATE', { pos: n.pos, name: n.name });
      list.push({ evar, value: n.value }); return { type: 'true' };
    }
    if (n.type === 'and') return { ...n, children: n.children.map(c => lift(c, top)) };
    if (n.type === 'or') return { ...n, children: n.children.map(c => lift(c, false)) };
    if (n.type === 'not') return { ...n, child: lift(n.child, false) };
    return n;
  };
  q.filter = lift(q.filter, true);
  const multi = q.vars.length > 1;
  if (!multi) for (const [name, list] of Object.entries(q.bindings)) if (list.length > 1) invalid('BINDING_DUPLICATE', { pos: list[1].value.pos, name });
  // Shared placeholders: set by every event variable. They are the join keys and the only match keys of a join.
  const shared = multi ? Object.keys(q.bindings).filter(k => new Set(q.bindings[k].map(b => b.evar)).size === q.vars.length) : [];
  if (multi) {
    for (const v of q.vars) if (!shared.length) invalid('UNJOINED_VARIABLE', { pos: 0, name: v, vars: q.vars });
    for (const [name, list] of Object.entries(q.bindings)) if (list.some(b => !b.evar)) invalid('BARE_FIELD_IN_JOIN', { pos: list.find(b => !b.evar).value.pos, name });
    if (q.vars.every(v => q.varKinds[v] === 'entity')) unsupported('ENTITY_JOIN_ONLY', { pos: 0 });
  }

  // Resolve an operand to an expression: placeholders to what they were set to, functions with their arguments
  // checked (Google: YARA-L 2.0 functions; the trainer renders UTC only).
  const resolve = (o, where, depth = 0) => {
    if (depth > 4) invalid('QUERY_TOO_LONG');
    if (o.kind === 'field') return { kind: 'field', name: o.name, evar: o.evar ?? null };
    if (o.kind === 'lit') return { kind: 'lit', value: o.value, type: o.type };
    if (o.kind === 'group') invalid('GROUPED_FIELD_HERE', { pos: o.pos, name: o.name, where });
    if (o.kind === 'tablecol') {
      // A joined table's column, read through the row the event joined (first matching row). The table must have been
      // joined in the filter with $e.field = %table.join_column.
      const j = q.tableJoins[o.table]; if (!j) invalid('TABLE_NOT_JOINED', { pos: o.pos, name: `${o.table}.${o.column}` });
      const table = tables.get(o.table); const col = table?.columns.get(o.column); if (!col) invalid('UNKNOWN_TABLE_COLUMN', { pos: o.pos, name: `${o.table}.${o.column}`, known: [...(table?.columns.keys() ?? [])] });
      return { kind: 'tablecol', table: o.table, column: o.column, joinField: j.field, joinItems: j.items, items: col.items.slice() };
    }
    if (o.kind === 'var') {
      const list = q.bindings[o.name]; if (!list) invalid('UNBOUND_VARIABLE', { pos: o.pos, name: o.name, where });
      if (list.length === 1) return resolve(list[0].value, where, depth + 1);
      if (where === 'filter') invalid('SHARED_PLACEHOLDER_COMPARED', { pos: o.pos, name: o.name });
      const parts = list.map(b => ({ evar: b.evar, expr: resolve(b.value, where, depth + 1) }));
      const names = [...new Set(parts.map(x => exprName(x.expr)))].sort();
      return { kind: 'join', name: names.join(' = '), parts };
    }
    const name = o.name; const args = o.args.map(a => resolve(a, where, depth + 1));
    if (name.startsWith('timestamp.')) {
      if (!args.length || args.length > 2 || args[0].kind !== 'field' || !TIMESTAMP_FIELDS.includes(args[0].name)) invalid('TIMESTAMP_FN_NEEDS_TIMESTAMP', { pos: o.pos, fn: name });
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
      if (new Set(args.flatMap(evarsOf)).size > 1) unsupported('MIXED_EVENT_VARS', { pos: o.pos, name });
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
    if (n.type === 'tablejoin') {
      n.field = resolve(n.field, 'filter'); const ft = exprType(n.field);
      const label = `${n.table}.${n.column}`;
      const table = tables.get(n.table); if (!table) invalid('UNKNOWN_TABLE', { pos: n.pos, name: n.table, known: [...tables.keys()] });
      const col = table.columns.get(n.column); if (!col) invalid('UNKNOWN_TABLE_COLUMN', { pos: n.pos, name: label, known: [...table.columns.keys()] });
      if (col.type !== 'string') invalid('TABLE_JOIN_TYPE', { pos: n.pos, name: label, listType: col.type });
      if (ft === 'number') invalid('LIST_ON_NUMBER', { pos: n.pos, name: label });
      if (q.tableJoins[n.table]) invalid('TABLE_JOINED_TWICE', { pos: n.pos, name: n.table });
      q.tableJoins[n.table] = { field: n.field, column: n.column, items: col.items.slice() };
      if (!q.tables.includes(n.table)) q.tables.push(n.table);
      n.items = col.items.slice(); n.ftype = ft;
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

  // Entity queries (Google: statistics page, graph.entity.* fields): a single-variable query whose fields are all entity
  // fields runs against the entity records; mixing entity and event fields in one filter needs two variables.
  const fieldsIn = n => n.children ? n.children.flatMap(fieldsIn) : n.child ? fieldsIn(n.child) : n.field ? [n.field] : [];
  const leaves = x => x.kind === 'field' ? [x] : x.kind === 'fn' ? x.args.flatMap(leaves) : x.kind === 'join' ? x.parts.flatMap(pp => leaves(pp.expr)) : x.kind === 'tablecol' ? leaves(x.joinField) : [];
  const allFields = [...fieldsIn(q.filter).flatMap(leaves), ...Object.values(q.bindings).flat().flatMap(b => leaves(resolve(b.value, 'filter')))];
  if (!multi) {
    const ent = allFields.filter(f => isEntityField(f.name)), ev = allFields.filter(f => !isEntityField(f.name));
    if (ent.length && ev.length) invalid('ENTITY_MIX', { pos: 0, name: q.vars[0] ?? '$e' });
    q.entityQuery = ent.length > 0;
  } else {
    // Each top-level conjunct of a join reads exactly one event variable; the join itself is written with placeholders.
    const varsIn = n => [...new Set(fieldsIn(n).flatMap(leaves).map(f => f.evar).filter(Boolean))];
    const bare = fieldsIn(q.filter).flatMap(leaves).find(f => !f.evar); if (bare) invalid('BARE_FIELD_IN_JOIN', { pos: bare.pos ?? 0, name: bare.name });
    q.filters = Object.fromEntries(q.vars.map(v => [v, []]));
    const conjuncts = q.filter.type === 'and' ? q.filter.children : [q.filter];
    for (const c of conjuncts) {
      if (c.type === 'true') continue;
      const vs = varsIn(c); if (vs.length > 1) unsupported('MIXED_EVENT_VARS', { pos: 0, name: vs.join(', ') });
      if (vs.length === 1) q.filters[vs[0]].push(c);
    }
    for (const v of q.vars) q.filters[v] = q.filters[v].length ? { type: 'and', children: q.filters[v] } : { type: 'true' };
    q.joinKeys = shared.map(name => ({ name, parts: q.bindings[name].map(b => ({ evar: b.evar, expr: resolve(b.value, 'join') })) }));
  }

  let last = -1;
  while (peek()) {
    const t = ts[p++]; const name = String(t.value).toLowerCase(); const rank = SECTIONS.indexOf(name);
    if (t.kind !== 'word' || rank < 0) { if (['option', 'unselect'].includes(name)) unsupported('UNSUPPORTED_SECTION', { pos: t.pos, section: name }); invalid('UNEXPECTED_TOKEN', t.pos); }
    if (rule && ['dedup', 'order', 'limit'].includes(name)) invalid('RULE_NO_SECTION', { pos: t.pos, section: name });
    if (rank <= last) invalid('SECTION_ORDER', { pos: t.pos, section: name }); last = rank;
    need(':', 'EXPECTED_COLON');
    if (name === 'match') {
      if (kw(peek(), 'over') || kw(peek(), 'by')) invalid('OVER_NEEDS_KEY', peek().pos);
      const ops = [operand()]; while (peek()?.kind === ',') { p++; ops.push(operand()); }
      if (ops.length > LIMITS.matchKeys) invalid('TOO_MANY_KEYS', t.pos);
      let window = null, windowKind = 'bucket';
      if (take('over')) {
        if (!take('every')) {
          // `over N` without `every`: the join window (events for the same key within N of each other). On a single-event
          // query it is the rule-engine window, which the statistics page says Search does not support; a rule's match
          // section is written exactly this way (a sliding window), so rule mode accepts it.
          if (!multi && !rule) unsupported('OVER_WINDOW', t.pos);
          windowKind = 'over';
        } else if (rule) invalid('RULE_WINDOW_FORM', ts[p - 1].pos);
      } else if (take('by')) { if (rule) invalid('RULE_WINDOW_FORM', ts[p - 1].pos); }
      else if (rule) invalid('RULE_NEEDS_WINDOW', t.pos);
      if (peek()?.kind === 'duration') window = ts[p++].value;
      else if (peek()?.kind === 'word' && UNITS[peek().value.toLowerCase()]) window = UNITS[ts[p++].value.toLowerCase()];
      else if (windowKind === 'over') invalid('BAD_WINDOW', peek()?.pos ?? text.length);
      else if (last === 0 && peek() && !isSection() && peek().kind !== 'word') invalid('BAD_WINDOW', peek().pos);
      let keys = ops.map(k => resolve(k, 'match'));
      if (multi) {
        // A join written directly ($e1.a = $e2.b) has no placeholder to name, so either side names the key in match:.
        const asJoin = k => k.kind === 'join' ? k : q.joinKeys.map(jk => ({ kind: 'join', name: [...new Set(jk.parts.map(pp => exprName(pp.expr)))].sort().join(' = '), parts: jk.parts })).find(jk => jk.parts.some(pp => pp.evar === k.evar && exprName(pp.expr) === exprName(k))) ?? k;
        keys = keys.map(asJoin);
        for (const [i, k] of keys.entries()) if (k.kind !== 'join') invalid('MATCH_KEY_NOT_SHARED', { pos: ops[i].pos, name: exprName(k), shared });
      }
      if (multi && window && q.vars.some(v => q.varKinds[v] === 'entity')) invalid('ENTITY_WINDOW', { pos: t.pos });
      q.match = { keys, names: keys.map(exprName), window, windowKind: window ? windowKind : null };
      if (new Set(q.match.names).size !== q.match.names.length) invalid('DUPLICATE_KEY', t.pos);
    } else if (name === 'outcome') {
      do {
        const v = ts[p++]; if (!v || v.kind !== 'var') invalid('OUTCOME_NAME', v?.pos ?? text.length);
        if (q.bindings[v.value]) invalid('OUTCOME_SHADOWS_BINDING', v.pos);
        const eq = ts[p++]; if (!eq || eq.value !== '=') invalid('EXPECTED_OPERATOR', eq?.pos ?? text.length);
        const fn = ts[p++]; if (!fn || fn.kind !== 'word') invalid('EXPECTED_AGGREGATE', fn?.pos ?? text.length);
        const fname = fn.value.toLowerCase();
        if (!AGGREGATES.includes(fname)) unsupported('UNSUPPORTED_AGGREGATE', { pos: fn.pos, fn: fn.value });
        need('(', 'EXPECTED_PAREN'); const argOp = operand(); const arg = resolve(argOp, 'outcome'); need(')', 'EXPECTED_PAREN');
        const argName = exprName(arg);
        if (['sum', 'max', 'min'].includes(fname) && exprType(arg) !== 'number') invalid('AGGREGATE_NEEDS_NUMBER', { pos: fn.pos, fn: fname, field: argName });
        if (TIME_AGGREGATES.includes(fname) && (arg.kind !== 'field' || !TIMESTAMP_FIELDS.includes(arg.name))) invalid('TIME_AGGREGATE_NEEDS_TIMESTAMP', { pos: fn.pos, fn: fname, field: argName });
        if (q.outcomes.some(o => o.name === v.value)) invalid('DUPLICATE_OUTCOME', v.pos);
        // In a join every outcome aggregates one event variable's events: count($e1.metadata.id), not count(metadata.id).
        const evars = evarsOf(arg);
        if (multi && (evars.length !== 1 || arg.kind === 'join')) invalid('OUTCOME_NEEDS_VARIABLE', { pos: fn.pos, fn: fname, field: argName, vars: q.vars });
        q.outcomes.push({ name: v.value, fn: fname, field: arg, fieldName: argName, evar: multi ? evars[0] : null, array: ARRAY_AGGREGATES.includes(fname), time: TIME_AGGREGATES.includes(fname) });
        if (q.outcomes.length > LIMITS.outcomes) invalid('QUERY_TOO_LONG');
      } while (peek()?.kind === 'var' && peek(1)?.value === '=');
    } else if (name === 'condition') {
      if (!q.match) invalid('CONDITION_NEEDS_MATCH', t.pos);
      q.condition = expression('condition');
      // Bounded and unbounded (Google: conditions page): a non-existence test (#var = 0, not $var) needs at least one
      // bounded event and is not run here.
      const zeroTrue = (op, v) => ({ '=': 0 === v, '!=': 0 !== v, '<': 0 < v, '<=': 0 <= v, '>': 0 > v, '>=': 0 >= v })[op];
      const hasCount = n => n.count ? true : n.children ? n.children.some(hasCount) : n.child ? hasCount(n.child) : false;
      const check = n => {
        if (n.children) return n.children.forEach(check);
        if (n.child) { if (hasCount(n.child)) unsupported('NON_EXISTENCE', { pos: n.child.pos ?? 0 }); return check(n.child); }
        if (n.type !== 'cmp') invalid('CONDITION_SHAPE', n.pos);
        if (n.count) { if (zeroTrue(n.op, n.value.value)) unsupported('NON_EXISTENCE', { pos: n.pos, name: n.count }); return; }
        const o = n.field.kind === 'var' ? q.outcomes.find(x => x.name === n.field.name) : null;
        if (!o) invalid('CONDITION_UNKNOWN_OUTCOME', { pos: n.pos, name: n.field.name ?? exprName(n.field) });
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
        if (q.match || q.outcomes.length || multi) { if (!q.match || !q.match.names.includes(label)) invalid('DEDUP_KEY_NOT_GROUPED', { pos: o.pos, name: label }); return { name: label, column: label }; }
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
  if (multi && !q.match) invalid('MULTI_EVENT_NEEDS_MATCH', { vars: q.vars });
  if (!multi) {
    // The sections read the same source as the filter: an entity query aggregates entity fields, an event query event fields.
    const sectionFields = [...(q.match?.keys ?? []), ...q.outcomes.map(o => o.field), ...(q.dedup?.keys ?? []).map(k => k.expr).filter(Boolean)].flatMap(leaves);
    if (sectionFields.some(f => f.name !== 'metadata.id' && isEntityField(f.name) !== q.entityQuery)) invalid('ENTITY_MIX', { pos: 0, name: q.vars[0] ?? '$e' });
  }
  if (q.condition && !q.outcomes.length && !multi && !rule) invalid('CONDITION_NEEDS_MATCH');
  if (q.order.length && !q.outcomes.length) invalid('ORDER_UNKNOWN_OUTCOME', {});
  return q;
}
