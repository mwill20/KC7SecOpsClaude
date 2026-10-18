import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSearch, QueryError } from '../../site/engine/parser.js';
import { execute, MEMBERS as MEMBERS_SYM } from '../../site/engine/executor.js';
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
  fails('metadata.event_type = "USER_LOGIN"\noutcome:\n  $a = stddev(network.sent_bytes)', 'UNSUPPORTED_AGGREGATE', 'unsupported');
  fails('metadata.event_type = "USER_LOGIN"\noutcome:\n  $s = sum(principal.hostname)', 'AGGREGATE_NEEDS_NUMBER');
});

test('G4 other languages and rule syntax are reported as unsupported, not as wrong answers', () => {
  fails('SecurityEvent | where EventID == 4625', 'LOOKS_LIKE_KQL', 'unsupported');
  fails('rule failed_logins { meta: }', 'LOOKS_LIKE_RULE', 'unsupported');
  fails('SELECT * FROM events', 'LOOKS_LIKE_SQL', 'unsupported');
  fails('$e1.principal.hostname = "a" $e2.principal.hostname = "b"', 'UNJOINED_VARIABLE', 'invalid');
  fails('$e1.principal.hostname = $h $e2.principal.hostname = $h $e3.principal.hostname = $h\nmatch:\n  $h', 'TOO_MANY_EVENT_VARS', 'unsupported');
  fails('principal.hostname = "x"\noption:\n  allow_zero_values = true', 'UNSUPPORTED_SECTION', 'unsupported');
  fails('principal.hostname = "x"\n$h = math.abs(target.port)', 'UNSUPPORTED_FUNCTION', 'unsupported');
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
  fails('metadata.event_type = "USER_LOGIN"\noutcome:\n  $n = median(network.sent_bytes)', 'UNSUPPORTED_AGGREGATE', 'unsupported');
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

// ---------- engine v2: dedup, array outcomes, earliest/latest, functions, reference lists ----------
const LISTS = [
  { name: 'known_ips', type: 'string', items: ['10.0.0.1', '10.0.0.2'] },
  { name: 'ext_ranges', type: 'cidr', items: ['203.0.113.0/24'] },
  { name: 'ps_shapes', type: 'regex', items: ['powershell\\.exe$', '(a+)+$'] },
  { name: 'hosts', type: 'string', items: ['pc-1'] },
];
const ctx = { lists: LISTS };
const runL = t => execute(parseSearch(t, ctx), mini);
const failsL = (t, code, status) => { try { parseSearch(t, ctx); } catch (e) { assert.ok(e instanceof QueryError, 'QueryError'); assert.equal(e.code, code); if (status) assert.equal(e.status, status); return; } assert.fail('expected ' + code); };

test('V1 dedup on an event query keeps the first event per key, on a statistics query the first row per key after ordering; should-fail cases are named', () => {
  assert.deepEqual(ids(runL('metadata.event_type = "USER_LOGIN"\ndedup:\n  principal.user.userid')), ['e1', 'e3', 'e4']);
  assert.deepEqual(ids(runL('metadata.event_type = "USER_LOGIN"\n$u = principal.user.userid\ndedup:\n  $u, security_result.action')), ['e1', 'e2', 'e3', 'e4']);
  const r = runL('metadata.event_type = "USER_LOGIN"\nmatch:\n  principal.user.userid, security_result.action\noutcome:\n  $c = count(metadata.id)\ndedup:\n  principal.user.userid\norder:\n  $c desc');
  assert.equal(r.deduped, true); assert.deepEqual(r.rows.map(x => [x['principal.user.userid'], x.$c]), [['', 1], ['ana', 1], ['bo', 1]]);
  assert.equal(runL('metadata.event_type = "USER_LOGIN"\nmatch:\n  principal.user.userid\noutcome:\n  $c = count(metadata.id)\ndedup:\n  $c').rows.length, 2, 'dedup by an outcome value');
  // the deduped event table grades against a reference by record ids like any other
  const ref = runQuery('metadata.event_type = "USER_LOGIN"\ndedup:\n  principal.user.userid', mini, null, ctx).result;
  assert.equal(compareResults(runQuery('metadata.event_type = "USER_LOGIN"\n$who = principal.user.userid\ndedup:\n  $who', mini, null, ctx).result, ref).correct, true);
  assert.equal(compareResults(runQuery('metadata.event_type = "USER_LOGIN"', mini, null, ctx).result, ref).correct, false);
  failsL('metadata.event_type = "USER_LOGIN"\nmatch:\n  principal.user.userid\noutcome:\n  $c = count(metadata.id)\ndedup:\n  principal.hostname', 'DEDUP_KEY_NOT_GROUPED');
  failsL('metadata.event_type = "USER_LOGIN"\noutcome:\n  $c = count(metadata.id)\ndedup:\n  principal.hostname', 'DEDUP_KEY_NOT_GROUPED', 'invalid');
  failsL('metadata.event_type = "USER_LOGIN"\ndedup:\n  principal.user.userid, principal.user.userid', 'DUPLICATE_KEY');
  failsL('metadata.event_type = "USER_LOGIN"\ndedup:\n  hostname', 'GROUPED_FIELD_HERE');
  failsL('metadata.event_type = "USER_LOGIN"\ndedup:\n  $u', 'UNBOUND_VARIABLE');
  failsL('metadata.event_type = "USER_LOGIN"\nmatch:\n  principal.user.userid\noutcome:\n  $c = count(metadata.id)\norder:\n  $c\ndedup:\n  principal.user.userid', 'SECTION_ORDER');
  failsL('metadata.event_type = "USER_LOGIN"\ndedup:\n  principal.user.userid\nmatch:\n  principal.user.userid\noutcome:\n  $c = count(metadata.id)', 'SECTION_ORDER');
});

test('V2 array and array_distinct return lists cut at 1,000; earliest and latest return timestamps; should-fail: non-timestamp argument, array in condition or order', () => {
  const r = runL('metadata.event_type = "USER_LOGIN"\nmatch:\n  principal.hostname\noutcome:\n  $users = array(principal.user.userid)\n  $distinct = array_distinct(principal.user.userid)\n  $first = earliest(metadata.event_timestamp)\n  $last = latest(metadata.event_timestamp.seconds)');
  const pc1 = r.rows.find(x => x['principal.hostname'] === 'PC-1');
  assert.deepEqual(pc1.$users, ['ana', 'ana']); assert.deepEqual(pc1.$distinct, ['ana']); assert.equal(pc1.$first, 1000); assert.equal(pc1.$last, 1100);
  assert.deepEqual(r.arrayCols, ['$users', '$distinct']); assert.deepEqual(r.timeCols, ['$first', '$last']);
  const many = Array.from({ length: 1200 }, (_, i) => ({ 'metadata.id': 'm' + i, 'metadata.event_timestamp.seconds': i, 'metadata.event_type': 'USER_LOGIN', 'principal.user.userid': 'u' + i }));
  const big = execute(parseSearch('metadata.event_type = "USER_LOGIN"\noutcome:\n  $a = array(principal.user.userid)\n  $d = array_distinct(principal.user.userid)'), many).rows[0];
  assert.equal(big.$a.length, 1000); assert.equal(big.$d.length, 1000); assert.equal(big.$a[0], 'u0');
  assert.equal(execute(parseSearch('metadata.event_type = "USER_LOGIN"\noutcome:\n  $d = array_distinct(principal.user.userid)'), many.map(e => ({ ...e, 'principal.user.userid': 'same' }))).rows[0].$d.length, 1, 'distinct before truncation');
  // min/max on the timestamp still read as time columns, and the old shapes still run
  assert.deepEqual(runL('metadata.event_type = "USER_LOGIN"\noutcome:\n  $m = min(metadata.event_timestamp.seconds)').timeCols, ['$m']);
  failsL('metadata.event_type = "USER_LOGIN"\noutcome:\n  $e = earliest(principal.hostname)', 'TIME_AGGREGATE_NEEDS_TIMESTAMP', 'invalid');
  failsL('metadata.event_type = "USER_LOGIN"\noutcome:\n  $e = latest(target.port)', 'TIME_AGGREGATE_NEEDS_TIMESTAMP');
  failsL('metadata.event_type = "USER_LOGIN"\nmatch:\n  principal.hostname\noutcome:\n  $a = array(principal.user.userid)\ncondition:\n  $a > 1', 'CONDITION_ON_ARRAY');
  failsL('metadata.event_type = "USER_LOGIN"\nmatch:\n  principal.hostname\noutcome:\n  $a = array(principal.user.userid)\norder:\n  $a desc', 'ORDER_ON_ARRAY');
  failsL('metadata.event_type = "USER_LOGIN"\noutcome:\n  $a = array_distinct(hostname)', 'GROUPED_FIELD_HERE');
});

test('V3 timestamp and string functions in filters and placeholders, UTC only; should-fail: another zone is unsupported with a reason, wrong argument types are invalid', () => {
  // mini timestamps are seconds after the epoch: 1000 s = 00:16:40 UTC on 1970-01-01, 1800 s = 00:30:00
  assert.deepEqual(ids(runL('timestamp.get_hour(metadata.event_timestamp.seconds, "UTC") = 0\ntimestamp.get_minute(metadata.event_timestamp) >= 30')), ['e7']);
  assert.deepEqual(ids(runL('timestamp.get_date(metadata.event_timestamp.seconds) = "1970-01-01"\nmetadata.event_type = "USER_LOGIN"')), ['e1', 'e2', 'e3', 'e4']);
  const hours = runL('metadata.event_type = "USER_LOGIN"\n$h = timestamp.get_hour(metadata.event_timestamp.seconds, "UTC")\nmatch:\n  $h\noutcome:\n  $c = count(metadata.id)');
  assert.deepEqual(hours.columns, ['timestamp.get_hour(metadata.event_timestamp.seconds)', '$c']); assert.deepEqual(hours.rows, [{ 'timestamp.get_hour(metadata.event_timestamp.seconds)': 0, $c: 4 }]);
  assert.deepEqual(ids(runL('strings.to_lower(principal.hostname) = "pc-2"\nmetadata.event_type = "USER_LOGIN"')), ['e3']);
  assert.deepEqual(ids(runL('strings.to_upper(principal.user.userid) = "BO"')), ['e3', 'e5']);
  const keyed = runL('metadata.event_type = "USER_LOGIN"\n$key = strings.concat(principal.hostname, ":", principal.user.userid)\nmatch:\n  $key\noutcome:\n  $c = count(metadata.id)');
  assert.deepEqual(keyed.rows.map(r => r['strings.concat(principal.hostname, ":", principal.user.userid)']).sort(), [':', 'PC-1:ana', 'PC-2:bo']);
  assert.deepEqual(ids(runL('strings.to_lower(target.process.file.full_path) = /powershell\\.exe$/')), ['e5'], 'a regex on a function result');
  assert.deepEqual(ids(runL('$lo = strings.to_lower(principal.hostname)\n$lo = "pc-1"\nmetadata.event_type = "NETWORK_CONNECTION"')), ['e7'], 'a placeholder set from a function and then compared');
  // the regex guard still applies on a function result, and the grader compares function tables by their names
  failsL('strings.to_lower(principal.hostname) = /(a+)+$/', 'REGEX_NESTED_QUANTIFIER');
  const ref = runQuery('metadata.event_type = "USER_LOGIN"\n$h = timestamp.get_hour(metadata.event_timestamp.seconds, "UTC")\nmatch:\n  $h\noutcome:\n  $c = count(metadata.id)', mini).result;
  assert.equal(compareResults(runQuery('metadata.event_type = "USER_LOGIN"\n$hour = timestamp.get_hour(metadata.event_timestamp)\nmatch:\n  $hour\noutcome:\n  $n = count(metadata.id)', mini).result, ref).correct, true);
  failsL('timestamp.get_hour(metadata.event_timestamp.seconds, "America/Los_Angeles") = 19', 'TIMEZONE_UNSUPPORTED', 'unsupported');
  failsL('timestamp.get_hour(metadata.event_timestamp.seconds, "-08:00") = 19', 'TIMEZONE_UNSUPPORTED', 'unsupported');
  failsL('timestamp.get_hour(metadata.event_timestamp.seconds, 0) = 19', 'TIMEZONE_NEEDS_STRING', 'invalid');
  failsL('timestamp.get_hour(target.port, "UTC") = 19', 'TIMESTAMP_FN_NEEDS_TIMESTAMP', 'invalid');
  failsL('timestamp.get_hour(metadata.event_timestamp.seconds, "UTC") = "19"', 'NUMBER_NEEDS_NUMBER');
  failsL('strings.to_lower(target.port) = "443"', 'STRING_FN_NEEDS_STRING', 'invalid');
  failsL('strings.to_lower(principal.hostname, principal.ip) = "x"', 'STRING_FN_NEEDS_STRING');
  failsL('strings.concat(principal.hostname) = "x"', 'CONCAT_NEEDS_ARGS');
  failsL('strings.to_lower(principal.hostname) = 1', 'STRING_NEEDS_QUOTES');
  failsL('strings.to_lower(principal.hostname) > "a"', 'STRING_OPERATOR');
  failsL('metadata.event_type = "USER_LOGIN"\noutcome:\n  $s = sum(strings.to_lower(principal.hostname))', 'AGGREGATE_NEEDS_NUMBER');
  failsL('strings.reverse(principal.hostname) = "x"', 'UNSUPPORTED_FUNCTION', 'unsupported');
  failsL('timestamp.get_week(metadata.event_timestamp.seconds) = 3', 'UNSUPPORTED_FUNCTION', 'unsupported');
});

test('V4 reference lists: in %string, in cidr %cidr, in regex %regex, not in, nocase; should-fail: unknown list, wrong keyword for the list type, wrong field type, too many lists', () => {
  assert.deepEqual(ids(runL('principal.ip in %known_ips\nmetadata.event_type = "USER_LOGIN"')), ['e1', 'e2', 'e3']);
  assert.deepEqual(ids(runL('metadata.event_type = "USER_LOGIN"\nprincipal.ip not in %known_ips')), ['e4']);
  assert.deepEqual(ids(runL('metadata.event_type = "USER_LOGIN"\nnot principal.ip in %known_ips')), ['e4']);
  assert.deepEqual(ids(runL('target.ip in cidr %ext_ranges')), ['e6']);
  assert.deepEqual(ids(runL('ip in cidr %ext_ranges')), ['e4', 'e6'], 'a grouped field expands across the list test');
  assert.deepEqual(ids(runL('target.process.file.full_path in regex %ps_shapes')), [], 'regex lists are case-sensitive without nocase');
  assert.deepEqual(ids(runL('target.process.file.full_path in regex %ps_shapes nocase')), ['e5']);
  assert.deepEqual(ids(runL('principal.hostname in %hosts')), []);
  assert.deepEqual(ids(runL('principal.hostname in %hosts nocase\nmetadata.event_type = "USER_LOGIN"')), ['e1', 'e2']);
  assert.deepEqual(ids(runL('strings.to_lower(principal.hostname) in %hosts\nmetadata.event_type = "USER_LOGIN"')), ['e1', 'e2'], 'a function result can be tested against a list');
  assert.deepEqual(parseSearch('principal.ip in %known_ips OR target.ip in cidr %ext_ranges', ctx).lists, ['known_ips', 'ext_ranges']);
  failsL('principal.ip in %nobody_home', 'UNKNOWN_LIST', 'invalid');
  failsL('principal.ip in cidr %known_ips', 'LIST_TYPE_MISMATCH', 'invalid');
  failsL('principal.ip in %ext_ranges', 'LIST_TYPE_MISMATCH', 'invalid');
  failsL('principal.hostname in regex %hosts', 'LIST_TYPE_MISMATCH');
  failsL('principal.hostname in cidr %ext_ranges', 'LIST_NEEDS_IP', 'invalid');
  failsL('target.port in %known_ips', 'LIST_ON_NUMBER', 'invalid');
  failsL('target.port in regex %ps_shapes', 'LIST_ON_NUMBER');
  failsL('target.ip in cidr %ext_ranges nocase', 'NOCASE_ON_CIDR_LIST');
  failsL('principal.ip in %', 'BAD_LIST_NAME');
  failsL('principal.ip in known_ips', 'EXPECTED_LIST');
  failsL(Array.from({ length: 8 }, () => 'principal.ip in %known_ips').join(' OR '), 'TOO_MANY_LISTS');
  assert.equal(parseSearch(Array.from({ length: 7 }, () => 'principal.ip in %known_ips').join(' OR '), ctx).lists.length, 1, 'seven in tests are allowed');
  // without lists in the context every list is unknown, so the engine stays usable where none are bundled
  fails('principal.ip in %known_ips', 'UNKNOWN_LIST');
  // a list that fails the regex guard is skipped, never compiled: (a+)+$ is in ps_shapes and matches nothing here
  assert.deepEqual(ids(runL('principal.user.userid in regex %ps_shapes')), []);
});

// ---------- data tables (Google: "Use reference lists and data tables in YARA-L 2.0", verified 2026-10-18) ----------
const TABLES = [
  { name: 'allow', columns: [{ name: 'domain', type: 'string' }, { name: 'source', type: 'string' }], rows: [['PC-1', 'contract'], ['PC-9', 'log']] },
  { name: 'blocks', columns: [{ name: 'range', type: 'cidr' }, { name: 'reason', type: 'string' }], rows: [['203.0.113.0/24', 'c2']] },
  { name: 'shapes', columns: [{ name: 'pattern', type: 'regex' }], rows: [['powershell\\.exe$']] },
];
const ctxT = { lists: LISTS, tables: TABLES };
const runT = t => execute(parseSearch(t, ctxT), mini);
const failsT = (t, code, status) => { try { parseSearch(t, ctxT); } catch (e) { assert.ok(e instanceof QueryError, 'QueryError'); assert.equal(e.code, code); if (status) assert.equal(e.status, status); return; } assert.fail('expected ' + code); };

test('V5 data tables: %table.column in the three forms, with not and nocase; should-fail: unknown table, unknown column, keyword mismatch, = instead of in, and the 7/4/2 Search limits', () => {
  assert.deepEqual(ids(runT('principal.hostname in %allow.domain\nmetadata.event_type = "USER_LOGIN"')), ['e1', 'e2']);
  assert.deepEqual(ids(runT('principal.hostname not in %allow.domain\nmetadata.event_type = "USER_LOGIN"')), ['e3', 'e4']);
  assert.deepEqual(ids(runT('principal.hostname in %allow.source nocase')), [], 'another column of the same table is another list');
  assert.deepEqual(ids(runT('target.ip in cidr %blocks.range')), ['e6']);
  assert.deepEqual(ids(runT('target.process.file.full_path in regex %shapes.pattern nocase')), ['e5']);
  assert.deepEqual(ids(runT('target.process.file.full_path in regex %shapes.pattern')), [], 'case-sensitive without nocase');
  const q = parseSearch('principal.hostname in %allow.domain OR target.ip in cidr %blocks.range OR principal.ip in %known_ips', ctxT);
  assert.deepEqual(q.tables, ['allow', 'blocks']); assert.deepEqual(q.lists, ['known_ips']);
  // the lists and the tables are both named in the Lists and tables panel; the engine keeps them apart by the dot
  failsT('principal.hostname in %nowhere.domain', 'UNKNOWN_TABLE', 'invalid');
  failsT('principal.hostname in %allow.owner', 'UNKNOWN_TABLE_COLUMN', 'invalid');
  failsT('principal.hostname in %allow', 'UNKNOWN_LIST', 'invalid');
  failsT('target.ip in %blocks.range', 'LIST_TYPE_MISMATCH', 'invalid');
  failsT('principal.hostname in cidr %allow.domain', 'LIST_TYPE_MISMATCH');
  failsT('principal.hostname in regex %allow.domain', 'LIST_TYPE_MISMATCH');
  failsT('target.ip in cidr %blocks.range nocase', 'NOCASE_ON_CIDR_LIST');
  failsT('principal.hostname in cidr %blocks.range', 'LIST_NEEDS_IP');
  failsT('target.port in %allow.domain', 'LIST_ON_NUMBER');
  failsT('principal.hostname in %allow.', 'BAD_LIST_NAME');
  failsT('principal.hostname = %allow.domain', 'LIST_AS_VALUE', 'unsupported');
  failsT('principal.hostname = %hosts', 'LIST_AS_VALUE', 'unsupported');
  // Search limits per query: at most 7 in statements, 4 regex, 2 cidr (rules allow 10/5/5)
  const rep = (n, t) => Array.from({ length: n }, () => t).join(' OR ');
  failsT(rep(8, 'principal.hostname in %allow.domain'), 'TOO_MANY_LISTS', 'invalid');
  failsT(rep(5, 'principal.hostname in regex %shapes.pattern'), 'TOO_MANY_REGEX_LISTS', 'invalid');
  failsT(rep(3, 'target.ip in cidr %blocks.range'), 'TOO_MANY_CIDR_LISTS', 'invalid');
  failsT(rep(4, 'principal.hostname in regex %ps_shapes') + ' OR ' + 'principal.hostname in regex %shapes.pattern', 'TOO_MANY_REGEX_LISTS');
  assert.equal(parseSearch(rep(4, 'principal.hostname in regex %shapes.pattern') + ' OR ' + rep(2, 'target.ip in cidr %blocks.range') + ' OR principal.hostname in %allow.domain', ctxT).tables.length, 3, 'exactly 7 = 4 regex + 2 cidr + 1 string is allowed');
  // without tables in the context every table is unknown
  failsL('principal.hostname in %allow.domain', 'UNKNOWN_TABLE');
});

// ---------- multi-event joins (Google: "Use conditions in search and dashboards", verified 2026-10-18) ----------
const J = 'events:\n  $e1.metadata.event_type = "USER_LOGIN"\n  $e1.principal.user.userid = $u\n  $e2.metadata.event_type = "PROCESS_LAUNCH"\n  $e2.principal.user.userid = $u\n';
test('V6 two event variables joined by a shared placeholder: over N pairs events within N of each other, by N buckets them, no window joins the whole range; outcomes read one variable each and #var counts it', () => {
  const r = runL(J + 'match:\n  $u over 5m\noutcome:\n  $logins = count($e1.metadata.id)\n  $procs = array($e2.target.process.file.full_path)');
  assert.deepEqual(r.columns, ['principal.user.userid', '$logins', '$procs']);
  assert.deepEqual(r.rows, [{ 'principal.user.userid': 'bo', $logins: 1, $procs: ['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\PowerShell.exe'] }]);
  assert.deepEqual(r.rows[0][MEMBERS_SYM], ['e3', 'e5']); assert.deepEqual(r.joined, ['$e1', '$e2']); assert.equal(r.scanned, 5, 'four logins and one launch were read');
  assert.equal(runL(J + 'match:\n  $u over 1m\noutcome:\n  $n = count($e1.metadata.id)').rows.length, 0, '200 seconds apart is outside a one-minute window');
  assert.equal(runL(J + 'match:\n  $u over 1h\noutcome:\n  $n = count($e1.metadata.id)').rows.length, 1);
  const bucketed = runL(J + 'match:\n  $u by 10m\noutcome:\n  $n = count($e2.metadata.id)');
  assert.deepEqual(bucketed.columns, ['principal.user.userid', 'window_start', '$n']); assert.deepEqual(bucketed.rows, [{ 'principal.user.userid': 'bo', window_start: 1200, $n: 1 }]);
  assert.equal(runL(J + 'match:\n  $u\noutcome:\n  $n = count($e1.metadata.id)').rows.length, 1, 'no window: the whole range');
  // the join on hostname: a login followed by a connection from the same host, either order, written with a placeholder or directly
  const H = '$e1.metadata.event_type = "USER_LOGIN"\n$e1.principal.hostname = $h\n$e2.metadata.event_type = "NETWORK_CONNECTION"\n$e2.principal.hostname = $h\nmatch:\n  $h over 1h\noutcome:\n  $first_login = earliest($e1.metadata.event_timestamp)\n  $to = array_distinct($e2.target.ip)\n  $n = count($e2.metadata.id)\norder:\n  $first_login';
  const h = runL(H);
  assert.deepEqual(h.rows.map(x => [x['principal.hostname'], x.$first_login, x.$to, x.$n]), [['PC-1', 1000, ['192.0.2.8'], 1], ['PC-2', 1400, ['203.0.113.44'], 1]]);
  assert.deepEqual(h.timeCols, ['$first_login']);
  const direct = runL('$e1.metadata.event_type = "USER_LOGIN"\n$e2.metadata.event_type = "NETWORK_CONNECTION"\n$e1.principal.hostname = $e2.principal.hostname\nmatch:\n  $e1.principal.hostname over 1h\noutcome:\n  $n = count($e2.metadata.id)');
  assert.deepEqual(direct.rows.map(x => x['principal.hostname']), ['PC-1', 'PC-2']);
  // condition: #var, $var as #var > 0, outcome comparisons, and/or
  assert.equal(runL(J + 'match:\n  $u over 5m\noutcome:\n  $n = count($e1.metadata.id)\ncondition:\n  #e1 > 0 and #e2 >= 1').rows.length, 1);
  assert.equal(runL(J + 'match:\n  $u over 5m\noutcome:\n  $n = count($e1.metadata.id)\ncondition:\n  $e1 and $e2').rows.length, 1);
  assert.equal(runL(J + 'match:\n  $u over 5m\noutcome:\n  $n = count($e1.metadata.id)\ncondition:\n  #e1 > 1 or $n > 1').rows.length, 0);
  assert.equal(runL(H.replace('order:\n  $first_login', 'condition:\n  #e2 > 0 and $n >= 1')).rows.length, 2);
  // grading: differently named variables and placeholders are the same evidence
  const ref = runQuery(J + 'match:\n  $u over 5m\noutcome:\n  $n = count($e2.metadata.id)', mini, null, ctx).result;
  const alt = runQuery('$login.metadata.event_type = "USER_LOGIN"\n$login.principal.user.userid = $who\n$proc.metadata.event_type = "PROCESS_LAUNCH"\n$proc.principal.user.userid = $who\nmatch:\n  $who over 5m\noutcome:\n  $launches = count($proc.metadata.id)', mini, null, ctx).result;
  assert.equal(compareResults(alt, ref).correct, true);
  assert.equal(compareResults(runQuery(J + 'match:\n  $u over 1m\noutcome:\n  $n = count($e2.metadata.id)', mini, null, ctx).result, ref).reason, 'DIFFERENT_STATS');
  assert.equal(compareResults(runQuery('metadata.event_type = "PROCESS_LAUNCH"\nmatch:\n  principal.user.userid\noutcome:\n  $n = count(metadata.id)', mini, null, ctx).result, ref).correct, true, 'a single-event table with the same rows is the same evidence; the grader compares tables, not shapes');
});

test('V6 should-fail: unjoined variables, a placeholder set twice by one event, #var on an unknown variable, over without a key, more than two variables, a bare field, a match key one event sets, an outcome without a variable, no match section, a non-existence condition, and #var outside a join', () => {
  failsL('$e1.metadata.event_type = "USER_LOGIN"\n$e2.metadata.event_type = "PROCESS_LAUNCH"\nmatch:\n  $e1.principal.user.userid', 'UNJOINED_VARIABLE', 'invalid');
  failsL('$e1.principal.hostname = $h\n$e1.target.hostname = $h\n$e2.principal.hostname = $h\nmatch:\n  $h', 'BINDING_DUPLICATE', 'invalid');
  failsL('$e.principal.hostname = $h\n$e.target.hostname = $h\nmatch:\n  $h\noutcome:\n  $n = count(metadata.id)', 'BINDING_DUPLICATE', 'invalid');
  failsL(J + 'match:\n  $u over 5m\noutcome:\n  $n = count($e1.metadata.id)\ncondition:\n  #e3 > 0', 'UNKNOWN_EVENT_VAR', 'invalid');
  failsL(J + 'match:\n  over 1h\noutcome:\n  $n = count($e1.metadata.id)', 'OVER_NEEDS_KEY', 'invalid');
  failsL('metadata.event_type = "USER_LOGIN"\nmatch:\n  by 5m\noutcome:\n  $n = count(metadata.id)', 'OVER_NEEDS_KEY', 'invalid');
  failsL(J + '$e3.metadata.event_type = "NETWORK_CONNECTION"\n$e3.principal.user.userid = $u\nmatch:\n  $u over 1h', 'TOO_MANY_EVENT_VARS', 'unsupported');
  failsL(J + 'security_result.action = "FAIL"\nmatch:\n  $u over 5m', 'BARE_FIELD_IN_JOIN', 'invalid');
  failsL(J + 'match:\n  $e1.principal.hostname over 5m\noutcome:\n  $n = count($e1.metadata.id)', 'MATCH_KEY_NOT_SHARED', 'invalid');
  failsL(J + '$e1.principal.hostname = $h\nmatch:\n  $h over 5m', 'MATCH_KEY_NOT_SHARED', 'invalid');
  failsL(J + 'match:\n  $u over 5m\noutcome:\n  $n = count(metadata.id)', 'OUTCOME_NEEDS_VARIABLE', 'invalid');
  failsL(J + 'match:\n  $u over 5m\noutcome:\n  $n = count_distinct($u)', 'OUTCOME_NEEDS_VARIABLE', 'invalid');
  failsL(J + 'outcome:\n  $n = count($e1.metadata.id)', 'MULTI_EVENT_NEEDS_MATCH', 'invalid');
  failsL(J + 'match:\n  $u over 5m\ncondition:\n  #e2 = 0', 'NON_EXISTENCE', 'unsupported');
  failsL(J + 'match:\n  $u over 5m\ncondition:\n  not $e2', 'NON_EXISTENCE', 'unsupported');
  failsL(J + 'match:\n  $u over 5m\ncondition:\n  #e1 > 0 and #e2 < 1', 'NON_EXISTENCE', 'unsupported');
  failsL(J + 'match:\n  $u over 5m\ncondition:\n  $e1 >= 0', 'NON_EXISTENCE', 'unsupported');
  failsL(J + 'match:\n  $u over 5m\noutcome:\n  $n = count($e1.metadata.id)\ncondition:\n  #e1 > "1"', 'CONDITION_NEEDS_NUMBER', 'invalid');
  failsL('metadata.event_type = "USER_LOGIN"\nmatch:\n  principal.user.userid\noutcome:\n  $n = count(metadata.id)\ncondition:\n  #e > 0', 'UNKNOWN_EVENT_VAR', 'invalid');
  failsL('$e.metadata.event_type = "USER_LOGIN"\nmatch:\n  $e.principal.user.userid\noutcome:\n  $n = count(metadata.id)\ncondition:\n  #e > 0', 'COUNT_CHARACTER', 'unsupported');
  failsL('#e1 > 0', 'COUNT_CHARACTER', 'unsupported');
  failsL(J + '$u = "bo"\nmatch:\n  $u over 5m', 'SHARED_PLACEHOLDER_COMPARED', 'invalid');
  failsL('($e1.metadata.event_type = "USER_LOGIN" OR $e2.metadata.event_type = "PROCESS_LAUNCH")\n$e1.principal.user.userid = $u\n$e2.principal.user.userid = $u\nmatch:\n  $u', 'MIXED_EVENT_VARS', 'unsupported');
  failsL(J + 'match:\n  $u over 5m\ndedup:\n  $e1.principal.hostname', 'DEDUP_KEY_NOT_GROUPED', 'invalid');
  // single-event behaviour is unchanged: over N stays the unsupported rule window, by N buckets
  failsL('metadata.event_type = "USER_LOGIN"\nmatch:\n  principal.hostname over 1h\noutcome:\n  $c = count(metadata.id)', 'OVER_WINDOW', 'unsupported');
});
