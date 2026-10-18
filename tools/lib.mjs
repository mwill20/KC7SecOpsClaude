import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseSearch } from '../site/engine/parser.js';
import { execute } from '../site/engine/executor.js';
import { runQuery, compareResults, normalizeAnswer } from '../site/engine/grader.js';
import { LIST_TYPES } from '../site/engine/catalog.js';
import { guardRegex, parseCidr } from '../site/engine/safety.js';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// content/case.json holds a cases array; each case names its chapters and its data file. `case` is the first case
// (the shape earlier branches used), `chapters` is every chapter in order across cases, and chapterCase maps a
// chapter id to its case id.
export function loadContent() {
  const caseFile = JSON.parse(fs.readFileSync(path.join(root, 'content', 'case.json'), 'utf8'));
  const cases = caseFile.cases;
  const chapterCase = {};
  const chapters = cases.flatMap(c => c.chapters.map(id => { chapterCase[id] = c.id; return JSON.parse(fs.readFileSync(path.join(root, 'content', 'chapters', id + '.json'), 'utf8')); }));
  const casebook = JSON.parse(fs.readFileSync(path.join(root, 'content', 'casebook.json'), 'utf8'));
  const lists = JSON.parse(fs.readFileSync(path.join(root, 'content', 'lists.json'), 'utf8'));
  const tables = JSON.parse(fs.readFileSync(path.join(root, 'content', 'tables.json'), 'utf8'));
  return { cases, case: cases[0], chapters, chapterCase, casebook, lists, tables, boundary: caseFile.boundary };
}
export function loadData(file = 'events.json') { return JSON.parse(fs.readFileSync(path.join(root, 'data', file), 'utf8')); }
// Every case's dataset, keyed by case id.
export function loadDatasets(content = loadContent()) { return Object.fromEntries(content.cases.map(c => [c.id, loadData(c.data)])); }
export const digestOf = events => crypto.createHash('sha256').update(JSON.stringify(events)).digest('hex');

const hhmm = s => new Date(s * 1000).toISOString().slice(11, 16);

// Derives a mission's expected answer from its reference query, so authored answers cannot drift from the data.
export const ctxFor = content => ({ lists: content?.lists?.lists ?? [], tables: content?.tables?.tables ?? [] });
export function deriveAnswer(mission, events, ctx = {}) {
  const r = execute(parseSearch(mission.reference, ctx), events);
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
    // format "hhmm": the cell holds a timestamp in seconds (min/max/earliest/latest on the timestamp) and the learner
    // answers with the clock time. format "list": the cell holds an array (array/array_distinct) and the learner
    // answers with the comma-separated values; format "size": the learner answers with the array's length.
    const v = row?.[col];
    if (c.format === 'hhmm') return hhmm(v);
    if (c.format === 'list') return Array.isArray(v) ? v.join(', ') : String(v);
    if (c.format === 'size') return Array.isArray(v) ? String(v.length) : String(v);
    return String(v);
  }
  throw new Error('unknown check type ' + c.type);
}

// The casebook entry kinds a mission's "Log it" may ask for, and the four remediation lists. Mirrors site/ui/casebook.js.
export const LOGIT_KINDS = ['scope', 'evidence', 'timeline', 'hypothesis', 'pivot', 'gap', 'determination', 'remediation', 'handoff'];
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

// content/lists.json: the bundled reference lists. Names are what a query writes after %, types are the three Google
// documents, items must parse (CIDR) or pass the regex guard (regex), and every list carries a description for the
// Lists panel.
export const LIST_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
export function validateLists(raw) {
  const problems = [];
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.lists)) return ['lists.json: shape'];
  const names = new Set();
  for (const l of raw.lists) {
    const where = `lists.json ${l?.name ?? '?'}`;
    if (!l || typeof l.name !== 'string' || !LIST_NAME.test(l.name)) { problems.push(`${where}: bad name`); continue; }
    if (names.has(l.name)) problems.push(`${where}: duplicate name`); names.add(l.name);
    if (!LIST_TYPES.includes(l.type)) problems.push(`${where}: type must be ${LIST_TYPES.join('/')}`);
    if (typeof l.description !== 'string' || l.description.length < 12) problems.push(`${where}: description`);
    if (!Array.isArray(l.items) || !l.items.length || l.items.length > 500 || l.items.some(x => typeof x !== 'string' || !x || x.length > 512)) { problems.push(`${where}: items must be 1 to 500 strings of up to 512 characters`); continue; }
    if (new Set(l.items).size !== l.items.length) problems.push(`${where}: duplicate items`);
    if (l.type === 'cidr') for (const x of l.items) if (!parseCidr(x)) problems.push(`${where}: "${x}" is not a CIDR range`);
    if (l.type === 'regex') for (const x of l.items) { const bad = guardRegex(x); if (bad) problems.push(`${where}: "${x}" fails the regex guard (${bad})`); }
    if (Object.keys(l).some(k => !['name', 'type', 'items', 'description'].includes(k))) problems.push(`${where}: unknown keys`);
  }
  return problems;
}

// content/tables.json: the bundled data tables. Each has a name, a description, one to eight typed columns (the three
// list types) and one to 500 rows with one string per column; CIDR cells must parse and regex cells must pass the guard,
// as list items must. Column values are what %table.column tests against.
export function validateTables(raw) {
  const problems = [];
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tables)) return ['tables.json: shape'];
  const names = new Set();
  for (const t of raw.tables) {
    const where = `tables.json ${t?.name ?? '?'}`;
    if (!t || typeof t.name !== 'string' || !LIST_NAME.test(t.name)) { problems.push(`${where}: bad name`); continue; }
    if (names.has(t.name)) problems.push(`${where}: duplicate name`); names.add(t.name);
    if (typeof t.description !== 'string' || t.description.length < 12) problems.push(`${where}: description`);
    if (!Array.isArray(t.columns) || !t.columns.length || t.columns.length > 8 || t.columns.some(c => !c || typeof c.name !== 'string' || !LIST_NAME.test(c.name) || !LIST_TYPES.includes(c.type))) { problems.push(`${where}: columns must be 1 to 8 of { name, type string|cidr|regex }`); continue; }
    if (new Set(t.columns.map(c => c.name)).size !== t.columns.length) problems.push(`${where}: duplicate column`);
    if (!Array.isArray(t.rows) || !t.rows.length || t.rows.length > 500 || t.rows.some(r => !Array.isArray(r) || r.length !== t.columns.length || r.some(x => typeof x !== 'string' || !x || x.length > 512))) { problems.push(`${where}: rows must be 1 to 500 arrays of ${t.columns.length} non-empty strings up to 512 characters`); continue; }
    t.columns.forEach((c, i) => {
      const cells = t.rows.map(r => r[i]);
      if (new Set(cells).size !== cells.length && c.type !== 'string') problems.push(`${where}.${c.name}: duplicate cells`);
      if (c.type === 'cidr') for (const x of cells) if (!parseCidr(x)) problems.push(`${where}.${c.name}: "${x}" is not a CIDR range`);
      if (c.type === 'regex') for (const x of cells) { const bad = guardRegex(x); if (bad) problems.push(`${where}.${c.name}: "${x}" fails the regex guard (${bad})`); }
    });
    if (Object.keys(t).some(k => !['name', 'description', 'columns', 'rows'].includes(k))) problems.push(`${where}: unknown keys`);
  }
  return problems;
}

// A case file entry: the fields the UI reads, a window, ranges inside the window, chapters that exist, a data file and
// the digest of its events. The digest is how the validator proves an earlier case's events did not move.
export function validateCase(c, chapterIds, data) {
  const problems = []; const where = `case ${c?.id ?? '?'}`;
  if (!c || typeof c !== 'object') return ['case: shape'];
  for (const k of ['id', 'title', 'tagline', 'role', 'summary', 'data', 'closedAt', 'digest']) if (typeof c[k] !== 'string' || !c[k]) problems.push(`${where}: ${k}`);
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(c.id ?? '')) problems.push(`${where}: id must be a lower-case slug`);
  if (!Array.isArray(c.opening) || c.opening.length < 2 || !Array.isArray(c.people) || !c.people.length || !Array.isArray(c.systems) || !c.systems.length) problems.push(`${where}: opening, people and systems`);
  if (!c.window || Number.isNaN(Date.parse(c.window.start)) || Number.isNaN(Date.parse(c.window.end)) || Date.parse(c.window.end) <= Date.parse(c.window.start)) problems.push(`${where}: window`);
  else {
    const span = (Date.parse(c.window.end) - Date.parse(c.window.start)) / 1000;
    if (!Array.isArray(c.ranges) || !c.ranges.length || c.ranges[0].id !== 'all' || c.ranges.some(r => !r.id || !r.label || r.start < 0 || r.end > span || r.end <= r.start)) problems.push(`${where}: ranges must start with "all" and sit inside the window`);
    if (data && (data.window?.start !== Date.parse(c.window.start) / 1000 || data.window?.end !== Date.parse(c.window.end) / 1000)) problems.push(`${where}: data window differs from the case window`);
    if (data && data.events.some(e => e['metadata.event_timestamp.seconds'] < data.window.start || e['metadata.event_timestamp.seconds'] > data.window.end)) problems.push(`${where}: an event lies outside the window`);
  }
  if (!Array.isArray(c.chapters) || !c.chapters.length || c.chapters.some(id => !chapterIds.has(id))) problems.push(`${where}: chapters must name existing chapter files`);
  if (!data) problems.push(`${where}: no dataset`);
  else if (digestOf(data.events) !== c.digest) problems.push(`${where}: events changed (digest ${digestOf(data.events).slice(0, 12)}… does not match case.json). Regenerate deliberately and update the digest, or restore the data.`);
  return problems;
}

export function validate({ cases, chapters, chapterCase, casebook, lists, tables }, datasets) {
  const problems = [];
  if (casebook !== undefined) problems.push(...validateCasebookContent(casebook));
  if (lists !== undefined) problems.push(...validateLists(lists));
  if (tables !== undefined) problems.push(...validateTables(tables));
  if (lists && tables && lists.lists?.some(l => tables.tables?.some(t => t.name === l.name))) problems.push('lists.json and tables.json share a name; a learner could not tell %name from %name.column');
  const ctx = ctxFor({ lists, tables });
  const ids = new Set();
  // Accept a single dataset (earlier branches) as the first case's.
  const sets = datasets?.events ? { [cases[0].id]: datasets } : datasets ?? {};
  const chapterIds = new Set(chapters.map(ch => ch.id));
  if (!Array.isArray(cases) || !cases.length) problems.push('case.json: cases array');
  for (const c of cases ?? []) problems.push(...validateCase(c, chapterIds, sets[c.id]));
  if (new Set((cases ?? []).map(c => c.id)).size !== (cases ?? []).length) problems.push('case.json: duplicate case id');
  const eventIdsOf = {}; for (const [id, d] of Object.entries(sets)) eventIdsOf[id] = new Set(d.events.map(e => e['metadata.id']));
  for (const ch of chapters) {
    const caseId = chapterCase?.[ch.id] ?? cases[0].id; const data = sets[caseId];
    if (!data) { problems.push(`${ch.id}: no dataset for case ${caseId}`); continue; }
    const eventIds = eventIdsOf[caseId];
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
      if (m.logIt?.kind === 'scope' && ch.missions.indexOf(m) > 1) problems.push(`${where}: a Scope Log it belongs to the first or second mission of a case's first chapter`);
      if (m.kind === 'read') { if (m.reference) problems.push(`${where}: read mission has a reference`); continue; }
      if (!m.reference) { problems.push(`${where}: missing reference`); continue; }
      const ref = runQuery(m.reference, data.events, null, ctx);
      if (!ref.ok) { problems.push(`${where}: reference does not run (${ref.code})`); continue; }
      if (m.hints.length !== 3) problems.push(`${where}: expected 3 hints`);
      if (m.kind !== 'watch') { // watch missions already show the full query; their hints are reading prompts
        const full = runQuery(m.hints[2], data.events, null, ctx);
        if (!full.ok || !compareResults(full.result, ref.result).correct) problems.push(`${where}: hint 3 is not a passing answer`);
      }
      if (m.kind === 'build') {
        if (!m.starter.includes('___')) problems.push(`${where}: build starter has no gap`);
        const st = runQuery(m.starter, data.events, null, ctx);
        if (st.ok && compareResults(st.result, ref.result).correct) problems.push(`${where}: starter already passes`);
      }
      if (m.kind === 'solo' && m.starter !== '') problems.push(`${where}: solo starter must be empty`);
      if (m.kind === 'watch' && m.starter !== m.reference) problems.push(`${where}: watch starter should equal reference`);
      if (!m.answer) { problems.push(`${where}: missing answer`); continue; }
      const derived = deriveAnswer(m, data.events, ctx);
      if (normalizeAnswer(derived) !== normalizeAnswer(m.answer.value)) problems.push(`${where}: authored answer "${m.answer.value}" but data says "${derived}"`);
    }
  }
  const named = (cases ?? []).flatMap(c => c.chapters ?? []);
  if (new Set(named).size !== chapters.length || named.length !== chapters.length) problems.push('case.chapters mismatch');
  // Every case ends with exactly one brief mission (the handoff beside the model) in its last chapter, and each case's
  // missions ask for every casebook entry kind, so a fresh casebook fills from Scope to Handoff.
  for (const c of cases ?? []) {
    const ms = chapters.filter(ch => (c.chapters ?? []).includes(ch.id)).flatMap(ch => ch.missions);
    const briefs = ms.filter(m => m.brief === 'casebook');
    if (briefs.length !== 1 || ms.at(-1)?.brief !== 'casebook') problems.push(`case ${c.id}: the last mission must be the one brief mission`);
    const kinds = new Set(ms.map(m => m.logIt?.kind).filter(Boolean));
    for (const k of LOGIT_KINDS) if (!kinds.has(k)) problems.push(`case ${c.id}: no mission asks for a ${k} entry`);
    if (ms.findIndex(m => m.logIt?.kind === 'scope') > 1) problems.push(`case ${c.id}: the Scope must be asked for at the start`);
  }
  return problems;
}
