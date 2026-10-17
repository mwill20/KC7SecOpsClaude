import { loadContent, loadData, validate } from './lib.mjs';
const problems = validate(loadContent(), loadData());
if (problems.length) { console.error('Content problems:\n- ' + problems.join('\n- ')); process.exit(1); }
console.log('content ok');
