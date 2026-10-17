import { CONTENT, DATA } from './bundle.js';
import { FIELDS } from './engine/catalog.js';
import { runQuery, gradeQuery, gradeAnswer, gradeCall, POINTS } from './engine/grader.js';
import { describe } from './ui/messages.js';
import { createStore } from './ui/progress.js';
import { el, clear, resultsTable, rawRecord, fmtNum } from './ui/render.js';

const CASE = CONTENT.case;
const CHAPTERS = CONTENT.chapters;
const MISSIONS = CHAPTERS.flatMap(ch => ch.missions.map(m => ({ ...m, chapterId: ch.id, chapterTitle: ch.title })));
const BY_ID = new Map(MISSIONS.map(m => [m.id, m]));
const store = createStore(new Set(MISSIONS.map(m => m.id)));
const EVENTS = DATA.events;
const WINDOW = DATA.window;
const KIND_LABEL = { watch: 'Watch one', build: 'Build it', solo: 'Your turn', read: 'Read' };
const missionMax = m => (m.kind === 'read' ? POINTS.call : m.kind === 'watch' ? POINTS.answer + POINTS.call : POINTS.query + POINTS.answer + POINTS.call);
const COURSE_MAX = MISSIONS.reduce((s, m) => s + missionMax(m), 0);
const earned = m => { const r = store.get(m.id); return (m.kind === 'read' ? 0 : m.kind === 'watch' ? 0 : r.q) + (m.kind === 'read' ? 0 : r.a) + r.c; };
const isDone = m => earned(m) === missionMax(m);

// Per-mission working state lives only in memory and only for this tab.
const session = new Map();
const sess = id => { if (!session.has(id)) session.set(id, { text: null, rangeId: 'all', run: null, query: null, answer: null, call: null, hint: 0, picked: null }); return session.get(id); };
const rangeFor = id => { const r = CASE.ranges.find(x => x.id === id) ?? CASE.ranges[0]; return { start: WINDOW.start + r.start, end: WINDOW.start + r.end }; };

const app = document.getElementById('main');
const topscore = document.getElementById('topscore');
function paintScore() { topscore.textContent = `${fmtNum(store.total())} / ${fmtNum(COURSE_MAX)} pts`; }

function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  clear(app);
  if (hash === 'about') app.append(aboutPage());
  else if (BY_ID.has(hash)) app.append(missionPage(BY_ID.get(hash)));
  else if (CHAPTERS.some(c => c.id === hash)) app.append(chapterPage(CHAPTERS.find(c => c.id === hash)));
  else app.append(homePage());
  paintScore();
  app.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

// ---------- Home ----------
function homePage() {
  const done = MISSIONS.filter(isDone).length;
  return el('div', {},
    el('section', { class: 'card story' },
      el('div', { class: 'eyebrow', text: 'Case file · Google SecOps · YARA-L 2.0 Search' }),
      el('h1', { text: CASE.title }),
      el('p', { class: 'muted', text: CASE.tagline }),
      ...CASE.opening.map(p => el('p', { text: p })),
      el('p', {}, el('strong', { text: 'Your role. ' }), CASE.role),
      el('div', { class: 'row', style: 'margin-top:14px' },
        el('a', { href: '#' + (MISSIONS.find(m => !isDone(m)) ?? MISSIONS[0]).id }, el('button', { class: 'primary', text: done ? 'Continue the case →' : 'Open the case →' })),
        el('span', { class: 'muted small', text: `${done} of ${MISSIONS.length} missions complete · ${fmtNum(store.total())} of ${fmtNum(COURSE_MAX)} points` })),
    ),
    el('section', { class: 'card' },
      el('div', { class: 'eyebrow', text: 'Chapters' }),
      el('div', { class: 'grid' }, CHAPTERS.map((ch, i) => {
        const ms = ch.missions.map(m => BY_ID.get(m.id)); const d = ms.filter(isDone).length;
        return el('a', { class: 'card chapter-card', href: '#' + ch.id },
          el('div', { class: 'num', text: String(i + 1).padStart(2, '0') }),
          el('h3', { text: ch.title }), el('p', { class: 'muted small', text: ch.subtitle }),
          el('div', { class: 'bar' }, el('span', { style: `width:${Math.round(100 * d / ms.length)}%` })),
          el('div', { class: 'muted small', text: `${d} / ${ms.length} missions` }));
      }))),
    el('section', { class: 'card' },
      el('div', { class: 'eyebrow', text: 'People and systems' }),
      el('table', { class: 'people' }, el('tbody', {}, [...CASE.people.map(p => el('tr', {}, el('td', { text: p.name }), el('td', { class: 'muted', text: p.role }), el('td', { text: p.note }))),
        ...CASE.systems.map(s => el('tr', {}, el('td', { class: 'mono', text: s.name }), el('td', { class: 'muted', text: 'system' }), el('td', { text: s.note })))]))),
    el('section', { class: 'card' },
      el('div', { class: 'eyebrow', text: 'Remembering progress' }),
      el('label', { class: 'toggle' }, el('input', { type: 'checkbox', checked: store.remember, disabled: !store.available, onchange: e => { store.setRemember(e.target.checked); paintScore(); } }),
        el('span', {}, 'Remember my points in this browser. Stores mission IDs, points and hint levels only; never query text or answers. Leave off on a shared device.', store.available ? '' : ' (Storage is unavailable here, so progress is session-only.)')),
      el('div', { class: 'row', style: 'margin-top:10px' }, el('button', { class: 'ghost', text: 'Clear all progress', onclick: () => { if (confirm('Clear all saved and current progress?')) { store.clear(); route(); } } }))),
    el('section', { class: 'card notice' }, el('strong', { text: 'Boundary. ' }), CASE.boundary, ' ', el('a', { href: '#about', text: 'What this trainer is and is not.' })),
  );
}

// ---------- Chapter ----------
function chapterPage(ch) {
  const idx = CHAPTERS.indexOf(ch);
  return el('div', {},
    el('section', { class: 'card story' },
      el('div', { class: 'crumbs' }, el('a', { href: '#', text: 'Case file' }), ' › ', `Chapter ${idx + 1}`),
      el('div', { class: 'eyebrow', text: `Chapter ${String(idx + 1).padStart(2, '0')}` }),
      el('h1', { text: ch.title }), el('p', { class: 'muted', text: ch.subtitle }), el('p', { text: ch.intro }),
      el('ul', { class: 'chips' }, ch.concepts.map(c => el('li', { text: c })))),
    el('section', { class: 'card' },
      el('div', { class: 'eyebrow', text: 'Missions' }),
      el('ul', { class: 'list' }, ch.missions.map((mm, i) => { const m = BY_ID.get(mm.id); return el('li', {},
        el('a', { href: '#' + m.id }, `${i + 1}. ${m.title}`),
        el('span', { class: 'row' }, el('span', { class: 'pill ' + m.kind, text: KIND_LABEL[m.kind] }), el('span', { class: 'pill' + (isDone(m) ? ' done' : ''), text: `${earned(m)} / ${missionMax(m)}` }))); }))),
    el('div', { class: 'navrow' }, idx > 0 ? el('a', { href: '#' + CHAPTERS[idx - 1].id }, el('button', { text: '← Previous chapter' })) : el('span'), idx < CHAPTERS.length - 1 ? el('a', { href: '#' + CHAPTERS[idx + 1].id }, el('button', { text: 'Next chapter →' })) : el('span')));
}

// ---------- Mission ----------
function missionPage(m) {
  const s = sess(m.id);
  if (s.text === null) s.text = m.starter ?? '';
  const chapter = CHAPTERS.find(c => c.id === m.chapterId);
  const order = MISSIONS.map(x => x.id); const at = order.indexOf(m.id);
  const prev = at > 0 ? MISSIONS[at - 1] : null, next = at < MISSIONS.length - 1 ? MISSIONS[at + 1] : null;
  const lesson = el('aside', { class: 'lesson' });
  const desk = el('section', { class: 'card desk', 'aria-label': 'Query desk' });

  const clueBox = el('section', { class: 'card clue', hidden: !isDone(m) }, el('div', { class: 'eyebrow', text: 'Case update' }), el('p', { text: m.clue }));
  const headerPill = el('span', { class: 'pill' });
  const paintHeaderPill = () => { headerPill.className = 'pill' + (isDone(m) ? ' done' : ''); headerPill.textContent = `${earned(m)} / ${missionMax(m)} pts`; };
  paintHeaderPill();
  const hintsBox = el('div', { class: 'hints' });
  const paintHints = () => {
    clear(hintsBox);
    if (!m.hints.length) return;
    for (let i = 0; i < s.hint; i++) hintsBox.append(el('div', { class: 'hint' }, el('div', { class: 'small muted', text: `Hint ${i + 1} of ${m.hints.length}` }), i === 2 && m.kind !== 'watch' ? el('pre', { text: m.hints[i] }) : el('div', { text: m.hints[i] })));
    if (s.hint < m.hints.length) hintsBox.append(el('button', { class: 'ghost', style: 'margin-top:8px', text: s.hint === 0 ? 'Show a hint' : `Show hint ${s.hint + 1} of ${m.hints.length}`, onclick: () => { s.hint++; store.hint(m.id, s.hint); paintHints(); } }));
    else hintsBox.append(el('div', { class: 'small muted', style: 'margin-top:8px', text: 'Hints never cost points. The last one is a full answer; using it still teaches the shape.' }));
  };
  paintHints();

  lesson.append(
    el('section', { class: 'card story' },
      el('div', { class: 'crumbs' }, el('a', { href: '#', text: 'Case file' }), ' › ', el('a', { href: '#' + chapter.id, text: chapter.title }), ` › Mission ${chapter.missions.findIndex(x => x.id === m.id) + 1} of ${chapter.missions.length}`),
      el('div', { class: 'row' }, el('span', { class: 'pill ' + m.kind, text: KIND_LABEL[m.kind] }), headerPill),
      el('h1', { text: m.title }),
      el('p', { class: 'beat', text: m.beat }),
      el('div', { class: 'question', text: m.question })),
    el('section', { class: 'card concept' }, el('div', { class: 'eyebrow', text: 'Think like an analyst' }), el('h3', { text: m.concept.title }), el('p', { text: m.concept.text })),
    m.explain?.length ? el('section', { class: 'card' }, el('div', { class: 'eyebrow', text: m.kind === 'read' ? 'Side by side' : 'Read the query' }),
      el('ul', { class: 'explain' }, m.explain.map(x => el('li', {}, el('code', { text: x.part }), el('span', { text: x.meaning }))))) : null,
    m.hints.length ? el('section', { class: 'card' }, el('div', { class: 'eyebrow', text: 'Stuck?' }), hintsBox) : null,
    clueBox,
    m.caveat ? el('div', { class: 'caveat' }, el('strong', { text: 'In a real tenant: ' }), m.caveat) : null,
    el('div', { class: 'navrow' }, prev ? el('a', { href: '#' + prev.id }, el('button', { text: '← ' + prev.title })) : el('span'), next ? el('a', { href: '#' + next.id }, el('button', { class: isDone(m) ? 'primary' : '', text: next.title + ' →' })) : el('a', { href: '#' }, el('button', { class: 'primary', text: 'Back to the case file' }))),
  );

  // ----- Desk -----
  const feedback = el('div', { class: 'feedback', hidden: true, role: 'status', 'aria-live': 'polite' });
  const say = (cls, title, fix) => { clear(feedback); feedback.hidden = false; feedback.className = 'feedback ' + cls; feedback.append(el('div', { class: 'title', text: title })); if (fix) feedback.append(el('div', { class: 'fix', text: fix })); };
  const results = el('div', { class: 'results' });
  const scorebox = el('div', { class: 'scorebox' });
  const paintScoreBox = () => {
    clear(scorebox); const r = store.get(m.id);
    if (m.kind === 'build' || m.kind === 'solo') scorebox.append(el('span', { class: r.q ? 'on' : '', text: `Query ${r.q}/${POINTS.query}` }));
    if (m.kind !== 'read') scorebox.append(el('span', { class: r.a ? 'on' : '', text: `Answer ${r.a}/${POINTS.answer}` }));
    scorebox.append(el('span', { class: r.c ? 'on' : '', text: `Analyst call ${r.c}/${POINTS.call}` }));
    scorebox.append(el('span', { class: isDone(m) ? 'on' : '', text: isDone(m) ? 'Mission complete' : `${earned(m)} / ${missionMax(m)}` }));
    clueBox.hidden = !isDone(m); paintHeaderPill(); paintScore();
  };

  const paintResults = () => {
    clear(results);
    const run = s.run;
    if (!run) { results.append(el('div', { class: 'empty', text: m.kind === 'read' ? 'This mission has no query to run. Read the side-by-side, then answer the analyst call.' : 'Run the query to see what comes back. Press Ctrl+Enter in the editor.' })); return; }
    if (!run.ok) return;
    const r = run.result;
    const range = CASE.ranges.find(x => x.id === s.rangeId);
    const head = el('div', { class: 'summary' },
      el('span', { text: r.kind === 'events' ? `${fmtNum(r.count)} event${r.count === 1 ? '' : 's'}` : `${fmtNum(r.count)} row${r.count === 1 ? '' : 's'} · ${fmtNum(r.scanned)} events summarised` }),
      el('span', { text: range.label + (r.count > 200 ? ' · showing first 200' : '') }));
    const raw = el('div', { hidden: true });
    const wrap = el('div', { class: 'tablewrap' }, r.count ? resultsTable(r, rec => { clear(raw); raw.hidden = false; raw.append(el('div', { class: 'row', style: 'justify-content:space-between;margin-top:8px' }, el('strong', { class: 'small', text: 'Full record ' + rec['metadata.id'] }), el('button', { class: 'ghost', text: 'Close', onclick: () => { raw.hidden = true; } })), rawRecord(rec)); }) : el('div', { class: 'empty', text: 'No events in this time range match. Widen the range or loosen the filter; an empty result is information, not an error.' }));
    results.append(head, wrap, raw);
  };

  const editor = el('textarea', { class: 'editor', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', 'aria-label': 'Training query', disabled: m.kind === 'read' });
  editor.value = s.text;
  editor.addEventListener('input', () => { s.text = editor.value; s.query = null; });
  editor.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doRun(); } });

  const rangeSel = el('select', { 'aria-label': 'Time range', onchange: e => { s.rangeId = e.target.value; s.run = null; s.query = null; paintResults(); feedback.hidden = true; } }, CASE.ranges.map(r => el('option', { value: r.id, selected: r.id === s.rangeId, text: r.label })));

  const doRun = () => {
    if (m.kind === 'read') return;
    s.run = runQuery(editor.value, EVENTS, rangeFor(s.rangeId)); s.query = null;
    if (!s.run.ok) { const d = describe(s.run.code, s.run.detail); say(s.run.status === 'unsupported' ? 'warn' : 'bad', (s.run.status === 'unsupported' ? 'Not run here: ' : 'Will not run: ') + d.title, d.fix); }
    else say('info', `Ran against ${CASE.ranges.find(x => x.id === s.rangeId).label}.`, m.kind === 'watch' ? 'Read the table, then answer below.' : 'Check the query when the evidence looks right.');
    paintResults();
  };
  const doCheck = () => {
    const g = gradeQuery(editor.value, m, EVENTS, rangeFor(s.rangeId)); s.query = g;
    if (g.status === 'correct') { store.record(m.id, 'q', POINTS.query); say('ok', 'Query correct: it returns the same evidence as the reference.', 'Now read your results and answer the question below.'); }
    else if (g.status === 'incorrect') { const d = describe(g.comparison.reason, g.comparison); const extra = g.comparison.missing !== undefined ? ` You have ${fmtNum(g.comparison.studentCount)} ${g.result.kind === 'events' ? 'events' : 'rows'}; the reference has ${fmtNum(g.comparison.referenceCount)}.` : ''; say('bad', d.title + extra, d.fix); }
    else { const d = describe(g.code, g.detail); say(g.status === 'unsupported' ? 'warn' : 'bad', (g.status === 'unsupported' ? 'Not run here: ' : 'Will not run: ') + d.title, d.fix); }
    if (!s.run || s.run.text !== editor.value) { s.run = runQuery(editor.value, EVENTS, rangeFor(s.rangeId)); paintResults(); }
    paintScoreBox();
  };

  const deskButtons = el('div', { class: 'row', style: 'margin-top:8px' });
  if (m.kind !== 'read') {
    deskButtons.append(el('button', { class: 'primary', text: 'Run query', onclick: doRun }));
    if (m.kind !== 'watch') deskButtons.append(el('button', { text: 'Check query', onclick: doCheck }));
    deskButtons.append(el('button', { class: 'ghost', text: 'Reset', onclick: () => { editor.value = s.text = m.starter ?? ''; s.run = null; s.query = null; paintResults(); feedback.hidden = true; } }));
    deskButtons.append(el('span', { class: 'small muted' }, el('kbd', { text: 'Ctrl' }), ' + ', el('kbd', { text: 'Enter' }), ' runs'));
  }

  const fieldList = el('details', { class: 'fields' }, el('summary', { text: 'Field list for this dataset' }), el('ul', {}, Object.entries(FIELDS).map(([f, t]) => el('li', {}, f, ' ', el('span', { text: t })))));

  // Answer part
  const answerPart = el('div', { class: 'part' });
  if (m.answer) {
    const input = el('input', { type: 'text', 'aria-label': m.answer.prompt, autocomplete: 'off', style: 'min-width:220px' });
    const ansFeedback = el('div', { class: 'small muted', style: 'margin-top:6px' });
    answerPart.append(el('h3', {}, 'From your results', el('span', { class: 'pts', text: POINTS.answer + ' pts' })), el('p', { text: m.answer.prompt }),
      el('div', { class: 'row' }, input, el('button', { text: 'Check answer', onclick: () => {
        const g = gradeAnswer(input.value, m); s.answer = g;
        if (g.correct) { store.record(m.id, 'a', POINTS.answer); ansFeedback.textContent = 'Correct.'; ansFeedback.style.color = 'var(--ok)'; }
        else { ansFeedback.style.color = 'var(--bad)'; ansFeedback.textContent = 'Not what the whole night shows.' + (s.rangeId !== 'all' ? ' Answers assume the whole night; your time range is narrower.' : ' Run the query and read the value from the results.'); }
        paintScoreBox();
      } })), ansFeedback);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); answerPart.querySelector('button').click(); } });
  }

  // Analyst call part
  const callPart = el('div', { class: 'part' });
  const callFeedback = el('div', { class: 'small', style: 'margin-top:6px' });
  const radios = m.call.options.map(o => el('li', {}, el('label', {}, el('input', { type: 'radio', name: 'call-' + m.id, value: o.id, onchange: () => { s.picked = o.id; } }), el('span', { text: o.label }))));
  callPart.append(el('h3', {}, 'Analyst call', el('span', { class: 'pts', text: POINTS.call + ' pts' })), el('p', { text: m.call.prompt }), el('ul', { class: 'options' }, radios),
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
    editor, deskButtons, feedback, results, fieldList, answerPart, callPart, scorebox,
  );
  paintResults(); paintScoreBox();
  return el('div', { class: 'mission' }, lesson, desk);
}

// ---------- About ----------
function aboutPage() {
  const link = (href, text) => el('a', { href, target: '_blank', rel: 'noopener noreferrer', text });
  return el('div', {},
    el('section', { class: 'card story' }, el('div', { class: 'eyebrow', text: 'What this is' }), el('h1', { text: 'A practice desk for Google SecOps Search' }),
      el('p', { text: 'You write YARA-L 2.0 Search queries against a small fictional dataset of UDM events and see what comes back. Queries are graded by running them: if yours returns the same evidence as the reference, it passes, however you spelled it. Answers are read from your own results. Analyst calls are fixed-choice reasoning checks with an explanation either way.' }),
      el('p', { text: 'Points are formative. Hints never cost anything and the last hint is a full answer. A complete course proves you can read and write the taught subset against this data; it does not prove tenant execution, detection skill or anything an employer should rely on.' })),
    el('section', { class: 'card' }, el('div', { class: 'eyebrow', text: 'What it is not' }),
      el('ul', {}, ['Not connected to any SIEM, and never will be. Nothing you type leaves this tab.', 'Not Google\'s compiler. The supported subset is documented; valid Google syntax outside it is reported as "not run here", separately from mistakes.', 'Not real data. Every event is generated by a script in this repository; IP addresses come from documentation ranges; people and places are invented.', 'Not a place for workplace values. Practise the shape here; use real identifiers only inside tools your employer authorizes.'].map(t => el('li', { text: t })))),
    el('section', { class: 'card' }, el('div', { class: 'eyebrow', text: 'Supported subset' }),
      el('p', { text: 'Filters with =, !=, <, <=, >, >=, nocase, regex literals, re.regex, net.ip_in_range_cidr, AND/OR/NOT, parentheses, implicit AND, $e. event-variable prefix, placeholders ($x = field), grouped fields (ip, hostname, user, domain, file_path, email). Sections: match (with by / over every windows), outcome (count, count_distinct, sum, max, min), condition, order, limit. Not run here: dedup, arrays, joins, entity graph, additional.fields, multi-event queries, most functions.' })),
    el('section', { class: 'card' }, el('div', { class: 'eyebrow', text: 'Google documentation used' }),
      el('ul', {}, [
        ['https://docs.cloud.google.com/chronicle/docs/investigation/search-syntax-reference', 'Understand search syntax'],
        ['https://docs.cloud.google.com/chronicle/docs/investigation/statistics-aggregations-in-udm-search', 'Analyze search data with statistics'],
        ['https://docs.cloud.google.com/chronicle/docs/investigation/yara-l-2-0-conditions', 'Use conditions in search and dashboards'],
        ['https://docs.cloud.google.com/chronicle/docs/investigation/udm-search-vs-rules-results', 'UDM search compared with rule results'],
        ['https://docs.cloud.google.com/chronicle/docs/reference/udm-field-list', 'UDM field list'],
      ].map(([h, t]) => el('li', {}, link(h, t)))),
      el('p', { class: 'small muted', text: 'Links open in a new tab on click only. Google\'s pages disagree on whether Search supports the condition section; this trainer follows the page that documents it and says so in chapter 6.' })),
    el('div', { class: 'navrow' }, el('a', { href: '#' }, el('button', { text: '← Back to the case file' }))),
  );
}

window.addEventListener('hashchange', route);
route();
