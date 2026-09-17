const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

// Tier-3 team/housekeeping features: sg untrack, sg ignore, sg pr, sg why.

const BIN = path.join(__dirname, '..', 'bin', 'smart-git.js');
const BIN_DIR = path.join(__dirname, '..');

const GH_PRESENT = spawnSync('gh', ['--version'], { stdio: 'ignore' }).status === 0;

function mkRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-t3-'));
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@smart-git.local');
  git('config', 'user.name', 'smart-git test');
  return { dir, git };
}

function sg(cwd, ...args) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
}

function sgEnv(cwd, env, ...args) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
}

function write(dir, name, content) {
  fs.writeFileSync(path.join(dir, name), content);
}

function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function mkBare() {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-bare-'));
  spawnSync('git', ['init', '--bare', '-q'], { cwd: bare, encoding: 'utf8' });
  return bare;
}

function bareRefs(bare) {
  return spawnSync('git', ['--git-dir', bare, 'for-each-ref'], { encoding: 'utf8' }).stdout;
}

function ignoreContent(dir) {
  return fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
}

async function runInteractive(repoDir, argv, answers) {
  const inquirer = require('inquirer');
  const original = inquirer.prompt;
  const prompts = [];
  inquirer.prompt = async (questions) => {
    const out = {};
    for (const q of questions) {
      prompts.push(q.name);
      out[q.name] = answers[q.name];
    }
    return out;
  };
  const prevCwd = process.cwd();
  process.chdir(repoDir);
  try {
    const program = require(path.join(BIN_DIR, 'src', 'index')).program;
    await program.parseAsync(argv, { from: 'user' });
    return prompts;
  } finally {
    process.chdir(prevCwd);
    inquirer.prompt = original;
  }
}

// ── sg untrack ────────────────────────────────────────────────────────────

test('untrack removes from the index, keeps the file, and appends .gitignore with --yes', () => {
  const { dir, git } = mkRepo();
  write(dir, '.env', 'SECRET=1\n');
  write(dir, 'app.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');

  const r = sg(dir, 'untrack', '.env', '--yes');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Untracked 1 path/);
  assert.ok(fs.existsSync(path.join(dir, '.env')), 'file stays on disk');
  assert.doesNotMatch(git('ls-files').stdout, /\.env/);
  assert.match(git('ls-files').stdout, /app\.txt/);
  assert.match(ignoreContent(dir), /^\.env$/m);
  rm(dir);
});

test('untrack --no-gitignore never touches .gitignore', () => {
  const { dir, git } = mkRepo();
  write(dir, '.env', 'SECRET=1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');

  const r = sg(dir, 'untrack', '.env', '--no-gitignore');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(path.join(dir, '.gitignore')));
  assert.strictEqual(git('ls-files').stdout.trim(), '');
  rm(dir);
});

test('untrack of a path that is not tracked fails cleanly', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');

  const r = sg(dir, 'untrack', 'nope.txt');
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /None of the given paths are tracked/);
  assert.strictEqual(git('ls-files').stdout.trim(), 'a.txt'); // nothing was untracked
  rm(dir);
});

// ── sg ignore ─────────────────────────────────────────────────────────────

test('ignore appends a pattern once (dedupe)', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');

  const first = sg(dir, 'ignore', '*.log');
  assert.strictEqual(first.status, 0, first.stderr);
  assert.match(first.stdout, /Added 1 pattern/);
  assert.strictEqual(ignoreContent(dir), '*.log\n');

  const second = sg(dir, 'ignore', '*.log');
  assert.strictEqual(second.status, 0, second.stderr);
  assert.match(second.stdout, /already present/);
  assert.strictEqual(ignoreContent(dir), '*.log\n'); // still one line
  rm(dir);
});

test('ignore warns when the pattern matches already-tracked files', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');

  const r = sg(dir, 'ignore', 'a.txt');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /matches tracked/);
  assert.match(r.stdout, /a\.txt/);
  assert.match(ignoreContent(dir), /^a\.txt$/m); // appended anyway
  rm(dir);
});

test('ignore --from-status picks untracked files via checkbox', async () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  write(dir, 'x.txt', '1\n');
  write(dir, 'y.txt', '2\n');
  write(dir, 'z.txt', '3\n');

  const prompts = await runInteractive(dir, ['ignore', '--from-status'], { selected: ['x.txt', 'z.txt'] });
  assert.deepStrictEqual(prompts, ['selected']);
  const content = ignoreContent(dir);
  assert.match(content, /^x\.txt$/m);
  assert.match(content, /^z\.txt$/m);
  assert.doesNotMatch(content, /y\.txt/);
  rm(dir);
});

test('bare sg ignore lists the current .gitignore', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  sg(dir, 'ignore', 'out.log');

  const r = sg(dir, 'ignore');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /smart ignore/);
  assert.match(r.stdout, /out\.log/);
  rm(dir);
});

// ── sg pr ─────────────────────────────────────────────────────────────────

test('pr --dry-run prints the steps and pushes nothing', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  const bare = mkBare();
  git('remote', 'add', 'origin', bare);

  const r = sg(dir, 'pr', '--dry-run');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /push -u origin/);
  assert.match(r.stdout, /\[dry-run\]/);
  assert.strictEqual(bareRefs(bare), ''); // nothing pushed
  rm(dir);
  rm(bare);
});

test('pr without a remote fails cleanly', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');

  const r = sg(dir, 'pr');
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /No git remotes/);
  rm(dir);
});

test('pr pushes and invokes gh with pr create --fill (SMART_GIT_GH override)', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  const bare = mkBare();
  git('remote', 'add', 'origin', bare);

  const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-fakegh-'));
  fs.writeFileSync(path.join(fakeDir, 'gh.cmd'), '@echo off\r\necho %* > "%~dp0gh-called.args"\r\necho https://fake.example/pr/1\r\n');

  const r = sgEnv(dir, { SMART_GIT_GH: path.join(fakeDir, 'gh.cmd') }, 'pr');
  assert.strictEqual(r.status, 0, r.stderr);
  const argsFile = path.join(fakeDir, 'gh-called.args');
  assert.ok(fs.existsSync(argsFile), 'gh was invoked');
  assert.match(fs.readFileSync(argsFile, 'utf8'), /pr create --fill/);
  assert.match(r.stdout, /https:\/\/fake\.example\/pr\/1/); // gh output surfaced
  assert.ok(bareRefs(bare).trim(), 'branch was pushed before gh');
  rm(dir);
  rm(bare);
  rm(fakeDir);
});

test('pr degrades to a hint when gh is missing', { skip: GH_PRESENT }, () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  const bare = mkBare();
  git('remote', 'add', 'origin', bare);

  const r = sg(dir, 'pr');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /gh CLI not found/);
  assert.match(r.stdout, /cli\.github\.com/);
  assert.ok(bareRefs(bare).trim(), 'push still happened');
  rm(dir);
  rm(bare);
});

// ── sg why ────────────────────────────────────────────────────────────────

test('why <file> shows authors and recent changes', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'v1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: one');
  write(dir, 'a.txt', 'v2\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: two');

  const r = sg(dir, 'why', 'a.txt');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Top authors/);
  assert.match(r.stdout, /smart-git test/);
  assert.match(r.stdout, /Recent changes/);
  assert.match(r.stdout, /feat: two/);
  assert.match(r.stdout, /feat: one/);
  rm(dir);
});

test('why <file>:<line> names the commit that last touched the line', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'alpha\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: old');
  write(dir, 'a.txt', 'beta\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: new');

  const r = sg(dir, 'why', 'a.txt:1');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Line 1:/);
  assert.match(r.stdout, /beta/); // current content of the line
  assert.match(r.stdout, /feat: new/); // last commit touching that line
  assert.match(r.stdout, /History of this line/);
  rm(dir);
});

test('why errors cleanly on untracked files and out-of-range lines', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'only line\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  write(dir, 'u.txt', 'never committed\n');

  const untracked = sg(dir, 'why', 'u.txt');
  assert.strictEqual(untracked.status, 1);
  assert.match(untracked.stderr, /not a tracked file/);

  const range = sg(dir, 'why', 'a.txt:99');
  assert.strictEqual(range.status, 1);
  assert.match(range.stderr, /out of range/);
  rm(dir);
});