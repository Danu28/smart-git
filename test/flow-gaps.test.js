const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

// Tier-1 flow-gap regression tests (pass 3): sg switch, sg undo <file>, sg diff <ref>.
// Deterministic: no TTY needed — CLI paths use --yes; the one confirm-decline case
// uses the inquirer stub pattern (shared require cache) like commit-interactive.

const BIN = path.join(__dirname, '..', 'bin', 'smart-git.js');

function mkRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-flow-'));
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

async function runInProcess(repoDir, argv, answers) {
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
    const program = require(path.join(__dirname, '..', 'src', 'index')).program;
    await program.parseAsync(argv, { from: 'user' });
    return prompts;
  } finally {
    process.chdir(prevCwd);
    inquirer.prompt = original;
  }
}

// ---- sg switch ----

test('switch jumps to an existing branch and back with -', () => {
  const { dir, git } = mkRepo();
  const defaultBranch = git('branch', '--show-current').stdout.trim();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  git('checkout', '-qb', 'feature');
  write(dir, 'b.txt', 'y\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: work');
  git('checkout', '-q', defaultBranch);

  const r = sg(dir, 'switch', 'feature');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Switched/);
  assert.strictEqual(git('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim(), 'feature');

  const back = sg(dir, 'switch', '-');
  assert.strictEqual(back.status, 0, back.stderr);
  assert.strictEqual(git('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim(), defaultBranch);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('switch to a missing branch exits 1 with guidance', () => {
  const { dir, git } = mkRepo();
  const defaultBranch = git('branch', '--show-current').stdout.trim();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  const r = sg(dir, 'switch', 'nope');
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /not found/);
  assert.match(r.stderr, /branch --create/);
  assert.strictEqual(git('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim(), defaultBranch);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- sg diff <refs...> ----

test('diff with a single ref shows that commit diff stat', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'v1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: one');
  write(dir, 'a.txt', 'v2\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: two');

  const r = sg(dir, 'diff', 'HEAD~1');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Diff HEAD~1/);
  assert.match(r.stdout, /a\.txt/);
  // stats-only by default: no patch hunks
  assert.doesNotMatch(r.stdout, /^@@/m);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('diff with two refs shows the range diff', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'v1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: one');
  write(dir, 'a.txt', 'v2\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: two');
  const hash1 = git('rev-parse', 'HEAD~1').stdout.trim();
  const hash2 = git('rev-parse', 'HEAD').stdout.trim();

  const r = sg(dir, 'diff', hash1, hash2);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`Diff ${hash1} ${hash2}`));
  assert.match(r.stdout, /a\.txt/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- sg undo <file> ----

test('undo <file> unstages a staged-only file', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  write(dir, 'a.txt', 'y\n');
  git('add', 'a.txt');
  assert.match(git('status', '--porcelain').stdout, /^M /m);

  const r = sg(dir, 'undo', 'a.txt');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Unstaged a\.txt/);
  assert.match(git('status', '--porcelain').stdout, /^ M a\.txt/m);
  assert.strictEqual(git('show', ':a.txt').stdout, 'x\n');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('undo <file> discards an untracked file with --yes', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  write(dir, 'junk.txt', 'temp\n');

  const r = sg(dir, 'undo', 'junk.txt', '--yes');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Deleted untracked junk\.txt/);
  assert.strictEqual(fs.existsSync(path.join(dir, 'junk.txt')), false);
  assert.doesNotMatch(git('status', '--porcelain').stdout, /junk\.txt/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('undo <file> without --yes keeps the file when confirm declined', async () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  write(dir, 'junk.txt', 'temp\n');

  const prompts = await runInProcess(dir, ['undo', 'junk.txt'], { ok: false });
  assert.deepStrictEqual(prompts, ['ok']);
  assert.strictEqual(fs.existsSync(path.join(dir, 'junk.txt')), true);
  fs.rmSync(dir, { recursive: true, force: true });
});