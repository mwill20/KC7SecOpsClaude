// The Casebook drawer: a right-side panel on wide screens (the desk shifts, nothing is covered) and a full-screen
// sheet on narrow ones. Nine tabs, one small structured form each, every entry rendered through text nodes.
// Drafts (the entry being written) live only in this module's memory; saved entries go through the store in
// casebook.js, which bounds and validates them. Escape closes and focus returns to where it was.
import { el, clear, fmtBytes } from './render.js';
import { KINDS, TABS, KIND_LABEL, ENTRY_LABEL, FIELDS, SINGLE, LISTS, LIST_LABEL, LIST_TEACH, VERDICT_LABEL, MAX_NAME, MAX_FREEFORM, checkEntry, contextFor, sortTimeline, timeKey, toMarkdown, handoffText, normalizePaste, freeformBytes, checkFreeform, exportFilename } from './casebook.js';

const TEACH = {
  scope: 'Write the question before you write an answer. A scope line keeps you from proving something nobody asked. The investigation needs a name first: the field at the top of this drawer.',
  freeform: 'A blank page for raw capture: type fast, paste query text and results, think out loud. Nothing here is graded or checked by Log it; the faded template is a prompt, not a form. When a thought firms up, move it to the structured tab it belongs in.',
  evidence: 'One claim per entry. Time in UTC, the query and range that produced it, and the record IDs. A second analyst at 3 a.m. should be able to rerun it.',
  timeline: 'Facts in clock order, each pointing at the Evidence entry it came from. Sorted automatically by time.',
  hypothesis: 'The story that would explain the facts, labelled as a story. Supported and refuted need references; open needs a test.',
  pivot: 'Where to look next and why. Tick them off; the ones left open go in the handoff as open questions.',
  gap: 'What the logs could not show. A gap is not a failure; an unwritten gap is.',
  determination: 'One call: confirmed incident, benign activity, or inconclusive. Name the evidence that decides it and write two sentences a board member can read.',
  remediation: 'Four lists. Each item answers a piece of evidence, has an owner role and an urgency.',
  handoff: 'The ticket an engineer picks up when you go home. Assembled from the other tabs, then edited. This is the exit point to the Cybersecurity Engineering course that follows this one.',
};
const SELECT_LABEL = { high: 'high', medium: 'medium', low: 'low', open: 'open', supported: 'supported', refuted: 'refuted', now: 'now', today: 'today', 'this-week': 'this week', ...VERDICT_LABEL, ...LIST_LABEL };
const hhmm = s => (String(s).match(/\d{2}:\d{2}/) ?? [''])[0];

export function mountCasebook({ host, toggle, store, cases, template = [] }) {
  let open = false, tab = 'evidence', caseId = cases[0].id, editing = null, returnTo = null, confirmClear = false;
  const drafts = {};
  let context = () => ({ query: '', range: '' });
  const caseInfo = () => cases.find(c => c.id === caseId) ?? { id: caseId, title: caseId + ' (stored casebook)', eventIds: null, dayStartHour: 0 };
  const book = () => store.get(caseId);
  const ctx = () => contextFor(book(), caseInfo().eventIds);
  const narrow = matchMedia('(max-width: 1023px)');

  // Drafts hold raw strings for records and refs until save; the store turns them into bounded arrays.
  const blankDraft = kind => { const d = {}; for (const f of FIELDS[kind]) d[f.key] = f.type === 'check' ? false : f.type === 'source' ? { query: '', range: '' } : ''; return d; };
  const draft = kind => { if (!drafts[kind]) drafts[kind] = SINGLE.has(kind) && book()[kind] ? fromEntry(kind, book()[kind]) : blankDraft(kind); return drafts[kind]; };
  const fromEntry = (kind, e) => { const d = blankDraft(kind); for (const f of FIELDS[kind]) { const v = e[f.key]; if (v === undefined || v === null) continue; d[f.key] = f.type === 'records' ? v.join(', ') : f.type === 'refs' ? v.map(n => '#' + n).join(', ') : f.type === 'ref' ? '#' + v : f.type === 'source' ? { ...v } : v; } return d; };

  const status = el('div', { class: 'cbstatus small', role: 'status', 'aria-live': 'polite', tabindex: -1 });
  const say = (text, cls = '') => { status.textContent = text; status.className = 'cbstatus small ' + cls; };

  function openDrawer(which, opts = {}) {
    if (which && TABS.includes(which)) tab = which;
    if (!open) { returnTo = document.activeElement; open = true; }
    host.hidden = false; document.body.classList.add('cb-open'); toggle.setAttribute('aria-expanded', 'true');
    render();
    if (opts.focus) host.querySelector(opts.focus)?.focus(); else host.querySelector('#cb-title')?.focus();
  }
  function closeDrawer() {
    if (!open) return;
    open = false; host.hidden = true; document.body.classList.remove('cb-open'); toggle.setAttribute('aria-expanded', 'false'); clear(host);
    const back = returnTo && document.contains(returnTo) ? returnTo : toggle; returnTo = null; back.focus();
  }
  host.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); closeDrawer(); } });
  toggle.addEventListener('click', () => (open ? closeDrawer() : openDrawer()));
  // Alt+Shift+C toggles the drawer from any page. Matched on the physical key as well as the key value, because Alt+Shift
  // changes the character some layouts report. Chrome reserves Ctrl+Shift+N, the previous combination, for incognito.
  document.addEventListener('keydown', e => { if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && (e.code === 'KeyC' || e.key === 'C' || e.key === 'c')) { e.preventDefault(); open ? closeDrawer() : openDrawer(); } });
  // Typing into the name field or the FreeForm page saves on every keystroke; those saves must not repaint the drawer
  // under the learner's cursor, so they run with the repaint suppressed. Every other change repaints.
  let quiet = false;
  const quietly = fn => { quiet = true; try { return fn(); } finally { quiet = false; } };
  store.subscribe(() => { if (open && !quiet) render(); });
  narrow.addEventListener('change', () => { if (open) render(); });

  function render() {
    clear(host);
    host.setAttribute('role', 'dialog'); host.setAttribute('aria-labelledby', 'cb-title');
    if (narrow.matches) host.setAttribute('aria-modal', 'true'); else host.removeAttribute('aria-modal');
    const known = cases.map(c => c.id), stored = store.cases().filter(id => !known.includes(id));
    const caseSel = known.length + stored.length > 1 ? el('select', { 'aria-label': 'Case', onchange: e => { caseId = e.target.value; editing = null; for (const k of Object.keys(drafts)) delete drafts[k]; render(); } },
      cases.map(c => el('option', { value: c.id, selected: c.id === caseId, text: c.title })), stored.map(id => el('option', { value: id, selected: id === caseId, text: id + ' (stored)' }))) : null;
    host.append(
      el('div', { class: 'cbhead' },
        el('h2', { id: 'cb-title', tabindex: -1, text: 'Casebook' }),
        el('div', { class: 'row' }, caseSel, el('button', { class: 'ghost', text: 'Close', 'aria-label': 'Close casebook', onclick: closeDrawer }))),
      nameField(),
      el('p', { class: 'small muted cbintro', text: `${caseInfo().title}. Your notes, in your words. The check is for structure, never for the quality of your thinking.` }),
      tabs(), panel(), footer());
  }

  // The investigation name: the first field of every casebook, saved as it is typed, shown in the header, the export
  // title and file name and on the case-closed page. The Scope structure check requires it.
  function nameField() {
    const b = book();
    const input = el('input', { type: 'text', id: 'cb-name', autocomplete: 'off', maxlength: String(MAX_NAME), placeholder: 'Name this investigation', 'aria-label': 'Investigation name', 'aria-describedby': 'cb-name-hint',
      oninput: e => { const r = quietly(() => store.setName(caseId, e.target.value)); if (!r.ok) say(reason(r.reason), 'bad'); } });
    input.value = b.name ?? '';
    return el('div', { class: 'cbname' }, el('label', { for: 'cb-name', class: 'small', text: 'Investigation' }), input,
      el('div', { class: 'small muted', id: 'cb-name-hint', text: 'Short and specific, as the ticket would be titled. Saved as you type; used for the export title and file name.' }));
  }

  function tabs() {
    const b = book();
    const count = k => SINGLE.has(k) ? (b[k] ? 1 : 0) : b[k].length;
    const list = el('div', { class: 'cbtabs', role: 'tablist', 'aria-label': 'Casebook sections' });
    const buttons = TABS.map(k => { const n = k === 'freeform' ? ((b.freeform ?? '').trim() ? 1 : 0) : count(k); return el('button', { role: 'tab', id: 'cbtab-' + k, 'aria-selected': k === tab ? 'true' : 'false', 'aria-controls': 'cbpanel-' + k, tabindex: k === tab ? 0 : -1, class: k === tab ? 'on' : '',
      'aria-label': n ? `${KIND_LABEL[k]}, ${n} ${n === 1 ? 'entry' : 'entries'}` : KIND_LABEL[k],
      onclick: () => { tab = k; editing = null; render(); host.querySelector('#cbtab-' + k)?.focus(); } }, KIND_LABEL[k], n ? el('span', { class: 'cnt', 'aria-hidden': 'true', text: String(n) }) : null); });
    list.append(...buttons);
    list.addEventListener('keydown', e => {
      const i = TABS.indexOf(tab); let j = null;
      if (e.key === 'ArrowRight') j = (i + 1) % TABS.length; else if (e.key === 'ArrowLeft') j = (i + TABS.length - 1) % TABS.length; else if (e.key === 'Home') j = 0; else if (e.key === 'End') j = TABS.length - 1;
      if (j === null) return; e.preventDefault(); tab = TABS[j]; editing = null; render(); host.querySelector('#cbtab-' + tab)?.focus();
    });
    return list;
  }

  function panel() {
    const kind = tab, b = book();
    const p = el('div', { class: 'cbpanel', role: 'tabpanel', id: 'cbpanel-' + kind, 'aria-labelledby': 'cbtab-' + kind });
    p.append(el('p', { class: 'small teach', text: TEACH[kind] }));
    if (kind === 'freeform') { p.append(freeformPanel(b)); return p; }
    if (kind === 'handoff') p.append(el('p', { class: 'small muted', text: 'Harden items become proposed controls; the determination becomes the problem statement. Detection ideas are written in words, never as a query.' }));
    if (SINGLE.has(kind)) {
      if (kind === 'handoff') p.append(el('div', { class: 'row', style: 'margin-bottom:8px' }, el('button', { class: 'ghost', text: 'Assemble from casebook', onclick: assemble })));
      p.append(form(kind, true));
      if (kind === 'handoff') p.append(el('details', { class: 'ticket' }, el('summary', { text: 'Ticket as text' }), el('pre', { text: handoffText(b, caseInfo()) })));
      return p;
    }
    if (kind === 'remediation') {
      for (const list of LISTS) {
        const items = b.remediation.filter(r => r.list === list);
        p.append(el('section', { class: 'rlist', 'aria-label': LIST_LABEL[list] }, el('h3', { text: LIST_LABEL[list] }), el('p', { class: 'small muted', text: LIST_TEACH[list] }),
          items.length ? el('ul', { class: 'entries' }, items.map(e => card(kind, e))) : el('p', { class: 'small muted empty', text: 'No items yet.' })));
      }
    } else {
      const entries = kind === 'timeline' ? sortTimeline(b.timeline, caseInfo().dayStartHour) : b[kind];
      p.append(entries.length ? el('ul', { class: 'entries' }, entries.map(e => card(kind, e))) : el('p', { class: 'small muted empty', text: `No ${KIND_LABEL[kind].toLowerCase()} yet.` }));
    }
    p.append(form(kind, false));
    return p;
  }

  // FreeForm: one bounded textarea. The template is the placeholder (faded, gone as soon as the learner types) and the
  // text "Insert template" drops in at the cursor as editable text. Paste is reduced to plain text and normalised.
  // The optional structure check reports presence only: a UTC time, a query line, record IDs that exist.
  function freeformPanel(b) {
    const tpl = template.join('\n');
    const meterLine = el('span', { class: 'small muted' });
    const meter = el('div', { class: 'cbmeter', role: 'img' }, el('span'));
    const paintMeter = text => { const used = freeformBytes(text); meterLine.textContent = `${fmtBytes(used)} of ${fmtBytes(MAX_FREEFORM)}`; meter.setAttribute('aria-label', `FreeForm: ${meterLine.textContent} used`); meter.firstChild.style.width = Math.min(100, Math.round(100 * used / MAX_FREEFORM)) + '%'; };
    const area = el('textarea', { id: 'cb-freeform', class: 'mono freeform', rows: 16, spellcheck: 'false', placeholder: tpl, 'aria-label': 'Free-form notes', 'aria-describedby': 'cb-freeform-hint' });
    area.value = b.freeform ?? ''; paintMeter(area.value);
    let last = area.value;
    const paintBadge = () => { const t = host.querySelector('#cbtab-freeform'); if (!t) return; const has = area.value.trim().length > 0; t.setAttribute('aria-label', has ? 'FreeForm, 1 entry' : 'FreeForm'); const c = t.querySelector('.cnt'); if (has && !c) t.append(el('span', { class: 'cnt', 'aria-hidden': 'true', text: '1' })); else if (!has && c) c.remove(); };
    const commitText = () => { const r = quietly(() => store.setFreeform(caseId, area.value)); paintBadge(); if (!r.ok) { say(reason(r.reason), 'bad'); area.value = last; } else { last = r.freeform; paintMeter(last); } };
    area.addEventListener('input', commitText);
    area.addEventListener('paste', e => {
      e.preventDefault();
      const text = normalizePaste(e.clipboardData?.getData('text/plain') ?? '');
      area.setRangeText(text, area.selectionStart, area.selectionEnd, 'end'); commitText();
    });
    const insertTemplate = () => { const at = area.selectionStart ?? area.value.length; const text = (at > 0 && area.value[at - 1] !== '\n' ? '\n' : '') + tpl + '\n'; area.setRangeText(text, at, area.selectionEnd ?? at, 'end'); commitText(); area.focus(); say('Template inserted at the cursor. Fill the lines you need; delete the rest.'); };
    const check = () => {
      const r = checkFreeform(area.value, caseInfo().eventIds);
      const parts = [`UTC time (HH:MM): ${r.time ? 'found' : 'none'}`, `a query line: ${r.query ? 'found' : 'none'}`, `record IDs: ${r.record ? r.records.join(', ') : 'none'}` + (r.unknown.length ? ` (not in this dataset: ${r.unknown.join(', ')})` : '')];
      say(`Structure only, nothing graded. ${parts.join('. ')}.`, r.time && r.query && r.record ? 'ok' : 'warn');
    };
    return el('div', { class: 'freeformpanel' },
      el('div', { class: 'small muted', id: 'cb-freeform-hint', text: 'Ungraded by design. The template fades as you type; paste arrives as plain text. Bounded at 24 KB.' }),
      area,
      el('div', { class: 'row', style: 'justify-content:space-between;margin-top:6px' }, meterLine, el('span', { class: 'small muted', text: 'Not checked by Log it.' })),
      meter,
      el('div', { class: 'row', style: 'margin-top:8px' }, el('button', { type: 'button', class: 'ghost', text: 'Insert template', onclick: insertTemplate }), el('button', { type: 'button', class: 'ghost', text: 'Check structure', onclick: check })));
  }

  // One saved entry: its fields as text, the structure check's verdict in plain language, Edit and Delete.
  function card(kind, e) {
    const problems = checkEntry(kind, e, ctx());
    const head = kind === 'evidence' ? `#${e.n} · ${e.time} · ${e.confidence || 'confidence —'}` : kind === 'timeline' ? `${e.time} · ref #${e.ref ?? '—'}` : kind === 'hypothesis' ? e.status || 'status —' : kind === 'remediation' ? `${SELECT_LABEL[e.urgency] || 'urgency —'} · ${e.owner || 'owner —'} · answers ${refs(e.refs)}` : kind === 'gap' ? 'Gap' : 'Pivot';
    const body = kind === 'evidence' ? [el('p', { text: e.observation }), el('div', { class: 'small muted', text: 'Records: ' + (e.records.join(', ') || '—') + (e.where ? ' · ' + e.where : '') }), el('details', {}, el('summary', { class: 'small', text: 'Source · ' + (e.source.range || 'range —') }), el('pre', { text: e.source.query || '(no query)' }))]
      : kind === 'timeline' ? [el('p', { text: e.fact })]
      : kind === 'hypothesis' ? [el('p', { text: e.statement }), el('div', { class: 'small muted', text: `Supporting ${refs(e.supporting)} · Contradicting ${refs(e.contradicting)}` + (e.testNext ? ` · Test next: ${e.testNext}` : '') })]
      : kind === 'pivot' ? [el('label', { class: 'toggle small' }, el('input', { type: 'checkbox', checked: e.done, 'aria-label': 'Done: ' + e.text.slice(0, 60), onchange: ev => { const r = store.update(caseId, 'pivot', e.id, { ...e, done: ev.target.checked }); if (!r.ok) say(reason(r.reason), 'bad'); } }), el('span', { class: e.done ? 'done' : '', text: e.text }))]
      : kind === 'gap' ? [el('p', { text: e.text }), el('div', { class: 'small muted', text: 'Why it matters: ' + e.why })]
      : [el('p', { text: e.text })];
    const check = problems.length ? el('ul', { class: 'small problems', 'aria-label': 'Structure check' }, problems.map(x => el('li', { text: x.message }))) : el('div', { class: 'small passes', text: 'Passes the structure check.' });
    let armed = false; // Delete is two presses: the first arms it, the second removes the entry.
    const del = el('button', { class: 'ghost small', text: 'Delete', 'aria-label': `Delete ${kind === 'evidence' ? '#' + e.n : 'entry'}`, onclick: () => { if (!armed) { armed = true; del.textContent = 'Confirm delete'; return; } store.remove(caseId, kind, e.id); say(`Deleted ${kind === 'evidence' ? 'evidence #' + e.n : 'the entry'}.`); } });
    return el('li', { class: 'entry', id: 'cb-entry-' + e.id, tabindex: -1 }, el('div', { class: 'ehead' }, el('strong', { class: 'small', text: head }), el('span', { class: 'row' }, el('button', { class: 'ghost small', text: 'Edit', 'aria-label': `Edit ${kind === 'evidence' ? '#' + e.n : 'entry'}`, onclick: () => { editing = e.id; drafts[kind] = fromEntry(kind, e); render(); host.querySelector('.cbform textarea, .cbform input')?.focus(); } }), del)), ...body, check);
  }
  const refs = list => (list ?? []).length ? list.map(n => '#' + n).join(', ') : '—';

  function form(kind, single) {
    const d = draft(kind);
    const title = single ? (book()[kind] ? `Edit the ${ENTRY_LABEL[kind].toLowerCase()}` : `Write the ${ENTRY_LABEL[kind].toLowerCase()}`) : editing ? `Edit ${kind === 'evidence' ? 'evidence #' + (book().evidence.find(x => x.id === editing)?.n ?? '') : ENTRY_LABEL[kind].toLowerCase()}` : `New ${ENTRY_LABEL[kind].toLowerCase()}`;
    const f = el('form', { class: 'cbform', 'aria-label': title, onsubmit: e => { e.preventDefault(); save(kind, single); } });
    f.append(el('h3', { text: title }));
    for (const spec of FIELDS[kind]) f.append(field(kind, spec, d));
    const bar = el('div', { class: 'row', style: 'margin-top:10px' }, el('button', { class: 'primary', type: 'submit', text: single ? 'Save' : editing ? 'Save changes' : 'Add entry' }));
    if (editing && !single) bar.append(el('button', { type: 'button', class: 'ghost', text: 'Cancel', onclick: () => { editing = null; drafts[kind] = blankDraft(kind); render(); } }));
    if (!single && !editing) bar.append(el('button', { type: 'button', class: 'ghost', text: 'Clear form', onclick: () => { drafts[kind] = blankDraft(kind); render(); } }));
    f.append(bar);
    return f;
  }

  function field(kind, spec, d) {
    const id = `cb-${kind}-${spec.key}`, hintId = id + '-hint';
    const wrap = el('div', { class: 'cbfield' });
    const label = el('label', { for: id }, spec.label, spec.required ? el('span', { class: 'muted', text: ' · required' }) : null);
    const hint = spec.hint ? el('div', { class: 'small muted', id: hintId, text: spec.hint }) : null;
    const common = { id, 'aria-describedby': hint ? hintId : null };
    let control;
    if (spec.type === 'textarea') control = el('textarea', { ...common, rows: 3, oninput: e => { d[spec.key] = e.target.value; } });
    else if (spec.type === 'select') control = el('select', { ...common, onchange: e => { d[spec.key] = e.target.value; } }, el('option', { value: '', text: '—' }), spec.options.map(o => el('option', { value: o, selected: d[spec.key] === o, text: SELECT_LABEL[o] ?? o })));
    else if (spec.type === 'check') { control = el('input', { ...common, type: 'checkbox', checked: Boolean(d[spec.key]), onchange: e => { d[spec.key] = e.target.checked; } }); put(wrap, el('label', { class: 'toggle small', for: id }, control, el('span', { text: spec.label }))); return wrap; }
    else if (spec.type === 'source') {
      const s = d.source; const editingSource = Boolean(d._editSource);
      const summary = el('div', { class: 'source' }, el('div', { class: 'small muted', text: s.range ? 'Range: ' + s.range : 'Range: —' }), el('pre', { text: s.query || '(no query yet)' }));
      const useBtn = el('button', { type: 'button', class: 'ghost small', text: 'Use current query', onclick: () => { const c = context(); d.source = { query: c.query, range: c.range }; render(); host.querySelector('#' + id + '-edit')?.focus(); } });
      const editBtn = el('button', { type: 'button', id: id + '-edit', class: 'ghost small', text: editingSource ? 'Done editing' : 'Edit source', 'aria-expanded': editingSource ? 'true' : 'false', onclick: () => { d._editSource = !editingSource; render(); host.querySelector('#' + (d._editSource ? id : id + '-edit'))?.focus(); } });
      put(wrap, el('div', { class: 'ehead' }, el('span', { id: id + '-label', text: spec.label }), el('span', { class: 'row' }, useBtn, editBtn)), hint);
      if (editingSource) put(wrap, el('label', { for: id, class: 'small', text: 'Query' }), el('textarea', { id, rows: 3, class: 'mono', 'aria-describedby': hintId, oninput: e => { d.source.query = e.target.value; } }), el('label', { for: id + '-range', class: 'small', text: 'Time-range label' }), el('input', { id: id + '-range', type: 'text', oninput: e => { d.source.range = e.target.value; } }));
      else put(wrap, summary);
      if (editingSource) { wrap.querySelector('#' + id).value = s.query; wrap.querySelector('#' + id + '-range').value = s.range; }
      return wrap;
    }
    else control = el('input', { ...common, type: 'text', autocomplete: 'off', placeholder: spec.type === 'time' ? 'HH:MM' : spec.type === 'ref' ? '#1' : spec.type === 'refs' ? '#1, #2' : spec.type === 'records' ? 'evt-00001, evt-00002' : null, oninput: e => { d[spec.key] = e.target.value; } });
    if (spec.type === 'textarea' || spec.type === 'text' || spec.type === 'time' || spec.type === 'ref' || spec.type === 'refs' || spec.type === 'records') control.value = d[spec.key] ?? '';
    put(wrap, label, hint, control);
    return wrap;
  }
  // Native append would stringify a null child as the word "null"; only real nodes go in.
  const put = (parent, ...nodes) => { for (const n of nodes) if (n) parent.append(n); };

  function save(kind, single) {
    const d = draft(kind); const fields = { ...d }; delete fields._editSource;
    const r = single ? store.setSingle(caseId, kind, fields) : editing ? store.update(caseId, kind, editing, fields) : store.add(caseId, kind, fields);
    if (!r.ok) { say(reason(r.reason), 'bad'); return; }
    const problems = checkEntry(kind, r.entry, ctx());
    const name = kind === 'evidence' ? `Evidence #${r.entry.n}` : ENTRY_LABEL[kind];
    say(problems.length ? `${name} saved. Structure check: ${problems.map(p => p.message).join(' ')}` : `${name} saved and passes the structure check.`, problems.length ? 'warn' : 'ok');
    const wasEditing = editing; editing = null; drafts[kind] = SINGLE.has(kind) ? fromEntry(kind, r.entry) : blankDraft(kind);
    render();
    (host.querySelector(single ? '.cbstatus' : '#cb-entry-' + (wasEditing ?? r.entry.id)) ?? status).focus();
  }
  const reason = code => ({ FULL: 'The casebook is full (96 KB). Shorten or delete entries before adding more.', FREEFORM_FULL: 'The FreeForm page is full (24 KB). Move finished thoughts into the structured tabs, then trim here.', TOO_LONG: 'One field is longer than 4,000 characters.', TOO_MANY: 'Too many entries or references in one place.', BLANK: 'Write something in the entry first.', MISSING: 'That entry no longer exists.' })[code] ?? 'Could not save.';

  // Handoff: fill what the other tabs already know; the engineer-facing fields stay the learner's to write.
  function assemble() {
    const b = book(); const d = draft('handoff');
    if (b.determination) { d.problem = d.problem || b.determination.summary; d.refs = d.refs || (b.determination.refs ?? []).map(n => '#' + n).join(', '); }
    if (!d.refs) d.refs = b.evidence.map(e => '#' + e.n).join(', ');
    const harden = b.remediation.filter(r => r.list === 'harden').map(r => '- ' + r.text).join('\n'); if (harden && !d.controls) d.controls = harden;
    const gaps = b.gap.map(g => '- ' + g.text).join('\n'); const pivots = b.pivot.filter(p => !p.done).map(p => '- ' + p.text).join('\n');
    if (!d.openQuestions && (gaps || pivots)) d.openQuestions = [gaps, pivots].filter(Boolean).join('\n');
    render(); say('Filled the problem statement, evidence refs, proposed controls and open questions from your other tabs. Assets, detection ideas and acceptance criteria are yours to write. Nothing is saved until you press Save.');
    host.querySelector('#cb-handoff-problem')?.focus();
  }

  function footer() {
    const used = store.bytes(), pct = Math.min(100, Math.round(100 * used / store.max));
    const meter = el('div', { class: 'cbmeter', role: 'img', 'aria-label': `${fmtBytes(used)} of ${fmtBytes(store.max)} used` }, el('span', { style: `width:${pct}%` }));
    const clearBtn = el('button', { class: 'ghost small', text: confirmClear ? 'Confirm: clear this casebook' : 'Clear this case', onclick: () => { if (!confirmClear) { confirmClear = true; render(); host.querySelector('.cbfoot button.ghost.small')?.focus(); return; } confirmClear = false; store.clearCase(caseId); for (const k of Object.keys(drafts)) delete drafts[k]; editing = null; say('Casebook cleared for this case.'); } });
    return el('div', { class: 'cbfoot' },
      el('div', { class: 'row', style: 'justify-content:space-between' }, el('span', { class: 'small muted', text: `${fmtBytes(used)} of ${fmtBytes(store.max)}` }), el('span', { class: 'small muted', text: store.remember ? 'Remembered in this browser.' : 'Session only: closes with this tab.' })),
      meter,
      el('div', { class: 'row', style: 'margin-top:8px' },
        el('button', { text: 'Download Markdown', onclick: () => download(store.get(caseId), caseInfo(), say) }),
        el('button', { text: 'Copy handoff ticket', onclick: () => copyTicket(store.get(caseId), caseInfo(), say) }),
        clearBtn),
      status,
      el('p', { class: 'small muted', text: 'Remembering is a toggle on the case file page. Export is a local download; nothing is uploaded. Fiction only: never put real workplace values here.' }));
  }

  return {
    open: openDrawer, close: closeDrawer, toggle: () => (open ? closeDrawer() : openDrawer()), isOpen: () => open,
    setContext(fn) { context = fn; },
    setCase(id) { if (id !== caseId) { caseId = id; editing = null; for (const k of Object.keys(drafts)) delete drafts[k]; if (open) render(); } },
    get caseId() { return caseId; },
    // Insert from results: the record's time and ID go into the Evidence draft. The observation is never touched;
    // the source is filled from the desk only when the draft has none, and stays editable.
    insertEvidence({ time, id }) {
      const d = draft('evidence'); const t = hhmm(time);
      if (!d.time) d.time = t;
      else if (t && !d.time.includes(t)) { const parts = [...(d.time.match(/\d{2}:\d{2}/g) ?? []), t].sort((a, b) => timeKey(a, caseInfo().dayStartHour) - timeKey(b, caseInfo().dayStartHour)); d.time = `${parts[0]} to ${parts.at(-1)}`; }
      const recs = String(d.records ?? '').split(/[,\s;]+/).filter(Boolean); if (id && !recs.includes(id)) recs.push(id); d.records = recs.join(', ');
      if (!d.source.query) { const c = context(); d.source = { query: c.query, range: c.range }; }
      openDrawer('evidence', { focus: '#cb-evidence-observation' });
      say(`Added ${id} at ${t} UTC to the evidence draft. Write the observation, then add the entry.`);
    },
  };
}

// Export as a Markdown file: built from text, offered as a local download the learner starts.
export function download(casebook, caseInfo, say = () => {}) {
  try {
    const md = toMarkdown(casebook, caseInfo);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const file = exportFilename(casebook.name, caseInfo.id);
    const a = el('a', { href: url, download: file, class: 'sr-only', text: 'download' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    say(`Downloaded ${file} (${fmtBytes(md.length)}).`, 'ok');
  } catch { say('The browser refused the download. The export is built from your entries only; try again or copy the ticket instead.', 'bad'); }
}
// Write-only clipboard, on click. If the browser refuses, the ticket text is still visible in the Handoff tab.
export function copyTicket(casebook, caseInfo, say = () => {}) {
  const text = handoffText(casebook, caseInfo);
  if (!navigator.clipboard?.writeText) { say('Clipboard is not available here. Open the Handoff tab and copy the ticket text by hand.', 'warn'); return; }
  navigator.clipboard.writeText(text).then(() => say('Handoff ticket copied to the clipboard.', 'ok'), () => say('The browser refused clipboard access. Open the Handoff tab and copy the ticket text by hand.', 'warn'));
}
