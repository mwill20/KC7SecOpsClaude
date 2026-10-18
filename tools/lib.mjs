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
  const casebook = JSON.parse(fs.readFileSync(path.join(root, 'content', 'casebook.json'), 'utf8'));
  return { case: caseFile, chapters, casebook };
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
    // format "hhmm": the cell holds a timestamp in seconds (min/max on metadata.event_timestamp.seconds) and the
    // learner answers with the clock time.
    return c.format === 'hhmm' ? hhmm(row?.[col]) : String(row?.[col]);
  }
  throw new Error('unknown check type ' + c.type);
}

// The casebook entry kinds a mission's "Log it" may ask for, and the four remediation lists. Mirrors site/ui/casebook.js.
const LOGIT_KINDS = ['scope', 'evidence', 'timeline', 'hypothesis', 'pivot', 'gap', 'determination', 'remediation', 'handoff'];
const LOGIT_LISTS = ['contain', 'eradicate', 'recover', 'harden'];

// logIt: { kind, prompt, mustInclude: [token|alternative, ...], list? }. Every token that looks like a record ID must
// exist in the dataset, so a mission can never ask for a record the learner cannot find.
export function validateLogIt(li, where, eventIds) {
  const problems = [];
  if (!li || typeof li !== 'object' || Array.isArray(li)) return [`${where}: logIt shape`];
  if (!LOGIT_KINDS.includes(li.kind)) problems.push(`${where}: logIt.kind "${li.kind}" not in ${LOGIT_KINDS.join('/')}`);
  if (typeof li.prompt !== 'string' || li.prompt.trim().length < 20) problems.push(`${where}: logIt.prompt missing or too short`);
  if (!Array.isArray(li.mustInclude) || !li.mustInclude.length || li.mustInclude.some(t => typeof t !== 'string' || !t.trim())) problems.push(`${where}: logIt.mustInclude must be a non-empty list of strings`);
  else for (const token of li.mustInclude) for (const alt of token.split('|')) if (/^evt-\d{5}$/.test(alt.trim()) && !eventIds.has(alt.trim())) problems.push(`${where}: logIt.mustInclude names ${alt.trim()}, which is not in the dataset`);
  if (li.list !== undefined && (li.kind !== 'remediation' || !LOGIT_LISTS.includes(li.list))) problems.push(`${where}: logIt.list "${li.list}" only applies to remediation and must be one of ${LOGIT_LISTS.join('/')}`);
  if (Object.keys(li).some(k => !['kind', 'prompt', 'mustInclude', 'list'].includes(k))) problems.push(`${where}: logIt has unknown keys`);
  return problems;
}

// Chapter density, KC7-like: at least DENSITY.min missions per chapter and at most DENSITY.maxDesk of them with a query
// desk (Watch, Build, Your turn). Read missions carry no desk and frame the chapter, so they sit outside the ceiling.
// Every chapter after the first needs DENSITY.solo Your-turn missions; the first chapter may have one.
export const DENSITY = Object.freeze({ min: 7, maxDesk: 8, solo: 2, soloFirst: 1 });

// content/casebook.json: the FreeForm template (3 to 40 short lines, each ending in a colon so it reads as a prompt)
// and the teaching line shown above the page.
export function validateCasebookContent(cb) {
  const problems = [];
  if (!cb || typeof cb !== 'object' || Array.isArray(cb)) return ['casebook.json: shape'];
  const t = cb.freeformTemplate;
  if (!Array.isArray(t) || t.length < 3 || t.length > 40) problems.push('casebook.json: freeformTemplate needs 3 to 40 lines');
  else for (const line of t) if (typeof line !== 'string' || !/^[A-Z][A-Za-z0-9 /#()-]{1,60}:$/.test(line)) problems.push(`casebook.json: template line "${line}" must be a short label ending in a colon`);
  if (typeof cb.freeformTeach !== 'string' || cb.freeformTeach.length < 40 || cb.freeformTeach.length > 600) problems.push('casebook.json: freeformTeach missing or out of range');
  if (Object.keys(cb).some(k => !['freeformTemplate', 'freeformTeach'].includes(k))) problems.push('casebook.json: unknown keys');
  return problems;
}

export function validate({ case: caseFile, chapters, casebook }, data) {
  const problems = [];
  if (casebook !== undefined) problems.push(...validateCasebookContent(casebook));
  const ids = new Set();
  const eventIds = new Set(data.events.map(e => e['metadata.id']));
  for (const ch of chapters) {
    if (!ch.id || !ch.title || !Array.isArray(ch.missions)) problems.push(`${ch.id}: chapter shape`);
    // The chapter-end recap card needs three to six plain-language "you can now" lines.
    if (!Array.isArray(ch.recap) || ch.recap.length < 3 || ch.recap.length > 6 || ch.recap.some(r => typeof r !== 'string' || r.length < 12)) problems.push(`${ch.id}: recap needs 3 to 6 lines`);
    if (Array.isArray(ch.missions)) {
      const desk = ch.missions.filter(m => m.kind !== 'read').length, solo = ch.missions.filter(m => m.kind === 'solo').length;
      if (ch.missions.length < DENSITY.min) problems.push(`${ch.id}: density: ${ch.missions.length} missions, needs at least ${DENSITY.min}`);
      if (desk > DENSITY.maxDesk) problems.push(`${ch.id}: density: ${desk} missions with a query desk, at most ${DENSITY.maxDesk}`);
      const needSolo = chapters.indexOf(ch) === 0 ? DENSITY.soloFirst : DENSITY.solo;
      if (solo < needSolo) problems.push(`${ch.id}: density: ${solo} Your-turn missions, needs at least ${needSolo}`);
    }
    for (const m of ch.missions) {
      const where = `${m.id}`;
      if (ids.has(m.id)) problems.push(`${where}: duplicate id`); ids.add(m.id);
      if (!['watch', 'build', 'solo', 'read'].includes(m.kind)) problems.push(`${where}: kind`);
      if (!m.call || !m.call.options?.some(o => o.id === m.call.correct)) problems.push(`${where}: call.correct not among options`);
      if (m.logIt !== undefined) problems.push(...validateLogIt(m.logIt, where, eventIds));
      if (m.brief !== undefined && (m.brief !== 'casebook' || m.kind !== 'read' || !['Facts', 'Hypotheses', 'Gaps', 'Determination', 'Remediation', 'Handoff'].every(part => m.explain?.some(e => e.part === part)))) problems.push(`${where}: brief must be "casebook" on a read mission whose explain carries all six brief sections`);
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
