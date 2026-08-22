const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { trace, formatTable } = require('../src/trace');

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-test-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email "t@t.com" && git config user.name "T"', { cwd: dir });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/app.js'), 'line1\n');
  execSync('git add -A && git commit -qm initial', { cwd: dir });
  fs.writeFileSync(path.join(dir, 'src/app.js'), 'bad()\n');
  execSync('git add -A && git commit -qm feat', { cwd: dir });
  fs.writeFileSync(path.join(dir, 'src/app.js'), 'bad() // fmt\n');
  execSync('git add -A && git commit -qm fmt', { cwd: dir });
  const prev = process.cwd();
  process.chdir(dir);
  return { dir, prev, cleanup() { process.chdir(prev); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('trace returns locations and culprits in repo', () => {
  const { cleanup } = tmpRepo();
  try {
    const r = trace('Error\n at foo (src/app.js:1:2)');
    assert.equal(r.locations.length, 1);
    assert.equal(r.locations[0].file, 'src/app.js');
    assert.ok(r.culprits.length >= 1);
    assert.match(r.culprits[0].hash, /^[0-9a-f]{7,12}$/);
    assert.ok(r.culprits[0].file.includes('app.js'));
  } finally { cleanup(); }
});

test('trace no file:line returns error', () => {
  const { cleanup } = tmpRepo();
  try {
    const r = trace('no stack here');
    assert.equal(r.culprits.length, 0);
    assert.ok(r.error);
  } finally { cleanup(); }
});

test('formatTable and oneline', () => {
  const culprits = [{ hash: 'abc123def456', file: 'src/app.js', line: 1, author: 'Alice', date: '2026-01-01', message: 'feat', whitespaceOnly: false }];
  const t = formatTable(culprits, {});
  assert.ok(t.includes('abc123def456'));
  assert.ok(t.includes('src/app.js:1'));
  const o = formatTable(culprits, { oneline: true });
  assert.equal(o, 'abc123def456 src/app.js:1 feat');
  assert.equal(formatTable([], {}), 'No culprits found.');
});

test('bin help works', () => {
  const help = execSync('node ' + JSON.stringify(path.join(process.cwd(), 'bin/smart-git')) + ' --help', { encoding: 'utf8' });
  assert.ok(help.includes('smart-git'));
});
