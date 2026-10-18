import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root, loadContent, loadData, validate, deriveAnswer, validateLogIt } from '../../tools/lib.mjs';
import { runQuery, compareResults, gradeQuery, gradeAnswer, gradeCall } from '../../site/engine/grader.js';
import { MESSAGES, describe } from '../../site/ui/messages.js';

const content = loadContent(); const data = loadData();
const missions = content.chapters.flatMap(c => c.missions);

test('C1 every mission validates: references run, answers match the data, starters do not already pass', () => {
  assert.deepEqual(validate(content, data), []);
});

test('C1 should-fail: an authored answer that drifts from the data is caught', () => {
  const bad = JSON.parse(JSON.stringify(content));
  bad.chapters[0].missions[1].answer.value = '41';   // C01-M01; missions[0] is now the read mission on note-keeping
  assert.ok(validate(bad, data).some(p => p.includes('C01-M01') && p.includes('data says "40"')));
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
  for (const ip of ips) assert.ok(/^(10\.9\.4\.|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)/.test(ip), 'unexpected ip ' + ip);
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
  assert.ok(validate(bad, data).some(p => p.includes('C03') && p.includes('recap')));
});

test('C9 every original mission carries a Log it block the validator accepts; the new notes mission has none; the validator refuses a bad one', () => {
  const withLogIt = missions.filter(m => m.logIt);
  assert.equal(withLogIt.length, 25);
  assert.equal(missions.length, 26);
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
  assert.ok(validate(bad, data).some(p => p.includes('C01-M01') && p.includes('evt-99999')));
  const noBrief = JSON.parse(JSON.stringify(content)); noBrief.chapters[5].missions[3].explain = noBrief.chapters[5].missions[3].explain.filter(e => e.part !== 'Handoff');
  assert.ok(validate(noBrief, data).some(p => p.includes('C06-M04') && p.includes('brief')));
});
