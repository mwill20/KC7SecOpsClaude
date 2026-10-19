import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRule, executeRule, runRule, gradeRuleCases, clockToSeconds } from '../../site/engine/rules.js';
import { parseSearch, QueryError } from '../../site/engine/parser.js';
import { execute } from '../../site/engine/executor.js';
import { gradeQuery } from '../../site/engine/grader.js';
import { MESSAGES } from '../../site/ui/messages.js';

// A small dataset: a burst of failures by "ana" that a clock-aligned 2-minute bucket splits but a sliding window holds,
// one failure by "bo", a login and a file by "cy" forty minutes apart, a gateway failure with a blank hostname.
const T = 1_700_000_000;
const login = (id, t, user, action, extra = {}) => ({ 'metadata.id': id, 'metadata.event_timestamp.seconds': T + t, 'metadata.event_type': 'USER_LOGIN', 'principal.user.userid': user, 'security_result.action': action, 'principal.hostname': 'PC-1', 'principal.ip': '10.0.0.1', 'target.hostname': 'DC-01', ...extra });
const events = [
  login('e1', 0, 'ana', 'FAIL'), login('e2', 70, 'ana', 'FAIL'), login('e3', 130, 'ana', 'FAIL'), login('e4', 190, 'ana', 'FAIL'),
  login('e5', 1000, 'bo', 'FAIL'),
  login('e6', 2000, 'cy', 'ALLOW', { 'target.hostname': 'VPN-GW-01' }),
  { 'metadata.id': 'e7', 'metadata.event_timestamp.seconds': T + 4400, 'metadata.event_type': 'FILE_CREATION', 'principal.user.userid': 'cy', 'principal.hostname': 'FS-01', 'target.file.full_path': 'C:\\x.zip' },
  login('e8', 5000, 'dee', 'FAIL', { 'principal.hostname': '', 'target.hostname': 'VPN-GW-01' }), login('e9', 5030, 'dee', 'FAIL', { 'principal.hostname': '', 'target.hostname': 'VPN-GW-01' }),
  login('e10', 6000, 'ana', 'ALLOW', { 'target.user.userid': 'svc-playout', 'target.hostname': 'FS-01' }),
  login('e11', 6100, 'root', 'ALLOW', { 'target.user.userid': 'svc-playout', 'target.hostname': 'AUTO-01' }),
];
const tables = [{ name: 'privileged_accounts', columns: [{ name: 'account', type: 'string' }, { name: 'may_run_as', type: 'string' }, { name: 'granted_by', type: 'string' }], rows: [['root', 'svc-playout', 'board']] }];
const ctx = { lists: [], tables, window: { start: T, end: T + 7200 } };
const META = 'meta:\n  author = "desk"\n  description = "test rule"\n  severity = "MEDIUM"\n';
const rule = (body, name = 'r') => `rule ${name} {\n${META}${body}\n}`;
const fails = (t, code, status) => { try { parseRule(t, ctx); } catch (e) { assert.ok(e instanceof QueryError, 'QueryError for ' + code + ' got ' + e.message); assert.equal(e.code, code); if (status) assert.equal(e.status, status); return; } assert.fail('expected ' + code); };
const run = t => executeRule(parseRule(t, ctx), events, null);
const BURST = rule('events:\n  $e.metadata.event_type = "USER_LOGIN"\n  $e.security_result.action = "FAIL"\n  $e.principal.user.userid = $account\nmatch:\n  $account over 2m\noutcome:\n  $failures = count($e.metadata.id)\ncondition:\n  $e and $failures >= 3');

test('R1 a rule parses as an envelope around the Search body: name, meta, events with $e, match over N, outcome, condition; the sliding window holds a burst the clock bucket splits', () => {
  const r = parseRule(BURST, ctx);
  assert.equal(r.name, 'r'); assert.deepEqual(r.meta, { author: 'desk', description: 'test rule', severity: 'MEDIUM' }); assert.equal(r.window, 120); assert.equal(r.options.allow_zero_values, false);
  const d = executeRule(r, events, null);
  assert.equal(d.kind, 'detections'); assert.deepEqual(d.columns, ['principal.user.userid', 'window_start', 'window_end', '$failures']);
  // the first window [0, 120] holds two failures and does not fire; the window slides to 70 and holds three
  assert.deepEqual(d.rows.map(x => [x['principal.user.userid'], x.window_start - T, x.$failures]), [['ana', 70, 3]]);
  assert.deepEqual(d.rule.keys, ['principal.user.userid']); assert.equal(d.rule.window, 120);
  // Search on the same data and threshold: the 2-minute clock buckets hold 2 and 2, so no row survives the condition.
  const search = execute(parseSearch('metadata.event_type = "USER_LOGIN"\nsecurity_result.action = "FAIL"\n$account = principal.user.userid\nmatch:\n  $account by 2m\noutcome:\n  $failures = count(metadata.id)\ncondition:\n  $failures >= 3'), events);
  assert.equal(search.rows.length, 0);
  // One detection per key per window hit: the window moves past the events it fired on, then slides on.
  const two = run(rule('events:\n  $e.metadata.event_type = "USER_LOGIN"\n  $e.security_result.action = "FAIL"\n  $e.principal.user.userid = $account\nmatch:\n  $account over 1m\noutcome:\n  $n = count($e.metadata.id)\ncondition:\n  $e and $n >= 2'));
  assert.deepEqual(two.rows.map(x => [x['principal.user.userid'], x.window_start - T, x.$n]), [['ana', 70, 2], ['dee', 5000, 2]]);
  // range narrows the events the rule sees
  assert.equal(executeRule(parseRule(BURST, ctx), events, { start: T + 100, end: T + 7200 }).count, 0);
});

test('R1 two event variables in a rule: the join key is the shared placeholder, $e1 and $e2 in condition, outcomes per variable, both orders inside the window', () => {
  const d = run(rule('events:\n  $e1.metadata.event_type = "USER_LOGIN"\n  $e1.target.hostname = "VPN-GW-01"\n  $e1.security_result.action = "ALLOW"\n  $e1.principal.user.userid = $account\n  $e2.metadata.event_type = "FILE_CREATION"\n  $e2.principal.user.userid = $account\nmatch:\n  $account over 1h\noutcome:\n  $files = array($e2.target.file.full_path)\n  $login_at = earliest($e1.metadata.event_timestamp)\ncondition:\n  $e1 and $e2'));
  assert.deepEqual(d.rows.map(x => [x['principal.user.userid'], x.$files, x.$login_at - T]), [['cy', ['C:\\x.zip'], 2000]]);
  assert.deepEqual(d.timeCols, ['$login_at']);
  // a 30-minute window no longer holds the pair
  assert.equal(run(rule('events:\n  $e1.metadata.event_type = "USER_LOGIN"\n  $e1.principal.user.userid = $account\n  $e2.metadata.event_type = "FILE_CREATION"\n  $e2.principal.user.userid = $account\nmatch:\n  $account over 30m\ncondition:\n  $e1 and $e2')).count, 0);
});

test('R2 allow_zero_values: a blank match key forms no detection until the option is set', () => {
  const body = 'events:\n  $e.metadata.event_type = "USER_LOGIN"\n  $e.security_result.action = "FAIL"\n  $e.target.hostname = "VPN-GW-01"\n  $e.principal.hostname = $host\nmatch:\n  $host over 10m\noutcome:\n  $n = count($e.metadata.id)\ncondition:\n  $e and $n >= 2';
  assert.equal(run(rule(body)).count, 0);
  const d = run(rule(body + '\noptions:\n  allow_zero_values = true'));
  assert.deepEqual(d.rows.map(x => [x['principal.hostname'], x.$n]), [['', 2]]);
  assert.equal(parseRule(rule(body + '\noptions:\n  allow_zero_values = true'), ctx).options.allow_zero_values, true);
});

test('R2 the data-table join: $e.field = %table.column joins the rows whose column holds the value, outcome reads another column of the joined row, in and not in still work; should-fail cases are named', () => {
  const d = run(rule('events:\n  $e.metadata.event_type = "USER_LOGIN"\n  $e.target.user.userid = %privileged_accounts.may_run_as\n  not $e.principal.user.userid in %privileged_accounts.account\n  $e.principal.user.userid = $account\nmatch:\n  $account over 1h\noutcome:\n  $granted_by = array_distinct(%privileged_accounts.granted_by)\n  $host = array_distinct($e.target.hostname)\ncondition:\n  $e'));
  assert.deepEqual(d.rows.map(x => [x['principal.user.userid'], x.$granted_by, x.$host]), [['ana', ['board'], ['FS-01']]]);
  assert.deepEqual(d.columns, ['principal.user.userid', 'window_start', 'window_end', '$granted_by', '$host']);
  fails(rule('events:\n  $e.target.user.userid = %privileged_accounts\n  $e.principal.user.userid = $a\nmatch:\n  $a over 1h\ncondition:\n  $e'), 'TABLE_JOIN_NEEDS_COLUMN');
  fails(rule('events:\n  $e.target.user.userid != %privileged_accounts.may_run_as\n  $e.principal.user.userid = $a\nmatch:\n  $a over 1h\ncondition:\n  $e'), 'TABLE_JOIN_OPERATOR');
  fails(rule('events:\n  $e.target.user.userid = %no_table.col\n  $e.principal.user.userid = $a\nmatch:\n  $a over 1h\ncondition:\n  $e'), 'UNKNOWN_TABLE');
  fails(rule('events:\n  $e.target.user.userid = %privileged_accounts.nope\n  $e.principal.user.userid = $a\nmatch:\n  $a over 1h\ncondition:\n  $e'), 'UNKNOWN_TABLE_COLUMN');
  fails(rule('events:\n  $e.metadata.event_type = "USER_LOGIN"\n  $e.principal.user.userid = $a\nmatch:\n  $a over 1h\noutcome:\n  $g = array_distinct(%privileged_accounts.granted_by)\ncondition:\n  $e'), 'TABLE_NOT_JOINED');
  fails(rule('events:\n  $e.target.user.userid = %privileged_accounts.may_run_as\n  $e.principal.user.userid = %privileged_accounts.account\n  $e.principal.user.userid = $a\nmatch:\n  $a over 1h\ncondition:\n  $e'), 'TABLE_JOINED_TWICE');
  // in Search mode the join form stays rule syntax, reported as not run here
  assert.throws(() => parseSearch('target.user.userid = %privileged_accounts.may_run_as', ctx), e => e.code === 'LIST_AS_VALUE' && e.status === 'unsupported');
});

test('R3 should-fail: missing condition, a field without its event variable, over without a match key, an unknown option, and the envelope and section mistakes each carry their own code and a message', () => {
  fails(rule('events:\n  $e.metadata.event_type = "USER_LOGIN"\n  $e.principal.user.userid = $a\nmatch:\n  $a over 5m\noutcome:\n  $n = count($e.metadata.id)'), 'RULE_NEEDS_CONDITION', 'invalid');
  fails(rule('events:\n  metadata.event_type = "USER_LOGIN"\n  $e.principal.user.userid = $a\nmatch:\n  $a over 5m\ncondition:\n  $e'), 'FIELD_NEEDS_VARIABLE', 'invalid');
  fails(rule('events:\n  $e.metadata.event_type = "USER_LOGIN"\n  $e.principal.user.userid = $a\nmatch:\n  over 5m\ncondition:\n  $e'), 'OVER_NEEDS_KEY', 'invalid');
  fails(rule('events:\n  $e.metadata.event_type = "USER_LOGIN"\n  $e.principal.user.userid = $a\nmatch:\n  $a over 5m\ncondition:\n  $e\noptions:\n  allow_repeated_values = true'), 'RULE_UNKNOWN_OPTION', 'unsupported');
  fails(rule('events:\n  $e.metadata.event_type = "USER_LOGIN"\n  $e.principal.user.userid = $a\nmatch:\n  $a over 5m\ncondition:\n  $e\noptions:\n  allow_zero_values = yes'), 'RULE_OPTION_VALUE');
  fails(rule('events:\n  $e.metadata.event_type = "USER_LOGIN"\n  $e.principal.user.userid = $a\nmatch:\n  $a\ncondition:\n  $e'), 'RULE_NEEDS_WINDOW');
  fails(rule('events:\n  $e.metadata.event_type = "USER_LOGIN"\n  $e.principal.user.userid = $a\nmatch:\n  $a by 5m\ncondition:\n  $e'), 'RULE_WINDOW_FORM');
  fails(rule('events:\n  $e.metadata.event_type = "USER_LOGIN"\n  $e.principal.user.userid = $a\nmatch:\n  $a over every 5m\ncondition:\n  $e'), 'RULE_WINDOW_FORM');
  fails(rule('events:\n  $e.metadata.event_type = "USER_LOGIN"\n  $e.principal.user.userid = $a\ncondition:\n  $e'), 'RULE_NEEDS_MATCH', 'unsupported');
  fails(rule('events:\n  $e.metadata.event_type = "USER_LOGIN"\n  $e.principal.user.userid = $a\nmatch:\n  $a over 5m\noutcome:\n  $n = count($e.metadata.id)\ncondition:\n  $e\norder:\n  $n desc'), 'RULE_NO_SECTION');
  fails(rule('events:\n  $e.metadata.event_type = "USER_LOGIN"\n  $e.principal.user.userid = $a\nmatch:\n  $a over 5m\norder:\n  $n desc\ncondition:\n  $e'), 'RULE_NO_SECTION');
  fails(rule('events:\n  $e.metadata.event_type = "USER_LOGIN"\n  $e.principal.user.userid = $a\nmatch:\n  $a over 72h\ncondition:\n  $e'), 'RULE_WINDOW_TOO_LONG', 'unsupported');
  fails(rule('events:\n  $e.metadata.event_type = "USER_LOGIN"\n  $u.graph.entity.user.userid = $a\n  $e.principal.user.userid = $a\nmatch:\n  $a over 5m\ncondition:\n  $e'), 'ENTITY_IN_RULE', 'unsupported');
  // the envelope
  fails('metadata.event_type = "USER_LOGIN"', 'RULE_NEEDS_ENVELOPE');
  fails('rule { events: $e.metadata.id = "x" }', 'RULE_NAME');
  fails('rule r\n' + META + 'events:\n  $e.metadata.id = "x"\n}', 'RULE_BRACE');
  fails('rule r {\n' + META + 'events:\n  $e.metadata.id = "x"\nmatch:\n  $e.metadata.id over 5m\ncondition:\n  $e', 'RULE_BRACE');
  fails('rule r {\n  $e.metadata.id = "x"\n}', 'RULE_SECTION_FIRST');
  fails('rule r {\nevents:\n  $e.metadata.id = "x"\nmatch:\n  $e.metadata.id over 5m\ncondition:\n  $e\n}', 'RULE_NEEDS_META');
  fails('rule r {\n' + META + 'match:\n  $a over 5m\ncondition:\n  $e\n}', 'RULE_NEEDS_EVENTS');
  fails('rule r {\n' + META + META + 'events:\n  $e.metadata.id = "x"\nmatch:\n  $e.metadata.id over 5m\ncondition:\n  $e\n}', 'RULE_SECTION_TWICE');
  fails('rule r {\nevents:\n  $e.metadata.id = "x"\n' + META + 'match:\n  $e.metadata.id over 5m\ncondition:\n  $e\n}', 'RULE_SECTION_ORDER');
  fails('rule r {\nmeta:\n  author = "a"\n  description = "d"\nevents:\n  $e.metadata.id = "x"\nmatch:\n  $e.metadata.id over 5m\ncondition:\n  $e\n}', 'RULE_META_MISSING');
  fails('rule r {\nmeta:\n  author = "a"\n  description = "d"\n  severity = "URGENT"\nevents:\n  $e.metadata.id = "x"\nmatch:\n  $e.metadata.id over 5m\ncondition:\n  $e\n}', 'RULE_SEVERITY');
  fails('rule r {\nmeta:\n  author = a\nevents:\n  $e.metadata.id = "x"\nmatch:\n  $e.metadata.id over 5m\ncondition:\n  $e\n}', 'RULE_META_STRING');
  fails(rule('events:\n  $e.metadata.id = "x"\nmatch:\n  $e.metadata.id over 5m\ncondition:\n  $e\n}\n}'), 'RULE_BRACE');
  // the rule desk refuses a non-existence condition the same way Search does, and Search still refuses braces and over
  fails(rule('events:\n  $e1.metadata.event_type = "USER_LOGIN"\n  $e1.principal.user.userid = $a\n  $e2.metadata.event_type = "FILE_CREATION"\n  $e2.principal.user.userid = $a\nmatch:\n  $a over 1h\ncondition:\n  $e1 and #e2 = 0'), 'NON_EXISTENCE', 'unsupported');
  assert.throws(() => parseSearch(BURST), e => e.code === 'LOOKS_LIKE_RULE' && e.status === 'unsupported');
  assert.throws(() => parseSearch('metadata.event_type = "USER_LOGIN"\n$a = principal.user.userid\nmatch:\n  $a over 5m\noutcome:\n  $n = count(metadata.id)'), e => e.code === 'OVER_WINDOW');
  // every rule code has a two-part message
  for (const code of ['RULE_NEEDS_ENVELOPE', 'RULE_NAME', 'RULE_BRACE', 'RULE_SECTION_FIRST', 'RULE_SECTION_TWICE', 'RULE_SECTION_ORDER', 'RULE_SECTION_EMPTY', 'RULE_NEEDS_META', 'RULE_NEEDS_EVENTS', 'RULE_NEEDS_MATCH', 'RULE_NEEDS_CONDITION', 'RULE_NEEDS_WINDOW', 'RULE_WINDOW_FORM', 'RULE_WINDOW_TOO_LONG', 'RULE_META_SHAPE', 'RULE_META_STRING', 'RULE_META_TWICE', 'RULE_META_EMPTY', 'RULE_META_MISSING', 'RULE_SEVERITY', 'RULE_OPTION_SHAPE', 'RULE_OPTION_VALUE', 'RULE_UNKNOWN_OPTION', 'RULE_NO_SECTION', 'FIELD_NEEDS_VARIABLE', 'ENTITY_IN_RULE', 'TABLE_JOIN_OPERATOR', 'TABLE_JOIN_NEEDS_COLUMN', 'TABLE_JOIN_TYPE', 'TABLE_JOINED_TWICE', 'TABLE_NOT_JOINED', 'RULE_MISSED', 'RULE_WRONG_WINDOW', 'RULE_NOISY', 'RULE_MISSED_AND_NOISY', 'RULE_KEY_SHAPE']) { assert.equal(MESSAGES[code].length, 2, code); assert.ok(MESSAGES[code][1].length > 20, code); }
});

test('R4 grading by must-fire and must-not-fire: the authored key is detected in a window covering the minute, the must-not-fire key stays quiet, and the false-positive count is read, not scored; should-fail: a rule that fires on the must-not-fire case', () => {
  const cases = { mustFire: { key: ['ana'], at: new Date((T + 70) * 1000).toISOString().slice(11, 16) }, mustNotFire: { key: ['bo'] } };
  const good = runRule(BURST, events, null, ctx);
  assert.equal(good.ok, true);
  const g = gradeRuleCases(good.result, cases, ctx.window);
  assert.equal(g.correct, true); assert.equal(g.reason, 'RULE_FIRES'); assert.equal(g.detections, 1); assert.equal(g.falsePositives, 0);
  // loosened to one failure: fires on ana and on bo (and dee): noisy, with false positives counted
  const loose = runRule(BURST.replace('$failures >= 3', '$failures >= 1'), events, null, ctx).result;
  const n = gradeRuleCases(loose, cases, ctx.window);
  assert.equal(n.correct, false); assert.equal(n.reason, 'RULE_NOISY'); assert.ok(n.falsePositives >= 2);
  // too tight: misses the must-fire case
  const tight = runRule(BURST.replace('$failures >= 3', '$failures >= 5'), events, null, ctx).result;
  assert.equal(gradeRuleCases(tight, cases, ctx.window).reason, 'RULE_MISSED');
  // right key, wrong minute: the detection exists but not where the test case says
  assert.equal(gradeRuleCases(good.result, { ...cases, mustFire: { key: ['ana'], at: new Date((T + 6000) * 1000).toISOString().slice(11, 16) } }, ctx.window).reason, 'RULE_WRONG_WINDOW');
  // a different key shape
  assert.equal(gradeRuleCases(good.result, { mustFire: { key: ['ana', 'PC-1'], at: cases.mustFire.at } }, ctx.window).reason, 'RULE_KEY_SHAPE');
  // through gradeQuery on a rule mission: correct earns the query points, a loosened rule earns none with the reason
  const mission = { id: 'T', kind: 'build', mode: 'rule', reference: BURST, rule: cases };
  assert.equal(gradeQuery(BURST, mission, events, null, ctx).points, 60);
  const bad = gradeQuery(BURST.replace('$failures >= 3', '$failures >= 1'), mission, events, null, ctx);
  assert.equal(bad.status, 'incorrect'); assert.equal(bad.comparison.reason, 'RULE_NOISY');
  assert.equal(gradeQuery('metadata.event_type = "USER_LOGIN"', mission, events, null, ctx).code, 'RULE_NEEDS_ENVELOPE');
  assert.equal(clockToSeconds('00:01', { start: 86400 - 600, end: 86400 + 600 }), 86460);
  assert.equal(clockToSeconds('12:00', { start: 0, end: 600 }), null);
});
