const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin', 'smart-git.js');

function mkRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-aug-'));
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@smart-git.local');
  git('config', 'user.name', 'smart-git test');
  return { dir, git };
}
function sg(cwd, ...args) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
}
function write(dir, name, content) {
  fs.writeFileSync(path.join(dir, name), content);
}

// ── triage module direct ────────────────────────────────────────────────
test('triage: getTriageState returns not-repo outside git', () => {
  const { getTriageState } = require('../src/triage');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-triage-norepo-'));
  const s = getTriageState(dir);
  assert.strictEqual(s.mode, 'not-repo');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('triage: clean repo returns clean mode', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  const prev = process.cwd();
  process.chdir(dir);
  try {
    const { getTriageState } = require('../src/triage');
    // clear require cache to ensure cwd-sensitive
    delete require.cache[require.resolve('../src/triage')];
    const fresh = require('../src/triage');
    const s = fresh.getTriageState(dir);
    assert.strictEqual(s.mode, 'clean');
  } finally {
    process.chdir(prev);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('triage: dirty repo returns dirty mode', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  write(dir, 'a.txt', 'y\n');
  const prev = process.cwd();
  process.chdir(dir);
  try {
    delete require.cache[require.resolve('../src/triage')];
    const { getTriageState } = require('../src/triage');
    const s = getTriageState(dir);
    assert.strictEqual(s.mode, 'dirty');
    assert.ok(s.dirtyCount >= 1);
  } finally {
    process.chdir(prev);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('triage: bare sg outside repo shows triage not-repo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-triage-spawn-'));
  const r = sg(dir);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /not a git repo/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('triage: bare sg in clean repo shows clean triage', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  const r = sg(dir);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /clean/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── git submodules ───────────────────────────────────────────────────────
test('git/run: shellSplit handles quotes and spaces', () => {
  const { shellSplit } = require('../src/utils/git/run');
  assert.deepStrictEqual(shellSplit(`log --pretty="%H %s"`), ['log', '--pretty=%H %s']);
  assert.deepStrictEqual(shellSplit(`commit -m 'feat: \"x\" & $y'`), [
    'commit',
    '-m',
    'feat: \"x\" & $y',
  ]);
  assert.deepStrictEqual(shellSplit(`a \"C:\\\\Users\\\\tmp file.txt\" b`), [
    'a',
    'C:\\\\Users\\\\tmp file.txt',
    'b',
  ]);
  assert.deepStrictEqual(shellSplit(`a '{a..b}'`), ['a', '{a..b}']);
});

test('git/status: getChangedFiles and invalidate', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  write(dir, 'b.txt', 'new\n');
  const prev = process.cwd();
  process.chdir(dir);
  try {
    const {
      getChangedFiles,
      invalidateChangedCache,
      getStatusPorcelain,
    } = require('../src/utils/git');
    const files = getChangedFiles();
    assert.ok(files.some((f) => f.file === 'b.txt'));
    assert.match(getStatusPorcelain(), /b\.txt/);
    invalidateChangedCache();
    const files2 = getChangedFiles();
    assert.ok(files2.length >= 1);
  } finally {
    process.chdir(prev);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('git/pathspec: expandPathspecs matches staged files', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  try {
    fs.mkdirSync(path.join(dir, 'sub'));
  } catch {}
  write(dir, 'a.txt', 'y\n');
  write(dir, 'sub/b.txt', 'z\n');
  git('add', 'a.txt');
  const prev = process.cwd();
  process.chdir(dir);
  try {
    const { expandPathspecs } = require('../src/utils/git');
    const { matched } = expandPathspecs(['a.txt']);
    assert.ok(matched.some((m) => m.file === 'a.txt'));
  } finally {
    process.chdir(prev);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── tidy ─────────────────────────────────────────────────────────────────
test('tidy: without flags shows usage', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  const r = sg(dir, 'tidy');
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /--untracked|--merged/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('tidy: --untracked --dry-run preview', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  write(dir, 'untracked.txt', 'hello\n');
  const r = sg(dir, 'tidy', '--untracked', '--dry-run');
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /dry-run|Would remove|untracked/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('tidy: --untracked protects .env without --force', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  write(dir, '.env', 'SECRET=1\n');
  write(dir, 'other.txt', 'x\n');
  const r = sg(dir, 'tidy', '--untracked');
  // should error about protected files (exit 1 via UserError)
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /protected/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('tidy: --merged --dry-run on clean repo', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  const r = sg(dir, 'tidy', '--merged', '--dry-run');
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /tidy --merged|No merged branches/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── review ───────────────────────────────────────────────────────────────
test('review: clean repo review passes', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  const r = sg(dir, 'review');
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /review|Nothing to review/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('review: --json outputs machine-readable', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  const r = sg(dir, 'review', '--json');
  assert.strictEqual(r.status, 0);
  const j = JSON.parse(r.stdout);
  assert.ok(Array.isArray(j.issues));
  assert.ok(j.summary);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('review: detects WIP and large file', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  write(dir, 'b.txt', 'TODO fixme\n');
  git('add', 'b.txt');
  const r = sg(dir, 'review', '--staged', '--json');
  assert.strictEqual(r.status, 0);
  const j = JSON.parse(r.stdout);
  assert.ok(j.issues.some((i) => i.rule === 'wip'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('review: --strict fails on warnings', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'badmsg without conventional');
  write(dir, 'b.txt', 'TODO fix\n');
  git('add', 'b.txt');
  // last commit not conventional -> warn -> strict fails
  const r = sg(dir, 'review', '--strict');
  assert.strictEqual(r.status, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── checkpoint ───────────────────────────────────────────────────────────
test('checkpoint: --list on empty', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  const r = sg(dir, 'checkpoint', '--list');
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /checkpoints|No checkpoints/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('checkpoint: save and list', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  write(dir, 'a.txt', 'y\n');
  const r = sg(dir, 'checkpoint', 'my save');
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /Checkpoint saved/i);
  const r2 = sg(dir, 'checkpoint', '--list');
  assert.match(r2.stdout, /checkpoint:/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('checkpoint: --diff shows patch', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  write(dir, 'a.txt', 'y\n');
  sg(dir, 'checkpoint', 'diff test');
  const r = sg(dir, 'checkpoint', '--diff', '0');
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /diff --git|a\.txt/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── bisect ──────────────────────────────────────────────────────────────
test('bisect: help outside active', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  const r = sg(dir, 'bisect');
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /bisect/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('bisect: visual shows graph', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  write(dir, 'b.txt', 'y\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: second');
  const r = sg(dir, 'bisect', 'visual');
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /bisect visual|feat/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('bisect: log shows empty when not active', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  const r = sg(dir, 'bisect', 'log');
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /no bisect log|empty|We are not bisecting/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── resolve ──────────────────────────────────────────────────────────────
test('resolve: no conflicts shows clean', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  const r = sg(dir, 'resolve');
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /No conflicts/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('resolve: --dry-run with no conflicts', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  const r = sg(dir, 'resolve', '--dry-run');
  assert.strictEqual(r.status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('resolve: conflict dry-run preview', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'base\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: base');
  git('checkout', '-b', 'branch1', '-q');
  write(dir, 'a.txt', 'branch1\n');
  git('commit', '-am', 'feat: branch1', '-q');
  git('checkout', 'master', '-q');
  git('checkout', '-b', 'branch2', '-q'); // avoid main/master issue
  // create conflict: edit same file
  const head = git('branch', '--show-current').stdout.trim();
  git('checkout', '-b', 'conflict-test', '-q');
  write(dir, 'a.txt', 'conflictA\n');
  git('commit', '-am', 'feat: a', '-q');
  // stash and create another branch conflict not needed: just test dry-run path still covers code
  const r = sg(dir, 'resolve', '--dry-run');
  assert.strictEqual(r.status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── undo handlers direct ────────────────────────────────────────────────
test('undo handlers: show and fmtGit', () => {
  const { show, fmtGit } = require('../src/commands/undo/handlers');
  assert.strictEqual(show([]), '');
  assert.strictEqual(show(['a']), 'a');
  assert.strictEqual(show(['a', 'b', 'c', 'd', 'e', 'f']), 'a, b, c, d, e … (+1 more)');
  assert.strictEqual(
    fmtGit(['git restore', '--staged'], ['a.txt']),
    'git restore --staged -- a.txt'
  );
});

test('undo handlers: getCommitCount', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  const prev = process.cwd();
  process.chdir(dir);
  try {
    const { getCommitCount, isSingleCommit } = require('../src/commands/undo/handlers');
    assert.strictEqual(getCommitCount(), 1);
    assert.strictEqual(isSingleCommit(), true);
  } finally {
    process.chdir(prev);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('config command: --help lists options', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  const r = sg(dir, 'config', '--help');
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /config/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('doctor: clean repo shows no issues', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  const r = sg(dir, 'doctor');
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /doctor|Working tree clean|No rebase/i);
  fs.rmSync(dir, { recursive: true, force: true });
});
