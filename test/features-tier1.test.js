const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

// Tier-1 safety-net features: sg rescue (reflog recovery), sg doctor (state
// diagnosis), sg clean (guarded untracked cleanup) + git-state util.
// Pattern: real temp repos, spawned CLI. Interactive confirms use the shared
// require-cache inquirer stub driven through program.parseAsync (Windows has
// no TTY in tests).

const BIN = path.join(__dirname, '..', 'bin', 'smart-git.js');
const BIN_DIR = path.join(__dirname, '..');

function mkRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-tier1-'));
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

// ── sg rescue ─────────────────────────────────────────────────────────────

test('rescue lists reflog and flags a commit lost by reset --hard', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'v1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: base');
  write(dir, 'b.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: precious work');
  git('reset', '--hard', 'HEAD~1'); // precious work now exists only in reflog

  const r = sg(dir, 'rescue');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /HEAD@{1}/); // reflog entry rendered
  assert.match(r.stdout, /✖ LOST/);
  assert.match(r.stdout, /precious work/); // subject of the lost commit shown
  assert.match(r.stdout, /sg rescue <hash>/); // recovery hint
  rm(dir);
});

test('rescue <hash> creates a non-destructive branch at the lost commit', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'v1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: base');
  const baseSha = git('rev-parse', 'HEAD').stdout.trim();
  write(dir, 'b.txt', 'x\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: precious work');
  git('reset', '--hard', 'HEAD~1');
  const lostSha = git('rev-parse', 'ORIG_HEAD').stdout.trim();
  const short = lostSha.slice(0, 7);

  const r = sg(dir, 'rescue', lostSha);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`rescue/${short}`));
  assert.match(r.stdout, /precious work/); // "commits you would gain"

  const rescued = git('rev-parse', `refs/heads/rescue/${short}`).stdout.trim();
  assert.strictEqual(rescued, lostSha);
  // HEAD untouched — recovery is additive
  assert.strictEqual(git('rev-parse', 'HEAD').stdout.trim(), baseSha);
  rm(dir);
});

test('rescue with a non-commit ref exits 1 with a clean message', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'v1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: base');
  const r = sg(dir, 'rescue', 'definitely-not-a-commit');
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /Not a commit/);
  assert.doesNotMatch(r.stderr, /at Command|stack/i);
  rm(dir);
});

// ── sg doctor ─────────────────────────────────────────────────────────────

test('doctor on a healthy repo reports clean state', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'v1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: base');
  write(dir, 'a.txt', 'v2\n'); // dirty → stashable
  git('stash', 'push', '-m', 'wip-a');
  const r = sg(dir, 'doctor');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Branch:/);
  assert.match(r.stdout, /none → sg sync/); // no upstream yet
  assert.match(r.stdout, /none ✔/); // no operation in progress
  assert.match(r.stdout, /Stashes: 1/);
  assert.match(r.stdout, /Healthy/);
  rm(dir);
});

test('doctor detects a rebase in progress with conflicted files', () => {
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
  git('rebase', def); // conflicts on f.txt

  const r = sg(dir, 'doctor');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /REBASE in progress/i);
  assert.match(r.stdout, /f\.txt/); // conflicted file listed
  assert.match(r.stdout, /git rebase --continue/); // next action given
  git('rebase', '--abort');
  rm(dir);
});

test('doctor detects detached HEAD and suggests reattaching', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'v1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: one');
  write(dir, 'a.txt', 'v2\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: two');
  git('checkout', '-q', 'HEAD~1'); // detached

  const r = sg(dir, 'doctor');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /detached HEAD/);
  assert.match(r.stdout, /sg switch/);
  rm(dir);
});

test('doctor outside a git repository exits 1 with guidance', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-norepo-'));
  const r = sg(dir, 'doctor');
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /Not a git repository/);
  rm(dir);
});

// ── sg clean ──────────────────────────────────────────────────────────────

test('clean --dry-run previews untracked files and deletes nothing', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'v1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: base');
  write(dir, 'junk.txt', 'trash\n');
  write(dir, '.env', 'SECRET=1\n');

  const r = sg(dir, 'clean', '--dry-run');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /junk\.txt/);
  assert.match(r.stdout, /\[dry-run\] No changes made/);
  assert.match(r.stdout, /Protected/); // .env flagged, not silently listed
  assert.ok(fs.existsSync(path.join(dir, 'junk.txt')));
  assert.ok(fs.existsSync(path.join(dir, '.env')));
  rm(dir);
});

test('clean --yes deletes safe untracked files, keeps tracked ones', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'v1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: base');
  write(dir, 'junk.txt', 'trash\n'); // untracked AFTER the initial commit
  write(dir, 'junk2.txt', 'trash\n');

  const r = sg(dir, 'clean', '--yes');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Deleted 2 file/);
  assert.ok(!fs.existsSync(path.join(dir, 'junk.txt')));
  assert.ok(fs.existsSync(path.join(dir, 'a.txt'))); // tracked survives
  assert.strictEqual(git('status', '--porcelain').stdout.trim(), ''); // still clean
  rm(dir);
});

test('clean refuses protected files (.env) without --force', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'v1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: base');
  write(dir, '.env', 'SECRET=1\n');
  write(dir, 'junk.txt', 'trash\n');

  const r = sg(dir, 'clean', '--yes');
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /Aborting/);
  assert.match(r.stderr, /protected/);
  assert.ok(fs.existsSync(path.join(dir, '.env')));
  assert.ok(fs.existsSync(path.join(dir, 'junk.txt')));
  rm(dir);
});

test('clean --yes --force deletes protected files as requested', () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'v1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: base');
  write(dir, '.env', 'SECRET=1\n');
  write(dir, 'id_rsa', 'key\n');

  const r = sg(dir, 'clean', '--yes', '--force');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /--force: deleting/);
  assert.ok(!fs.existsSync(path.join(dir, '.env')));
  assert.ok(!fs.existsSync(path.join(dir, 'id_rsa')));
  rm(dir);
});

test('clean without --yes prompts; confirm=true deletes, confirm=false cancels', async () => {
  const { dir, git } = mkRepo();
  write(dir, 'a.txt', 'v1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: base');

  write(dir, 'junk.txt', 'trash\n');
  await runInteractive(dir, ['clean'], { ok: true });
  assert.ok(!fs.existsSync(path.join(dir, 'junk.txt')));

  write(dir, 'junk2.txt', 'trash2\n');
  const prompts = await runInteractive(dir, ['clean'], { ok: false });
  assert.deepStrictEqual(prompts, ['ok']);
  assert.ok(fs.existsSync(path.join(dir, 'junk2.txt')));
  rm(dir);
});