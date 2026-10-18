// Tiny DOM helpers. Everything renders through text nodes; there is no innerHTML anywhere.
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style') node.style.cssText = v; // CSSOM assignment is allowed under style-src 'self'; a style attribute is not
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}
export const frag = (...kids) => { const f = document.createDocumentFragment(); for (const k of kids.flat()) if (k) f.append(k); return f; };
export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

export const fmtTime = s => { const d = new Date(s * 1000); return d.toISOString().slice(5, 19).replace('T', ' '); };
export const fmtNum = n => typeof n === 'number' ? n.toLocaleString('en-US') : String(n);
export const fmtBytes = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B';

const BASE_COLS = ['metadata.event_type', 'principal.user.userid', 'principal.hostname', 'principal.ip', 'target.user.userid', 'target.hostname', 'target.ip', 'target.port', 'security_result.action'];
const EXTRA_COLS = ['target.process.command_line', 'target.process.file.full_path', 'network.dns.questions.name', 'network.email.from', 'network.email.to', 'network.email.subject', 'target.url', 'target.file.full_path', 'network.sent_bytes', 'network.received_bytes', 'security_result.summary'];
const short = c => c.replace('metadata.', '').replace('security_result.', 'sr.').replace('network.', 'net.').replace('.file.full_path', '.path').replace('.questions.name', '.question').replace('.command_line', '.cmd');

// timeCols: outcome column names whose values are timestamps in seconds; they render as UTC clock times with the raw
// value beside them, so a min/max on metadata.event_timestamp.seconds reads as "first" and "last".
export function resultsTable(result, onRow, timeCols = new Set()) {
  if (result.kind === 'events') {
    const sample = result.rows.slice(0, 200);
    const present = c => sample.some(r => r[c] !== undefined && r[c] !== '' && r[c] !== 0);
    const cols = ['time', ...BASE_COLS.filter(present), ...EXTRA_COLS.filter(present)].slice(0, 9);
    // Each row keeps its table semantics; a real button in the first cell opens the record, so keyboard and
    // screen-reader users get one focus stop per row with an explicit name. Mouse users can click anywhere on the row.
    const head = el('tr', {}, el('th', { text: 'record' }), cols.map(c => el('th', { text: c === 'time' ? 'time (UTC)' : short(c) })));
    const body = sample.map(r => { const btn = el('button', { class: 'ghost', text: 'Open', 'aria-label': 'Open record ' + r['metadata.id'], onclick: e => { e.stopPropagation(); onRow(r, btn); } });
      return el('tr', { class: 'row-btn', onclick: () => onRow(r, btn) }, el('td', {}, btn),
        cols.map(c => el('td', { text: c === 'time' ? fmtTime(r['metadata.event_timestamp.seconds']) : cell(r[c]) }))); });
    return el('table', {}, el('thead', {}, head), el('tbody', {}, body));
  }
  const head = el('tr', {}, result.columns.map(c => el('th', { text: c === 'window_start' ? 'window start (UTC)' : short(c) })));
  const body = result.rows.slice(0, 200).map(r => el('tr', {}, result.columns.map(c => el('td', { class: Array.isArray(r[c]) ? 'arr' : null, text: c === 'window_start' ? fmtTime(r[c]) : timeCols.has(c) && typeof r[c] === 'number' && r[c] > 0 ? `${fmtTime(r[c])} (${r[c]})` : cell(r[c]) }))));
  return el('table', {}, el('thead', {}, head), el('tbody', {}, body));
}
// An array outcome renders as a comma-joined list; the display is capped so a 1,000-element array stays readable.
export const ARRAY_SHOW = 12;
export const fmtArray = a => a.length ? (a.length > ARRAY_SHOW ? a.slice(0, ARRAY_SHOW).map(String).join(', ') + ` … (+${fmtNum(a.length - ARRAY_SHOW)} more, ${fmtNum(a.length)} in all)` : a.map(String).join(', ')) : '[]';
const cell = v => v === undefined || v === '' ? '—' : Array.isArray(v) ? fmtArray(v) : typeof v === 'number' ? fmtNum(v) : String(v);

export function rawRecord(r) {
  const entries = Object.entries(r).sort(([a], [b]) => a.localeCompare(b));
  return el('div', { class: 'raw' }, el('dl', {}, entries.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: k === 'metadata.event_timestamp.seconds' ? v + ' (' + fmtTime(v) + ' UTC)' : String(v) })])));
}
