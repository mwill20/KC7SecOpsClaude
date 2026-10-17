import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSearch, QueryError } from '../../site/engine/parser.js';
import { execute } from '../../site/engine/executor.js';
import { runQuery, compareResults } from '../../site/engine/grader.js';
import { guardRegex } from '../../site/engine/safety.js';

const mini = [
  { 'metadata.id': 'e1', 'metadata.event_timestamp.seconds': 1000, 'metadata.event_type': 'USER_LOGIN', 'principal.user.userid': 'ana', 'security_result.action': 'ALLOW', 'principal.hostname': 'PC-1', 'principal.ip': '10.0.0.1', 'target.port': 0 },
  { 'metadata.id': 'e2', 'metadata.event_timestamp.seconds': 1100, 'metadata.event_type': 'USER_LOGIN', 'principal.user.userid': 'ana', 'security_result.action': 'FAIL', 'principal.hostname': 'PC-1', 'principal.ip': '10.0.0.1' },
  { 'metadata.id': 'e3', 'metadata.event_timestamp.seconds': 1400, 'metadata.event_type': 'USER_LOGIN', 'principal.user.userid': 'bo', 'security_result.action': 'FAIL', 'principal.hostname': 'PC-2', 'principal.ip': '10.0.0.2' },
  { 'metadata.id': 'e4', 'metadata.event_timestamp.seconds': 1500, 'metadata.event_type': 'USER_LOGIN', 'principal.user.userid': '', 'security_result.action': 'FAIL', 'principal.hostname': '', 'principal.ip': '203.0.113.9' },
  { 'metadata.id': 'e5', 'metadata.event_timestamp.seconds': 1600, 'metadata.event_type': 'PROCESS_LAUNCH', 'principal.user.userid': 'bo', 'principal.hostname': 'PC-2', 'target.process.file.full_path': 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\PowerShell.exe', 'target.process.command_line': 'powershell -enc AAAA' },
  { 'metadata.id': 'e6', 'metadata.event_timestamp.seconds': 1700, 'metadata.event_type': 'NETWORK_CONNECTION', 'principal.hostname': 'PC-2', 'principal.ip': '10.0.0.2', 'target.ip': '203.0.113.44', 'target.port': 443, 'network.sent_bytes': 5000 },
  { 'metadata.id': 'e7', 'metadata.event_timestamp.seconds': 1800, 'metadata.event_type': 'NETWORK_CONNECTION', 'principal.hostname': 'PC-1', 'principal.ip': '10.0.0.1', 'target.ip': '192.0.2.8', 'target.port': 443, 'network.sent_bytes': 100 },
];
const ids = r => r.rows.map(e => e['metadata.id']);
const run = t => execute(parseSearch(t), mini);
const fails = (t, code, status) => { try { parseSearch(t); } catch (e) { assert.ok(e instanceof QueryError, 'QueryError'); assert.equal(e.code, code); if (status) assert.equal(e.status, status); return; } assert.fail('expected ' + code); };

test('G1 implicit AND, explicit AND and events: prefix all select the same rows', () => {
  const a = run('metadata.event_type = "USER_LOGIN"\nsecurity_result.action = "FAIL"');
  const b = run('metadata.event_type = "USER_LOGIN" AND security_result.action = "FAIL"');
  const c = run('events:\n  $e.metadata.event_type = "USER_LOGIN"\n  $e.security_result.action = "FAIL"');
  assert.deepEqual(ids(a), ['e2', 'e3', 'e4']); assert.deepEqual(ids(b), ids(a)); assert.deepEqual(ids(c), ids(a));
});

test('G1 OR needs parentheses to bind as the learner means', () => {
  assert.deepEqual(ids(run('metadata.event_type = "USER_LOGIN" AND (principal.user.userid = "bo" OR principal.user.userid = "ana")')), ['e1', 'e2', 'e3']);
  assert.deepEqual(ids(run('metadata.event_type = "PROCESS_LAUNCH" OR principal.user.userid = "ana" AND security_result.action = "FAIL"')), ['e2', 'e5']);
});

test('G2 nocase, regex literal, re.regex and grouped field', () => {
  assert.deepEqual(ids(run('target.process.file.full_path = /\\\\powershell\\.exe$/ nocase')), ['e5']);
  assert.deepEqual(ids(run('target.process.file.full_path = /\\\\powershell\\.exe$/')), []);
  assert.deepEqual(ids(run('re.regex(target.process.command_line, "-enc")')), ['e5']);
  assert.deepEqual(ids(run('ip = "10.0.0.2"')), ['e3', 'e6']);
  assert.deepEqual(ids(run('hostname = "PC-2" AND metadata.event_type = "NETWORK_CONNECTION"')), ['e6']);
});

test('G2 CIDR function and numeric comparisons type-check', () => {
  assert.deepEqual(ids(run('net.ip_in_range_cidr(target.ip, "203.0.113.0/24")')), ['e6']);
  assert.deepEqual(ids(run('network.sent_bytes > 1000')), ['e6']);
  fails('target.port = "443"', 'NUMBER_NEEDS_NUMBER');
  fails('principal.hostname = PC-1', 'EXPECTED_VALUE');
  fails('metadata.event_type = USER_LOGIN', 'UNQUOTED_ENUM');
  fails('principal.ip = 10.0.0.1', 'UNQUOTED_IP');
  fails('net.ip_in_range_cidr(principal.hostname, "10.0.0.0/8")', 'CIDR_NEEDS_IP');
});

test('G3 count_distinct counts the empty string as a value until it is filtered (Google note)', () => {
  const noFilter = run('metadata.event_type = "USER_LOGIN"\noutcome:\n  $n = count_distinct(principal.user.userid)');
  const filtered = run('metadata.event_type = "USER_LOGIN"\nprincipal.user.userid != ""\noutcome:\n  $n = count_distinct(principal.user.userid)');
  assert.equal(noFilter.rows[0].$n, 3); assert.equal(filtered.rows[0].$n, 2);
});

test('G3 match with placeholder, window bucket, condition, order and limit', () => {
  const r = run('metadata.event_type = "USER_LOGIN"\n$u = principal.user.userid\nmatch:\n  $u by 5m\noutcome:\n  $c = count(metadata.id)\norder:\n  $c desc\nlimit:\n  2');
  assert.deepEqual(r.columns, ['principal.user.userid', 'window_start', '$c']);
  assert.deepEqual(r.rows.map(x => [x['principal.user.userid'], x.window_start, x.$c]), [['ana', 900, 2], ['', 1500, 1]]);
  const c = run('metadata.event_type = "USER_LOGIN"\nmatch:\n  principal.user.userid\noutcome:\n  $c = count(metadata.id)\ncondition:\n  $c > 1');
  assert.deepEqual(c.rows, [{ 'principal.user.userid': 'ana', $c: 2 }]);
  const over = run('metadata.event_type = "USER_LOGIN"\nmatch:\n  principal.hostname over every 10m\noutcome:\n  $c = count(metadata.id)');
  assert.equal(over.rows.length, 3);
});

test('G3 structural mistakes are named', () => {
  fails('metadata.event_type = "USER_LOGIN"\noutcome:\n  $c = count(metadata.id)\ncondition:\n  $c > 1', 'CONDITION_NEEDS_MATCH');
  fails('metadata.event_type = "USER_LOGIN"\nmatch:\n  $u\noutcome:\n  $c = count(metadata.id)', 'UNBOUND_VARIABLE');
  fails('metadata.event_type = "USER_LOGIN"\norder:\n  $c desc', 'ORDER_UNKNOWN_OUTCOME');
  fails('metadata.event_type = "USER_LOGIN"\nmatch:\n  principal.hostname over 1h\noutcome:\n  $c = count(metadata.id)', 'OVER_WINDOW', 'unsupported');
  fails('metadata.event_type = "USER_LOGIN"\noutcome:\n  $a = array_distinct(principal.hostname)', 'UNSUPPORTED_AGGREGATE', 'unsupported');
  fails('metadata.event_type = "USER_LOGIN"\noutcome:\n  $s = sum(principal.hostname)', 'AGGREGATE_NEEDS_NUMBER');
});

test('G4 other languages and rule syntax are reported as unsupported, not as wrong answers', () => {
  fails('SecurityEvent | where EventID == 4625', 'LOOKS_LIKE_KQL', 'unsupported');
  fails('rule failed_logins { meta: }', 'LOOKS_LIKE_RULE', 'unsupported');
  fails('SELECT * FROM events', 'LOOKS_LIKE_SQL', 'unsupported');
  fails('$e1.principal.hostname = "a" $e2.principal.hostname = "b"', 'MULTI_EVENT', 'unsupported');
  fails('principal.hostname = "x"\ndedup:\n  principal.hostname', 'UNSUPPORTED_SECTION', 'unsupported');
});

test('G4 broken syntax is reported as invalid with a position', () => {
  fails('metadata.event_type = "USER_LOGIN', 'UNCLOSED_STRING');
  fails('principal.hostname = /abc', 'UNCLOSED_REGEX');
  fails('principal.hostnme = "x"', 'UNKNOWN_FIELD');
  fails('', 'EMPTY_QUERY');
  fails('match:\n  principal.hostname', 'MISSING_FILTER');
  fails('/* open comment', 'UNCLOSED_COMMENT');
  const q = parseSearch('/* note */ metadata.event_type = "USER_LOGIN" // trailing');
  assert.equal(q.filter.type, 'cmp');
});

test('G5 regex guard rejects catastrophic and non-RE2 patterns, allows ordinary ones', () => {
  assert.equal(guardRegex('(a+)+$'), 'REGEX_NESTED_QUANTIFIER');
  assert.equal(guardRegex('(?=abc)'), 'REGEX_LOOKAROUND');
  assert.equal(guardRegex('(a)\\1'), 'REGEX_BACKREFERENCE');
  assert.equal(guardRegex('a{9999}'), 'REGEX_RANGE_TOO_LARGE');
  assert.equal(guardRegex('x'.repeat(81)), 'REGEX_TOO_LONG');
  assert.equal(guardRegex('\\\\(powershell|pwsh)\\.exe$'), null);
  assert.equal(guardRegex('^10\\.9\\.4\\.\\d+$'), null);
  fails('target.process.command_line = /(a+)+$/', 'REGEX_NESTED_QUANTIFIER');
});

test('G6 grading compares evidence, so differently written correct queries pass and wrong ones fail', () => {
  const ref = runQuery('metadata.event_type = "USER_LOGIN"\nsecurity_result.action = "FAIL"', mini).result;
  assert.equal(compareResults(runQuery('security_result.action = "FAIL" AND metadata.event_type = "USER_LOGIN"', mini).result, ref).correct, true);
  assert.equal(compareResults(runQuery('metadata.event_type = "USER_LOGIN" AND NOT security_result.action = "ALLOW"', mini).result, ref).correct, true);
  const wrong = compareResults(runQuery('metadata.event_type = "USER_LOGIN"', mini).result, ref);
  assert.equal(wrong.correct, false); assert.equal(wrong.reason, 'DIFFERENT_EVENTS'); assert.equal(wrong.extra, 1);
  const refStats = runQuery('metadata.event_type = "USER_LOGIN"\nmatch:\n  principal.user.userid\noutcome:\n  $c = count(metadata.id)', mini).result;
  assert.equal(compareResults(runQuery('metadata.event_type = "USER_LOGIN"\n$u = principal.user.userid\nmatch:\n  $u\noutcome:\n  $total = count(metadata.id)', mini).result, refStats).correct, true);
  assert.equal(compareResults(runQuery('metadata.event_type = "USER_LOGIN"\nmatch:\n  principal.hostname\noutcome:\n  $c = count(metadata.id)', mini).result, refStats).reason, 'DIFFERENT_GROUPING');
  assert.equal(compareResults(runQuery('metadata.event_type = "USER_LOGIN"', mini).result, refStats).reason, 'EXPECTED_STATS');
  const ordered = runQuery('metadata.event_type = "USER_LOGIN"\nmatch:\n  principal.user.userid\noutcome:\n  $c = count(metadata.id)\norder:\n  $c desc', mini).result;
  assert.equal(compareResults(runQuery('metadata.event_type = "USER_LOGIN"\nmatch:\n  principal.user.userid\noutcome:\n  $c = count(metadata.id)\norder:\n  $c asc', mini).result, ordered).reason, 'DIFFERENT_ORDER');
});

test('G7 time range changes results; the query stays the same', () => {
  const q = parseSearch('metadata.event_type = "USER_LOGIN"');
  assert.equal(execute(q, mini).count, 4);
  assert.equal(execute(q, mini, { start: 1200, end: 2000 }).count, 2);
  assert.equal(execute(q, mini, { start: 5000, end: 6000 }).count, 0);
});

test('G8 bounded input: oversize query is refused before parsing', () => {
  fails('principal.hostname = "' + 'a'.repeat(9000) + '"', 'QUERY_TOO_LONG');
});

test('G9 an unfilled starter gap is named as such, before any other diagnostic', () => {
  fails('metadata.event_type = "USER_LOGIN"\nsecurity_result.action = "___"', 'STARTER_GAP', 'invalid');
  fails('metadata.event_type = "USER_LOGIN"\noutcome:\n  $n = ___(principal.user.userid)', 'STARTER_GAP', 'invalid');
  fails('metadata.event_type = "USER_LOGIN"\nmatch:\n  ___\noutcome:\n  $n = count(metadata.id)', 'STARTER_GAP', 'invalid');
  // should-fail: without the gap the same shapes get their ordinary diagnostics, and a lone underscore is not a gap
  fails('metadata.event_type = "USER_LOGIN"\noutcome:\n  $n = array_distinct(principal.user.userid)', 'UNSUPPORTED_AGGREGATE', 'unsupported');
  assert.equal(run('principal.user.userid = "a_b"').count, 0);
});

test('G10 comparison failures carry up to three example record IDs from the dataset side, never from the learner', () => {
  const ref = runQuery('metadata.event_type = "USER_LOGIN"\nsecurity_result.action = "FAIL"', mini).result;
  const narrow = compareResults(runQuery('metadata.event_type = "USER_LOGIN"\nsecurity_result.action = "FAIL"\nprincipal.user.userid = "ana"', mini).result, ref);
  assert.deepEqual(narrow.missingIds, ['e3', 'e4']); assert.deepEqual(narrow.extraIds, []);
  const wide = compareResults(runQuery('metadata.id != "ZZZ-NOT-A-RECORD"', mini).result, ref);
  assert.equal(wide.extraIds.length, 3, 'capped at three');            // e1, e5, e6, e7 are extra; only three are shown
  assert.deepEqual(wide.extraIds, ['e1', 'e5', 'e6']);                 // time order, so the learner can find them
  assert.ok(!JSON.stringify(wide).includes('ZZZ'), 'learner text is never echoed');
  for (const id of [...wide.extraIds, ...narrow.missingIds]) assert.ok(mini.some(e => e['metadata.id'] === id), id + ' is a real record');
  // should-fail: a correct query carries no examples at all
  const same = compareResults(runQuery('security_result.action = "FAIL" AND metadata.event_type = "USER_LOGIN"', mini).result, ref);
  assert.equal(same.correct, true); assert.equal(same.missingIds, undefined);
});

test('G10 stats comparison separates missing rows, extra rows and same-key rows whose numbers differ', () => {
  const ref = runQuery('metadata.event_type = "USER_LOGIN"\nsecurity_result.action = "FAIL"\nmatch:\n  principal.user.userid\noutcome:\n  $c = count(metadata.id)', mini).result;
  const changed = compareResults(runQuery('metadata.event_type = "USER_LOGIN"\nmatch:\n  principal.user.userid\noutcome:\n  $c = count(metadata.id)', mini).result, ref);
  assert.equal(changed.reason, 'DIFFERENT_STATS');
  assert.equal(changed.changed, 1); assert.equal(changed.missing, 0); assert.equal(changed.extra, 0);   // ana: 2 logins vs 1 failure
  assert.deepEqual(changed.changedIds, ['e2']);                                                           // the reference side of the changed row
  const narrow = compareResults(runQuery('metadata.event_type = "USER_LOGIN"\nsecurity_result.action = "FAIL"\nprincipal.user.userid != ""\nmatch:\n  principal.user.userid\noutcome:\n  $c = count(metadata.id)', mini).result, ref);
  assert.equal(narrow.missing, 1); assert.deepEqual(narrow.missingIds, ['e4']); assert.equal(narrow.changed, 0);
  const wide = compareResults(runQuery('metadata.event_type = "USER_LOGIN"\nsecurity_result.action = "FAIL"\nmatch:\n  principal.user.userid, principal.hostname\noutcome:\n  $c = count(metadata.id)', mini).result, ref);
  assert.equal(wide.reason, 'DIFFERENT_GROUPING');                                                       // grouping mismatch is still named first
  // should-fail: the members behind a row are not a column and do not reach the table or JSON
  assert.deepEqual(Object.keys(ref.rows[0]), ['principal.user.userid', '$c']);
  assert.ok(!JSON.stringify(ref.rows).includes('e2'));
});
