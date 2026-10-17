import { FIELDS, AGGREGATES, LIMITS } from './catalog.js';
import { guardRegex, parseCidr } from './safety.js';

// Parses the YARA-L 2.0 *Search* subset this course teaches into a small AST.
// status: 'invalid' = broken syntax; 'unsupported' = may be valid Google syntax the trainer does not run.
export class QueryError extends Error {
  constructor(code, status = 'invalid', detail = null) { super(code); this.code = code; this.status = status; this.detail = detail; }
}
const invalid = (code, detail) => { throw new QueryError(code, 'invalid', detail); };
const unsupported = (code, detail) => { throw new QueryError(code, 'unsupported', detail); };

const KEYWORDS = new Set(['and', 'or', 'not', 'nocase', 'events', 'match', 'outcome', 'condition', 'order', 'limit', 'by', 'over', 'every', 'asc', 'desc', 'any', 'all']);
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

export function lex(text) {
  if (typeof text !== 'string') invalid('EMPTY_QUERY');
  if (new TextEncoder().encode(text).length > LIMITS.bytes) invalid('QUERY_TOO_LONG');
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

export function parseSearch(text) {
  const ts = lex(text); let p = 0, atoms = 0;
  const q = { filter: null, bindings: {}, eventVar: null, match: null, outcomes: [], condition: null, order: [], limit: null };
  const peek = (k = 0) => ts[p + k];
  const kw = (t, w) => t && t.kind === 'word' && t.value.toLowerCase() === w;
  const take = w => { if (kw(peek(), w)) { p++; return true; } return false; };
  const need = (kind, code) => { const t = ts[p]; if (!t || t.kind !== kind) invalid(code, t?.pos ?? text.length); p++; return t; };
  const isSection = (k = 0) => peek(k)?.kind === 'word' && peek(k + 1)?.kind === ':' && ['match', 'outcome', 'condition', 'order', 'limit', 'dedup', 'events', 'option', 'meta', 'rule', 'unselect'].includes(peek(k).value.toLowerCase());

  // Accept Google's $e.field form: one event variable, stripped to the bare field.
  const fieldName = t => {
    let v = t.value;
    if (t.kind === 'var') {
      const m = /^(\$[A-Za-z_][A-Za-z0-9_]*)\.(.+)$/.exec(v);
      if (!m) return null;
      if (q.eventVar && q.eventVar !== m[1]) unsupported('MULTI_EVENT', t.pos);
      q.eventVar = m[1]; v = m[2];
    }
    if (!Object.hasOwn(FIELDS, v)) invalid('UNKNOWN_FIELD', { pos: t.pos, field: v });
    return v;
  };
  const operand = () => {
    const t = ts[p++];
    if (!t || !['var', 'word'].includes(t.kind)) invalid('EXPECTED_FIELD', t?.pos ?? text.length);
    if (t.kind === 'word' && KEYWORDS.has(t.value.toLowerCase())) invalid('EXPECTED_FIELD', t.pos);
    if (t.kind === 'var' && !t.value.includes('.')) return { kind: 'var', name: t.value, pos: t.pos };
    if (t.kind === 'word' && Object.hasOwn(GROUPED, t.value)) return { kind: 'group', name: t.value, pos: t.pos };
    return { kind: 'field', name: fieldName(t), pos: t.pos };
  };
  const literal = () => {
    const t = ts[p++];
    if (!t) invalid('EXPECTED_VALUE', text.length);
    if (t.kind === 'word' && /^[A-Z_]+$/.test(t.value)) invalid('UNQUOTED_ENUM', { pos: t.pos, word: t.value });
    if (!['string', 'number', 'regex'].includes(t.kind)) invalid('EXPECTED_VALUE', t.pos);
    return t;
  };
  const atom = () => { if (++atoms > LIMITS.atoms) invalid('QUERY_TOO_LONG'); };

  const expression = (ctx, depth = 0) => {
    if (depth > LIMITS.depth) invalid('QUERY_TOO_LONG');
    const unary = () => {
      if (take('not')) return { type: 'not', child: unary() };
      if (peek()?.kind === '(') { p++; const e = orExpr(); need(')', 'EXPECTED_PAREN'); return e; }
      take('any'); take('all');
      const t = peek();
      if (ctx === 'filter' && kw(t, 're.regex')) {
        p++; need('(', 'EXPECTED_PAREN'); const f = operand(); need(',', 'EXPECTED_COMMA'); const v = literal(); need(')', 'EXPECTED_PAREN');
        if (!['string', 'regex'].includes(v.kind)) invalid('EXPECTED_VALUE', v.pos);
        const nocase = take('nocase'); atom();
        return { type: 'cmp', field: f, op: 'regex', value: { kind: 'regex', value: v.value }, nocase, pos: t.pos };
      }
      if (ctx === 'filter' && kw(t, 'net.ip_in_range_cidr')) {
        p++; need('(', 'EXPECTED_PAREN'); const f = operand(); need(',', 'EXPECTED_COMMA'); const v = literal(); need(')', 'EXPECTED_PAREN');
        if (v.kind !== 'string' || !parseCidr(v.value)) invalid('BAD_CIDR', v.pos);
        atom(); return { type: 'cmp', field: f, op: 'cidr', value: { kind: 'string', value: v.value }, nocase: false, pos: t.pos };
      }
      if (t?.kind === 'word' && /^[a-z_]+\.[a-z_]+$/.test(t.value) && !Object.hasOwn(FIELDS, t.value) && t.value.includes('.') && /^(strings|math|timestamp|arrays|re|net)\./.test(t.value)) unsupported('UNSUPPORTED_FUNCTION', { pos: t.pos, fn: t.value });
      const left = operand();
      const opTok = ts[p++];
      if (!opTok || opTok.kind !== 'op') invalid('EXPECTED_OPERATOR', opTok?.pos ?? text.length);
      const next = peek();
      const nameLike = next && (next.kind === 'var' || (next.kind === 'word' && (Object.hasOwn(FIELDS, next.value) || Object.hasOwn(GROUPED, next.value))));
      if (ctx === 'filter' && nameLike) {
        // placeholder binding: $x = field  or  field = $x
        if (opTok.value !== '=') invalid('BINDING_OPERATOR', opTok.pos);
        const right = operand();
        const [v, f] = left.kind === 'var' ? [left, right] : [right, left];
        if (v.kind !== 'var' || f.kind !== 'field') invalid('BINDING_SHAPE', opTok.pos);
        return { type: 'binding', name: v.name, field: f.name, pos: opTok.pos };
      }
      const v = literal();
      const nocase = ctx === 'filter' && take('nocase');
      if (v.kind === 'regex') {
        if (opTok.value !== '=' && opTok.value !== '!=') invalid('REGEX_OPERATOR', opTok.pos);
        const bad = guardRegex(v.value); if (bad) invalid(bad, v.pos);
        atom(); return { type: 'cmp', field: left, op: opTok.value === '=' ? 'regex' : 'not_regex', value: { kind: 'regex', value: v.value }, nocase, pos: opTok.pos };
      }
      atom(); return { type: 'cmp', field: left, op: opTok.value, value: { kind: v.kind, value: v.value }, nocase, pos: opTok.pos };
    };
    const startsAtom = () => { const t = peek(); if (!t || isSection()) return false; if (t.kind === '(' || t.kind === 'var') return true; return t.kind === 'word' && !['or', 'by', 'over', 'asc', 'desc', 'nocase'].includes(t.value.toLowerCase()); };
    const andExpr = () => {
      const kids = [unary()];
      while (true) {
        if (take('and')) kids.push(unary());
        else if (ctx === 'filter' && startsAtom()) kids.push(unary()); // implicit AND between lines
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
      q.bindings[n.name] = n.field; return { type: 'true' };
    }
    if (n.type === 'and') return { ...n, children: n.children.map(c => lift(c, top)) };
    if (n.type === 'or') return { ...n, children: n.children.map(c => lift(c, false)) };
    if (n.type === 'not') return { ...n, child: lift(n.child, false) };
    return n;
  };
  q.filter = lift(q.filter, true);
  const resolve = (o, where) => {
    if (o.kind === 'field') return o.name;
    if (o.kind === 'group') invalid('GROUPED_FIELD_HERE', { pos: o.pos, name: o.name, where });
    if (!q.bindings[o.name]) invalid('UNBOUND_VARIABLE', { pos: o.pos, name: o.name, where });
    return q.bindings[o.name];
  };
  // A grouped field is an OR across its member fields (Google: "Search grouped fields").
  const expandGroups = n => {
    if (n.children) return { ...n, children: n.children.map(expandGroups) };
    if (n.child) return { ...n, child: expandGroups(n.child) };
    if (n.type === 'cmp' && n.field.kind === 'group') {
      const members = GROUPED[n.field.name].map(f => ({ ...n, field: { kind: 'field', name: f, pos: n.field.pos }, grouped: n.field.name }));
      return n.op === '!=' || n.op === 'not_regex' ? { type: 'and', children: members } : { type: 'or', children: members };
    }
    return n;
  };
  q.filter = expandGroups(q.filter);
  const typeCheck = n => {
    if (n.children) return n.children.forEach(typeCheck);
    if (n.child) return typeCheck(n.child);
    if (n.type !== 'cmp') return;
    n.field = resolve(n.field, 'filter'); const ft = FIELDS[n.field];
    if (n.op === 'cidr') { if (ft !== 'ip') invalid('CIDR_NEEDS_IP', { pos: n.pos, field: n.field }); return; }
    if (n.op === 'regex' || n.op === 'not_regex') { if (ft === 'number') invalid('REGEX_ON_NUMBER', { pos: n.pos, field: n.field }); return; }
    if (ft === 'number') { if (n.value.kind !== 'number') invalid('NUMBER_NEEDS_NUMBER', { pos: n.pos, field: n.field }); if (n.nocase) invalid('NOCASE_ON_NUMBER', n.pos); return; }
    if (n.value.kind !== 'string') invalid('STRING_NEEDS_QUOTES', { pos: n.pos, field: n.field });
    if (!['=', '!='].includes(n.op)) invalid('STRING_OPERATOR', { pos: n.pos, field: n.field });
  };
  typeCheck(q.filter);

  const ORDER = ['match', 'outcome', 'condition', 'order', 'limit']; let last = -1;
  while (peek()) {
    const t = ts[p++]; const name = String(t.value).toLowerCase(); const rank = ORDER.indexOf(name);
    if (t.kind !== 'word' || rank < 0) { if (['dedup', 'option', 'unselect'].includes(name)) unsupported('UNSUPPORTED_SECTION', { pos: t.pos, section: name }); invalid('UNEXPECTED_TOKEN', t.pos); }
    if (rank <= last) invalid('SECTION_ORDER', { pos: t.pos, section: name }); last = rank;
    need(':', 'EXPECTED_COLON');
    if (name === 'match') {
      const keys = [operand()]; while (peek()?.kind === ',') { p++; keys.push(operand()); }
      if (keys.length > LIMITS.matchKeys) invalid('TOO_MANY_KEYS', t.pos);
      let window = null;
      if (take('over')) { if (!take('every')) unsupported('OVER_WINDOW', t.pos); }
      else take('by');
      if (peek()?.kind === 'duration') window = ts[p++].value;
      else if (peek()?.kind === 'word' && UNITS[peek().value.toLowerCase()]) window = UNITS[ts[p++].value.toLowerCase()];
      else if (last === 0 && peek() && !isSection() && peek().kind !== 'word') invalid('BAD_WINDOW', peek().pos);
      q.match = { keys: keys.map(k => resolve(k, 'match')), window };
      if (new Set(q.match.keys).size !== q.match.keys.length) invalid('DUPLICATE_KEY', t.pos);
    } else if (name === 'outcome') {
      do {
        const v = ts[p++]; if (!v || v.kind !== 'var') invalid('OUTCOME_NAME', v?.pos ?? text.length);
        if (q.bindings[v.value]) invalid('OUTCOME_SHADOWS_BINDING', v.pos);
        const eq = ts[p++]; if (!eq || eq.value !== '=') invalid('EXPECTED_OPERATOR', eq?.pos ?? text.length);
        const fn = ts[p++]; if (!fn || fn.kind !== 'word') invalid('EXPECTED_AGGREGATE', fn?.pos ?? text.length);
        const fname = fn.value.toLowerCase();
        if (!AGGREGATES.includes(fname)) unsupported('UNSUPPORTED_AGGREGATE', { pos: fn.pos, fn: fn.value });
        need('(', 'EXPECTED_PAREN'); const arg = resolve(operand(), 'outcome'); need(')', 'EXPECTED_PAREN');
        if (['sum', 'max', 'min'].includes(fname) && FIELDS[arg] !== 'number') invalid('AGGREGATE_NEEDS_NUMBER', { pos: fn.pos, fn: fname, field: arg });
        if (q.outcomes.some(o => o.name === v.value)) invalid('DUPLICATE_OUTCOME', v.pos);
        q.outcomes.push({ name: v.value, fn: fname, field: arg });
        if (q.outcomes.length > LIMITS.outcomes) invalid('QUERY_TOO_LONG');
      } while (peek()?.kind === 'var' && peek(1)?.value === '=');
    } else if (name === 'condition') {
      if (!q.match) invalid('CONDITION_NEEDS_MATCH', t.pos);
      q.condition = expression('condition');
      const check = n => {
        if (n.children) return n.children.forEach(check);
        if (n.child) return check(n.child);
        if (n.type !== 'cmp') invalid('CONDITION_SHAPE', n.pos);
        if (n.field.kind !== 'var' || !q.outcomes.some(o => o.name === n.field.name)) invalid('CONDITION_UNKNOWN_OUTCOME', { pos: n.pos, name: n.field.name });
        if (n.value.kind !== 'number') invalid('CONDITION_NEEDS_NUMBER', n.pos);
        n.field = n.field.name;
      };
      check(q.condition);
    } else if (name === 'order') {
      do {
        const v = ts[p++]; if (!v || v.kind !== 'var' || !q.outcomes.some(o => o.name === v.value)) invalid('ORDER_UNKNOWN_OUTCOME', { pos: v?.pos ?? text.length, name: v?.value });
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
