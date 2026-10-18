import test from 'node:test';
import assert from 'node:assert/strict';
import { createCasebook, validateState, checkEntry, checkLogIt, contextFor, toMarkdown, handoffText, sortTimeline, isTime, KEY, MAX_BYTES, MAX_NAME, MAX_FREEFORM, FIELDS, KINDS, TABS, SINGLE, normalizePaste, freeformBytes, checkFreeform, exportFilename, cleanName } from '../../site/ui/casebook.js';
import { loadContent, loadData } from '../../tools/lib.mjs';

const CASE = 'pier-nine';
const memStorage = (initial = {}) => { const m = new Map(Object.entries(initial)); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), dump: () => Object.fromEntries(m) }; };
const EVENT_IDS = new Set(loadData().events.map(e => e['metadata.id']));
const good = { time: '19:05 to 19:10', source: { query: 'metadata.event_type = "USER_LOGIN"\nprincipal.user.userid = "pledge-desk"', range: 'Whole night (18:00 to 06:00)' }, observation: 'Seven FAIL events for pledge-desk from 198.51.100.23 through VPN-GW-01; hostname blank on each.', records: ['evt-00039', 'evt-00057'], confidence: 'high', where: 'USER_LOGIN, principal.ip' };

test('K1 session-only by default: entries live in memory, nothing is written until remembering is on, and turning it off removes the key', () => {
  const st = memStorage(); const s = createCasebook(st);
  const r = s.add(CASE, 'evidence', good);
  assert.equal(r.ok, true); assert.equal(r.entry.n, 1); assert.equal(r.entry.id, 'e1');
  assert.equal(st.getItem(KEY), null);
  s.setRemember(true); assert.ok(st.getItem(KEY).includes('evt-00039'));
  s.setRemember(false); assert.equal(st.getItem(KEY), null);
  assert.equal(s.get(CASE).evidence.length, 1);
});

test('K2 evidence numbers are stable: deleting #1 never renumbers #2, and the next entry is #3', () => {
  const s = createCasebook(null);
  s.add(CASE, 'evidence', good); s.add(CASE, 'evidence', { ...good, observation: 'second' });
  s.remove(CASE, 'evidence', 'e1');
  assert.deepEqual(s.get(CASE).evidence.map(e => e.n), [2]);
  assert.equal(s.add(CASE, 'evidence', good).entry.n, 3);
  // update keeps the number and the id
  const u = s.update(CASE, 'evidence', 'e2', { ...good, observation: 'edited' });
  assert.equal(u.entry.n, 2); assert.equal(s.get(CASE).evidence.find(e => e.id === 'e2').observation, 'edited');
});

test('K3 per-case isolation: two cases keep separate entries and numbering, clearing one leaves the other, and the store lists stored cases', () => {
  const st = memStorage(); const s = createCasebook(st); s.setRemember(true);
  s.add(CASE, 'evidence', good); s.add('second-case', 'gap', { text: 'no email body', why: 'cannot judge the lure' });
  assert.equal(s.get('second-case').evidence.length, 0); assert.equal(s.get('second-case').gap.length, 1);
  assert.equal(s.add('second-case', 'evidence', good).entry.n, 1);
  assert.deepEqual(s.cases().sort(), [CASE, 'second-case']);
  s.clearCase(CASE);
  assert.equal(s.isEmpty(CASE), true); assert.equal(s.get('second-case').gap.length, 1);
  assert.deepEqual(Object.keys(JSON.parse(st.getItem(KEY)).cases), ['second-case']);
  s.clearCase('second-case'); assert.equal(st.getItem(KEY), null);
});

test('K4 should-fail: hostile or malformed stored state is ignored, not loaded, and left in place', () => {
  const cases = [
    'not json', '[]', '{"v":2,"cases":{}}', '{"v":1,"cases":[]}',
    '{"v":1,"cases":{"../etc":{}}}',                                                   // bad case id
    '{"v":1,"cases":{"pier-nine":{"evidence":[{"id":"e1","n":1,"time":"19:05","observation":"x","records":[],"source":{"query":"","range":""},"confidence":"high","onclick":"alert(1)"}]}}}', // unknown key
    '{"v":1,"cases":{"pier-nine":{"evidence":[{"id":"<img>","n":1}]}}}',               // bad entry id
    '{"v":1,"cases":{"pier-nine":{"evidence":[{"id":"e1","n":1,"confidence":"certain"}]}}}', // enum outside the set
    '{"v":1,"cases":{"pier-nine":{"evidence":[{"id":"e1","n":1,"records":"evt-00001"}]}}}',  // records not an array
    '{"v":1,"cases":{"pier-nine":{"timeline":[{"id":"t1","time":"19:05","fact":"x","ref":"1"}]}}}', // ref not an integer
    '{"v":1,"cases":{"pier-nine":{"evidence":[{"id":"e1","n":1},{"id":"e1","n":2}]}}}',  // duplicate ids
    '{"v":1,"cases":{"pier-nine":{"seq":-1}}}',
    '{"v":1,"cases":{"pier-nine":{"determination":{"verdict":"confirmed","extra":1}}}}',
    '{"v":1,"cases":{"pier-nine":{"notes":"free text"}}}',                              // unknown list
    '{"v":1,"cases":{"pier-nine":{"evidence":[{"id":"e1","n":1,"observation":' + JSON.stringify('x'.repeat(4001)) + '}]}}}', // oversize field
    '{"v":1,"cases":{"pier-nine":{"pivot":' + JSON.stringify(Array.from({ length: 201 }, (_, i) => ({ id: 'p' + (i + 1), text: 'x', done: false }))) + '}}}', // too many
  ];
  for (const text of cases) {
    const st = memStorage({ [KEY]: text }); const s = createCasebook(st);
    assert.equal(s.remember, false, text.slice(0, 60)); assert.equal(s.isEmpty(CASE), true, text.slice(0, 60)); assert.equal(st.getItem(KEY), text, 'untouched: ' + text.slice(0, 60));
  }
  assert.equal(validateState({ v: 1, cases: { 'pier-nine': { evidence: [{ id: 'e1', n: 1, ...good }], seq: 1, nextRef: 2 } } }).cases['pier-nine'].evidence[0].n, 1);
});

test('K5 oversize: a stored blob over 96 KB is ignored, and a write that would pass the bound is refused with FULL while the state stays intact', () => {
  const big = memStorage({ [KEY]: JSON.stringify({ v: 1, cases: {} }).padEnd(MAX_BYTES + 1, ' ') });
  assert.equal(createCasebook(big).remember, false);
  const s = createCasebook(null);
  const long = { ...good, observation: 'x'.repeat(3900) };
  let added = 0;
  for (let i = 0; i < 40; i++) { const r = s.add(CASE, 'evidence', long); if (r.ok) added++; else { assert.equal(r.reason, 'FULL'); break; } }
  assert.ok(added >= 20 && added < 40, 'filled at ' + added);
  assert.equal(s.get(CASE).evidence.length, added);
  assert.ok(s.bytes() <= MAX_BYTES);
  assert.equal(s.add(CASE, 'gap', { text: 'small', why: 'small' }).ok, true, 'a small entry still fits');
  // a single field over 4,000 characters is refused before it is stored
  assert.equal(s.add(CASE, 'gap', { text: 'y'.repeat(4001), why: 'z' }).reason, 'TOO_LONG');
  assert.equal(s.add(CASE, 'gap', {}).reason, 'BLANK');
  assert.equal(s.add(CASE, 'scope', {}).reason, 'KIND');
  assert.equal(s.add('BAD CASE', 'gap', { text: 'a', why: 'b' }).reason, 'KIND');
});

test('K6 storage that throws on every call leaves the casebook session-only instead of crashing', () => {
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('blocked'); } };
  const s = createCasebook(broken); s.setRemember(true);
  assert.equal(s.add(CASE, 'pivot', { text: 'look at mail', done: false }).ok, true);
  assert.equal(s.get(CASE).pivot.length, 1);
  s.clear(); assert.equal(s.isEmpty(CASE), true);
});

test('K7 sanitising: unknown keys are dropped, refs and records parse from text, enums outside the set become blank, and singles save in place', () => {
  const s = createCasebook(null);
  const r = s.add(CASE, 'hypothesis', { statement: '  outside guessing  ', status: 'maybe', supporting: '#1, 2; #2', contradicting: [], testNext: 'time and source', onclick: 'x', __proto__: { polluted: true } });
  assert.deepEqual(Object.keys(r.entry).sort(), ['contradicting', 'id', 'statement', 'status', 'supporting', 'testNext']);
  assert.equal(r.entry.statement, 'outside guessing'); assert.equal(r.entry.status, ''); assert.deepEqual(r.entry.supporting, [1, 2]);
  assert.equal(s.add(CASE, 'evidence', { ...good, records: 'evt-00039 evt-00039, evt-00040' }).entry.records.join(','), 'evt-00039,evt-00040');
  assert.equal(s.setSingle(CASE, 'determination', { verdict: 'confirmed', confidence: 'high', refs: '#1', summary: 'Two sentences. Here.' }).ok, true);
  assert.equal(s.get(CASE).determination.refs[0], 1);
  assert.equal(s.setSingle(CASE, 'determination', { verdict: '', confidence: '', refs: '', summary: '' }).ok, true);
  assert.equal(s.get(CASE).determination, null, 'a blank single clears it');
  for (const kind of KINDS) assert.ok(FIELDS[kind].length >= 2, kind);
  assert.deepEqual([...SINGLE].sort(), ['determination', 'handoff', 'scope']);
});

// ---------- the note check ----------
const ctxWith = (casebook) => contextFor(casebook, EVENT_IDS);
const codes = problems => problems.map(p => p.code);

test('N1 a complete evidence entry passes, and every rule message is plain language', () => {
  const s = createCasebook(null); s.add(CASE, 'evidence', good);
  const cb = s.get(CASE);
  assert.deepEqual(checkEntry('evidence', cb.evidence[0], ctxWith(cb)), []);
  assert.deepEqual(checkEntry('timeline', { time: '19:21', fact: 'first success for pledge-desk from 198.51.100.23', ref: 1 }, ctxWith(cb)), []);
  assert.deepEqual(checkEntry('hypothesis', { statement: 'guessing from outside', status: 'supported', supporting: [1], contradicting: [], testNext: '' }, ctxWith(cb)), []);
  assert.deepEqual(checkEntry('remediation', { list: 'contain', text: 'block egress to 203.0.113.0/24', refs: [1], owner: 'network engineer', urgency: 'now' }, ctxWith(cb)), []);
  s.setName(CASE, 'Pledge Night static');
  assert.deepEqual(checkEntry('scope', { question: 'who touched a keyboard', requestedBy: 'Odalys Reyes', window: '18:00 to 06:00', inScope: 'logins', outScope: 'names' }, ctxWith(s.get(CASE))), []);
  assert.deepEqual(codes(checkEntry('scope', { question: 'who touched a keyboard', requestedBy: 'Odalys Reyes', window: '18:00 to 06:00', inScope: 'logins', outScope: 'names' }, ctxWith(cb))), ['NEEDS_NAME'], 'the scope needs the investigation name');
  assert.ok(isTime('19:21:04') && isTime('19:05 - 19:10') && !isTime('7pm') && !isTime('24:00') && !isTime('19:5'));
});

test('N2 should-fail: a claim word without a record ref fails with the claim rule, and with a record it passes', () => {
  const s = createCasebook(null); const cb = s.get(CASE);
  const p = checkEntry('evidence', { ...good, observation: 'This proves the pledge desk was brute-forced.', records: [] }, ctxWith(cb));
  assert.ok(codes(p).includes('CLAIM_WORD'), codes(p).join());
  assert.ok(codes(p).includes('NO_RECORDS'));
  assert.match(p.find(x => x.code === 'CLAIM_WORD').message, /"proves" is a claim/);
  assert.deepEqual(checkEntry('evidence', { ...good, observation: 'The records clearly show seven failures.' }, ctxWith(cb)), [], 'a claim word with records on the same entry is allowed');
  for (const w of ['definitely', 'Obviously', 'clearly', 'must have']) assert.ok(codes(checkEntry('timeline', { time: '19:21', fact: `they ${w} got in`, ref: 9 }, ctxWith(cb))).includes('CLAIM_WORD'), w);
  assert.ok(!codes(checkEntry('timeline', { time: '19:21', fact: 'the proverbial door', ref: 9 }, ctxWith(cb))).includes('CLAIM_WORD'), 'word boundaries');
});

test('N3 should-fail: a timeline entry that references a missing evidence entry fails with the reference rule', () => {
  const s = createCasebook(null); s.add(CASE, 'evidence', good); const cb = s.get(CASE);
  const p = checkEntry('timeline', { time: '19:21', fact: 'first success', ref: 2 }, ctxWith(cb));
  assert.deepEqual(codes(p), ['BAD_REF']); assert.match(p[0].message, /#2 does not point at an existing Evidence entry/);
  assert.deepEqual(codes(checkEntry('timeline', { time: '19:21', fact: 'first success', ref: null }, ctxWith(cb))), ['NEEDS_REF']);
});

test('N4 should-fail: a bad time, a record ID that is not in the dataset, and a missing required field each name their rule', () => {
  const s = createCasebook(null); const cb = s.get(CASE);
  assert.deepEqual(codes(checkEntry('evidence', { ...good, time: '7:05pm' }, ctxWith(cb))), ['BAD_TIME']);
  const p = checkEntry('evidence', { ...good, records: ['evt-00039', 'evt-99999'] }, ctxWith(cb));
  assert.deepEqual(codes(p), ['UNKNOWN_RECORD']); assert.match(p[0].message, /evt-99999 is not in the dataset/);
  assert.deepEqual(codes(checkEntry('evidence', { ...good, observation: '', confidence: '' }, ctxWith(cb))), ['MISSING_FIELD', 'MISSING_FIELD']);
  assert.deepEqual(codes(checkEntry('evidence', { ...good, source: { query: '', range: 'Whole night' } }, ctxWith(cb))), ['MISSING_FIELD']);
  assert.deepEqual(codes(checkEntry('gap', { text: 'no email body', why: '' }, ctxWith(cb))), ['MISSING_FIELD']);
  assert.deepEqual(codes(checkEntry('scope', { question: 'q', requestedBy: 'O', window: 'all night', inScope: 'a', outScope: 'b' }, ctxWith(cb))), ['BAD_TIME', 'NEEDS_NAME']);
});

test('N5 should-fail: a supported hypothesis without a supporting ref, a refuted one without a contradicting ref, and an open one without a test', () => {
  const s = createCasebook(null); s.add(CASE, 'evidence', good); const cb = s.get(CASE);
  assert.deepEqual(codes(checkEntry('hypothesis', { statement: 'x', status: 'supported', supporting: [], contradicting: [], testNext: '' }, ctxWith(cb))), ['NEEDS_SUPPORT']);
  assert.deepEqual(codes(checkEntry('hypothesis', { statement: 'x', status: 'refuted', supporting: [], contradicting: [], testNext: '' }, ctxWith(cb))), ['NEEDS_CONTRA']);
  assert.deepEqual(codes(checkEntry('hypothesis', { statement: 'x', status: 'open', supporting: [], contradicting: [], testNext: '' }, ctxWith(cb))), ['NEEDS_TEST']);
  assert.deepEqual(codes(checkEntry('hypothesis', { statement: 'x', status: 'supported', supporting: [4], contradicting: [], testNext: '' }, ctxWith(cb))), ['BAD_REF']);
});

test('N6 should-fail: a remediation item without an evidence ref, and a determination without its deciding refs', () => {
  const s = createCasebook(null); const cb = s.get(CASE);
  const p = checkEntry('remediation', { list: 'eradicate', text: 'disable PledgeSync', refs: [], owner: 'engineer', urgency: 'now' }, ctxWith(cb));
  assert.deepEqual(codes(p), ['NEEDS_REF']); assert.match(p[0].message, /at least one Evidence entry/);
  assert.deepEqual(codes(checkEntry('determination', { verdict: 'confirmed', confidence: 'high', refs: [], summary: 'Two sentences. Here.' }, ctxWith(cb))), ['NEEDS_REF']);
  assert.deepEqual(codes(checkEntry('determination', { verdict: 'maybe', confidence: 'high', refs: [1], summary: 's' }, ctxWith(cb))), ['BAD_ENUM', 'BAD_REF']);
});

test('N7 a mission Log it passes only when an entry of the kind passes the structure check and carries every anchor; the message says what is missing', () => {
  const content = loadContent(); const missions = content.chapters.flatMap(c => c.missions);
  const m = missions.find(x => x.id === 'C01-M05');
  const s = createCasebook(null);
  const none = checkLogIt(m.logIt, s.get(CASE), ctxWith(s.get(CASE)));
  assert.equal(none.ok, false); assert.match(none.message, /No evidence entry yet/);
  s.add(CASE, 'evidence', { ...good, observation: 'Seven failures for pledge-desk, then a success.', records: ['evt-00040'] });
  const partial = checkLogIt(m.logIt, s.get(CASE), ctxWith(s.get(CASE)));
  assert.equal(partial.ok, false); assert.match(partial.message, /Still missing from the entry: 198\.51\.100\.23/);
  s.update(CASE, 'evidence', 'e1', { ...good, observation: 'Seven failures for pledge-desk from 198.51.100.23, then a success at 19:21.', records: ['evt-00040'] });
  const pass = checkLogIt(m.logIt, s.get(CASE), ctxWith(s.get(CASE)));
  assert.equal(pass.ok, true); assert.equal(pass.entry.n, 1); assert.match(pass.message, /Evidence #1 passes/);
  // a remediation Log it only looks at its own list, and a structural failure is reported before the anchors
  const rem = missions.find(x => x.id === 'C04-M04');
  s.add(CASE, 'remediation', { list: 'eradicate', text: 'block 203.0.113.0/24', refs: [1], owner: 'network', urgency: 'now' });
  assert.match(checkLogIt(rem.logIt, s.get(CASE), ctxWith(s.get(CASE))).message, /No Contain remediation item yet/);
  s.add(CASE, 'remediation', { list: 'contain', text: 'block 203.0.113.0/24 egress', refs: [], owner: 'network', urgency: 'now' });
  const r = checkLogIt(rem.logIt, s.get(CASE), ctxWith(s.get(CASE)));
  assert.equal(r.ok, false); assert.match(r.message, /needs at least one Evidence entry/);
  // singles: the determination
  const det = missions.find(x => x.id === 'C06-M03');
  s.setSingle(CASE, 'determination', { verdict: 'confirmed', confidence: 'high', refs: [1], summary: 'An outside party used the pledge-desk credential from 19:21. The person is unidentified.' });
  assert.equal(checkLogIt(det.logIt, s.get(CASE), ctxWith(s.get(CASE))).ok, true);
});

test('N8 export: the Markdown and the handoff text are built from the entries only, sort the timeline across midnight, and never carry anything outside the casebook', () => {
  const s = createCasebook(null);
  s.add(CASE, 'evidence', good);
  s.add(CASE, 'timeline', { time: '02:10', fact: 'upload', ref: 1 }); s.add(CASE, 'timeline', { time: '19:21', fact: 'first success', ref: 1 });
  s.add(CASE, 'remediation', { list: 'harden', text: 'MFA on the VPN', refs: [1], owner: 'IT lead', urgency: 'this-week' });
  s.setSingle(CASE, 'determination', { verdict: 'confirmed', confidence: 'high', refs: [1], summary: 'Confirmed. Unidentified person.' });
  s.setSingle(CASE, 'handoff', { problem: 'phished shared credential', assets: 'AUTOMATION-01', refs: [1], controls: 'MFA', detections: 'burst of failures', acceptance: 'rule fires on replay', openQuestions: 'decoded command' });
  const cb = s.get(CASE);
  assert.deepEqual(sortTimeline(cb.timeline, 18).map(t => t.time), ['19:21', '02:10']);
  const md = toMarkdown(cb, { id: CASE, title: 'Static on Pier Nine', dayStartHour: 18 });
  assert.match(md, /^# Casebook: Static on Pier Nine/);
  assert.ok(md.indexOf('19:21 · first success') < md.indexOf('02:10 · upload'));
  assert.match(md, /### #1 · 19:05 to 19:10 · confidence high/);
  assert.match(md, /### Harden\n\n- MFA on the VPN · answers #1 · owner: IT lead · urgency: this-week/);
  assert.match(md, /\*\*Confirmed incident\*\* · confidence high · decided by #1/);
  const ticket = handoffText(cb, { title: 'Static on Pier Nine' });
  assert.match(ticket, /^Engineering handoff: Static on Pier Nine\nDetermination: Confirmed incident \(confidence high; refs #1\)/);
  assert.match(ticket, /Acceptance criteria\nrule fires on replay/);
  assert.ok(!md.includes('localStorage') && !md.includes('<'), 'no markup, no storage internals');
  const empty = toMarkdown(s.get('other'), { id: 'other' });
  assert.match(empty, /## Scope\n\n- Investigation: _\(unnamed\)_\n- _Scope not written._/); assert.match(handoffText(s.get('other')), /\(not written\)/);
});

// ---------- the investigation name and the FreeForm page ----------
test('F1 the name is the first field: cleaned, bounded at 120 characters, saved per case, shown in the export title and file name, and the Scope check requires it', () => {
  const st = memStorage(); const s = createCasebook(st); s.setRemember(true);
  assert.equal(s.setName(CASE, '  Pledge\u0000 Night \n static  ').name, 'Pledge Night static');
  assert.equal(s.setName(CASE, 'x'.repeat(500)).name.length, MAX_NAME);
  assert.equal(s.get(CASE).name.length, MAX_NAME);
  s.setName(CASE, 'Pledge Night: static at 03:10!'); s.setName('other', 'Second case');
  assert.equal(s.get(CASE).name, 'Pledge Night: static at 03:10!'); assert.equal(s.get('other').name, 'Second case');
  assert.ok(st.getItem(KEY).includes('Second case'));
  const md = toMarkdown(s.get(CASE), { id: CASE, title: 'Static on Pier Nine' });
  assert.match(md, /^# Casebook: Pledge Night: static at 03:10! \(Static on Pier Nine\)/);
  assert.match(md, /- Investigation: Pledge Night: static at 03:10!/);
  assert.equal(exportFilename('Pledge Night: static at 03:10!', CASE), 'casebook-pledge-night-static-at-03-10.md');
  assert.equal(exportFilename('', CASE), 'casebook-pier-nine.md');
  assert.equal(exportFilename('../../etc/passwd <script>', CASE), 'casebook-etc-passwd-script.md');
  assert.equal(exportFilename('x'.repeat(100), CASE).length, 'casebook-.md'.length + 40);
  assert.equal(cleanName(null), '');
  // the Scope structure check and a scope Log it both need the name
  const scope = { question: 'who touched a keyboard', requestedBy: 'Odalys Reyes', window: '18:00 to 06:00', inScope: 'logins', outScope: 'names' };
  s.setSingle(CASE, 'scope', scope);
  assert.deepEqual(codes(checkEntry('scope', scope, ctxWith(s.get(CASE)))), []);
  s.setName(CASE, '');
  assert.deepEqual(codes(checkEntry('scope', scope, ctxWith(s.get(CASE)))), ['NEEDS_NAME']);
  const li = { kind: 'scope', prompt: 'write the scope', mustInclude: ['Odalys', '18:00'] };
  assert.equal(checkLogIt(li, s.get(CASE), ctxWith(s.get(CASE))).ok, false);
  assert.match(checkLogIt(li, s.get(CASE), ctxWith(s.get(CASE))).message, /Name the investigation/);
  s.setName(CASE, 'named');
  assert.equal(checkLogIt(li, s.get(CASE), ctxWith(s.get(CASE))).ok, true);
  // tabs: FreeForm sits after Scope and before Evidence, and is not an entry kind
  assert.deepEqual(TABS.slice(0, 3), ['scope', 'freeform', 'evidence']); assert.ok(!KINDS.includes('freeform'));
});

test('F2 FreeForm: bounded at 24 KB of UTF-8 (refused, not truncated), normalised on the way in, exported under Free-form notes, and counted toward the 96 KB store bound', () => {
  const st = memStorage(); const s = createCasebook(st); s.setRemember(true);
  assert.equal(s.setFreeform(CASE, 'ALERT / CASE #: 12\r\nQUERY: x\u0000y\u200b').freeform, 'ALERT / CASE #: 12\nQUERY: xy');
  const full = 'é'.repeat(MAX_FREEFORM / 2);                   // exactly 24 KB in UTF-8
  assert.equal(s.setFreeform(CASE, full).ok, true);
  const over = s.setFreeform(CASE, full + 'a');
  assert.deepEqual(over, { ok: false, reason: 'FREEFORM_FULL' });
  assert.equal(s.get(CASE).freeform, full, 'a refused write leaves the page as it was');
  assert.equal(freeformBytes(full), MAX_FREEFORM); assert.equal(freeformBytes(''), 0);
  assert.equal(s.setFreeform(CASE, '').freeform, '');
  s.setFreeform(CASE, 'OBSERVATION: seven failures at 19:05, evt-00039');
  const md = toMarkdown(s.get(CASE), { id: CASE, title: 'Static on Pier Nine' });
  assert.match(md, /## Free-form notes\n\n```text\nOBSERVATION: seven failures at 19:05, evt-00039\n```/);
  assert.match(toMarkdown(s.get('other'), { id: 'other' }), /## Free-form notes\n\n_No free-form notes\._/);
  // the whole store bound still applies: four pages of 24 KB cannot fit beside anything else in 96 KB
  for (const id of ['a', 'b', 'c']) assert.equal(s.setFreeform(id, 'x'.repeat(MAX_FREEFORM)).ok, true);
  assert.equal(s.setFreeform('d', 'x'.repeat(MAX_FREEFORM)).reason, 'FULL');
});

test('F3 should-fail: hostile stored state for the name or the page is ignored and left in place; a good one loads', () => {
  const cases = [
    '{"v":1,"cases":{"pier-nine":{"name":123}}}',
    '{"v":1,"cases":{"pier-nine":{"name":' + JSON.stringify('x'.repeat(MAX_NAME + 1)) + '}}}',
    '{"v":1,"cases":{"pier-nine":{"freeform":["a"]}}}',
    '{"v":1,"cases":{"pier-nine":{"freeform":' + JSON.stringify('é'.repeat(MAX_FREEFORM / 2 + 1)) + '}}}',
    '{"v":1,"cases":{"pier-nine":{"freeform":"ok","notes":"x"}}}',
  ];
  for (const text of cases) {
    const st = memStorage({ [KEY]: text }); const s = createCasebook(st);
    assert.equal(s.remember, false, text.slice(0, 60)); assert.equal(s.isEmpty(CASE), true, text.slice(0, 60)); assert.equal(st.getItem(KEY), text);
  }
  const good = JSON.stringify({ v: 1, cases: { 'pier-nine': { name: 'Pledge Night', freeform: '<img src=x onerror=alert(1)>' } } });
  const s = createCasebook(memStorage({ [KEY]: good }));
  assert.equal(s.remember, true); assert.equal(s.get(CASE).name, 'Pledge Night'); assert.equal(s.get(CASE).freeform, '<img src=x onerror=alert(1)>');
  assert.equal(validateState({ v: 1, cases: { 'pier-nine': { name: 'n', freeform: 'f', seq: 0, nextRef: 1 } } }).cases['pier-nine'].freeform, 'f');
});

test('F4 paste normalisation keeps text only, and the FreeForm structure check reports presence and nothing else', () => {
  assert.equal(normalizePaste('a\r\nb\rc\n'), 'a\nb\nc\n');
  assert.equal(normalizePaste('x\u0007y\u001bz\u200e\u202e\ufeff\ttab'), 'xyz\ttab');
  assert.equal(normalizePaste(null), '');
  assert.equal(normalizePaste('<b>bold</b> stays as the characters it is'), '<b>bold</b> stays as the characters it is');
  const ids = new Set(['evt-00039']);
  assert.deepEqual(checkFreeform('', ids), { time: false, query: false, record: false, records: [], unknown: [] });
  assert.deepEqual(checkFreeform('DATE-TIME (UTC): 19:05\nQUERY: metadata.event_type = "USER_LOGIN"\nRESULTS: evt-00039 evt-00039 evt-12345', ids), { time: true, query: true, record: true, records: ['evt-00039'], unknown: ['evt-12345'] });
  assert.equal(checkFreeform('at 7pm something', ids).time, false);
  assert.equal(checkFreeform('24:00', ids).time, false);
  assert.equal(checkFreeform('match:\n  principal.hostname', ids).query, true);
  assert.equal(checkFreeform('no query here, just words', ids).query, false);
  assert.equal(checkFreeform('evt-12345 only', ids).record, false);
  assert.equal(checkFreeform('evt-12345 only', null).record, true, 'without a dataset every well-formed ID counts');
});
