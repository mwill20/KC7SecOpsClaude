import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root, loadContent, loadData, loadDatasets, validate, deriveAnswer, validateLogIt, validateLists, validateTables, validateEntities, entityRecords, entitiesFor, ctxFor, digestOf, DENSITY } from '../../tools/lib.mjs';
import { runQuery, compareResults, gradeQuery, gradeAnswer, gradeCall } from '../../site/engine/grader.js';
import { MESSAGES, describe } from '../../site/ui/messages.js';

const content = loadContent(); const data = loadData(); const datasets = loadDatasets(content); const data2 = datasets['week-after'];
const missions = content.chapters.flatMap(c => c.missions);

test('C1 every mission validates: references run, answers match the data, starters do not already pass', () => {
  assert.deepEqual(validate(content, datasets), []);
});

test('C1 should-fail: an authored answer that drifts from the data is caught', () => {
  const bad = JSON.parse(JSON.stringify(content));
  bad.chapters[0].missions[1].answer.value = '41';   // C01-M01; missions[0] is now the read mission on note-keeping
  assert.ok(validate(bad, datasets).some(p => p.includes('C01-M01') && p.includes('data says "40"')));
});

test('C2 the capstone story holds: the burst, the first success and the big upload are where the chapters say', () => {
  const burst = runQuery('metadata.event_type = "USER_LOGIN"\nsecurity_result.action = "FAIL"\n$u = principal.user.userid\nmatch:\n  $u by 5m\noutcome:\n  $f = count(metadata.id)\ncondition:\n  $f > 3', data.events).result;
  assert.equal(burst.rows.length, 1); assert.equal(burst.rows[0]['principal.user.userid'], 'pledge-desk'); assert.equal(burst.rows[0].$f, 7);
  assert.equal(deriveAnswer(missions.find(m => m.id === 'C06-M03'), data.events), '19:21');
  const big = runQuery('network.sent_bytes > 10000000', data.events).result;
  assert.equal(big.count, 1); assert.equal(big.rows[0]['target.ip'], '203.0.113.44');
  // the red herring stays a red herring: Marco never succeeds
  assert.equal(runQuery('principal.user.userid = "marco.vela"\nsecurity_result.action = "ALLOW"', data.events).result.count, 0);
});

test('C3 grading a build mission: a differently written correct query passes; a plausible wrong one fails with a reason', () => {
  const m = missions.find(x => x.id === 'C01-M04');
  const alt = 'security_result.action = "FAIL" AND metadata.event_type = "USER_LOGIN"\n$who = principal.user.userid\nmatch:\n  $who\noutcome:\n  $n = count(metadata.id)\norder:\n  $n desc';
  assert.equal(gradeQuery(alt, m, data.events).status, 'correct');
  const wrong = gradeQuery('metadata.event_type = "USER_LOGIN"\nmatch:\n  principal.user.userid\noutcome:\n  $n = count(metadata.id)\norder:\n  $n desc', m, data.events);
  assert.equal(wrong.status, 'incorrect'); assert.equal(wrong.comparison.reason, 'DIFFERENT_STATS');
  assert.equal(gradeQuery(m.starter, m, data.events).status, 'invalid');
  assert.equal(gradeQuery('', m, data.events).points, 0);
});

test('C3 answers and calls: right earns points, wrong earns zero, whitespace and case do not matter', () => {
  const m = missions.find(x => x.id === 'C02-M03');
  assert.equal(gradeAnswer(' pledge-desk-02 ', m).points, 25);
  assert.equal(gradeAnswer('PLEDGE-DESK-01', m).points, 0);
  assert.equal(gradeAnswer('', m).points, 0);
  assert.equal(gradeCall(m.call.correct, m).points, 15);
  assert.equal(gradeCall('Z', m).points, 0);
  const cap = missions.find(x => x.id === 'C06-M03');
  assert.equal(gradeAnswer('19:21:04', cap).correct, true);
});

test('C4 every diagnostic code the engine can raise has a plain-language message', () => {
  const src = ['site/engine/parser.js', 'site/engine/safety.js', 'site/engine/grader.js'].map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
  const codes = new Set([...src.matchAll(/(?:invalid|unsupported|fail)\('([A-Z_]+)'/g)].map(m => m[1]));
  for (const c of [...src.matchAll(/return '([A-Z_]+)'/g)]) codes.add(c[1]);
  for (const c of [...src.matchAll(/reason: '([A-Z_]+)'/g)]) codes.add(c[1]);
  const missing = [...codes].filter(c => !MESSAGES[c]);
  assert.deepEqual(missing, []);
  assert.ok(codes.size > 50);
});

test('C5 the dataset is fictional by construction: documentation IP ranges and .example domains only', () => {
  const text = JSON.stringify(data.events);
  const ips = new Set(text.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g));
  for (const ip of ips) assert.ok(/^(10\.9\.4\.|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)/.test(ip), 'unexpected ip ' + ip); // the station's own LAN and the documentation ranges only
  const domains = new Set(text.match(/[a-z0-9.-]+\.(?:com|org|net|io|example)\b/g));
  for (const d of domains) assert.ok(d.endsWith('.example'), 'unexpected domain ' + d);
  assert.equal(data.events.length, 1010);
});

test('C6 feedback text names the one-sided case and lists example IDs without echoing anything typed', () => {
  const m = missions.find(x => x.id === 'C01-M05');
  const g = gradeQuery('metadata.event_type = "USER_LOGIN"\nprincipal.user.userid = "pledge-desk"\nsecurity_result.action = "FAIL" // NOTE-FROM-LEARNER', m, data.events);
  const d = describe(g.comparison.reason, g.comparison);
  assert.match(d.title, /misses events/);
  assert.match(d.fix, /too narrow/);
  assert.match(d.examples, /"evt-00094", "evt-00127", "evt-00128"/);
  assert.match(d.examples, /metadata\.id = "evt-00094"/);
  assert.ok(!d.fix.includes('NOTE-FROM-LEARNER'));
  const stats = missions.find(x => x.id === 'C01-M03');
  const g2 = gradeQuery(stats.reference.replace('count_distinct', 'count'), stats, data.events);
  assert.match(describe(g2.comparison.reason, g2.comparison).title, /Same rows, different numbers/);
  // should-fail: a two-sided difference keeps the general title, and a code with no detail carries no examples
  const g3 = gradeQuery('metadata.event_type = "USER_LOGIN"\nprincipal.user.userid = "marco.vela"', m, data.events);
  assert.equal(describe(g3.comparison.reason, g3.comparison).title, MESSAGES.DIFFERENT_EVENTS[0]);
  assert.equal(describe('DIFFERENT_EVENTS', null).examples, '');
  assert.equal(describe('STARTER_GAP', 3).title, MESSAGES.STARTER_GAP[0]);
});

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const leaks = (prompt, value) => {
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const forms = [value]; if (/^\d+$/.test(value) && Number(value) <= 20) forms.push(NUMBER_WORDS[Number(value)]);
  return forms.some(f => new RegExp(`(^|[^\\w.:$-])${esc(f)}(?=$|[^\\w.:-])`, 'i').test(prompt));
};
test('C7 analyst calls cannot be guessed from length or position, and call prompts do not restate the answer', () => {
  const longest = missions.filter(m => { const lens = m.call.options.map(o => o.label.length); return lens[m.call.options.findIndex(o => o.id === m.call.correct)] === Math.max(...lens); });
  assert.ok(longest.length <= missions.length * 0.4, `longest option is correct in ${longest.map(m => m.id).join(', ')}`);
  const byPos = { A: 0, B: 0, C: 0 }; for (const m of missions) byPos[m.call.correct]++;
  for (const [pos, n] of Object.entries(byPos)) assert.ok(n >= 6, `position ${pos} is correct only ${n} times`);
  for (const m of missions) {
    const lens = m.call.options.map(o => o.label.length);
    assert.ok(Math.max(...lens) <= 1.6 * Math.min(...lens), `${m.id}: option lengths ${lens.join('/')} give the answer away`);
    if (m.answer) assert.ok(!leaks(m.call.prompt, m.answer.value), `${m.id}: call prompt restates the answer "${m.answer.value}"`);
  }
  // should-fail: the checks bite on a course whose correct option is always the longest, and on a prompt that leaks
  const bad = JSON.parse(JSON.stringify(missions));
  for (const m of bad) m.call.options.find(o => o.id === m.call.correct).label += ' and that is the whole story, in detail';
  assert.ok(bad.filter(m => { const lens = m.call.options.map(o => o.label.length); return lens[m.call.options.findIndex(o => o.id === m.call.correct)] === Math.max(...lens); }).length > missions.length * 0.4);
  assert.ok(leaks('Fourteen failures across the night. Which?', '14'));
  assert.ok(leaks('pledge-desk has 7 failures', 'pledge-desk'));
  assert.ok(!leaks('The time is 19:21:04', '21'));
});

test('C8 every chapter carries a recap for its chapter-end card, and the validator refuses one without', () => {
  for (const ch of content.chapters) assert.ok(ch.recap.length >= 3 && ch.recap.length <= 6, ch.id);
  const bad = JSON.parse(JSON.stringify(content)); delete bad.chapters[2].recap;
  assert.ok(validate(bad, datasets).some(p => p.includes('C03') && p.includes('recap')));
});

test('C9 every mission but the notes mission carries a Log it block the validator accepts; the validator refuses a bad one', () => {
  const withLogIt = missions.filter(m => m.logIt);
  assert.equal(withLogIt.length, 100);
  assert.equal(missions.length, 101);
  assert.equal(missions.find(m => m.id === 'C01-M00').logIt, undefined);
  assert.equal(missions[0].id, 'C01-M00');
  const kinds = new Set(withLogIt.map(m => m.logIt.kind));
  for (const k of ['scope', 'evidence', 'timeline', 'hypothesis', 'pivot', 'gap', 'determination', 'remediation', 'handoff']) assert.ok(kinds.has(k), 'some mission asks for ' + k);
  // the story anchors the task named
  const by = id => missions.find(m => m.id === id).logIt;
  assert.equal(by('C01-M05').kind, 'evidence'); assert.ok(by('C01-M05').mustInclude.includes('198.51.100.23') && by('C01-M05').mustInclude.some(t => t.startsWith('19:05')));
  assert.equal(by('C03-M03').kind, 'remediation'); assert.equal(by('C03-M03').list, 'eradicate'); assert.ok(by('C03-M03').mustInclude.includes('PledgeSync'));
  assert.equal(by('C04-M04').kind, 'remediation'); assert.equal(by('C04-M04').list, 'contain'); assert.ok(by('C04-M04').mustInclude.includes('203.0.113.0/24'));
  assert.equal(by('C06-M03').kind, 'determination'); assert.equal(by('C06-M04').kind, 'handoff');
  assert.equal(missions.find(m => m.id === 'C06-M04').brief, 'casebook');
  const eventIds = new Set(data.events.map(e => e['metadata.id']));
  // should-fail: kind outside the enum, empty prompt, empty mustInclude, a record ID that is not in the dataset, a list on a non-remediation kind
  assert.ok(validateLogIt({ kind: 'note', prompt: 'write something useful here', mustInclude: ['x'] }, 'T', eventIds).some(p => p.includes('logIt.kind')));
  assert.ok(validateLogIt({ kind: 'evidence', prompt: '', mustInclude: ['x'] }, 'T', eventIds).some(p => p.includes('prompt')));
  assert.ok(validateLogIt({ kind: 'evidence', prompt: 'write something useful here', mustInclude: [] }, 'T', eventIds).some(p => p.includes('mustInclude')));
  assert.ok(validateLogIt({ kind: 'evidence', prompt: 'write something useful here', mustInclude: ['evt-00001|evt-99999'] }, 'T', eventIds).some(p => p.includes('evt-99999')));
  assert.ok(validateLogIt({ kind: 'gap', prompt: 'write something useful here', mustInclude: ['x'], list: 'contain' }, 'T', eventIds).some(p => p.includes('logIt.list')));
  assert.deepEqual(validateLogIt({ kind: 'remediation', prompt: 'write something useful here', mustInclude: ['evt-00001'], list: 'harden' }, 'T', eventIds), []);
  const bad = JSON.parse(JSON.stringify(content)); bad.chapters[0].missions[1].logIt.mustInclude = ['evt-99999'];
  assert.ok(validate(bad, datasets).some(p => p.includes('C01-M01') && p.includes('evt-99999')));
  // should-fail (session 5): a record that exists but is not among the mission's reference rows is a drifted id. C01-M01
  // asks for USER_LOGIN events; evt-00140 is a process launch. On a read mission existence is still enough.
  const drift = JSON.parse(JSON.stringify(content)); drift.chapters[0].missions[1].logIt.mustInclude = ['evt-00140'];
  assert.ok(validate(drift, datasets).some(p => p.includes('C01-M01') && p.includes('evt-00140') && p.includes('does not return')));
  const readOk = JSON.parse(JSON.stringify(content)); const rd = readOk.chapters[5].missions.find(m => m.id === 'C06-M07'); rd.logIt.mustInclude = ['evt-00140'];
  assert.ok(!validate(readOk, datasets).some(p => p.includes('C06-M07')));
  // and the two ids session 5 corrected are now among their reference rows
  assert.deepEqual(by('C03-M03').mustInclude, ['PledgeSync', 'evt-00141']);
  assert.deepEqual(by('C08-M01').mustInclude, ['harborlight-sponsors.example', 'evt-20135']);
  assert.equal(data2.events.find(e => e['metadata.id'] === 'evt-20135')['metadata.event_type'], 'NETWORK_DNS');
  const noBrief = JSON.parse(JSON.stringify(content)); const hand = noBrief.chapters[5].missions.find(m => m.id === 'C06-M04'); hand.explain = hand.explain.filter(e => e.part !== 'Handoff');
  assert.ok(validate(noBrief, datasets).some(p => p.includes('C06-M04') && p.includes('brief')));
});

test('C10 chapter density: 7 to 8 desk missions per chapter and two Your-turn missions after chapter 1; the validator refuses a thin chapter', () => {
  assert.deepEqual(DENSITY, { min: 7, maxDesk: 8, solo: 2, soloFirst: 1 });
  for (const [i, ch] of content.chapters.entries()) {
    assert.ok(ch.missions.length >= 7, `${ch.id} has ${ch.missions.length} missions`);
    assert.ok(ch.missions.filter(m => m.kind !== 'read').length <= 8, `${ch.id} desk missions`);
    assert.ok(ch.missions.filter(m => m.kind === 'solo').length >= (i === 0 ? 1 : 2), `${ch.id} Your-turn missions`);
  }
  assert.equal(missions.length, 101);
  // every mission the density pass added carries the full schema
  const NEW = missions.filter(m => Number(m.id.slice(1, 3)) <= 6 && Number(m.id.slice(-2)) >= (m.id.startsWith('C01') ? 7 : m.id.startsWith('C06') ? 5 : m.id.startsWith('C05') ? 4 : 5));
  assert.equal(NEW.length, 23);
  for (const m of NEW) {
    for (const k of ['kind', 'beat', 'question', 'concept', 'explain', 'starter', 'reference', 'hints', 'answer', 'call', 'clue', 'caveat', 'logIt']) assert.ok(Object.hasOwn(m, k), `${m.id} lacks ${k}`);
    if (m.kind !== 'read') { assert.equal(m.hints.length, 3, m.id); assert.ok(m.answer?.check?.type, m.id); }
    assert.ok(m.call.why.length > 20, m.id);
  }
  // the min/max mission reads its answer as a clock time from a timestamp cell
  assert.equal(deriveAnswer(missions.find(m => m.id === 'C05-M04'), data.events), '19:40');
  // should-fail: too few missions, too many desk missions, too few Your-turn missions
  const thin = JSON.parse(JSON.stringify(content)); thin.chapters[4].missions.splice(0, 1);
  assert.ok(validate(thin, datasets).some(p => p.includes('C05') && p.includes('needs at least 7')));
  const fat = JSON.parse(JSON.stringify(content)); const extra = JSON.parse(JSON.stringify(fat.chapters[1].missions[1])); extra.id = 'C02-M99'; fat.chapters[1].missions.push(extra);
  assert.ok(validate(fat, datasets).some(p => p.includes('C02') && p.includes('at most 8')));
  const noSolo = JSON.parse(JSON.stringify(content)); for (const m of noSolo.chapters[2].missions) if (m.kind === 'solo') { m.kind = 'build'; m.starter = m.reference.replace('PROCESS_LAUNCH', '___'); }
  assert.ok(validate(noSolo, datasets).some(p => p.includes('C03') && p.includes('Your-turn')));
  // chapter 1 is allowed a single Your-turn mission
  const oneSolo = JSON.parse(JSON.stringify(content)); const s = oneSolo.chapters[0].missions.find(m => m.id === 'C01-M09'); s.kind = 'build'; s.starter = s.reference.replace('USER_LOGIN', '___');
  assert.ok(!validate(oneSolo, datasets).some(p => p.includes('C01') && p.includes('Your-turn')));
});

test('C11 the bundled reference lists validate and resolve from a query; should-fail: unknown type, bad CIDR, a regex that fails the guard, duplicate names, missing description', () => {
  assert.deepEqual(validateLists(content.lists), []);
  assert.ok(content.lists.lists.length >= 3);
  for (const t of ['string', 'cidr', 'regex']) assert.ok(content.lists.lists.some(l => l.type === t), 'a list of type ' + t);
  const ctx = ctxFor(content);
  const r = runQuery('target.ip in cidr %blocked_ranges', data.events, null, ctx);
  assert.equal(r.ok, true); assert.ok(r.result.count > 0);
  assert.equal(runQuery('target.ip in cidr %no_such_list', data.events, null, ctx).code, 'UNKNOWN_LIST');
  const bad = l => validateLists({ lists: [{ name: 'x', type: 'string', description: 'a dozen characters', items: ['a'], ...l }] });
  assert.ok(bad({ type: 'set' }).some(p => p.includes('type')));
  assert.ok(bad({ type: 'cidr', items: ['203.0.113.0/40'] }).some(p => p.includes('not a CIDR')));
  assert.ok(bad({ type: 'regex', items: ['(a+)+$'] }).some(p => p.includes('regex guard')));
  assert.ok(bad({ description: 'short' }).some(p => p.includes('description')));
  assert.ok(bad({ items: [] }).some(p => p.includes('items')));
  assert.ok(bad({ items: ['a', 'a'] }).some(p => p.includes('duplicate items')));
  assert.ok(bad({ name: '9lives' }).some(p => p.includes('bad name')));
  assert.ok(validateLists({ lists: [{ name: 'x', type: 'string', description: 'a dozen characters', items: ['a'] }, { name: 'x', type: 'string', description: 'a dozen characters', items: ['b'] }] }).some(p => p.includes('duplicate name')));
  // every new engine code reads as two plain-language parts
  for (const code of ['TIMEZONE_UNSUPPORTED', 'UNKNOWN_LIST', 'LIST_TYPE_MISMATCH', 'DEDUP_KEY_NOT_GROUPED', 'TIME_AGGREGATE_NEEDS_TIMESTAMP', 'CONDITION_ON_ARRAY', 'ORDER_ON_ARRAY', 'STRING_FN_NEEDS_STRING', 'CONCAT_NEEDS_ARGS', 'TOO_MANY_LISTS', 'TOO_MANY_REGEX_LISTS', 'TOO_MANY_CIDR_LISTS', 'UNKNOWN_TABLE', 'UNKNOWN_TABLE_COLUMN', 'LIST_AS_VALUE', 'UNJOINED_VARIABLE', 'BARE_FIELD_IN_JOIN', 'MATCH_KEY_NOT_SHARED', 'OUTCOME_NEEDS_VARIABLE', 'NON_EXISTENCE', 'TOO_MANY_EVENT_VARS', 'OVER_NEEDS_KEY', 'UNKNOWN_EVENT_VAR', 'MULTI_EVENT_NEEDS_MATCH']) { assert.equal(MESSAGES[code].length, 2, code); assert.ok(MESSAGES[code][1].length > 20, code); }
  assert.match(describe('TIMEZONE_UNSUPPORTED', { zone: 'America/Los_Angeles' }).title, /\(America\/Los_Angeles\)/);
  assert.match(describe('TIMEZONE_UNSUPPORTED', {}).fix, /UTC/);
});

test('C12 two cases: case 1 events are byte-identical to the density branch (digest proven by the validator), case 2 is fictional and inside its window, chapters 7 and 8 validate against it, and every case fills a casebook from Scope to Handoff', () => {
  assert.deepEqual(content.cases.map(c => c.id), ['pier-nine', 'week-after', 'saltmarsh']);
  assert.deepEqual(content.cases.map(c => c.chapters), [['C01', 'C02', 'C03', 'C04', 'C05', 'C06'], ['C07', 'C08', 'C09', 'C10', 'C11'], ['C12']]);
  // the first case's events: the digest recorded on the density branch, so a regenerated dataset is caught even if case.json is edited
  assert.equal(digestOf(data.events), 'a2ddb67f4a6b39a48a4023871eeb3096c70178009ce1986109444682dc9a09fd');
  assert.equal(data.events.length, 1010); assert.equal(content.cases[0].digest, digestOf(data.events));
  assert.equal(content.cases[1].digest, digestOf(data2.events));
  // should-fail: one moved event in either case is named by the validator
  const moved = JSON.parse(JSON.stringify(datasets)); moved['pier-nine'].events[5]['metadata.event_timestamp.seconds'] += 1;
  assert.ok(validate(content, moved).some(p => p.includes('case pier-nine') && p.includes('events changed')));
  const moved2 = JSON.parse(JSON.stringify(datasets)); moved2['week-after'].events[0]['principal.ip'] = '10.9.4.99';
  assert.ok(validate(content, moved2).some(p => p.includes('case week-after') && p.includes('events changed')));
  // case 2 is fictional, inside its window, with its own id range
  const text = JSON.stringify(data2.events);
  for (const ip of new Set(text.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g))) assert.ok(/^(10\.9\.4\.|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)/.test(ip), 'unexpected ip ' + ip);
  for (const d of new Set(text.match(/[a-z0-9.-]+\.(?:com|org|net|io|example)\b/g))) assert.ok(d.endsWith('.example'), 'unexpected domain ' + d);
  assert.equal(data2.window.start, Date.parse('2026-03-20T18:00:00Z') / 1000);
  assert.ok(data2.events.every(e => e['metadata.event_timestamp.seconds'] >= data2.window.start && e['metadata.event_timestamp.seconds'] <= data2.window.end));
  assert.ok(data2.events.every(e => /^evt-2\d{4}$/.test(e['metadata.id'])));
  const ids1 = new Set(data.events.map(e => e['metadata.id'])); assert.ok(data2.events.every(e => !ids1.has(e['metadata.id'])), 'no id overlap between cases');
  // the second story holds: the fix held for what it covered, and the return went around it
  const ctx = ctxFor(content);
  assert.equal(runQuery('principal.user.userid = "pledge-desk"\nsecurity_result.action = "ALLOW"', data2.events, null, ctx).result.count, 0, 'the reset held');
  assert.equal(runQuery('principal.hostname = "AUTOMATION-01"\nnetwork.dns.questions.name != "streaming.tunecast.example"\nmetadata.event_type = "NETWORK_DNS"', data2.events, null, ctx).result.count, 0, 'no PledgeSync lookups');
  const blocked = runQuery('target.ip in cidr %blocked_ranges', data2.events, null, ctx).result; assert.equal(blocked.count, 1); assert.equal(blocked.rows[0]['security_result.action'], 'BLOCK');
  assert.equal(runQuery('metadata.event_type = "USER_LOGIN"\ntarget.hostname = "VPN-GW-01"\nsecurity_result.action = "ALLOW"\nprincipal.user.userid = "lena.ostrowski"', data2.events, null, ctx).result.count, 2);
  assert.equal(runQuery('network.sent_bytes > 1000000', data2.events, null, ctx).result.rows[0]['target.ip'], '198.51.100.77');
  assert.equal(runQuery('metadata.event_type = "EMAIL_TRANSACTION"\nnetwork.email.from in regex %lookalike_patterns', data2.events, null, ctx).result.count, 3);
  assert.ok(content.lists.lists.find(l => l.name === 'sponsor_domains').items.includes('pier9-partners.example'), 'the allowlist is too wide on purpose');
  // chapters 7 to 11: forty-two missions, every answer proven against case 2 data; chapter 10 ends with the Monday brief and chapter 11 with the detection brief
  const c2 = missions.filter(m => /^C(07|08|09|10|11)/.test(m.id));
  assert.equal(c2.length, 42);
  assert.deepEqual(c2.map(m => m.kind), ['read', 'watch', 'build', 'build', 'watch', 'solo', 'solo', 'build', 'read', 'watch', 'build', 'build', 'watch', 'solo', 'solo', 'read', 'read', 'read', 'watch', 'build', 'build', 'solo', 'build', 'solo', 'watch', 'read', 'watch', 'build', 'build', 'solo', 'build', 'solo', 'read', 'read', 'watch', 'build', 'build', 'build', 'solo', 'solo', 'watch', 'read']);
  // chapter 9 joins: every desk mission names two event variables; chapter 10 reads the directory alone or joins an event to it
  for (const m of c2.filter(m => m.id.startsWith('C09') && m.kind !== 'read')) assert.match(m.reference, /\$e1\..*\$e2\./s, m.id);
  for (const m of c2.filter(m => m.id.startsWith('C10') && m.kind !== 'read')) assert.match(m.reference, /graph\./, m.id);
  assert.equal(missions.find(m => m.id === 'C08-M08').brief, undefined);
  assert.equal(missions.find(m => m.id === 'C10-M04').logIt.list, 'harden'); assert.ok(missions.find(m => m.id === 'C10-M04').logIt.mustInclude.includes('kenji.mori'), 'the Remediation entry names an owner');
  assert.equal(deriveAnswer(missions.find(m => m.id === 'C09-M08'), data2.events, ctxFor(content, 'week-after')), '7');
  assert.equal(deriveAnswer(missions.find(m => m.id === 'C10-M04'), data2.events, ctxFor(content, 'week-after')), '23:50');
  // the two appended records are the last two ids and every chapter 7 and 8 record id cited before them is unchanged
  assert.deepEqual(data2.events.slice(-2).map(e => [e['metadata.id'], e['principal.user.userid'], e['security_result.summary']]), [['evt-20972', 'marco.vela', 'Account disabled'], ['evt-20973', 'marco.vela', 'Account disabled']]);
  assert.equal(data2.events.find(e => e['metadata.id'] === 'evt-20796')['target.user.userid'], 'svc-playout');
  // chapter 8 teaches data tables as the current object: three missions name a %table.column, one the legacy %list, and the Read on the migration carries the date
  assert.deepEqual(c2.filter(m => /%[a-z_]+\.[a-z_]+/.test(m.reference ?? '')).map(m => m.id), ['C08-M02', 'C08-M03', 'C08-M04', 'C09-M04', 'C11-M06', 'C11-M07']);
  assert.deepEqual(c2.filter(m => /%[a-z_]+\b(?!\.)/.test(m.reference ?? '')).map(m => m.id), ['C08-M01']);
  assert.ok(missions.find(m => m.id === 'C08-M00').concept.text.includes('July 2027'));
  assert.equal(missions.find(m => m.id === 'C08-M00').logIt.kind, 'remediation');
  assert.equal(deriveAnswer(missions.find(m => m.id === 'C07-M03'), data2.events, ctx), '10.9.4.21, 198.51.100.77, 10.9.4.200');
  assert.equal(deriveAnswer(missions.find(m => m.id === 'C07-M04'), data2.events, ctx), '19:12');
  assert.equal(deriveAnswer(missions.find(m => m.id === 'C08-M04'), data2.events, ctx), 'BLOCK');
  for (const m of c2) for (const k of ['kind', 'beat', 'question', 'concept', 'explain', 'starter', 'reference', 'hints', 'answer', 'call', 'clue', 'caveat', 'logIt']) assert.ok(Object.hasOwn(m, k), `${m.id} lacks ${k}`);
  assert.equal(missions.find(m => m.id === 'C10-M08').brief, 'casebook');
  for (const c of content.cases) {
    const ms = content.chapters.filter(ch => c.chapters.includes(ch.id)).flatMap(ch => ch.missions);
    const kinds = new Set(ms.map(m => m.logIt?.kind).filter(Boolean));
    for (const k of ['scope', 'evidence', 'timeline', 'hypothesis', 'pivot', 'gap', 'determination', 'remediation', 'handoff']) assert.ok(kinds.has(k), `${c.id} asks for ${k}`);
    assert.ok(ms.findIndex(m => m.logIt?.kind === 'scope') <= 1, `${c.id} opens with the Scope`);
    assert.equal(ms.at(-1).brief, 'casebook', `${c.id} ends with the brief`);
  }
  // should-fail: a case whose last mission is not a brief, a case missing a logIt kind, a case with a bad window, a scope asked for late
  const noBrief = JSON.parse(JSON.stringify(content)); delete noBrief.chapters[10].missions.at(-1).brief;
  assert.ok(validate(noBrief, datasets).some(p => p.includes('case week-after') && p.includes('brief')));
  const noGap = JSON.parse(JSON.stringify(content)); for (const ch of noGap.chapters.slice(6, 11)) for (const m of ch.missions) if (m.logIt?.kind === 'gap') m.logIt.kind = 'pivot';
  assert.ok(validate(noGap, datasets).some(p => p.includes('case week-after') && p.includes('gap')));
  const badWindow = JSON.parse(JSON.stringify(content)); badWindow.cases[1].window.end = '2026-03-21T05:00:00Z';
  assert.ok(validate(badWindow, datasets).some(p => p.includes('case week-after') && p.includes('window')));
  const lateScope = JSON.parse(JSON.stringify(content)); const sc = lateScope.chapters[6].missions[0].logIt; lateScope.chapters[6].missions[0].logIt = lateScope.chapters[6].missions[3].logIt; lateScope.chapters[6].missions[3].logIt = sc;
  assert.ok(validate(lateScope, datasets).some(p => p.includes('Scope')));
  // the single-dataset shape earlier branches passed still validates the first case and names the missing second
  assert.ok(validate(content, data).some(p => p.includes('case week-after') && p.includes('no dataset')));
});

test('C15 rule missions validate against their own test cases; should-fail: a reference that fires on the must-not-fire key, a must-fire minute the reference does not cover, test cases on a Search mission, a missing case, a key count that does not match', () => {
  const rules = missions.filter(m => m.mode === 'rule');
  assert.deepEqual(rules.map(m => m.id), ['C11-M02', 'C11-M03', 'C11-M04', 'C11-M05', 'C11-M06', 'C11-M07', 'C11-M08', 'C12-M08']);
  for (const m of rules) { assert.ok(m.rule.mustFire.key.length >= 1 && /^\d{2}:\d{2}$/.test(m.rule.mustFire.at), m.id); assert.ok(m.rule.mustNotFire.key.length >= 1, m.id); assert.match(m.reference, /^rule [a-z_]+ \{/, m.id); }
  const noisy = JSON.parse(JSON.stringify(content)); noisy.chapters[10].missions.find(m => m.id === 'C11-M02').rule.mustNotFire.key = ['marco.vela'];
  assert.ok(validate(noisy, datasets).some(p => p.includes('C11-M02') && p.includes('RULE_NOISY')));
  const late = JSON.parse(JSON.stringify(content)); late.chapters[10].missions.find(m => m.id === 'C11-M02').rule.mustFire.at = '23:50';
  assert.ok(validate(late, datasets).some(p => p.includes('C11-M02') && p.includes('RULE_WRONG_WINDOW')));
  const missed = JSON.parse(JSON.stringify(content)); missed.chapters[10].missions.find(m => m.id === 'C11-M02').rule.mustFire.key = ['hal.brunner'];
  assert.ok(validate(missed, datasets).some(p => p.includes('C11-M02') && p.includes('RULE_MISSED')));
  const onSearch = JSON.parse(JSON.stringify(content)); onSearch.chapters[0].missions[1].rule = { mustFire: { key: ['x'], at: '19:00' }, mustNotFire: { key: ['y'] } };
  assert.ok(validate(onSearch, datasets).some(p => p.includes('C01-M01') && p.includes('rule test cases belong')));
  const noCases = JSON.parse(JSON.stringify(content)); delete noCases.chapters[10].missions.find(m => m.id === 'C11-M03').rule;
  assert.ok(validate(noCases, datasets).some(p => p.includes('C11-M03') && p.includes('mustFire')));
  const twoKeys = JSON.parse(JSON.stringify(content)); twoKeys.chapters[10].missions.find(m => m.id === 'C11-M03').rule.mustFire.key = ['lena.ostrowski', 'FS-01']; twoKeys.chapters[10].missions.find(m => m.id === 'C11-M03').rule.mustNotFire.key = ['dez.okafor', 'FS-01'];
  assert.ok(validate(twoKeys, datasets).some(p => p.includes('C11-M03') && p.includes('keys')));
  // a Build rule starter whose gap is filled wrongly is not a passing answer, and the hint 3 rule is
  const badHint = JSON.parse(JSON.stringify(content)); const m3 = badHint.chapters[10].missions.find(m => m.id === 'C11-M03'); m3.hints[2] = m3.hints[2].replace('$e1 and $e2', '$e1');
  assert.ok(validate(badHint, datasets).some(p => p.includes('C11-M03') && p.includes('hint 3')));
  const passingStarter = JSON.parse(JSON.stringify(content)); const m4 = passingStarter.chapters[10].missions.find(m => m.id === 'C11-M04'); m4.starter = m4.reference;
  assert.ok(validate(passingStarter, datasets).some(p => p.includes('C11-M04') && p.includes('starter')));
});

test('C14 the third case: its own dataset (fictional, on its own LAN, inside its window, own id range, digest proven), its own directory, chapter 12 as the capstone (eight desk missions with no explain blocks, mostly Your turn, one in rule mode, a Determination and a Handoff brief last), the engineering bridge; should-fail: a bad bridge, a directory asset off its LAN, a moved event', () => {
  const c3 = content.cases[2]; const d3 = datasets.saltmarsh;
  assert.equal(c3.id, 'saltmarsh'); assert.equal(c3.entities, 'entities-saltmarsh.json'); assert.equal(c3.digest, digestOf(d3.events));
  assert.ok(d3.events.length >= 600 && d3.events.length <= 900, 'a smaller case: ' + d3.events.length);
  assert.equal(d3.window.end - d3.window.start, 10 * 3600);
  assert.ok(d3.events.every(e => e['metadata.event_timestamp.seconds'] >= d3.window.start && e['metadata.event_timestamp.seconds'] <= d3.window.end));
  assert.ok(d3.events.every(e => /^evt-3\d{4}$/.test(e['metadata.id'])));
  const text = JSON.stringify(d3.events);
  for (const ip of new Set(text.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g))) assert.ok(/^(10\.77\.3\.|192\.0\.2\.|198\.51\.100\.)/.test(ip), 'unexpected ip ' + ip);
  assert.ok(!text.includes('10.9.4.'), 'no station address in the co-operative\'s logs');
  for (const dm of new Set(text.match(/[a-z0-9.-]+\.(?:com|org|net|io|example)\b/g))) assert.ok(dm.endsWith('.example'), 'unexpected domain ' + dm);
  // a different shape: no phish, no credential reuse, a trojanised update, a task, a beacon, an archive, an upload
  const ctx3 = { ...ctxFor(content, 'saltmarsh'), window: d3.window };
  assert.equal(runQuery('metadata.event_type = "EMAIL_TRANSACTION"\ntarget.url != ""\nsecurity_result.action = "ALLOW"\nnetwork.email.from = /tidewatch/', d3.events, null, ctx3).result.count, 2, 'only the vendor advisory carries a link');
  assert.equal(runQuery('metadata.event_type = "USER_LOGIN"\nsecurity_result.action = "ALLOW"\nprincipal.user.userid = "svc-tidewatch"', d3.events, null, ctx3).result.count, 0, 'the service account never logs in');
  assert.equal(runQuery('metadata.event_type = "SCHEDULED_TASK_CREATION"', d3.events, null, ctx3).result.count, 3);
  assert.equal(runQuery('target.port = 8443\nmetadata.event_type = "NETWORK_CONNECTION"\nmatch:\n  principal.hostname\noutcome:\n  $n = count(metadata.id)', d3.events, null, ctx3).result.rows.length, 3);
  assert.equal(runQuery('network.sent_bytes > 1000000', d3.events, null, ctx3).result.rows[0]['target.ip'], '198.51.100.210');
  assert.equal(runQuery('principal.user.userid = "rafael.quinn"\ntimestamp.get_hour(metadata.event_timestamp, "UTC") >= 9', d3.events, null, ctx3).result.count, 0, 'the suspect is off the system before the update');
  // the directory is the co-operative\'s, on its LAN, and every account and host in the logs is in it
  const recs = ctx3.entities; assert.ok(recs.length > 0); assert.ok(recs.every(r => !r['graph.entity.asset.ip'] || r['graph.entity.asset.ip'].startsWith('10.77.3.')));
  assert.ok(!recs.some(r => r['graph.entity.user.userid'] === 'lena.ostrowski'));
  const dir = content.entitiesByCase.saltmarsh;
  for (const a of new Set(d3.events.map(e => e['principal.user.userid']).filter(Boolean))) assert.ok(dir.users.some(u => u.userid === a), 'user ' + a);
  for (const h of new Set(d3.events.map(e => e['principal.hostname']).filter(Boolean))) assert.ok(dir.assets.some(x => x.hostname === h), 'asset ' + h);
  assert.equal(ctxFor(content, 'week-after').entities.some(r => r['graph.entity.asset.hostname'] === 'DISPATCH-01'), false, 'the station does not see the co-operative\'s hosts');
  // chapter 12: ten missions, eight with a desk and none of them explained, six Your turn, one rule mission, then the Determination and the Handoff brief
  const c12 = missions.filter(m => m.id.startsWith('C12'));
  assert.equal(c12.length, 10);
  assert.deepEqual(c12.map(m => m.kind), ['solo', 'solo', 'solo', 'solo', 'build', 'solo', 'build', 'solo', 'read', 'read']);
  for (const m of c12.filter(m => m.kind !== 'read')) { assert.deepEqual(m.explain, [], m.id + ' has explain blocks'); assert.equal(m.hints.length, 3, m.id); }
  assert.equal(c12.filter(m => m.mode === 'rule').map(m => m.id).join(), 'C12-M08');
  assert.equal(c12[0].logIt.kind, 'scope'); assert.equal(c12[8].logIt.kind, 'determination'); assert.equal(c12[9].logIt.kind, 'handoff'); assert.equal(c12[9].brief, 'casebook');
  assert.equal(deriveAnswer(c12[7], d3.events, ctx3), '18');
  assert.equal(deriveAnswer(c12[4], d3.events, ctx3), '08:40');
  // the bridge
  assert.equal(c3.bridge.items.length, 4); assert.ok(c3.bridge.items.some(x => /acceptance/i.test(x.heading)));
  assert.equal(content.cases[0].bridge, undefined);
  // should-fail
  const badBridge = JSON.parse(JSON.stringify(content)); badBridge.cases[2].bridge.items = badBridge.cases[2].bridge.items.slice(0, 2);
  assert.ok(validate(badBridge, datasets).some(p => p.includes('case saltmarsh') && p.includes('bridge')));
  const offLan = JSON.parse(JSON.stringify(content)); offLan.entityFiles['entities-saltmarsh.json'].assets[0].ip = '10.9.4.20';
  assert.ok(validate(offLan, datasets).some(p => p.startsWith('entities-saltmarsh.json') && p.includes('LAN')));
  const badLan = JSON.parse(JSON.stringify(content)); badLan.entityFiles['entities-saltmarsh.json'].lan = '10.0.0.';
  assert.ok(validate(badLan, datasets).some(p => p.includes('lan must be')));
  const moved = JSON.parse(JSON.stringify(datasets)); moved.saltmarsh.events[3]['network.sent_bytes'] = 1;
  assert.ok(validate(content, moved).some(p => p.includes('case saltmarsh') && p.includes('events changed')));
  const noScope = JSON.parse(JSON.stringify(content)); noScope.chapters[11].missions[0].logIt.kind = 'evidence'; noScope.chapters[11].missions[0].logIt.mustInclude = ['evt-30157'];
  assert.ok(validate(noScope, datasets).some(p => p.includes('case saltmarsh') && p.includes('scope')));
});

test('C13 the bundled data tables and the station directory validate; should-fail: a bad column type, a short row, a CIDR cell that does not parse, a regex cell that fails the guard, a table named like a list, an unknown asset owner, overlapping versions, a real-looking address', () => {
  assert.deepEqual(validateTables(content.tables), []);
  assert.deepEqual(validateEntities(content.entities), []);
  const tb = t => validateTables({ tables: [{ name: 'x', description: 'a dozen characters', columns: [{ name: 'c', type: 'string' }], rows: [['a']], ...t }] });
  assert.ok(tb({ columns: [{ name: 'c', type: 'set' }] }).some(p => p.includes('columns')));
  assert.ok(tb({ columns: [{ name: 'c', type: 'string' }, { name: 'd', type: 'string' }] }).some(p => p.includes('rows')));
  assert.ok(tb({ columns: [{ name: 'c', type: 'cidr' }], rows: [['203.0.113.0/40']] }).some(p => p.includes('not a CIDR')));
  assert.ok(tb({ columns: [{ name: 'c', type: 'regex' }], rows: [['(a+)+$']] }).some(p => p.includes('regex guard')));
  assert.ok(tb({ columns: [{ name: 'c', type: 'string' }, { name: 'c', type: 'string' }], rows: [['a', 'b']] }).some(p => p.includes('duplicate column')));
  const shared = JSON.parse(JSON.stringify(content)); shared.tables.tables[0].name = 'sponsor_domains';
  assert.ok(validate(shared, datasets).some(p => p.includes('share a name')));
  // the directory: two versions of marco.vela, lena.ostrowski and STUDIO-B, and the case windows see the right one
  const recs = entityRecords(content.entities);
  assert.equal(recs.length, content.entities.users.length + content.entities.assets.length);
  assert.ok(recs.every(r => /^ent-\d{5}$/.test(r['metadata.id'])));
  const w1 = { start: Date.parse(content.cases[0].window.start) / 1000, end: Date.parse(content.cases[0].window.end) / 1000 };
  const w2 = { start: Date.parse(content.cases[1].window.start) / 1000, end: Date.parse(content.cases[1].window.end) / 1000 };
  const marco = w => entitiesFor(recs, w).filter(r => r['graph.entity.user.userid'] === 'marco.vela');
  assert.deepEqual(marco(w1).map(r => r['graph.entity.user.employment_status']), ['ACTIVE'], 'the directory lagged on pledge night');
  assert.deepEqual(marco(w2).map(r => r['graph.entity.user.employment_status']), ['TERMINATED']);
  assert.deepEqual(entitiesFor(recs, w2).filter(r => r['graph.entity.asset.hostname'] === 'STUDIO-B').map(r => r['graph.entity.asset.attribute.labels.owner']), ['kenji.mori']);
  assert.deepEqual(entitiesFor(recs, w1).filter(r => r['graph.entity.user.userid'] === 'lena.ostrowski').map(r => r['graph.entity.user.attribute.roles.name']), ['STAFF']);
  assert.deepEqual(entitiesFor(recs, w2).filter(r => r['graph.entity.user.userid'] === 'lena.ostrowski').map(r => r['graph.entity.user.attribute.roles.name']), ['MEMBERSHIP_SHARE_EDITOR']);
  assert.equal(ctxFor(content, 'week-after').entities.length, entitiesFor(recs, w2).length);
  // every event account and host the datasets carry is in the directory, so a join never silently drops a station name
  const accounts = new Set([...data.events, ...data2.events].map(e => e['principal.user.userid']).filter(Boolean));
  const hosts = new Set([...data.events, ...data2.events].map(e => e['principal.hostname']).filter(Boolean));
  for (const a of accounts) assert.ok(content.entities.users.some(u => u.userid === a), 'user ' + a);
  for (const h of hosts) assert.ok(content.entities.assets.some(x => x.hostname === h), 'asset ' + h);
  const en = patch => { const e = JSON.parse(JSON.stringify(content.entities)); patch(e); return validateEntities(e); };
  assert.ok(en(e => { e.assets[0].owner = 'nobody'; }).some(p => p.includes('not a user')));
  assert.ok(en(e => { e.assets[0].ip = '8.8.8.8'; }).some(p => p.includes('fictional station LAN')));
  assert.ok(en(e => { e.users.push({ ...e.users[0], valid_from: '2026-02-01T00:00:00Z' }); }).some(p => p.includes('versions overlap')));
  assert.ok(en(e => { e.users[0].employment_status = 'FIRED'; }).some(p => p.includes('employment_status')));
  assert.ok(en(e => { e.users[0].valid_to = e.users[0].valid_from; }).some(p => p.includes('valid_from and valid_to')));
  assert.ok(en(e => { e.assets[0].hostname = 'pc1'; }).some(p => p.includes('hostname')));
  // the running directory answers the week-after questions chapter 10 asks
  const ctx2 = ctxFor(content, 'week-after');
  const term = runQuery('$e.metadata.event_type = "USER_LOGIN"\n$e.principal.user.userid = $uid\n$u.graph.entity.user.userid = $uid\n$u.graph.entity.user.employment_status = "TERMINATED"\nmatch:\n  $uid\noutcome:\n  $n = count($e.metadata.id)', data2.events, null, ctx2);
  assert.equal(term.ok, true);
  assert.equal(runQuery('graph.metadata.entity_type = "ASSET"\ngraph.entity.asset.attribute.labels.criticality = "HIGH"', data2.events, null, ctx2).result.count, 4);
});
