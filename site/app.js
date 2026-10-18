import { CONTENT, DATASETS } from './bundle.js';
import { FIELDS, DOCS, FUNCTIONS } from './engine/catalog.js';
import { runQuery, gradeQuery, gradeAnswer, gradeCall, POINTS } from './engine/grader.js';
import { describe } from './ui/messages.js';
import { createStore, CASEBOOK_POINTS } from './ui/progress.js';
import { el, clear, resultsTable, rawRecord, fmtNum, fmtBytes } from './ui/render.js';
import { createCasebook, checkLogIt, contextFor, ENTRY_LABEL, LIST_LABEL, LISTS, VERDICT_LABEL, sortTimeline, handoffText } from './ui/casebook.js';
import { mountCasebook, download, copyTicket } from './ui/casebook-ui.js';

// Cases: each has its own story, window, ranges, chapters, dataset and casebook. Chapters and missions are numbered
// across cases (chapter 7 is the second case's first), and progress is one store across the course.
const CASE_LIST = CONTENT.cases;
const CASE = CASE_LIST[0];
const CASE_BY_ID = new Map(CASE_LIST.map(c => [c.id, c]));
const CHAPTERS = CONTENT.chapters.map(ch => ({ ...ch, caseId: CONTENT.chapterCase?.[ch.id] ?? CASE.id }));
const MISSIONS = CHAPTERS.flatMap(ch => ch.missions.map(m => ({ ...m, chapterId: ch.id, chapterTitle: ch.title, caseId: ch.caseId })));
const BY_ID = new Map(MISSIONS.map(m => [m.id, m]));
const store = createStore(new Set(MISSIONS.map(m => m.id)));
const eventsOf = caseId => DATASETS[caseId].events;
const windowOf = caseId => DATASETS[caseId].window;
const caseChapters = c => CHAPTERS.filter(ch => ch.caseId === c.id);
const caseMissions = c => MISSIONS.filter(m => m.caseId === c.id);
const caseIndex = c => CASE_LIST.indexOf(c);
// The first case keeps the #closed route earlier releases linked to; later cases get #closed/<id>. Home takes #case/<id>.
const closedHref = c => (caseIndex(c) === 0 ? '#closed' : '#closed/' + c.id);
const homeHref = c => (caseIndex(c) === 0 ? '#' : '#case/' + c.id);
// Reference lists are bundled content. In a tenant they are objects under Detection > Lists; the query names them with %.
const REF_LISTS = CONTENT.lists?.lists ?? [];
const CTX = { lists: REF_LISTS };
const KIND_LABEL = { watch: 'Watch one', build: 'Build it', solo: 'Your turn', read: 'Read' };
// The investigative parts (query, answer, analyst call) and, for missions that carry a "Log it", the Casebook part.
const investigateMax = m => (m.kind === 'read' ? POINTS.call : m.kind === 'watch' ? POINTS.answer + POINTS.call : POINTS.query + POINTS.answer + POINTS.call);
const missionMax = m => investigateMax(m) + (m.logIt ? CASEBOOK_POINTS : 0);
const COURSE_MAX = MISSIONS.reduce((s, m) => s + missionMax(m), 0);
const investigated = m => { const r = store.get(m.id); return (m.kind === 'read' ? 0 : m.kind === 'watch' ? 0 : r.q) + (m.kind === 'read' ? 0 : r.a) + r.c; };
const earned = m => investigated(m) + (m.logIt ? store.get(m.id).cb : 0);
const isInvestigated = m => investigated(m) === investigateMax(m);
const isDone = m => earned(m) === missionMax(m);
// The Log it block unlocks once the query is correct (Build, Your turn), the answer is read (Watch) or the call is made (Read).
const logItOpen = m => { const r = store.get(m.id); return m.kind === 'read' ? r.c > 0 : m.kind === 'watch' ? r.a > 0 : r.q > 0; };

// The Casebook: one notebook per case, stored apart from progress. The data model is case-scoped so a later case gets
// its own casebook and this one stays readable from the case switcher in the drawer.
const casebook = createCasebook();
const EVENT_IDS = Object.fromEntries(CASE_LIST.map(c => [c.id, new Set(eventsOf(c.id).map(e => e['metadata.id']))]));
const CASES = CASE_LIST.map(c => ({ id: c.id, title: c.title, eventIds: EVENT_IDS[c.id], dayStartHour: new Date(windowOf(c.id).start * 1000).getUTCHours() }));
const caseInfo = id => CASES.find(c => c.id === id) ?? CASES[0];
const hhmm = seconds => new Date(seconds * 1000).toISOString().slice(11, 16);

// Per-mission working state lives only in memory and only for this tab.
const session = new Map();
const sess = id => { if (!session.has(id)) session.set(id, { text: null, rangeId: 'all', run: null, query: null, answer: null, call: null, hint: 0, picked: null }); return session.get(id); };
const rangeFor = (caseId, id) => { const c = CASE_BY_ID.get(caseId); const w = windowOf(caseId); const r = c.ranges.find(x => x.id === id) ?? c.ranges[0]; return { start: w.start + r.start, end: w.start + r.end }; };

const app = document.getElementById('main');
const topscore = document.getElementById('topscore');
const cbui = mountCasebook({ host: document.getElementById('casebook'), toggle: document.getElementById('casebook-toggle'), store: casebook, cases: CASES, template: CONTENT.casebook?.freeformTemplate ?? [] });
let onBookChange = null; // the current page's repaint hook for casebook changes (the brief and the closed page use it)
casebook.subscribe(() => onBookChange?.());
const chapterprog = document.getElementById('chapterprog');
const chapterDone = ch => ch.missions.filter(mm => isDone(BY_ID.get(mm.id))).length;
const caseDone = c => caseMissions(c).every(isDone);
const currentChapterId = () => { const hash = location.hash.replace(/^#\/?/, ''); return BY_ID.get(hash)?.chapterId ?? (CHAPTERS.some(c => c.id === hash) ? hash : null); };
const SITE_TITLE = 'Static on Pier Nine · YARA-L Search practice';
// The skip link must move focus without touching the hash, or the router would send the learner home.
document.querySelector('.skip')?.addEventListener('click', e => { e.preventDefault(); app.focus(); app.scrollIntoView(); });
// Anchor styled as a button: one tab stop, Enter follows the link. Never nest a <button> inside an <a>.
const linkBtn = (href, text, primary = false) => el('a', { class: 'btn' + (primary ? ' primary' : ''), href, text });
function paintScore() {
  topscore.textContent = `${fmtNum(store.total())} / ${fmtNum(COURSE_MAX)} pts`;
  // One segment per chapter: number, a thin bar, and a full description for assistive tech. The current chapter is marked.
  clear(chapterprog); const cur = currentChapterId();
  chapterprog.append(...CHAPTERS.map((ch, i) => { const d = chapterDone(ch), n = ch.missions.length;
    return el('li', {}, el('a', { class: 'chap' + (d === n ? ' done' : d ? ' partial' : '') + (ch.id === cur ? ' current' : ''), href: '#' + ch.id, 'aria-current': ch.id === cur ? 'page' : null,
      'aria-label': `Chapter ${i + 1}, ${ch.title}: ${d} of ${n} missions complete` },
      el('span', { class: 'n', 'aria-hidden': 'true', text: String(i + 1) }), el('span', { class: 'bar', 'aria-hidden': 'true' }, el('span', { style: `width:${Math.round(100 * d / n)}%` })))); }));
}

function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  clear(app); onBookChange = null; cbui.setContext(() => ({ query: '', range: '' }));
  let title = CASE.title;
  const closedFor = /^closed(?:\/([a-z0-9-]+))?$/.exec(hash), homeFor = /^case\/([a-z0-9-]+)$/.exec(hash);
  if (hash === 'about') { cbui.setCase(CASE.id); app.append(aboutPage()); title = 'What this is'; }
  else if (closedFor) { const c = CASE_BY_ID.get(closedFor[1] ?? CASE.id) ?? CASE; cbui.setCase(c.id); app.append(closedPage(c)); title = `Case closed · ${c.title}`; }
  else if (BY_ID.has(hash)) { const m = BY_ID.get(hash); cbui.setCase(m.caseId); app.append(missionPage(m)); title = m.title; }
  else if (CHAPTERS.some(c => c.id === hash)) { const ch = CHAPTERS.find(c => c.id === hash); cbui.setCase(ch.caseId); app.append(chapterPage(ch)); title = ch.title; }
  else { const c = (homeFor && CASE_BY_ID.get(homeFor[1])) || CASE; cbui.setCase(c.id); app.append(homePage(c)); title = caseIndex(c) === 0 ? CASE.title : c.title; }
  document.title = title === CASE.title ? SITE_TITLE : `${title} · ${SITE_TITLE}`;
  paintScore();
  app.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

// ---------- Home ----------
// One case at a time: a switcher at the top names every case with its progress, and the page below is the selected
// case's file (story, chapters, people and systems, its casebook). Progress and the About page are course-wide.
function caseSwitcher(current) {
  return el('nav', { class: 'cases', 'aria-label': 'Cases' },
    el('ol', {}, CASE_LIST.map((c, i) => { const ms = caseMissions(c); const d = ms.filter(isDone).length;
      return el('li', {}, el('a', { class: 'casetab' + (c === current ? ' current' : '') + (d === ms.length ? ' done' : ''), href: homeHref(c), 'aria-current': c === current ? 'page' : null, 'aria-label': `Case ${i + 1}, ${c.title}: ${d} of ${ms.length} missions complete` },
        el('span', { class: 'small muted', 'aria-hidden': 'true', text: `Case ${i + 1}` }), el('strong', { 'aria-hidden': 'true', text: c.title }), el('span', { class: 'small muted', 'aria-hidden': 'true', text: `${d} / ${ms.length} missions` }))); })));
}
function homePage(c = CASE) {
  const ms = caseMissions(c); const done = ms.filter(isDone).length; const chapters = caseChapters(c); const courseDone = MISSIONS.filter(isDone).length;
  return el('div', {},
    caseSwitcher(c),
    el('section', { class: 'card story' },
      el('div', { class: 'eyebrow', text: `Case file ${caseIndex(c) + 1} of ${CASE_LIST.length} · Google SecOps · YARA-L 2.0 Search` }),
      el('h1', { text: c.title }),
      el('p', { class: 'muted', text: c.tagline }),
      ...c.opening.map(p => el('p', { text: p })),
      el('p', {}, el('strong', { text: 'Your role. ' }), c.role),
      el('div', { class: 'row', style: 'margin-top:14px' },
        caseDone(c) ? linkBtn(closedHref(c), 'Read the case-closed handoff →', true) : linkBtn('#' + (ms.find(m => !isDone(m)) ?? ms[0]).id, done ? 'Continue the case →' : 'Open the case →', true),
        el('span', { class: 'muted small', text: `${done} of ${ms.length} missions complete in this case · ${courseDone} of ${MISSIONS.length} in the course · ${fmtNum(store.total())} of ${fmtNum(COURSE_MAX)} points` })),
    ),
    el('section', { class: 'card' },
      el('div', { class: 'eyebrow', text: 'Chapters' }),
      el('div', { class: 'grid' }, chapters.map(ch => { const i = CHAPTERS.indexOf(ch);
        const cms = ch.missions.map(m => BY_ID.get(m.id)); const d = cms.filter(isDone).length;
        return el('a', { class: 'card chapter-card', href: '#' + ch.id },
          el('div', { class: 'num', text: String(i + 1).padStart(2, '0') }),
          el('h2', { class: 'sub', text: ch.title }), el('p', { class: 'muted small', text: ch.subtitle }),
          el('div', { class: 'bar', role: 'img', 'aria-label': `${d} of ${cms.length} missions complete` }, el('span', { style: `width:${Math.round(100 * d / cms.length)}%` })),
          el('div', { class: 'muted small', text: `${d} / ${cms.length} missions` }));
      }))),
    el('section', { class: 'card' },
      el('div', { class: 'eyebrow', text: 'People and systems' }),
      el('table', { class: 'people' }, el('tbody', {}, [...c.people.map(p => el('tr', {}, el('td', { text: p.name }), el('td', { class: 'muted', text: p.role }), el('td', { text: p.note }))),
        ...c.systems.map(s => el('tr', {}, el('td', { class: 'mono', text: s.name }), el('td', { class: 'muted', text: 'system' }), el('td', { text: s.note })))]))),
    el('section', { class: 'card' },
      el('div', { class: 'eyebrow', text: 'Remembering progress' }),
      el('label', { class: 'toggle' }, el('input', { type: 'checkbox', checked: store.remember, disabled: !store.available, onchange: e => { store.setRemember(e.target.checked); paintScore(); } }),
        el('span', {}, 'Remember my points in this browser. Stores mission IDs, points and hint levels only; never query text or answers. Leave off on a shared device.', store.available ? '' : ' (Storage is unavailable here, so progress is session-only.)')),
      el('div', { class: 'row', style: 'margin-top:10px' }, el('button', { class: 'ghost', text: 'Clear all progress', onclick: () => { if (confirm('Clear all saved and current progress?')) { store.clear(); route(); } } }))),
    casebookCard(c),
    el('section', { class: 'card notice' }, el('strong', { text: 'Boundary. ' }), CONTENT.boundary ?? CASE.boundary, ' ', el('a', { href: '#about', text: 'What this trainer is and is not.' })),
  );
}

// Home: the casebook's own remembering toggle, its 96 KB meter and a per-case clear. Separate from progress on purpose.
function casebookCard(c = CASE) {
  const meterLine = el('span', { class: 'small muted' });
  const meter = el('div', { class: 'cbmeter', role: 'img' }, el('span'));
  const paint = () => { const used = casebook.bytes(); meterLine.textContent = `${fmtBytes(used)} of ${fmtBytes(casebook.max)} used`; meter.setAttribute('aria-label', meterLine.textContent); meter.firstChild.style.width = Math.min(100, Math.round(100 * used / casebook.max)) + '%'; };
  paint(); onBookChangeAlso(paint);
  const clearBtn = el('button', { class: 'ghost', text: 'Clear this case\u2019s casebook' });
  let armed = false;
  clearBtn.addEventListener('click', () => { if (!armed) { armed = true; clearBtn.textContent = 'Confirm: clear the casebook'; return; } casebook.clearCase(c.id); armed = false; clearBtn.textContent = 'Clear this case\u2019s casebook'; });
  return el('section', { class: 'card' },
    el('div', { class: 'eyebrow', text: 'Remembering the casebook' }),
    el('label', { class: 'toggle' }, el('input', { type: 'checkbox', checked: casebook.remember, disabled: !casebook.available, onchange: e => { casebook.setRemember(e.target.checked); } }),
      el('span', {}, 'Remember my casebook in this browser. Stores your own notes for this case (investigation name, scope, free-form notes, evidence, timeline, hypotheses, pivots, gaps, determination, remediation, handoff) under 96 KB. Off by default; leave off on a shared device.', casebook.available ? '' : ' (Storage is unavailable here, so the casebook is session-only.)')),
    el('div', { class: 'row', style: 'margin-top:10px;justify-content:space-between' }, meterLine, el('button', { class: 'ghost', text: 'Open the Casebook', onclick: () => { cbui.setCase(c.id); cbui.open(); } })),
    el('p', { class: 'small muted', style: 'margin:8px 0 0', text: `One casebook per case. This button opens the one for ${c.title}; the drawer has a case switcher too.` }),
    meter,
    el('div', { class: 'row', style: 'margin-top:10px' }, clearBtn),
    el('p', { class: 'small muted', style: 'margin:8px 0 0', text: 'The Casebook button in the top bar, or Alt+Shift+C, opens it on every page. Export is a local Markdown download; nothing is uploaded.' }));
}
const onBookChangeAlso = fn => { const prev = onBookChange; onBookChange = () => { prev?.(); fn(); }; };

// ---------- Chapter ----------
function chapterPage(ch) {
  const idx = CHAPTERS.indexOf(ch); const c = CASE_BY_ID.get(ch.caseId);
  return el('div', {},
    el('section', { class: 'card story' },
      el('div', { class: 'crumbs' }, el('a', { href: homeHref(c), text: 'Case file' + (CASE_LIST.length > 1 ? ` ${caseIndex(c) + 1}: ${c.title}` : '') }), ' › ', `Chapter ${idx + 1}`),
      el('div', { class: 'eyebrow', text: `Chapter ${String(idx + 1).padStart(2, '0')}` }),
      el('h1', { text: ch.title }), el('p', { class: 'muted', text: ch.subtitle }), el('p', { text: ch.intro }),
      el('ul', { class: 'chips' }, ch.concepts.map(c => el('li', { text: c })))),
    missionMap(ch),
    el('section', { class: 'card' },
      el('div', { class: 'eyebrow', text: 'Missions' }),
      el('ul', { class: 'list' }, ch.missions.map((mm, i) => { const m = BY_ID.get(mm.id); return el('li', {},
        el('a', { href: '#' + m.id }, `${i + 1}. ${m.title}`),
        el('span', { class: 'row' }, el('span', { class: 'pill ' + m.kind, text: KIND_LABEL[m.kind] }), el('span', { class: 'pill' + (isDone(m) ? ' done' : ''), text: `${earned(m)} / ${missionMax(m)}` }))); }))),
    recapCard(ch),
    el('div', { class: 'navrow' }, idx > 0 ? linkBtn('#' + CHAPTERS[idx - 1].id, '← Previous chapter') : el('span'),
      caseDone(c) && caseChapters(c).at(-1) === ch ? linkBtn(closedHref(c), 'Case closed →', true) : idx < CHAPTERS.length - 1 ? linkBtn('#' + CHAPTERS[idx + 1].id, 'Next chapter →') : el('span')));
}

// Mission map: one segment per mission at the top of a chapter page, coloured by kind and filled when complete, each a
// link. Chapters are long enough now that the list below needs a shape above it; the legend names the four kinds.
function missionMap(ch) {
  const d = chapterDone(ch), n = ch.missions.length;
  const kinds = [...new Set(ch.missions.map(m => m.kind))];
  return el('section', { class: 'card mmap', 'aria-label': 'Mission map' },
    el('div', { class: 'row', style: 'justify-content:space-between;align-items:baseline' },
      el('div', { class: 'eyebrow', style: 'margin:0', text: `Mission map · ${d} of ${n} complete` }),
      el('ul', { class: 'legend', 'aria-label': 'Kinds in this chapter' }, kinds.map(k => el('li', {}, el('span', { class: 'swatch ' + k, 'aria-hidden': 'true' }), KIND_LABEL[k])))),
    el('ol', { class: 'strip' }, ch.missions.map((mm, i) => { const m = BY_ID.get(mm.id); const done = isDone(m);
      return el('li', {}, el('a', { class: 'seg ' + m.kind + (done ? ' done' : isInvestigated(m) || earned(m) ? ' partial' : ''), href: '#' + m.id,
        'aria-label': `Mission ${i + 1}, ${m.title}, ${KIND_LABEL[m.kind]}, ${done ? 'complete' : earned(m) ? 'in progress' : 'not started'}`, title: `${i + 1}. ${m.title} · ${KIND_LABEL[m.kind]}` },
        el('span', { class: 'n', 'aria-hidden': 'true', text: String(i + 1) }), el('span', { class: 'fill', 'aria-hidden': 'true' }))); })));
}

// Chapter-end recap: what the learner can now do, in plain language. Before the chapter is complete it reads as a
// promise; once every mission is done it reads as a record, and the card turns green.
function recapCard(ch) {
  const d = chapterDone(ch), n = ch.missions.length, complete = d === n;
  return el('section', { class: 'card recap' + (complete ? ' complete' : ''), 'aria-label': 'Chapter recap' },
    el('div', { class: 'eyebrow', text: complete ? 'Chapter complete · you can now' : 'By the end of this chapter you will be able to' }),
    el('ul', {}, ch.recap.map(r => el('li', { text: r }))),
    el('p', { class: 'small muted', text: complete ? 'Every mission in this chapter is complete.' : `${d} of ${n} missions complete so far.` }));
}

// Case closed: the handoff from the last mission, laid out as the three columns it teaches, shown once every mission
// is complete. Until then the page says what is left.
function closedPage(c = CASE) {
  const ms = caseMissions(c); const done = caseDone(c);
  const handoff = ms.find(m => m.brief === 'casebook') ?? ms.at(-1);
  const column = part => { const x = handoff.explain.find(e => e.part === part); return x ? x.meaning.split(/\.\s+(?=[A-Z0-9])/).map(t => t.replace(/\.$/, '')) : []; };
  const remaining = ms.filter(m => !isDone(m));
  const head = el('section', { class: 'card story' },
    el('div', { class: 'crumbs' }, el('a', { href: homeHref(c), text: 'Case file' + (CASE_LIST.length > 1 ? ` ${caseIndex(c) + 1}: ${c.title}` : '') }), ' › Case closed'),
    el('div', { class: 'eyebrow', text: done ? `Case closed · ${c.closedAt ?? ''}`.trim() : 'Case still open' }),
    el('h1', { text: done ? 'The handoff' : 'The handoff is not written yet' }),
    el('p', { text: done ? handoff.clue : `${remaining.length} of ${ms.length} missions in ${c.title} are still open. The handoff is written once every mission in the case is complete; what is below is what you can already do.` }));
  if (!done) {
    return el('div', {}, head,
      el('section', { class: 'card' }, el('div', { class: 'eyebrow', text: 'Still to do' }),
        el('ul', { class: 'list' }, remaining.map(m => el('li', {}, el('a', { href: '#' + m.id, text: `${m.chapterTitle} › ${m.title}` }), el('span', { class: 'pill ' + m.kind, text: KIND_LABEL[m.kind] }))))),
      skillsCard(c),
      closedCasebook(c),
      el('div', { class: 'navrow' }, linkBtn(homeHref(c), '← Back to the case file'), linkBtn('#' + remaining[0].id, 'Next open mission →', true)));
  }
  const next = CASE_LIST[caseIndex(c) + 1];
  return el('div', {}, head,
    closedCasebook(c),
    el('div', { class: 'columns' },
      ['Facts', 'Hypotheses', 'Gaps'].map(part => el('section', { class: 'card closed ' + part.toLowerCase(), 'aria-label': part },
        el('div', { class: 'eyebrow', text: part }),
        el('p', { class: 'small muted', text: part === 'Facts' ? 'A second analyst could reproduce each of these from the same queries.' : part === 'Hypotheses' ? 'The story that explains the facts, labelled as a story.' : 'What the logs could not show. Each one is a task for daylight.' }),
        el('ul', {}, column(part).map(t => el('li', { text: t })))))),
    skillsCard(c),
    el('section', { class: 'card notice' }, el('strong', { text: 'What this proves. ' }), 'You can read and write the taught subset of YARA-L 2.0 Search against this fictional data. It does not prove tenant execution; run each shape once in your own tenant before relying on it.'),
    el('div', { class: 'navrow' }, linkBtn(homeHref(c), '← Back to the case file'), next ? linkBtn(homeHref(next), `Next case: ${next.title} →`, true) : linkBtn('#' + handoff.id, 'Reread the handoff mission')));
}
// Case closed: the learner's own Determination and Handoff ticket, with the export buttons. Repaints as the casebook changes.
function closedCasebook(c = CASE) {
  const box = el('section', { class: 'card closedbook', 'aria-label': 'Casebook' });
  const paint = () => {
    clear(box); const b = casebook.get(c.id); const d = b.determination;
    const status = el('div', { class: 'small', role: 'status', 'aria-live': 'polite' });
    const say = (text, cls = '') => { status.textContent = text; status.style.color = cls === 'ok' ? 'var(--ok)' : cls === 'bad' ? 'var(--bad)' : cls === 'warn' ? 'var(--warn)' : 'var(--muted)'; };
    const fillers = kind => caseMissions(c).filter(m => m.logIt?.kind === kind).map(m => el('a', { href: '#' + m.id, text: m.id }));
    box.append(el('div', { class: 'eyebrow', text: 'Your casebook' }),
      el('h2', { class: 'sub cbname-title', text: (b.name ?? '').trim() || 'Unnamed investigation' }),
      el('p', { class: 'small muted', text: 'The determination and the engineering handoff you wrote while working the case. The export is a local file; the copy is write-only to your clipboard.' }),
      el('h2', { class: 'sub', text: 'Determination' }),
      d ? el('div', {}, el('p', {}, el('strong', { text: (VERDICT_LABEL[d.verdict] ?? d.verdict ?? '—') + ' · confidence ' + (d.confidence || '—') }), ' · decided by ' + ((d.refs ?? []).map(n => '#' + n).join(', ') || '—')), el('p', { text: d.summary }))
        : el('p', { class: 'small muted' }, 'Not written yet. The mission that asks for it: ', ...fillers('determination').flatMap((a, i) => (i ? [', ', a] : [a])), '.'),
      el('h2', { class: 'sub', text: 'Handoff ticket' }),
      b.handoff ? el('pre', { text: handoffText(b, caseInfo(c.id)) }) : el('p', { class: 'small muted' }, 'Not written yet. The mission that asks for it: ', ...fillers('handoff').flatMap((a, i) => (i ? [', ', a] : [a])), '.'),
      el('div', { class: 'row', style: 'margin-top:10px' },
        el('button', { text: 'Download Markdown', onclick: () => download(casebook.get(c.id), caseInfo(c.id), say) }),
        el('button', { text: 'Copy handoff ticket', onclick: () => copyTicket(casebook.get(c.id), caseInfo(c.id), say) }),
        el('button', { class: 'ghost', text: 'Open the Casebook', onclick: () => { cbui.setCase(c.id); cbui.open('handoff'); } })),
      status);
  };
  paint(); onBookChangeAlso(paint);
  return box;
}
function skillsCard(c = CASE) {
  return el('section', { class: 'card' }, el('div', { class: 'eyebrow', text: 'What you can now do' }),
    el('div', { class: 'grid skills' }, caseChapters(c).map(ch => { const i = CHAPTERS.indexOf(ch); const complete = chapterDone(ch) === ch.missions.length;
      return el('div', { class: 'skill' + (complete ? ' complete' : '') }, el('div', { class: 'small muted', text: `Chapter ${i + 1} · ${ch.title}` + (complete ? '' : ' · in progress') }), el('ul', {}, ch.recap.map(r => el('li', { text: r })))); })));
}

// ---------- Mission ----------
function missionPage(m) {
  const s = sess(m.id);
  if (s.text === null) s.text = m.starter ?? '';
  const chapter = CHAPTERS.find(x => x.id === m.chapterId); const c = CASE_BY_ID.get(m.caseId);
  const EVENTS = eventsOf(m.caseId);
  const order = MISSIONS.map(x => x.id); const at = order.indexOf(m.id);
  const prev = at > 0 ? MISSIONS[at - 1] : null, next = at < MISSIONS.length - 1 ? MISSIONS[at + 1] : null;
  const lastOfCase = caseMissions(c).at(-1) === m;
  const lesson = el('aside', { class: 'lesson' });
  const desk = el('section', { class: 'card desk', 'aria-label': 'Query desk' });

  const clueBox = el('section', { class: 'card clue', hidden: !isInvestigated(m), 'aria-label': 'Case update' }, el('div', { class: 'eyebrow', text: 'Case update' }), el('p', { text: m.clue }));
  const logItBox = m.logIt ? logItCard(m) : null;
  cbui.setContext(() => ({ query: editor.value, range: c.ranges.find(x => x.id === s.rangeId)?.label ?? '' }));
  // Visually hidden status line for events that change the lesson pane while focus is on the desk.
  const announcer = el('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const headerPill = el('span', { class: 'pill' });
  const paintHeaderPill = () => { headerPill.className = 'pill' + (isDone(m) ? ' done' : ''); headerPill.textContent = `${earned(m)} / ${missionMax(m)} pts`; };
  paintHeaderPill();
  const hintsBox = el('div', { class: 'hints' });
  const paintHints = () => {
    clear(hintsBox);
    if (!m.hints.length) return;
    for (let i = 0; i < s.hint; i++) hintsBox.append(el('div', { class: 'hint', tabindex: -1 }, el('div', { class: 'small muted', text: `Hint ${i + 1} of ${m.hints.length}` }), i === 2 && m.kind !== 'watch' ? el('pre', { text: m.hints[i] }) : el('div', { text: m.hints[i] })));
    if (s.hint < m.hints.length) hintsBox.append(el('button', { class: 'ghost', style: 'margin-top:8px', text: s.hint === 0 ? 'Show a hint' : `Show hint ${s.hint + 1} of ${m.hints.length}`, onclick: () => { s.hint++; store.hint(m.id, s.hint); paintHints(); [...hintsBox.querySelectorAll('.hint')].at(-1)?.focus(); } }));
    else hintsBox.append(el('div', { class: 'small muted', style: 'margin-top:8px', text: 'Hints never cost points. The last one is a full answer; using it still teaches the shape.' }));
  };
  paintHints();

  lesson.append(
    el('section', { class: 'card story' },
      el('div', { class: 'crumbs' }, el('a', { href: homeHref(c), text: 'Case file' + (CASE_LIST.length > 1 ? ` ${caseIndex(c) + 1}` : '') }), ' › ', el('a', { href: '#' + chapter.id, text: chapter.title }), ` › Mission ${chapter.missions.findIndex(x => x.id === m.id) + 1} of ${chapter.missions.length}`),
      el('div', { class: 'row' }, el('span', { class: 'pill ' + m.kind, text: KIND_LABEL[m.kind] }), headerPill),
      el('h1', { text: m.title }),
      el('p', { class: 'beat', text: m.beat }),
      el('div', { class: 'question', text: m.question })),
    el('section', { class: 'card concept' }, el('div', { class: 'eyebrow', text: 'Think like an analyst' }), el('h2', { class: 'sub', text: m.concept.title }), el('p', { text: m.concept.text })),
    m.brief === 'casebook' ? briefCard(m) : m.explain?.length ? el('section', { class: 'card' }, el('div', { class: 'eyebrow', text: m.kind === 'read' ? 'Side by side' : 'Read the query' }),
      el('ul', { class: 'explain' }, m.explain.map(x => el('li', {}, el('code', { text: x.part }), el('span', { text: x.meaning }))))) : null,
    m.hints.length ? el('section', { class: 'card' }, el('div', { class: 'eyebrow', text: 'Stuck?' }), hintsBox) : null,
    clueBox,
    logItBox,
    m.caveat ? el('div', { class: 'caveat' }, el('strong', { text: 'In a real tenant: ' }), m.caveat) : null,
    el('div', { class: 'navrow' }, prev ? linkBtn('#' + prev.id, '← ' + prev.title) : el('span'),
      lastOfCase && isDone(m) && caseDone(c) ? linkBtn(closedHref(c), 'Case closed →', true) : next ? linkBtn('#' + next.id, next.title + ' →', isDone(m)) : linkBtn(homeHref(c), 'Back to the case file', true)),
  );

  // ----- Desk -----
  const feedback = el('div', { class: 'feedback', hidden: true, role: 'status', 'aria-live': 'polite' });
  const say = (cls, title, fix, examples) => { clear(feedback); feedback.hidden = false; feedback.className = 'feedback ' + cls; feedback.append(el('div', { class: 'title', text: title })); if (fix) feedback.append(el('div', { class: 'fix', text: fix })); if (examples) feedback.append(el('div', { class: 'fix examples', text: examples })); };
  const results = el('div', { class: 'results' });
  const scorebox = el('div', { class: 'scorebox' });
  let doneBefore = isDone(m);
  const paintScoreBox = () => {
    clear(scorebox); const r = store.get(m.id);
    if (m.kind === 'build' || m.kind === 'solo') scorebox.append(el('span', { class: r.q ? 'on' : '', text: `Query ${r.q}/${POINTS.query}` }));
    if (m.kind !== 'read') scorebox.append(el('span', { class: r.a ? 'on' : '', text: `Answer ${r.a}/${POINTS.answer}` }));
    scorebox.append(el('span', { class: r.c ? 'on' : '', text: `Analyst call ${r.c}/${POINTS.call}` }));
    if (m.logIt) scorebox.append(el('span', { class: r.cb ? 'on' : '', text: `Casebook ${r.cb}/${CASEBOOK_POINTS}` }));
    scorebox.append(el('span', { class: isDone(m) ? 'on' : '', text: isDone(m) ? 'Mission complete' : isInvestigated(m) && m.logIt ? 'Log it to complete' : `${earned(m)} / ${missionMax(m)}` }));
    const wasHidden = clueBox.hidden; clueBox.hidden = !isInvestigated(m);
    if (logItBox) logItBox.hidden = !logItOpen(m);
    const nowDone = isDone(m);
    if (!doneBefore && nowDone) announcer.textContent = 'Mission complete.' + (wasHidden ? ' A case update is now shown in the lesson pane.' : '');
    else if (wasHidden && isInvestigated(m)) announcer.textContent = 'A case update is now shown in the lesson pane. Log it in the Casebook to complete the mission.';
    doneBefore = nowDone;
    paintHeaderPill(); paintScore();
  };

  const paintResults = () => {
    clear(results);
    const run = s.run;
    if (!run) { results.append(el('div', { class: 'empty', text: m.kind === 'read' ? 'This mission has no query to run. Read the side-by-side, then answer the analyst call.' : 'Run the query to see what comes back. Press Ctrl+Enter in the editor.' })); return; }
    if (!run.ok) return;
    const r = run.result;
    const range = c.ranges.find(x => x.id === s.rangeId);
    const head = el('div', { class: 'summary' },
      el('span', { text: r.kind === 'events' ? `${fmtNum(r.count)} event${r.count === 1 ? '' : 's'}` : `${fmtNum(r.count)} row${r.count === 1 ? '' : 's'} · ${fmtNum(r.scanned)} events summarised` }),
      el('span', { text: range.label + (r.count > 200 ? ' · showing first 200' : '') + (r.deduped ? ' · deduplicated' : '') }));
    const raw = el('div', { hidden: true, role: 'region', 'aria-label': 'Full record', tabindex: -1 });
    // Opening a record moves focus into the region; closing it returns focus to the button that opened it.
    // Insert from results: the selected record's time and metadata.id go into the Evidence draft; the observation stays the learner's.
    // Outcomes computed on the timestamp (min/max of metadata.event_timestamp.seconds) read as clock times, with the raw seconds beside them.
    const timeCols = new Set(r.timeCols ?? []);
    const wrap = el('div', { class: 'tablewrap' }, r.count ? resultsTable(r, (rec, opener) => { clear(raw); raw.hidden = false; raw.append(el('div', { class: 'row', style: 'justify-content:space-between;margin-top:8px' }, el('strong', { class: 'small', text: 'Full record ' + rec['metadata.id'] }),
      el('span', { class: 'row' }, el('button', { class: 'ghost', text: 'Add to Casebook', 'aria-label': 'Add record ' + rec['metadata.id'] + ' to the Casebook evidence draft', onclick: () => cbui.insertEvidence({ time: hhmm(rec['metadata.event_timestamp.seconds']), id: rec['metadata.id'] }) }), el('button', { class: 'ghost', text: 'Close', onclick: () => { raw.hidden = true; opener?.focus(); } }))), rawRecord(rec)); raw.focus(); }, timeCols) : el('div', { class: 'empty', text: 'No events in this time range match. Widen the range or loosen the filter; an empty result is information, not an error.' }));
    results.append(head, wrap, raw);
  };

  const editor = el('textarea', { class: 'editor', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', 'aria-label': 'Training query', 'aria-describedby': 'editor-help-' + m.id, disabled: m.kind === 'read' });
  editor.value = s.text;
  editor.addEventListener('input', () => { s.text = editor.value; s.query = null; });
  // Ctrl+Enter runs; Ctrl+Shift+Enter checks on missions that have a check. Tab is left alone so focus can leave the editor.
  editor.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); if (e.shiftKey && m.kind !== 'watch') doCheck(); else doRun(); } });

  const rangeSel = el('select', { 'aria-label': 'Time range', onchange: e => { s.rangeId = e.target.value; s.run = null; s.query = null; paintResults(); feedback.hidden = true; } }, c.ranges.map(r => el('option', { value: r.id, selected: r.id === s.rangeId, text: r.label })));

  const doRun = () => {
    if (m.kind === 'read') return;
    s.run = runQuery(editor.value, EVENTS, rangeFor(m.caseId, s.rangeId), CTX); s.query = null;
    if (!s.run.ok) { const d = describe(s.run.code, s.run.detail); say(s.run.status === 'unsupported' ? 'warn' : 'bad', (s.run.status === 'unsupported' ? 'Not run here: ' : 'Will not run: ') + d.title, d.fix); }
    else say('info', `Ran against ${c.ranges.find(x => x.id === s.rangeId).label}.`, m.kind === 'watch' ? 'Read the table, then answer below.' : 'Check the query when the evidence looks right.');
    paintResults();
  };
  const doCheck = () => {
    const g = gradeQuery(editor.value, m, EVENTS, rangeFor(m.caseId, s.rangeId), CTX); s.query = g;
    if (g.status === 'correct') { store.record(m.id, 'q', POINTS.query); say('ok', 'Query correct: it returns the same evidence as the reference.', 'Now read your results and answer the question below.'); }
    else if (g.status === 'incorrect') { const d = describe(g.comparison.reason, g.comparison); const extra = g.comparison.missing !== undefined ? ` You have ${fmtNum(g.comparison.studentCount)} ${g.result.kind === 'events' ? 'events' : 'rows'}; the reference has ${fmtNum(g.comparison.referenceCount)}.` : ''; say('bad', d.title + extra, d.fix, d.examples); }
    else { const d = describe(g.code, g.detail); say(g.status === 'unsupported' ? 'warn' : 'bad', (g.status === 'unsupported' ? 'Not run here: ' : 'Will not run: ') + d.title, d.fix); }
    if (!s.run || s.run.text !== editor.value) { s.run = runQuery(editor.value, EVENTS, rangeFor(m.caseId, s.rangeId), CTX); paintResults(); }
    paintScoreBox();
  };

  const deskButtons = el('div', { class: 'row', style: 'margin-top:8px' });
  if (m.kind !== 'read') {
    deskButtons.append(el('button', { class: 'primary', text: 'Run query', onclick: doRun }));
    if (m.kind !== 'watch') deskButtons.append(el('button', { text: 'Check query', onclick: doCheck }));
    deskButtons.append(el('button', { class: 'ghost', text: 'Reset', onclick: () => { editor.value = s.text = m.starter ?? ''; s.run = null; s.query = null; paintResults(); feedback.hidden = true; } }));
    const keys = (...ks) => ks.flatMap((k, i) => (i ? [' + ', el('kbd', { text: k })] : [el('kbd', { text: k })]));
    deskButtons.append(el('span', { class: 'small muted keys', id: 'editor-help-' + m.id }, ...keys('Ctrl', 'Enter'), ' runs', m.kind !== 'watch' ? [' · ', ...keys('Ctrl', 'Shift', 'Enter'), ' checks'] : [], ' · ', el('kbd', { text: 'Tab' }), ' leaves the editor', ' · ', ...keys('Alt', 'Shift', 'C'), ' casebook'));
  } else deskButtons.append(el('span', { class: 'small muted keys' }, ...(() => { const k = (...ks) => ks.flatMap((x, i) => (i ? [' + ', el('kbd', { text: x })] : [el('kbd', { text: x })])); return k('Alt', 'Shift', 'C'); })(), ' opens the casebook'));

  const fieldList = el('details', { class: 'fields' }, el('summary', { text: 'Field list for this dataset' }), el('ul', {}, Object.entries(FIELDS).map(([f, t]) => el('li', {}, f, ' ', el('span', { text: t })))),
    el('p', { class: 'small muted', style: 'margin:8px 0 0', text: 'Functions that run here: ' + Object.keys(FUNCTIONS).join(', ') + '. Time functions take "UTC" as their zone.' }));
  // The Lists panel: every bundled reference list with its type and items, and the honest line about where lists
  // live in a tenant. The query names a list as %name, in cidr %name or in regex %name.
  const listsPanel = el('details', { class: 'lists' }, el('summary', { text: `Reference lists (${REF_LISTS.length})` }),
    el('p', { class: 'small muted', style: 'margin:8px 0' }, 'In Google SecOps, reference lists are objects you create under ', el('strong', { text: 'Detection > Lists' }), ' and a query names them with %. This trainer bundles the lists below so the syntax can be practised; nothing here is created or edited.'),
    el('ul', { class: 'listlist' }, REF_LISTS.map(l => el('li', {}, el('div', { class: 'row' }, el('code', { text: '%' + l.name }), el('span', { class: 'pill', text: l.type === 'cidr' ? 'cidr · in cidr %' : l.type === 'regex' ? 'regex · in regex %' : 'string · in %' })),
      el('div', { class: 'small muted', text: l.description }), el('div', { class: 'items', text: l.items.join('  ·  ') })))));

  // Answer part
  const answerPart = el('div', { class: 'part' });
  if (m.answer) {
    const input = el('input', { type: 'text', 'aria-label': m.answer.prompt, autocomplete: 'off', style: 'min-width:220px' });
    const ansFeedback = el('div', { class: 'small muted', style: 'margin-top:6px', role: 'status', 'aria-live': 'polite' });
    answerPart.append(el('h2', { class: 'sub' }, 'From your results', el('span', { class: 'pts', text: POINTS.answer + ' pts' })), el('p', { text: m.answer.prompt }),
      el('div', { class: 'row' }, input, el('button', { text: 'Check answer', onclick: () => {
        const g = gradeAnswer(input.value, m); s.answer = g;
        if (g.correct) { store.record(m.id, 'a', POINTS.answer); ansFeedback.textContent = 'Correct.'; ansFeedback.style.color = 'var(--ok)'; }
        else { ansFeedback.style.color = 'var(--bad)'; ansFeedback.textContent = 'Not what the whole night shows.' + (s.rangeId !== 'all' ? ' Answers assume the whole night; your time range is narrower.' : ' ' + whereToRead(m.answer.check) + (s.run?.ok ? '' : ' Run the query first.')); }
        paintScoreBox();
      } })), ansFeedback);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); answerPart.querySelector('button').click(); } });
  }

  // Analyst call part
  const callPart = el('div', { class: 'part' });
  const callFeedback = el('div', { class: 'small', style: 'margin-top:6px', role: 'status', 'aria-live': 'polite' });
  const radios = m.call.options.map(o => el('li', {}, el('label', {}, el('input', { type: 'radio', name: 'call-' + m.id, value: o.id, onchange: () => { s.picked = o.id; } }), el('span', { text: o.label }))));
  const callPromptId = 'call-prompt-' + m.id;
  callPart.append(el('h2', { class: 'sub' }, 'Analyst call', el('span', { class: 'pts', text: POINTS.call + ' pts' })), el('p', { id: callPromptId, text: m.call.prompt }), el('ul', { class: 'options', role: 'radiogroup', 'aria-labelledby': callPromptId }, radios),
    el('button', { text: 'Check call', onclick: () => {
      if (!s.picked) { callFeedback.style.color = 'var(--muted)'; callFeedback.textContent = 'Pick an option first.'; return; }
      const g = gradeCall(s.picked, m); s.call = g;
      if (g.correct) { store.record(m.id, 'c', POINTS.call); callFeedback.style.color = 'var(--ok)'; }
      else callFeedback.style.color = 'var(--bad)';
      callFeedback.textContent = (g.correct ? 'Right. ' : 'Not quite. ') + m.call.why;
      paintScoreBox();
    } }), callFeedback);

  desk.append(
    el('div', { class: 'deskbar' }, el('div', { class: 'eyebrow', style: 'margin:0', text: 'Query desk' }), el('label', {}, 'Time range', rangeSel)),
    editor, deskButtons, feedback, results, fieldList, listsPanel, answerPart, callPart, scorebox, announcer,
  );
  logItBox?.addEventListener('logged', paintScoreBox);
  paintResults(); paintScoreBox();
  return el('div', { class: 'mission' }, lesson, desk);
}

// Log it: the casebook entry this mission earns and what a good one contains. The check is structural (required
// fields, UTC times, record IDs that exist, references that resolve, no claim words without a record) plus the
// presence of the anchors the mission names; it never judges the quality of the thinking and never compares text
// against a model answer. Passing earns the mission's Casebook points.
function logItCard(m) {
  const li = m.logIt; const kind = li.kind;
  const what = (li.list ? LIST_LABEL[li.list] + ' item' : ENTRY_LABEL[kind]);
  const token = t => { const alts = t.split('|'); return alts.length === 1 ? alts[0] : alts.length <= 3 ? alts.join(' or ') : `${alts.slice(0, 2).join(' or ')} or another of ${alts.length - 2}`; };
  const feedback = el('div', { class: 'feedback', hidden: true, role: 'status', 'aria-live': 'polite' });
  const check = () => {
    const result = checkLogIt(li, casebook.get(m.caseId), contextFor(casebook.get(m.caseId), EVENT_IDS[m.caseId]));
    clear(feedback); feedback.hidden = false; feedback.className = 'feedback ' + (result.ok ? 'ok' : 'warn');
    feedback.append(el('div', { class: 'title', text: result.ok ? `Logged. ${result.message}` : result.message }));
    if (result.ok) { store.record(m.id, 'cb', CASEBOOK_POINTS); card.dispatchEvent(new Event('logged')); }
    else feedback.append(el('div', { class: 'fix', text: 'Structure is checked, not the quality of your thinking. Fix the entry in the Casebook and check again.' }));
  };
  const card = el('section', { class: 'card logit', hidden: !logItOpen(m), 'aria-label': 'Log it' },
    el('div', { class: 'eyebrow', text: `Log it · ${CASEBOOK_POINTS} pts` }),
    el('h2', { class: 'sub', text: `This mission earned: ${/^[aeiou]/i.test(what) ? 'an' : 'a'} ${what.toLowerCase()}` }),
    el('p', { text: li.prompt }),
    el('p', { class: 'small', text: 'A good one contains:' }),
    el('ul', {}, li.mustInclude.map(t => el('li', { class: 'mono', text: token(t) }))),
    el('div', { class: 'row' },
      el('button', { text: `Open Casebook: ${ENTRY_LABEL[kind].replace(' entry', '').replace(' item', '')}`, onclick: () => { cbui.setCase(m.caseId); cbui.open(kind); } }),
      el('button', { class: 'primary', text: 'Check my Casebook', onclick: check })),
    feedback,
    el('p', { class: 'small muted', style: 'margin:8px 0 0', text: 'The check is for structure: required fields, HH:MM UTC times, record IDs that exist, references that resolve, and no claim words without a record. It does not grade the quality of your thinking.' }));
  return card;
}

// The brief (C06-M04): the learner's casebook assembled into facts, hypotheses, gaps, determination, remediation and
// the handoff ticket, beside the authored model for self-comparison. Empty sections say which missions fill them.
function briefCard(m) {
  const box = el('section', { class: 'card', 'aria-label': 'Your brief beside the model' });
  const model = part => m.explain.find(e => e.part === part)?.meaning ?? '';
  const sentences = t => t.split(/\.\s+(?=[A-Z0-9])/).map(x => x.replace(/\.$/, '')).filter(Boolean);
  const paint = () => {
    clear(box); const b = casebook.get(m.caseId); const info = caseInfo(m.caseId);
    const fillers = kinds => caseMissions(CASE_BY_ID.get(m.caseId)).filter(x => kinds.includes(x.logIt?.kind)).map(x => x.id);
    const missing = (kinds, label) => { const ids = fillers(kinds); return el('p', { class: 'missing' }, `Nothing logged for ${label} yet. Missions whose Log it fills it: `, ...ids.flatMap((id, i) => (i ? [', ', el('a', { href: '#' + id, text: id })] : [el('a', { href: '#' + id, text: id })])), '.'); };
    const facts = [...b.evidence.map(e => `${e.time} · ${e.observation} (#${e.n}: ${e.records.join(', ')})`), ...sortTimeline(b.timeline, info.dayStartHour).map(t => `${t.time} · ${t.fact} (#${t.ref ?? '—'})`)];
    const rows = [
      ['Facts', facts.length ? el('ul', {}, facts.map(t => el('li', { text: t }))) : missing(['evidence', 'timeline'], 'facts'), 'Facts'],
      ['Hypotheses', b.hypothesis.length ? el('ul', {}, b.hypothesis.map(h => el('li', { text: `${h.status || 'open'} · ${h.statement}` + ((h.supporting ?? []).length ? ` (for: ${h.supporting.map(n => '#' + n).join(', ')})` : '') + ((h.contradicting ?? []).length ? ` (against: ${h.contradicting.map(n => '#' + n).join(', ')})` : '') }))) : missing(['hypothesis'], 'hypotheses'), 'Hypotheses'],
      ['Gaps', b.gap.length ? el('ul', {}, b.gap.map(g => el('li', { text: `${g.text} · ${g.why}` }))) : missing(['gap'], 'gaps'), 'Gaps'],
      ['Determination', b.determination ? el('p', { text: `${VERDICT_LABEL[b.determination.verdict] ?? b.determination.verdict ?? '—'} · confidence ${b.determination.confidence || '—'} · decided by ${(b.determination.refs ?? []).map(n => '#' + n).join(', ') || '—'}. ${b.determination.summary}` }) : missing(['determination'], 'the determination'), 'Determination'],
      ['Remediation', b.remediation.length ? el('ul', {}, LISTS.flatMap(l => b.remediation.filter(r => r.list === l).map(r => el('li', { text: `${LIST_LABEL[l]}: ${r.text} · ${r.owner} · ${r.urgency} · answers ${(r.refs ?? []).map(n => '#' + n).join(', ')}` })))) : missing(['remediation'], 'remediation'), 'Remediation'],
      ['Handoff', b.handoff ? el('pre', { text: handoffText(b, info) }) : missing(['handoff'], 'the handoff ticket'), 'Handoff'],
    ];
    box.append(el('div', { class: 'eyebrow', text: 'Your brief beside the model' }),
      el('p', { class: 'small muted', text: 'Left: assembled from your Casebook as it stands. Right: the authored brief for this case. Compare the columns yourself; nothing here is graded. Facts come from your Evidence and Timeline tabs.' }));
    for (const [label, mine, part] of rows) {
      const modelText = model(part);
      box.append(el('h2', { class: 'sub', style: 'margin-top:12px', text: label }),
        el('div', { class: 'brief' },
          el('div', {}, el('div', { class: 'eyebrow', text: 'Yours' }), mine),
          el('div', {}, el('div', { class: 'eyebrow', text: 'Model' }), modelText ? el('ul', {}, sentences(modelText).map(t => el('li', { text: t }))) : el('p', { class: 'missing', text: 'No model text for this section.' }))));
    }
    box.append(el('div', { class: 'row', style: 'margin-top:12px' }, el('button', { text: 'Open the Casebook', onclick: () => { cbui.setCase(m.caseId); cbui.open('handoff'); } })));
  };
  paint(); onBookChangeAlso(paint);
  return box;
}

// Tells the learner where in their own results the answer is read from, without giving the value.
function whereToRead(check) {
  const named = row => Object.entries(row).map(([k, v]) => `${k} is ${v}`).join(' and ');
  if (check.type === 'count') return 'The answer is the count in the results bar above the table, not a value inside it.';
  if (check.type === 'distinct') return `Count the different ${check.field} values in your results, not the number of rows.`;
  if (check.type === 'time') return 'Read the time column of the first row and give it as HH:MM, UTC.';
  if (check.type === 'field') return check.where ? `Find the first row where ${named(check.where)}, open it, and read ${check.field}.` : `Open the first row's record and read ${check.field}.`;
  if (check.type === 'cell') { const col = typeof check.column === 'number' ? 'the first calculated column' : `the ${check.column} column`; const how = check.format === 'hhmm' ? ' Give it as HH:MM, UTC.' : check.format === 'list' ? ' Give the values separated by commas.' : check.format === 'size' ? ' Give how many values the list holds.' : ''; return (typeof check.row === 'number' ? `Read ${col} of row ${check.row + 1} of the table.` : `Find the row where ${named(check.row)} and read ${col}.`) + how; }
  return 'Run the query and read the value from the results.';
}

// ---------- About ----------
function aboutPage() {
  const link = (href, text) => el('a', { href, target: '_blank', rel: 'noopener noreferrer', text });
  return el('div', {},
    el('section', { class: 'card story' }, el('div', { class: 'eyebrow', text: 'What this is' }), el('h1', { text: 'A practice desk for Google SecOps Search' }),
      el('p', { text: 'You write YARA-L 2.0 Search queries against a small fictional dataset of UDM events and see what comes back. Queries are graded by running them: if yours returns the same evidence as the reference, it passes, however you spelled it. Answers are read from your own results. Analyst calls are fixed-choice reasoning checks with an explanation either way.' }),
      el('p', { text: 'Points are formative. Hints never cost anything and the last hint is a full answer. A complete course proves you can read and write the taught subset against this data; it does not prove tenant execution, detection skill or anything an employer should rely on.' })),
    el('section', { class: 'card' }, el('div', { class: 'eyebrow', text: 'The Casebook' }),
      el('p', { text: 'One notebook per case, opened from the top bar or with Alt+Shift+C, with a case switcher in the drawer: an investigation name, scope, a FreeForm page, evidence with record IDs, a timeline, hypotheses, pivots, gaps, a determination, remediation in four lists and an engineering handoff. Each mission ends by asking for one entry; a deterministic check looks at structure only (required fields, UTC times, record IDs that exist, references that resolve, no claim words without a record) and never at the quality of the thinking. It is session-only unless you turn on remembering on the case file page; the export is a local Markdown download.' })),
    el('section', { class: 'card' }, el('div', { class: 'eyebrow', text: 'What it is not' }),
      el('ul', {}, ['Not connected to any SIEM, and never will be. Nothing you type leaves this tab.', 'Not Google\'s compiler. The supported subset is documented; valid Google syntax outside it is reported as "not run here", separately from mistakes.', 'Not real data. Every event is generated by a script in this repository; IP addresses come from documentation ranges; people and places are invented.', 'Not a place for workplace values. Practise the shape here; use real identifiers only inside tools your employer authorizes.'].map(t => el('li', { text: t })))),
    el('section', { class: 'card' }, el('div', { class: 'eyebrow', text: 'Supported subset' }),
      el('p', { text: 'Filters with =, !=, <, <=, >, >=, nocase, regex literals, re.regex, net.ip_in_range_cidr, AND/OR/NOT, parentheses, implicit AND, $e. event-variable prefix, placeholders ($x = field or $x = function(field)), grouped fields (ip, hostname, user, domain, file_path, email), the functions timestamp.get_hour, timestamp.get_minute and timestamp.get_date (zone "UTC" only; other zones are reported as not run here), strings.to_lower, strings.to_upper and strings.concat, and reference lists (in %name, in cidr %name, in regex %name, not in, nocase) against the lists bundled in content. Sections: match (with by / over every windows), outcome (count, count_distinct, sum, max, min, array, array_distinct, earliest, latest; arrays cut at 1,000 as in Search), condition, dedup, order, limit. Not run here: joins across event variables, entity graph, additional.fields, data tables, multi-stage queries, other functions and zones.' }),
      el('p', { class: 'small muted', text: 'Reference lists: in a tenant they are objects created under Detection > Lists; this trainer bundles a few in content/lists.json and shows them in the Lists panel on the desk. dedup is accepted between condition and order, keeps the first row per distinct key, and on a summary table can name only the grouping keys or outcomes.' })),
    el('section', { class: 'card' }, el('div', { class: 'eyebrow', text: 'Google documentation used' }),
      el('ul', {}, DOCS.map(([h, t]) => el('li', {}, link(h, t)))),
      el('p', { class: 'small muted', text: 'Links open in a new tab on click only. Google\'s pages disagree on whether Search supports the condition section; this trainer follows the page that documents it and says so in chapter 6. The dedup, statistics, functions and reference-list pages were read through search summaries on 2026-10-18, not fetched in full; run each new shape once in your own tenant.' })),
    el('div', { class: 'navrow' }, linkBtn('#', '← Back to the case file')),
  );
}

window.addEventListener('hashchange', route);
route();
