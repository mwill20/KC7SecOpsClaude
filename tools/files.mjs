// The runtime allowlist: the only files that may exist in dist/ and the only files tools/serve.mjs will serve.
// build.mjs copies every entry except bundle.js from site/ and generates bundle.js; check-artifact.mjs proves
// that dist/ holds exactly this list and nothing else. Keep it the single source of truth.
export const runtimeFiles = ['index.html', 'styles.css', 'app.js', 'bundle.js', 'engine/catalog.js', 'engine/safety.js', 'engine/parser.js', 'engine/executor.js', 'engine/grader.js', 'ui/messages.js', 'ui/progress.js', 'ui/render.js', 'ui/casebook.js', 'ui/casebook-ui.js'];
