import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, validateState, KEY } from '../../site/ui/progress.js';

const ids = new Set(['C01-M01', 'C01-M02']);
const memStorage = (initial = {}) => { const m = new Map(Object.entries(initial)); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), dump: () => Object.fromEntries(m) }; };

test('P1 session-only by default: nothing is written until remembering is turned on', () => {
  const st = memStorage(); const s = createStore(ids, st);
  s.record('C01-M01', 'q', 60);
  assert.equal(st.getItem(KEY), null); assert.equal(s.total(), 60);
  s.setRemember(true);
  assert.ok(st.getItem(KEY)); assert.ok(!st.getItem(KEY).includes('USER_LOGIN'));
  s.setRemember(false);
  assert.equal(st.getItem(KEY), null);
});

test('P2 only valid points for valid parts are recorded; lower scores never overwrite higher ones', () => {
  const s = createStore(ids, memStorage());
  s.record('C01-M01', 'q', 61); s.record('C01-M01', 'x', 60); s.record('NOPE', 'q', 60);
  assert.equal(s.total(), 0);
  s.record('C01-M01', 'a', 25); s.record('C01-M01', 'a', 0);
  assert.equal(s.get('C01-M01').a, 25);
});

test('P3 should-fail: hostile or malformed stored state is ignored, not loaded and not deleted', () => {
  const cases = ['{"v":1,"missions":{"C01-M01":{"q":999}}}', '{"v":2,"missions":{}}', '{"v":1,"missions":{"EVIL":{"q":60}}}', '{"v":1,"missions":{"C01-M01":{"q":60,"text":"metadata.event_type"}}}', '[]', 'not json', '{"v":1,"missions":{"C01-M01":{"q":60,"h":9}}}'];
  for (const text of cases) {
    const st = memStorage({ [KEY]: text }); const s = createStore(ids, st);
    assert.equal(s.total(), 0, text); assert.equal(s.remember, false, text); assert.equal(st.getItem(KEY), text, 'untouched: ' + text);
  }
  assert.equal(validateState({ v: 1, missions: { 'C01-M02': { q: 60, a: 25, c: 15, h: 3 } } }, ids).missions['C01-M02'].h, 3);
});

test('P4 oversize stored state is ignored; a valid one restores remembering', () => {
  const big = memStorage({ [KEY]: '{"v":1,"missions":{}}'.padEnd(20000, ' ') });
  assert.equal(createStore(ids, big).remember, false);
  const good = memStorage({ [KEY]: JSON.stringify({ v: 1, missions: { 'C01-M01': { q: 60, a: 0, c: 15, h: 1 } } }) });
  const s = createStore(ids, good); assert.equal(s.remember, true); assert.equal(s.total(), 75);
  s.clear(); assert.equal(good.getItem(KEY), null); assert.equal(s.total(), 0);
});

test('P5 storage that throws leaves the store session-only instead of crashing', () => {
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('blocked'); } };
  const s = createStore(ids, broken); s.setRemember(true); s.record('C01-M01', 'c', 15);
  assert.equal(s.total(), 15);
});
