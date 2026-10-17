import { LIMITS } from './catalog.js';

// Learner regex runs in the browser against bounded fictional strings. These checks keep a typo
// from becoming a hang: RE2 (which Google uses) never backtracks; JavaScript's engine can.
export function guardRegex(pattern) {
  if (typeof pattern !== 'string' || pattern.length === 0) return 'REGEX_EMPTY';
  if (pattern.length > LIMITS.regexLength) return 'REGEX_TOO_LONG';
  if (/\\[1-9]/.test(pattern)) return 'REGEX_BACKREFERENCE';
  if (/\(\?(?!:|i\))/.test(pattern)) return 'REGEX_LOOKAROUND';
  if (/[+*}]\s*[+*]|\)[+*{]\s*[+*]|(\([^()]*[+*][^()]*\))[+*{]/.test(pattern)) return 'REGEX_NESTED_QUANTIFIER';
  const bounded = pattern.match(/\{(\d+)(,(\d*))?\}/g) ?? [];
  for (const b of bounded) { const n = b.replace(/[{}]/g, '').split(',').map(Number).filter(x => !Number.isNaN(x)); if (Math.max(0, ...n) > 64) return 'REGEX_RANGE_TOO_LARGE'; }
  try { new RegExp(pattern); } catch { return 'REGEX_INVALID'; }
  return null;
}

export function compileRegex(pattern, nocase) {
  const problem = guardRegex(pattern);
  if (problem) throw Object.assign(new Error(problem), { code: problem, status: 'invalid' });
  // (?i) is RE2 syntax for case-insensitive; JavaScript needs the flag instead.
  const body = pattern.startsWith('(?i)') ? pattern.slice(4) : pattern;
  return new RegExp(body, nocase || pattern.startsWith('(?i)') ? 'i' : '');
}

export function testRegex(re, subject) {
  const s = String(subject ?? '');
  return re.test(s.length > LIMITS.regexSubject ? s.slice(0, LIMITS.regexSubject) : s);
}

export function parseCidr(text) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(text ?? '');
  if (!m) return null;
  const octets = m.slice(1, 5).map(Number); const bits = Number(m[5]);
  if (octets.some(o => o > 255) || bits > 32) return null;
  const base = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { base: (base & mask) >>> 0, mask };
}

export function ipInCidr(ip, cidr) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip ?? '');
  if (!m) return false;
  const o = m.slice(1).map(Number); if (o.some(x => x > 255)) return false;
  const n = ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
  return ((n & cidr.mask) >>> 0) === cidr.base;
}
