import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSearch } from '../site/engine/parser.js';
import { execute } from '../site/engine/executor.js';
import { runQuery, compareResults, normalizeAnswer } from '../site/engine/grader.js';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadContent() {
  const caseFile = JSON.parse(fs.readFileSync(path.join(root, 'content', 'case.json'), 'utf8'));
  const chapters = caseFile.chapters.map(id => JSON.parse(fs.readFileSync(path.join(root, 'content', 'chapters', id + '.json'), 'utf8')));
  return { case: caseFile, chapters };
}
export function loadData() { return JSON.parse(fs.readFileSync(path.join(root, 'data', 'events.json'), 'utf8')); }

const hhmm = s => new Date(s * 1000).toISOString().slice(11, 16);

// Derives a mission's expected answer from its reference query, so authored answers cannot drift from the data.
export function deriveAnswer(mission, events) {
  const r = execute(parseSearch(mission.reference), events);
  const c = mission.answer.check;
  if (c.type === 'count') return String(r.count);
  if (c.type === 'distinct') return String(new Set(r.rows.map(x => x[c.field])).size);
  if (c.type === 'field') {
    const rows = c.where ? r.rows.filter(x => Object.entries(c.where).every(([k, v]) => x[k] === v)) : r.rows;
    return String(rows[c.index ?? 0]?.[c.field]);
  }
  if (c.type === 'time') return hhmm(r.rows[c.index ?? 0]['metadata.event_timestamp.seconds']);
  if (c.type === 'cell') {
    const row = typeof c.row === 'number' ? r.rows[c.row] : r.rows.find(x => Object.entries(c.row).every(([k, v]) => x[k] === v));
    const col = typeof c.column === 'number' ? r.columns[c.column] : c.column;
    return String(row?.[col]);
  }
  throw new Error('unknown check type ' + c.type);
}

export function validate({ case: caseFile, chapters }, data) {
  const problems = [];
  const ids = new Set();
  for (const ch of chapters) {
    if (!ch.id || !ch.title || !Array.isArray(ch.missions)) problems.push(`${ch.id}: chapter shape`);
    for (const m of ch.missions) {
      const where = `${m.id}`;
      if (ids.has(m.id)) problems.push(`${where}: duplicate id`); ids.add(m.id);
      if (!['watch', 'build', 'solo', 'read'].includes(m.kind)) problems.push(`${where}: kind`);
      if (!m.call || !m.call.options?.some(o => o.id === m.call.correct)) problems.push(`${where}: call.correct not among options`);
      if (m.kind === 'read') { if (m.reference) problems.push(`${where}: read mission has a reference`); continue; }
      if (!m.reference) { problems.push(`${where}: missing reference`); continue; }
      const ref = runQuery(m.reference, data.events);
      if (!ref.ok) { problems.push(`${where}: reference does not run (${ref.code})`); continue; }
      if (m.hints.length !== 3) problems.push(`${where}: expected 3 hints`);
      if (m.kind !== 'watch') { // watch missions already show the full query; their hints are reading prompts
        const full = runQuery(m.hints[2], data.events);
        if (!full.ok || !compareResults(full.result, ref.result).correct) problems.push(`${where}: hint 3 is not a passing answer`);
      }
      if (m.kind === 'build') {
        if (!m.starter.includes('___')) problems.push(`${where}: build starter has no gap`);
        const st = runQuery(m.starter, data.events);
        if (st.ok && compareResults(st.result, ref.result).correct) problems.push(`${where}: starter already passes`);
      }
      if (m.kind === 'solo' && m.starter !== '') problems.push(`${where}: solo starter must be empty`);
      if (m.kind === 'watch' && m.starter !== m.reference) problems.push(`${where}: watch starter should equal reference`);
      if (!m.answer) { problems.push(`${where}: missing answer`); continue; }
      const derived = deriveAnswer(m, data.events);
      if (normalizeAnswer(derived) !== normalizeAnswer(m.answer.value)) problems.push(`${where}: authored answer "${m.answer.value}" but data says "${derived}"`);
    }
  }
  if (new Set(caseFile.chapters).size !== chapters.length) problems.push('case.chapters mismatch');
  return problems;
}
