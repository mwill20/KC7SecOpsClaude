import { loadContent, loadDatasets, validate } from './lib.mjs';
const content = loadContent();
const problems = validate(content, loadDatasets(content));
if (problems.length) { console.error('Content problems:\n- ' + problems.join('\n- ')); process.exit(1); }
console.log('content ok:', content.cases.length, 'cases,', content.chapters.flatMap(c => c.missions).length, 'missions,', content.lists.lists.length, 'lists');
