const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

// Regression tests for audit pass 2 (2026-09-17) — 6 confirmed bugs:
//   1. sg branch -d exact-match merged check (substring false-positive)
//   2. sg undo <file> "discard ALL" on MM files leaves the staged version
//   3. sg stash --pop with no stashes -> raw stack trace
//   4. sg commit --amend with no commits -> raw stack trace + surprise staging
//   5. sg diff <ref1> <ref2> --staged -> git rejects --cached, silent "(no diff)"
//   6. async command errors crash with unhandled-rejection stack traces
//      (fixed centrally via program.parseAsync().catch in bin/smart-git.js)

const BIN = path.join(__dirname, '..', 'bin', 'smart-git.js');

function mkRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-auditfix-'));
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

function defaultBranch(git) {
  return git('branch', '--show-current').stdout.trim();
}

const STACK_RE = /at Command\.|at runGit|Node\.js v\d+\./;

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
    // parseAsync rejects on error — runInProcess must propagate so tests fail loudly
    try {
      await program.parseAsync(argv, { from: 'user' });
    } catch (err) {
      err.message = `${err.message} (prompts: ${prompts.join(',')})`;
      throw err;
    }
    return prompts;
  } finally {
    process.chdir(prevCwd);
    inquirer.prompt = original;
  }
}

// ---- 1. branch -d exact-match ----

test('branch -d: unmerged "feature" is not treated as merged because "feature-x" is', async () => {
  const { dir, git } = mkRepo();
  const def = defaultBranch(git);
  write(dir, 'a.txt', 'x\n');
  git('add', '-A'); git('commit', '-qm', 'feat: init');
  git('checkout', '-qb', 'feature-x');
  write(dir, 'b.txt', 'y\n');
  git('add', '-A'); git('commit', '-qm', 'feat: x');
  git('checkout', '-q', def);
  git('merge', '-q', '--no-edit', 'feature-x'); // feature-x IS merged
  git('checkout', '-qb', 'feature');            // feature is NOT merged
  write(dir, 'c.txt', 'z\n');
  git('add', '-A'); git('commit', '-qm', 'feat: unmerged');
  git('checkout', '-q', def);

  // decline the force prompt -> aborted, branch intact, no stack
  const prompts = await runInProcess(dir, ['branch', '-d', 'feature'], { force: false });
  assert.deepStrictEqual(prompts, ['force']);
  assert.match(git('branch').stdout, /feature$/m, 'feature survives');
  assert.match(git('branch').stdout, /feature-x$/m, 'feature-x survives');
});

test('branch -d: confirming force deletes an unmerged branch', async () => {
  const { dir, git } = mkRepo();
  const def = defaultBranch(git);
  write(dir, 'a.txt', 'x\n');
  git('add', '-A'); git('commit', '-qm', 'feat: init');
  git('checkout', '-qb', 'feature-x');
  write(dir, 'b.txt', 'y\n');
  git('add', '-A'); git('commit', '-qm', 'feat: x');
  git('checkout', '-q', def);
  git('merge', '-q', '--no-edit', 'feature-x');
  git('checkout', '-qb', 'feature');
  write(dir, 'c.txt', 'z\n');
  git('add', '-A'); git('commit', '-qm', 'feat: unmerged');
  git('checkout', '-q', def);

  await runInProcess(dir, ['branch', '-d', 'feature'], { force: true });
  assert.doesNotMatch(git('branch').stdout, /feature$/m, 'feature deleted (exact line)');
  assert.match(git('branch').stdout, /feature-x$/m, 'sibling branch survives');
});

test('branch -d: deleting the current branch exits 1 with a clean message', () => {
  const { dir, git } = mkRepo();
  const def = defaultBranch(git);
  write(dir, 'a.txt', 'x\n');
  git('add', '-A'); git('commit', '-qm', 'feat: init');

  const r = sg(dir, 'branch', '-d', def);
  assert.strictEqual(r.status, 1);
  assert.match((r.stdout + r.stderr), /Could not delete branch/i);
  assert.doesNotMatch((r.stdout + r.stderr), STACK_RE);
  assert.strictEqual(git('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim(), def);
});

// ---- 2. undo <file> discard-all on MM ----

test('undo <file> "discard all" on a staged+unstaged file truly discards index AND worktree', async () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'a\n');
  git('add', '-A'); git('commit', '-qm', 'feat: init');
  write(dir, 'a.txt', 'a\nb\n');   // staged change
  git('add', 'a.txt');
  write(dir, 'a.txt', 'a\nb\nc\n'); // further unstaged change -> MM
  assert.match(git('status', '--porcelain').stdout, /^MM a\.txt/m);

  await runInProcess(dir, ['undo', 'a.txt'], { mode: 'discard', ok: true });

  const status = git('status', '--porcelain').stdout;
  assert.doesNotMatch(status, /a\.txt/, 'file fully reverted');
  assert.strictEqual(git('show', ':a.txt').stdout, 'a\n', 'index copy reverted too');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'a\n', 'worktree reverted too');
  assert.strictEqual(git('diff', '--cached', '--stat').stdout.trim(), '', 'nothing staged');
});

// ---- 3. stash pop with no stashes ----

test('stash --pop with no stashes exits 0 with a hint, no stack trace', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A'); git('commit', '-qm', 'feat: init');
  const r = sg(dir, 'stash', '--pop');
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /No stashes to pop/i);
  assert.doesNotMatch(r.stdout + r.stderr, STACK_RE);
});

// ---- 4. commit --amend with no commits ----

test('commit --amend on a repo with no commits fails cleanly and stages nothing', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  const r = sg(dir, 'commit', '--amend', '-m', 'feat: oops');
  assert.strictEqual(r.status, 1);
  assert.match((r.stdout + r.stderr), /Nothing to amend/i);
  assert.doesNotMatch((r.stdout + r.stderr), STACK_RE);
  assert.strictEqual(git('status', '--porcelain').stdout, '?? a.txt\n', 'file was NOT staged');
});

// ---- 5. diff with two refs + --staged ----

test('diff <ref1> <ref2> --staged shows the ref diff instead of failing silently', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'v1\n');
  git('add', '-A'); git('commit', '-qm', 'feat: one');
  write(dir, 'a.txt', 'v2\n');
  git('add', '-A'); git('commit', '-qm', 'feat: two');
  const h1 = git('rev-parse', 'HEAD~1').stdout.trim();
  const h2 = git('rev-parse', 'HEAD').stdout.trim();

  const r = sg(dir, 'diff', h1, h2, '--staged');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /a\.txt/);
  assert.doesNotMatch(r.stdout, /\(no diff\)/);
  assert.match(r.stdout, /--staged ignored/i);
});

// ---- 6. async error path prints clean message, not a stack ----

test('uncaught git failure inside an async command prints clean error', async () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'x\n');
  git('add', '-A'); git('commit', '-qm', 'feat: init');
  // git checkout -b with an invalid branch name -> git fails inside async action
  await assert.rejects(
    runInProcess(dir, ['branch', '--create', 'bad..name'], { prefix: 'no prefix' }),
    /Could not create branch/i
  );
});