import { parseSearch, QueryError } from './parser.js';
import { execute, MEMBERS } from './executor.js';

// Grades by running both queries against the same fictional data and comparing what comes back.
// Two different-looking queries that return the same evidence both pass; a plausible query that
// returns different evidence fails with a reason the learner can act on.
export function runQuery(text, events, range) {
  try {
    const query = parseSearch(text);
    const result = execute(query, events, range);
    return { ok: true, query, result };
  } catch (error) {
    if (error instanceof QueryError) return { ok: false, status: error.status, code: error.code, detail: error.detail };
    if (error?.code) return { ok: false, status: error.status ?? 'invalid', code: error.code, detail: null };
    return { ok: false, status: 'invalid', code: 'UNEXPECTED', detail: null };
  }
}

const idSet = rows => new Set(rows.map(r => r['metadata.id']));
// Up to three example record IDs, always taken from the dataset side of the comparison (never from learner text),
// in time order because executor rows are time-sorted. The learner can open one with metadata.id = "...".
export const EXAMPLE_IDS = 3;
const examples = ids => [...new Set(ids)].slice(0, EXAMPLE_IDS);

export function compareResults(student, reference) {
  if (student.kind !== reference.kind) return { correct: false, reason: reference.kind === 'stats' ? 'EXPECTED_STATS' : 'EXPECTED_EVENTS' };
  if (student.kind === 'events') {
    const s = idSet(student.rows), r = idSet(reference.rows);
    const missingIds = [...r].filter(id => !s.has(id)), extraIds = [...s].filter(id => !r.has(id));
    if (!missingIds.length && !extraIds.length) return { correct: true, reason: 'SAME_EVENTS' };
    return { correct: false, reason: 'DIFFERENT_EVENTS', missing: missingIds.length, extra: extraIds.length, missingIds: examples(missingIds), extraIds: examples(extraIds), studentCount: s.size, referenceCount: r.size };
  }
  // Stats: outcome names are the learner's choice, so compare by position of outcome columns.
  const sKeys = student.columns.filter(c => !c.startsWith('$')), rKeys = reference.columns.filter(c => !c.startsWith('$'));
  if (JSON.stringify([...sKeys].sort()) !== JSON.stringify([...rKeys].sort())) return { correct: false, reason: 'DIFFERENT_GROUPING', student: sKeys, reference: rKeys };
  const sOut = student.columns.filter(c => c.startsWith('$')), rOut = reference.columns.filter(c => c.startsWith('$'));
  if (sOut.length !== rOut.length) return { correct: false, reason: 'DIFFERENT_OUTCOME_COUNT', student: sOut.length, reference: rOut.length };
  const norm = (rows, keys, outs) => rows.map(r => JSON.stringify([...rKeys.map(k => r[k]), ...outs.map(o => r[o])]));
  const sRows = norm(student.rows, sKeys, sOut), rRows = norm(reference.rows, rKeys, rOut);
  if (reference.ordered) {
    if (JSON.stringify(sRows) === JSON.stringify(rRows)) return { correct: true, reason: 'SAME_STATS' };
    if (JSON.stringify([...sRows].sort()) === JSON.stringify([...rRows].sort())) return { correct: false, reason: 'DIFFERENT_ORDER' };
  } else if (JSON.stringify([...sRows].sort()) === JSON.stringify([...rRows].sort())) return { correct: true, reason: 'SAME_STATS' };
  const rs = new Set(rRows), ss = new Set(sRows);
  // Differing rows are described by the events behind them. A row is matched by its grouping keys: a key only in the
  // reference is a missing row, a key only in the student table is an extra row, and a key in both whose calculated
  // values differ is a changed row (same grouping, different aggregate).
  const keyOf = (row, keys) => JSON.stringify(keys.map(k => row[k]));
  const rKeyed = new Map(reference.rows.map((row, i) => [keyOf(row, rKeys), { row, full: rRows[i] }]));
  const sKeyed = new Map(student.rows.map((row, i) => [keyOf(row, sKeys), { row, full: sRows[i] }]));
  const missingIds = [], extraIds = [], changedIds = [];
  let missingRows = 0, extraRows = 0, changedRows = 0;
  for (const [k, { row, full }] of rKeyed) {
    if (ss.has(full)) continue;
    if (sKeyed.has(k)) { changedRows++; changedIds.push(...(row[MEMBERS] ?? [])); } else { missingRows++; missingIds.push(...(row[MEMBERS] ?? [])); }
  }
  for (const [k, { row, full }] of sKeyed) { if (!rs.has(full) && !rKeyed.has(k)) { extraRows++; extraIds.push(...(row[MEMBERS] ?? [])); } }
  return { correct: false, reason: 'DIFFERENT_STATS', missing: missingRows, extra: extraRows, changed: changedRows, missingIds: examples(missingIds), extraIds: examples(extraIds), changedIds: examples(changedIds), studentCount: sRows.length, referenceCount: rRows.length };
}

export const POINTS = Object.freeze({ query: 60, answer: 25, call: 15 });

export function gradeQuery(text, mission, events, range) {
  if (mission.kind === 'read') return { status: 'read', points: 0 };
  const student = runQuery(text, events, range);
  if (!student.ok) return { status: student.status, points: 0, code: student.code, detail: student.detail };
  const reference = runQuery(mission.reference, events, range);
  if (!reference.ok) throw new Error('REFERENCE_BROKEN:' + mission.id);
  const cmp = compareResults(student.result, reference.result);
  return { status: cmp.correct ? 'correct' : 'incorrect', points: cmp.correct ? POINTS.query : 0, comparison: cmp, result: student.result };
}

export function normalizeAnswer(text) { return String(text ?? '').trim().toLowerCase().replace(/[,\s]+/g, ' '); }

export function gradeAnswer(text, mission) {
  if (!mission.answer) return { correct: null, points: 0 };
  const given = normalizeAnswer(text);
  const accepted = [mission.answer.value, ...(mission.answer.also ?? [])].map(normalizeAnswer);
  const correct = given.length > 0 && accepted.includes(given);
  return { correct, points: correct ? POINTS.answer : 0 };
}

export function gradeCall(optionId, mission) {
  if (!mission.call) return { correct: null, points: 0 };
  const correct = optionId === mission.call.correct;
  return { correct, points: correct ? POINTS.call : 0 };
}
