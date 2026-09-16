const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin', 'smart-git.js');

function mkRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-test-'));
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

test('help works outside a git repository', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-norepo-'));
  const r = sg(dir, '--help');
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /Usage: smart-git/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('status outside a git repository exits 1 with guidance', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-norepo-'));
  const r = sg(dir, 'status');
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /Not a git repository/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('clean repo: status reports clean working tree', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'hello\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  const r = sg(dir, 'status');
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /Working tree clean/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('commit -m with shell metacharacters is not injected', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'hello\n');
  git('add', '-A');
  const msg = 'feat: test "quotes" & $special | chars; rm -rf x';
  const r = sg(dir, 'commit', '-m', msg);
  assert.strictEqual(r.status, 0, r.stderr);
  const log = git('log', '-1', '--pretty=%s').stdout.trim();
  assert.strictEqual(log, msg);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('selective commit stages only the given files', () => {
  const { dir, git } = mkRepo();
  write(dir, 'f1.txt', 'one\n');
  write(dir, 'f2.txt', 'two\n');
  write(dir, 'f3.txt', 'three\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  write(dir, 'f1.txt', 'one changed\n');
  write(dir, 'f2.txt', 'two changed\n');
  write(dir, 'f3.txt', 'three changed\n');
  const r = sg(dir, 'commit', '-m', 'feat: only f1', 'f1.txt');
  assert.strictEqual(r.status, 0, r.stderr);
  const status = git('status', '--porcelain').stdout;
  assert.match(status, /^ M f2\.txt/m);
  assert.match(status, /^ M f3\.txt/m);
  assert.doesNotMatch(status, /f1\.txt/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('selective commit supports filenames with spaces', () => {
  const { dir, git } = mkRepo();
  write(dir, 'my file.txt', 'x\n');
  write(dir, 'plain.txt', 'y\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  write(dir, 'my file.txt', 'x changed\n');
  write(dir, 'plain.txt', 'y changed\n');
  const r = sg(dir, 'commit', '-m', 'feat: spaced', 'my file.txt');
  assert.strictEqual(r.status, 0, r.stderr);
  const status = git('status', '--porcelain').stdout;
  assert.match(status, /plain\.txt/);
  assert.doesNotMatch(status, /my file\.txt/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('dry-run stages nothing and commits nothing', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  write(dir, 'a.txt', 'y\n');
  const before = git('status', '--porcelain').stdout;
  const r = sg(dir, 'commit', '--dry-run', '-m', 'feat: nope');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /dry-run/i);
  assert.strictEqual(git('status', '--porcelain').stdout, before);
  assert.strictEqual(git('log', '-1', '--pretty=%s').stdout.trim(), 'feat: init');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('--all commits every change', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  write(dir, 'a.txt', 'y\n');
  write(dir, 'b.txt', 'new\n');
  const r = sg(dir, 'commit', '-m', 'feat: all', '--all');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(git('status', '--porcelain').stdout.trim(), '');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('undo --soft on a single-commit repo does not crash', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: initial');
  const r = sg(dir, 'undo', '--soft');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /ambiguous argument/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('diff does not shell out to head (Windows-safe)', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  write(dir, 'a.txt', 'y\n');
  const r = sg(dir, 'diff');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /head.*not recognized/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('sync --dry-run works without a remote', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  const r = sg(dir, 'sync', '--dry-run');
  assert.strictEqual(r.status, 0, r.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('branch lists the current branch', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  const r = sg(dir, 'branch');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /main|master/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('stash --push then --pop round-trips', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  write(dir, 'a.txt', 'y\n');
  const push = sg(dir, 'stash', '--push', 'test stash');
  assert.strictEqual(push.status, 0, push.stderr);
  assert.strictEqual(git('status', '--porcelain').stdout.trim(), '');
  const pop = sg(dir, 'stash', '--pop');
  assert.strictEqual(pop.status, 0, pop.stderr);
  assert.match(git('status', '--porcelain').stdout, /a\.txt/);
  fs.rmSync(dir, { recursive: true, force: true });
});
