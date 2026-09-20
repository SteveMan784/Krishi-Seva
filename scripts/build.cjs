const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
fs.mkdirSync(output, {recursive: true});
// Explicit allowlist: never publish backend source, credentials, tests or node_modules.
for (const file of ['index.html', 'manifest.json', 'sw.js', 'js/app.js', 'js/firebase-config.js', 'assets/icon.svg']) {
  fs.mkdirSync(path.dirname(path.join(output, file)), {recursive: true});
  fs.copyFileSync(path.join(root, file), path.join(output, file));
}
