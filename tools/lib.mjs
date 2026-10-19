import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseSearch } from '../site/engine/parser.js';
import { execute, MEMBERS } from '../site/engine/executor.js';
import { runQuery, compareResults, normalizeAnswer, runFor, gradeQuery } from '../site/engine/grader.js';
import { gradeRuleCases } from '../site/engine/rules.js';
import { LIST_TYPES, ENTITY_TYPES, EMPLOYMENT_STATUSES, ACCOUNT_TYPES, ENTITY_ID_PREFIX } from '../site/engine/catalog.js';
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
  // Each case names its directory file (default content/entities.json, the station's); entitiesByCase maps case id to
  // the raw directory, entityFiles maps file name to it (so a shared file is validated once), and entities stays the
  // first case's directory for the earlier shape.
  const entityFiles = {}; const entitiesByCase = {};
  for (const c of cases) { const f = c.entities ?? 'entities.json'; entityFiles[f] ??= JSON.parse(fs.readFileSync(path.join(root, 'content', f), 'utf8')); entitiesByCase[c.id] = entityFiles[f]; }
  const entities = entitiesByCase[cases[0].id];
  return { cases, case: cases[0], chapters, chapterCase, casebook, lists, tables, entities, entitiesByCase, entityFiles, boundary: caseFile.boundary };
}
export function loadData(file = 'events.json') { return JSON.parse(fs.readFileSync(path.join(root, 'data', file), 'utf8')); }
// Every case's dataset, keyed by case id.
export function loadDatasets(content = loadContent()) { return Object.fromEntries(content.cases.map(c => [c.id, loadData(c.data)])); }
export const digestOf = events => crypto.createHash('sha256').update(JSON.stringify(events)).digest('hex');

// A missing or non-numeric value reads as itself, so a reference that returns no row yields an answer mismatch rather than a throw.
const hhmm = s => (Number.isFinite(s) ? new Date(s * 1000).toISOString().slice(11, 16) : String(s));

// Entity records as the engine reads them: content/entities.json (users and assets with ISO validity intervals) becomes
// flat graph.* records with the interval in seconds and a stable ent-NNNNN id, in file order. Mirrors site/app.js.
const secs = iso => Math.floor(Date.parse(iso) / 1000);
export function entityRecords(raw) {
  const out = []; let n = 0;
  const base = (type, r) => ({ 'metadata.id': ENTITY_ID_PREFIX + String(++n).padStart(5, '0'), 'graph.metadata.entity_type': type, 'graph.metadata.product_name': raw.product ?? 'Directory', 'graph.metadata.event_metadata.event_timestamp.seconds': secs(r.valid_from), 'graph.metadata.interval.start_time.seconds': secs(r.valid_from), 'graph.metadata.interval.end_time.seconds': secs(r.valid_to) });
  for (const u of raw?.users ?? []) out.push({ ...base('USER', u), 'graph.entity.user.userid': u.userid, 'graph.entity.user.title': u.title, 'graph.entity.user.department': u.department, 'graph.entity.user.managers.userid': u.manager, 'graph.entity.user.employment_status': u.employment_status, 'graph.entity.user.account_type': u.account_type, 'graph.entity.user.attribute.roles.name': u.role, 'graph.entity.user.attribute.labels.remote_access': u.remote_access });
  for (const a of raw?.assets ?? []) out.push({ ...base('ASSET', a), 'graph.entity.asset.hostname': a.hostname, 'graph.entity.asset.ip': a.ip, 'graph.entity.asset.attribute.roles.name': a.role, 'graph.entity.asset.attribute.labels.owner': a.owner, 'graph.entity.asset.attribute.labels.criticality': a.criticality });
  return out;
}
// The entity records valid at some point inside a case's window: the directory as it stood that night.
export const entitiesFor = (records, win) => (!win ? records : records.filter(e => e['graph.metadata.interval.start_time.seconds'] <= win.end && e['graph.metadata.interval.end_time.seconds'] >= win.start));
const caseWindow = c => ({ start: Date.parse(c.window.start) / 1000, end: Date.parse(c.window.end) / 1000 });

// Derives a mission's expected answer from its reference query, so authored answers cannot drift from the data.
// ctxFor(content, caseId) scopes the entity records to that case's window; without a case every record is in.
export const ctxFor = (content, caseId = null) => {
  const all = entityRecords((caseId && content?.entitiesByCase?.[caseId]) ?? content?.entities);
  const c = caseId ? content.cases.find(x => x.id === caseId) : null;
  return { lists: content?.lists?.lists ?? [], tables: content?.tables?.tables ?? [], entities: c ? entitiesFor(all, caseWindow(c)) : all };
};
export function deriveAnswer(mission, events, ctx = {}) {
  // A rule mission's answer is read from its detections (count, cell, field); a Search mission's from its rows.
  const r = mission.mode === 'rule' ? (() => { const x = runFor(mission, mission.reference, events, null, ctx); if (!x.ok) throw new Error('REFERENCE_BROKEN:' + x.code); return x.result; })() : execute(parseSearch(mission.reference, ctx), events, null, ctx.entities ?? []);
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
// exist in the dataset, so a mission can never ask for a record the learner cannot find; on a desk mission it must also
// be one of the records the mission's reference query returns (refIds: the rows' ids and the records behind each
// aggregated row), so an authored id cannot drift to a neighbouring event the learner's results never show.
const RECORD_ID = /^(?:evt|ent)-\d{5}$/;
export function validateLogIt(li, where, eventIds, refIds = null) {
  const problems = [];
  if (!li || typeof li !== 'object' || Array.isArray(li)) return [`${where}: logIt shape`];
  if (!LOGIT_KINDS.includes(li.kind)) problems.push(`${where}: logIt.kind "${li.kind}" not in ${LOGIT_KINDS.join('/')}`);
  if (typeof li.prompt !== 'string' || li.prompt.trim().length < 20) problems.push(`${where}: logIt.prompt missing or too short`);
  if (!Array.isArray(li.mustInclude) || !li.mustInclude.length || li.mustInclude.some(t => typeof t !== 'string' || !t.trim())) problems.push(`${where}: logIt.mustInclude must be a non-empty list of strings`);
  else for (const token of li.mustInclude) for (const alt of token.split('|')) {
    const id = alt.trim(); if (!RECORD_ID.test(id)) continue;
    if (!eventIds.has(id)) problems.push(`${where}: logIt.mustInclude names ${id}, which is not in the dataset`);
    else if (refIds && !refIds.has(id)) problems.push(`${where}: logIt.mustInclude names ${id}, which the reference query does not return`);
  }
  if (li.list !== undefined && (li.kind !== 'remediation' || !LOGIT_LISTS.includes(li.list))) problems.push(`${where}: logIt.list "${li.list}" only applies to remediation and must be one of ${LOGIT_LISTS.join('/')}`);
  if (Object.keys(li).some(k => !['kind', 'prompt', 'mustInclude', 'list'].includes(k))) problems.push(`${where}: logIt has unknown keys`);
  return problems;
}

// Chapter density, KC7-like: at least DENSITY.min missions per chapter and at most DENSITY.maxDesk of them with a query
// desk (Watch, Build, Your turn). Read missions carry no desk and frame the chapter, so they sit outside the ceiling.
// Every chapter after the first needs DENSITY.solo Your-turn missions; the first chapter may have one.
export const DENSITY = Object.freeze({ min: 7, maxDesk: 8, solo: 2, soloFirst: 1 });

// A rule mission (mode "rule") carries its two test cases: rule.mustFire = { key: [one value per match key], at: "HH:MM" }
// and rule.mustNotFire = { key: [...] }. The reference rule must fire on the first and stay quiet on the second; the
// learner's rule is graded the same way. ctx.window is the case window the clock time is read in.
// The record ids a result stands on: event and entity rows by id, aggregated rows and detections by the records behind them.
export const referenceIds = result => new Set(result.rows.flatMap(row => [row['metadata.id'], ...(row[MEMBERS] ?? [])].filter(Boolean)));

export function validateRuleMission(m, where, events, ctx) {
  const problems = [];
  const r = m.rule;
  if (!r || typeof r !== 'object' || !r.mustFire || !Array.isArray(r.mustFire.key) || !r.mustFire.key.length || !/^\d{2}:\d{2}$/.test(String(r.mustFire.at ?? '')) || !r.mustNotFire || !Array.isArray(r.mustNotFire.key) || !r.mustNotFire.key.length) return [`${where}: a rule mission needs rule.mustFire { key, at HH:MM } and rule.mustNotFire { key }`];
  if (r.mustFire.key.length !== r.mustNotFire.key.length) problems.push(`${where}: mustFire and mustNotFire keys differ in length`);
  if (JSON.stringify(r.mustFire.key) === JSON.stringify(r.mustNotFire.key)) problems.push(`${where}: mustFire and mustNotFire name the same key`);
  const ref = runFor(m, m.reference, events, null, ctx);
  if (!ref.ok) return [...problems, `${where}: reference rule does not run (${ref.code})`];
  if (ref.result.rule.keys.length !== r.mustFire.key.length) problems.push(`${where}: the reference groups by ${ref.result.rule.keys.length} keys but the test cases name ${r.mustFire.key.length}`);
  // The reference is graded exactly as a learner's rule is: it must fire on the must-fire case and stay quiet on the
  // must-not-fire key (RULE_MISSED, RULE_WRONG_WINDOW, RULE_NOISY name what is wrong).
  const g = gradeRuleCases(ref.result, r, ctx.window);
  if (!g.correct) problems.push(`${where}: the reference rule fails its own test cases (${g.reason})`);
  return problems;
}

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

// content/entities.json: the station directory. Users carry userid, title, department, manager, employment_status,
// account_type, role, remote_access; assets carry hostname, ip, owner, role, criticality; every record carries an ISO
// validity interval. Values stay fictional (station LAN addresses, lower-case dotted userids, upper-case hostnames) and
// the versions of one entity may not overlap.
const ISO = iso => typeof iso === 'string' && !Number.isNaN(Date.parse(iso));
// The fictional LANs an organisation's assets may sit on: the station's and the co-operative's. Same rule as the
// dataset tests and the artifact check, which also allow the RFC 5737 documentation ranges.
export const FICTIONAL_LANS = Object.freeze(['10.9.4.', '10.77.3.']);
export function validateEntities(raw) {
  const problems = [];
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.users) || !Array.isArray(raw.assets)) return ['entities.json: shape'];
  if (typeof raw.product !== 'string' || !raw.product) problems.push('entities.json: product');
  const lan = raw.lan ?? FICTIONAL_LANS[0];
  if (!FICTIONAL_LANS.includes(lan)) problems.push(`entities.json: lan must be one of ${FICTIONAL_LANS.join(' ')}`);
  const interval = (r, where) => {
    if (!ISO(r.valid_from) || !ISO(r.valid_to) || Date.parse(r.valid_to) <= Date.parse(r.valid_from)) problems.push(`${where}: valid_from and valid_to must be ISO times with the end after the start`);
  };
  const overlap = (list, key, label) => {
    const byKey = new Map(); for (const r of list) { const k = r[key]; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(r); }
    for (const [k, rs] of byKey) { const sorted = rs.slice().sort((a, b) => Date.parse(a.valid_from) - Date.parse(b.valid_from)); for (let i = 1; i < sorted.length; i++) if (Date.parse(sorted[i].valid_from) < Date.parse(sorted[i - 1].valid_to)) problems.push(`entities.json ${label} ${k}: versions overlap`); }
  };
  const userKeys = ['userid', 'title', 'department', 'manager', 'employment_status', 'account_type', 'role', 'remote_access', 'valid_from', 'valid_to'];
  for (const u of raw.users) {
    const where = `entities.json user ${u?.userid ?? '?'}`;
    if (!u || typeof u !== 'object') { problems.push(`${where}: shape`); continue; }
    if (!/^[a-z][a-z0-9.-]{1,40}$/.test(u.userid ?? '')) problems.push(`${where}: userid`);
    for (const k of ['title', 'department', 'manager', 'role']) if (typeof u[k] !== 'string' || !u[k] || u[k].length > 60) problems.push(`${where}: ${k}`);
    if (!EMPLOYMENT_STATUSES.includes(u.employment_status)) problems.push(`${where}: employment_status must be ${EMPLOYMENT_STATUSES.join('/')}`);
    if (!ACCOUNT_TYPES.includes(u.account_type)) problems.push(`${where}: account_type must be ${ACCOUNT_TYPES.join('/')}`);
    if (!['yes', 'no'].includes(u.remote_access)) problems.push(`${where}: remote_access must be yes or no`);
    interval(u, where);
    if (Object.keys(u).some(k => !userKeys.includes(k))) problems.push(`${where}: unknown keys`);
  }
  const assetKeys = ['hostname', 'ip', 'owner', 'role', 'criticality', 'valid_from', 'valid_to'];
  const userids = new Set(raw.users.map(u => u?.userid));
  for (const a of raw.assets) {
    const where = `entities.json asset ${a?.hostname ?? '?'}`;
    if (!a || typeof a !== 'object') { problems.push(`${where}: shape`); continue; }
    if (!/^[A-Z][A-Z0-9-]{1,30}$/.test(a.hostname ?? '')) problems.push(`${where}: hostname must be an upper-case station name`);
    if (!String(a.ip ?? '').startsWith(lan) || !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a.ip ?? '')) problems.push(`${where}: ip must be on the fictional station LAN ${lan}0/24`);
    if (!userids.has(a.owner)) problems.push(`${where}: owner ${a.owner} is not a user in the directory`);
    if (typeof a.role !== 'string' || !a.role) problems.push(`${where}: role`);
    if (!['LOW', 'MEDIUM', 'HIGH'].includes(a.criticality)) problems.push(`${where}: criticality must be LOW, MEDIUM or HIGH`);
    interval(a, where);
    if (Object.keys(a).some(k => !assetKeys.includes(k))) problems.push(`${where}: unknown keys`);
  }
  overlap(raw.users, 'userid', 'user'); overlap(raw.assets, 'hostname', 'asset');
  if (Object.keys(raw).some(k => !['note', 'product', 'lan', 'users', 'assets'].includes(k))) problems.push('entities.json: unknown keys');
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
  if (c.entities !== undefined && !/^[a-z0-9-]+\.json$/.test(c.entities)) problems.push(`${where}: entities must name a content/*.json directory file`);
  // The engineering bridge (optional): the case-closed page's exit to the engineering course, a title, an intro and
  // three to six headed paragraphs.
  if (c.bridge !== undefined) {
    const b = c.bridge;
    if (!b || typeof b !== 'object' || typeof b.title !== 'string' || !b.title || typeof b.intro !== 'string' || b.intro.length < 40 || !Array.isArray(b.items) || b.items.length < 3 || b.items.length > 6 || b.items.some(x => !x || typeof x.heading !== 'string' || !x.heading || typeof x.text !== 'string' || x.text.length < 60)) problems.push(`${where}: bridge needs a title, an intro and 3 to 6 items of { heading, text }`);
    if (b && Object.keys(b).some(k => !['title', 'intro', 'items'].includes(k))) problems.push(`${where}: bridge has unknown keys`);
  }
  if (!data) problems.push(`${where}: no dataset`);
  else if (digestOf(data.events) !== c.digest) problems.push(`${where}: events changed (digest ${digestOf(data.events).slice(0, 12)}… does not match case.json). Regenerate deliberately and update the digest, or restore the data.`);
  return problems;
}

export function validate({ cases, chapters, chapterCase, casebook, lists, tables, entities, entitiesByCase, entityFiles }, datasets) {
  const problems = [];
  if (casebook !== undefined) problems.push(...validateCasebookContent(casebook));
  if (lists !== undefined) problems.push(...validateLists(lists));
  if (tables !== undefined) problems.push(...validateTables(tables));
  // Every directory file a case names is validated once; the earlier shape (one entities object) still works.
  const dirs = entityFiles ?? (entities !== undefined ? { 'entities.json': entities } : {});
  for (const [f, raw] of Object.entries(dirs)) problems.push(...validateEntities(raw).map(p => p.replace(/^entities\.json/, f)));
  if (lists && tables && lists.lists?.some(l => tables.tables?.some(t => t.name === l.name))) problems.push('lists.json and tables.json share a name; a learner could not tell %name from %name.column');
  const dirsOk = !problems.some(p => Object.keys(dirs).some(f => p.startsWith(f)));
  const content = { cases, lists, tables, entities: dirsOk ? entities : undefined, entitiesByCase: dirsOk ? entitiesByCase : undefined };
  // Accept a single dataset (earlier branches) as the first case's.
  const sets = datasets?.events ? { [cases[0].id]: datasets } : datasets ?? {};
  const ctxOf = {}; const ctxForCase = id => (ctxOf[id] ??= { ...ctxFor(content, cases?.some(c => c.id === id && c.window) ? id : null), window: sets[id]?.window ?? null });
  const ids = new Set();
  const chapterIds = new Set(chapters.map(ch => ch.id));
  if (!Array.isArray(cases) || !cases.length) problems.push('case.json: cases array');
  for (const c of cases ?? []) problems.push(...validateCase(c, chapterIds, sets[c.id]));
  if (new Set((cases ?? []).map(c => c.id)).size !== (cases ?? []).length) problems.push('case.json: duplicate case id');
  // A Log it may cite an event record or an entity record valid in the case's window.
  const eventIdsOf = {}; for (const [id, d] of Object.entries(sets)) eventIdsOf[id] = new Set([...d.events.map(e => e['metadata.id']), ...ctxForCase(id).entities.map(e => e['metadata.id'])]);
  for (const ch of chapters) {
    const caseId = chapterCase?.[ch.id] ?? cases[0].id; const data = sets[caseId];
    if (!data) { problems.push(`${ch.id}: no dataset for case ${caseId}`); continue; }
    const eventIds = eventIdsOf[caseId]; const ctx = ctxForCase(caseId);
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
      // Read missions have no query: their record ids are checked for existence. Desk missions are checked against the
      // reference's rows once the reference has run, below.
      if (m.logIt !== undefined && m.kind === 'read') problems.push(...validateLogIt(m.logIt, where, eventIds));
      if (m.brief !== undefined && (m.brief !== 'casebook' || m.kind !== 'read' || !['Facts', 'Hypotheses', 'Gaps', 'Determination', 'Remediation', 'Handoff'].every(part => m.explain?.some(e => e.part === part)))) problems.push(`${where}: brief must be "casebook" on a read mission whose explain carries all six brief sections`);
      if (m.logIt?.kind === 'scope' && ch.missions.indexOf(m) > 1) problems.push(`${where}: a Scope Log it belongs to the first or second mission of a case's first chapter`);
      if (m.kind === 'read') { if (m.reference) problems.push(`${where}: read mission has a reference`); continue; }
      if (!m.reference) { problems.push(`${where}: missing reference`); continue; }
      if (m.mode !== undefined && m.mode !== 'rule') problems.push(`${where}: mode must be "rule" or absent`);
      const isRule = m.mode === 'rule';
      if (isRule) { const rp = validateRuleMission(m, where, data.events, ctx); if (rp.length) { problems.push(...rp); continue; } }
      else if (m.rule !== undefined) problems.push(`${where}: rule test cases belong to a mission in rule mode`);
      const ref = runFor(m, m.reference, data.events, null, ctx);
      if (!ref.ok) { problems.push(`${where}: reference does not run (${ref.code})`); continue; }
      if (m.logIt !== undefined) problems.push(...validateLogIt(m.logIt, where, eventIds, referenceIds(ref.result)));
      // A text passes when it grades correct in the mission's mode: the same evidence as the reference for a Search
      // mission, the must-fire and must-not-fire cases for a rule mission.
      const passes = text => gradeQuery(text, m, data.events, null, ctx).status === 'correct';
      if (m.hints.length !== 3) problems.push(`${where}: expected 3 hints`);
      if (m.kind !== 'watch') { // watch missions already show the full query; their hints are reading prompts
        if (!passes(m.hints[2])) problems.push(`${where}: hint 3 is not a passing answer`);
      }
      if (m.kind === 'build') {
        if (!m.starter.includes('___')) problems.push(`${where}: build starter has no gap`);
        if (passes(m.starter)) problems.push(`${where}: starter already passes`);
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
  // Every case ends with a brief mission (the handoff beside the model) in its last chapter (a case may show an earlier
  // brief too), and each case's missions ask for every casebook entry kind, so a fresh casebook fills from Scope to Handoff.
  for (const c of cases ?? []) {
    const ms = chapters.filter(ch => (c.chapters ?? []).includes(ch.id)).flatMap(ch => ch.missions);
    if (ms.at(-1)?.brief !== 'casebook') problems.push(`case ${c.id}: the last mission must be a brief mission`);
    const kinds = new Set(ms.map(m => m.logIt?.kind).filter(Boolean));
    for (const k of LOGIT_KINDS) if (!kinds.has(k)) problems.push(`case ${c.id}: no mission asks for a ${k} entry`);
    if (ms.findIndex(m => m.logIt?.kind === 'scope') > 1) problems.push(`case ${c.id}: the Scope must be asked for at the start`);
  }
  return problems;
}
