const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

// Tier-2 flow/conflict features: sg continue / sg abort (resume or bail out
// of an in-progress rebase/merge/cherry-pick), sg fixup (fixup + autosquash),
// and the pushed-commit guard on sg commit --amend.

const BIN = path.join(__dirname, '..', 'bin', 'smart-git.js');
const BIN_DIR = path.join(__dirname, '..');

function mkRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-tier2-'));
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

function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
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

// Sets up two branches whose f.txt edits conflict; leaves feature mid-rebase.
function startRebaseConflict() {
  const { dir, git } = mkRepo();
  const def = git('symbolic-ref', '--short', 'HEAD').stdout.trim();
  write(dir, 'f.txt', '0\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: base');
  git('checkout', '-qb', 'feature');
  write(dir, 'f.txt', 'f\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: feature');
  git('checkout', '-q', def);
  write(dir, 'f.txt', 'm\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: main');
  git('checkout', '-q', 'feature');
  git('rebase', def); // conflict on f.txt
  return { dir, git, def };
}

// ── sg continue ───────────────────────────────────────────────────────────

test('continue finishes a rebase after conflicts are resolved', () => {
  const { dir, git } = startRebaseConflict();
  git('add', 'f.txt'); // mark resolved

  const r = sg(dir, 'continue');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /completed/);
  assert.strictEqual(git('log', '--oneline').stdout.trim().split('\n').length, 3); // base + main + replayed feature
  assert.doesNotMatch(git('status', '--porcelain').stdout, /UU|AA/); // nothing left conflicted
  rm(dir);
});

test('continue refuses while conflicts remain and lists the files', () => {
  const { dir } = startRebaseConflict();
  const r = sg(dir, 'continue');
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /resolve/i);
  assert.match(r.stderr, /f\.txt/);
  rm(dir);
});

test('continue with nothing in progress says so', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'v1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: base');
  const r = sg(dir, 'continue');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Nothing to continue/);
  rm(dir);
});

test('continue finishes a plain merge after conflict resolution', () => {
  const { dir, git } = mkRepo();
  const def = git('symbolic-ref', '--short', 'HEAD').stdout.trim();
  write(dir, 'f.txt', '0\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: base');
  git('checkout', '-qb', 'other');
  write(dir, 'f.txt', 'o\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: other');
  git('checkout', '-q', def);
  write(dir, 'f.txt', 'd\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: def');
  git('merge', 'other'); // conflict on f.txt
  git('add', 'f.txt'); // resolve

  const r = sg(dir, 'continue');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /merge completed/);
  assert.ok(git('log', '--merges', '--oneline').stdout.trim()); // merge commit exists
  rm(dir);
});

// ── sg abort ──────────────────────────────────────────────────────────────

test('abort confirm=false keeps the rebase in progress', async () => {
  const { dir, git } = startRebaseConflict();
  const gitDir = git('rev-parse', '--absolute-git-dir').stdout.trim();
  const sentinel = path.join(gitDir, 'rebase-merge');
  assert.ok(fs.existsSync(sentinel), 'rebase should be active');

  const prompts = await runInteractive(dir, ['abort'], { ok: false });
  assert.deepStrictEqual(prompts, ['ok']);
  assert.ok(fs.existsSync(sentinel), 'rebase still active after declined abort');
  rm(dir);
});

test('abort --yes reverts to the pre-rebase state', () => {
  const { dir, git } = mkRepo();
  const def = git('symbolic-ref', '--short', 'HEAD').stdout.trim();
  write(dir, 'f.txt', '0\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: base');
  git('checkout', '-qb', 'feature');
  write(dir, 'f.txt', 'f\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: feature');
  const preRebase = git('rev-parse', 'HEAD').stdout.trim();
  git('checkout', '-q', def);
  write(dir, 'f.txt', 'm\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: main');
  git('checkout', '-q', 'feature');
  git('rebase', def);
  const gitDir = git('rev-parse', '--absolute-git-dir').stdout.trim();
  assert.ok(fs.existsSync(path.join(gitDir, 'rebase-merge')));

  const r = sg(dir, 'abort', '--yes');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /aborted/);
  assert.ok(!fs.existsSync(path.join(gitDir, 'rebase-merge')));
  assert.strictEqual(git('rev-parse', 'HEAD').stdout.trim(), preRebase);
  assert.strictEqual(git('log', '--oneline').stdout.trim().split('\n').length, 2); // base + feature only
  rm(dir);
});

test('abort with nothing in progress says so', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'v1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: base');
  const r = sg(dir, 'abort', '--yes');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Nothing to abort/);
  rm(dir);
});

// ── sg fixup ──────────────────────────────────────────────────────────────

function fixupBase() {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'a v1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: base');
  const baseSha = git('rev-parse', 'HEAD').stdout.trim();
  write(dir, 'b.txt', 'b v1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: work');
  return { dir, git, baseSha };
}

test('fixup --no-rebase creates a fixup commit only', () => {
  const { dir, git, baseSha } = fixupBase();
  write(dir, 'a.txt', 'a FIXED\n');

  const r = sg(dir, 'fixup', baseSha, '--no-rebase');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(git('log', '-1', '--pretty=%s').stdout, /^fixup! feat: base/);
  assert.strictEqual(git('log', '--oneline').stdout.trim().split('\n').length, 3); // base + work + fixup
  rm(dir);
});

test('fixup --yes autosquashes the fix into the target commit', () => {
  const { dir, git, baseSha } = fixupBase();
  write(dir, 'a.txt', 'a FIXED\n');

  const r = sg(dir, 'fixup', baseSha, '--yes');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Autosquash complete/);
  assert.strictEqual(git('log', '--oneline').stdout.trim().split('\n').length, 2); // folded
  assert.doesNotMatch(git('log', '--format=%s').stdout, /fixup!/); // no fixup commits left
  // fix landed inside the rewritten FIRST commit (target was the root commit)
  const first = git('rev-parse', 'HEAD~1').stdout.trim();
  assert.match(git('show', `${first}:a.txt`).stdout, /a FIXED/);
  rm(dir);
});

test('fixup rejects non-commits and commits not on the current branch', () => {
  const { dir, git } = mkRepo();
  const def = git('symbolic-ref', '--short', 'HEAD').stdout.trim();
  write(dir, 'a.txt', 'v1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: base');
  git('checkout', '-qb', 'other');
  write(dir, 'o.txt', 'o\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: other');
  const alienSha = git('rev-parse', 'HEAD').stdout.trim();
  git('checkout', '-q', def);

  const bad = sg(dir, 'fixup', 'not-a-commit');
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stderr, /Not a commit/);

  const alien = sg(dir, 'fixup', alienSha);
  assert.strictEqual(alien.status, 1);
  assert.match(alien.stderr, /not in the current branch/);
  rm(dir);
});

test('fixup refuses while a rebase is in progress', () => {
  const { dir, git } = startRebaseConflict();
  const baseSha = git('rev-parse', 'HEAD~2').stdout.trim(); // base commit is in history
  const r = sg(dir, 'fixup', baseSha, '--yes');
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /in progress/);
  rm(dir);
});

test('fixup --dry-run stages nothing and creates no commits', () => {
  const { dir, git, baseSha } = fixupBase();
  write(dir, 'a.txt', 'a FIXED\n');

  const r = sg(dir, 'fixup', baseSha, '--dry-run');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[dry-run\]/);
  assert.strictEqual(git('log', '--oneline').stdout.trim().split('\n').length, 2);
  assert.strictEqual(git('diff', '--cached', '--stat').stdout.trim(), ''); // nothing staged
  assert.strictEqual(git('status', '--porcelain').stdout.trim(), 'M a.txt'); // still just unstaged
  rm(dir);
});

// ── amend published-commit guard ──────────────────────────────────────────

test('commit --amend warns on a pushed commit; declines keep it, confirm amends', async () => {
  const { dir, git } = mkRepo();
  const def = git('symbolic-ref', '--short', 'HEAD').stdout.trim();
  write(dir, 'a.txt', 'v1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: base');

  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-bare-'));
  spawnSync('git', ['init', '--bare', '-q'], { cwd: bare, encoding: 'utf8' });
  git('remote', 'add', 'origin', bare);
  git('push', '-qu', 'origin', def); // now HEAD is published

  const prompts1 = await runInteractive(dir, ['commit', '--amend', '-m', 'fix: new'], { ok: false });
  assert.deepStrictEqual(prompts1, ['ok']); // the only prompt = the published-commit guard
  assert.strictEqual(git('log', '-1', '--pretty=%s').stdout.trim(), 'feat: base'); // declined → unchanged

  const prompts2 = await runInteractive(dir, ['commit', '--amend', '-m', 'fix: new'], { ok: true });
  assert.deepStrictEqual(prompts2, ['ok']);
  assert.strictEqual(git('log', '-1', '--pretty=%s').stdout.trim(), 'fix: new'); // confirmed → amended
  assert.strictEqual(git('log', '--oneline').stdout.trim().split('\n').length, 1); // still one commit

  rm(dir);
  rm(bare);
});

test('commit --amend on an unpublished commit asks nothing extra', async () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'v1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: base');

  const prompts = await runInteractive(dir, ['commit', '--amend', '-m', 'fix: local'], { ok: false });
  assert.deepStrictEqual(prompts, []); // no guard prompt, straight through
  assert.strictEqual(git('log', '-1', '--pretty=%s').stdout.trim(), 'fix: local');
  rm(dir);
});