'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const [command, requested] = process.argv.slice(2);
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const manifest = JSON.parse(read('extension/manifest.json'));
const version = requested || pkg.version;
if (!['set', 'check'].includes(command) || !/^\d+\.\d+\.\d+$/.test(version) || (command === 'set' && !requested)) {
  throw new Error('Usage: node scripts/version.cjs set X.Y.Z | check [X.Y.Z]');
}
if (command === 'set') {
  pkg.version = manifest.version = manifest.version_name = version;
  for (const [file, value] of [['package.json', pkg], ['extension/manifest.json', manifest]]) {
    fs.writeFileSync(path.join(root, file), JSON.stringify(value, null, 2) + '\n');
  }
  fs.writeFileSync(path.join(root, 'extension/VERSION.txt'), version + '\n');
} else {
  if ([pkg.version, manifest.version, manifest.version_name, read('extension/VERSION.txt').trim()].some(v => v !== version)) {
    throw new Error('Release tag and version files disagree');
  }
  for (const file of ['README.md', 'INSTALL-CODEX.md', 'docs/release-notes.md']) {
    if (!read(file).trim()) throw new Error('Missing release document: ' + file);
  }
}
console.log('Version ' + version + ': ' + command + ' OK');
