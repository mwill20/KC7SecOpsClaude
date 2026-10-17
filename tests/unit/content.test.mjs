import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root, loadContent, loadData, validate, deriveAnswer } from '../../tools/lib.mjs';
import { runQuery, compareResults, gradeQuery, gradeAnswer, gradeCall } from '../../site/engine/grader.js';
import { MESSAGES } from '../../site/ui/messages.js';

const content = loadContent(); const data = loadData();
const missions = content.chapters.flatMap(c => c.missions);

test('C1 every mission validates: references run, answers match the data, starters do not already pass', () => {
  assert.deepEqual(validate(content, data), []);
});

test('C1 should-fail: an authored answer that drifts from the data is caught', () => {
  const bad = JSON.parse(JSON.stringify(content));
  bad.chapters[0].missions[0].answer.value = '41';
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
