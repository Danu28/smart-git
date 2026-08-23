// Bug-reproduction tests for smart-git.
// Each test asserts the CORRECT behavior, so it FAILS on current code.
// The failure is the evidence that the bug is real (no fixes are applied here).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const SRC = path.join(__dirname, '..', 'src');
const BIN = path.join(__dirname, '..', 'bin', 'smart-git');
const { readInput } = require(SRC + '/cli');
const { trace, formatTable } = require(SRC + '/trace');
const lens = require(SRC + '/lens');

function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-bug-'));
  cp.execSync('git init -q && git config user.email t@t && git config user.name t', { cwd: dir });
  for (const [p, c] of Object.entries(files)) {
    const fp = path.join(dir, p);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, c);
  }
  cp.execSync('git add -A && git commit -qm init', { cwd: dir });
  return dir;
}

// F — readStdin's 250ms timer resolves and DROPS any stdin that arrives later.
test('stdin arriving after 250ms is captured (not dropped)', (t, done) => {
  const dir = makeRepo({ 'src/app.js': 'line1\n' });
  const child = cp.spawn('node', [BIN, 'trace', '--oneline'], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (c) => (out += c));
  child.stderr.on('data', (c) => (out += c));
  setTimeout(() => {
    child.stdin.write('Error\n at foo (src/app.js:1:2)\n');
    child.stdin.end();
  }, 400); // later than the 250ms cap
  child.on('close', (code) => {
    fs.rmSync(dir, { recursive: true, force: true });
    assert.equal(code, 0, 'slow producer should still find culprits, got: ' + out.trim());
    assert.ok(out.includes('app.js'), 'stacktrace should be captured: ' + out.trim());
    done();
  });
});

// B — a missing --stacktrace file path must error, not be used as raw stacktrace text.
test('readInput errors on missing --stacktrace file', async () => {
  const MISSING = path.join(os.tmpdir(), 'does-not-exist-' + Date.now() + '.log');
  await assert.rejects(
    () => readInput(MISSING, null),
    /not found/i,
    'a missing --stacktrace file must throw, not be used as raw stacktrace text'
  );
});

// E — trace() omits `error` when locations are found but no culprit resolves.
test('trace includes error when locations but no culprits', () => {
  const dir = makeRepo({ 'src/app.js': 'line1\n' });
  const prev = process.cwd();
  try {
    process.chdir(dir);
    const r = trace('at foo (untracked/nope.js:1:2)');
    assert.ok(r.error, 'trace should set error when locations exist but no culprits found');
  } finally {
    process.chdir(prev);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// C — formatTable hash column is misaligned relative to the header.
test('formatTable hash column aligns with header', () => {
  const culprits = [{ hash: 'abc123def456', file: 'src/app.js', line: 1, author: 'Alice', date: '2026-01-01 00:00:00', message: 'feat', whitespaceOnly: false }];
  const t = formatTable(culprits, {});
  const lines = t.split('\n');
  const hIdx = lines[0].indexOf('hash');
  const rIdx = lines[2].indexOf('abc123def456');
  assert.equal(hIdx, rIdx, 'hash value column must sit under the "hash" header label');
});

// I — lens.exitLens substring match can target the MAIN worktree when the repo
// path itself contains 'smart-git-lens'.
test('lens.exitLens ignores main worktree when repo path contains substring', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-git-lens-demo-'));
  cp.execSync('git init -q && git config user.email t@t && git config user.name t', { cwd: dir });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x\n');
  cp.execSync('git add a.txt && git commit -qm c', { cwd: dir });
  const prev = process.cwd();
  try {
    process.chdir(dir);
    assert.throws(
      () => lens.exitLens(),
      (e) => !/main working tree/i.test(e.message) && /no lens/i.test(e.message),
      'exitLens must report "no lens", not try to remove the main worktree'
    );
  } finally {
    process.chdir(prev);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// J — trace JSON is documented to include a root-level `snippet`; it does not.
test('trace JSON includes root snippet (documented contract)', () => {
  const dir = makeRepo({ 'src/app.js': 'line1\n' });
  const prev = process.cwd();
  try {
    process.chdir(dir);
    const r = trace('at foo (src/app.js:1:2)');
    assert.ok('snippet' in r, 'trace JSON should include root-level snippet per README');
  } finally {
    process.chdir(prev);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
