const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

// `git restore` parity for sg undo: pathspecs (".", directories, globs),
// --staged / --worktree targeting, --source <ref> and --patch pass-through.
// Broad pathspecs deliberately never touch untracked files (same as
// `git restore`); an exact path argument still deletes an untracked file.
// Prompting paths use the shared inquirer stub + require cache, like the other
// interactive suites (no TTY on CI/Windows).

const BIN = path.join(__dirname, '..', 'bin', 'smart-git.js');
const BIN_DIR = path.join(__dirname, '..');

function mkRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-restore-'));
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@smart-git.local');
  git('config', 'user.name', 'smart-git test');
  return { dir, git };
}

function sg(cwd, ...args) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
}

const w = (dir, name, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  fs.writeFileSync(path.join(dir, name), content);
};
const read = (dir, name) => fs.readFileSync(path.join(dir, name), 'utf8');
const rm = (dir) => fs.rmSync(dir, { recursive: true, force: true });
// NOTE: no .trim() — it would eat the leading space (X column) of the first
// porcelain line, exactly the trap getStatusPorcelain() documents.
const porcelain = (git) => git('status', '--porcelain').stdout
  .split('\n')
  .map(l => l.replace(/\r$/, ''))
  .filter(l => l.length > 0);

// Interactive runner. Commander accumulates option values across parse() calls
// on the SAME command instance (`_optionValues` is never reset), so resetting
// every subcommand keeps successive in-process parses independent.
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
    for (const c of [program, ...program.commands]) c._optionValues = {};
    await program.parseAsync(argv, { from: 'user' });
    return prompts;
  } finally {
    process.chdir(prevCwd);
    inquirer.prompt = original;
  }
}

// ---------------------------------------------------------------- restore all

test('undo . restores every tracked change and leaves untracked files alone', async () => {
  const { dir, git } = mkRepo();
  w(dir, 'a.txt', 'a1\n');
  w(dir, 'b.txt', 'b1\n');
  w(dir, 'sub/c.txt', 'c1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');

  w(dir, 'a.txt', 'a2\n');            // staged-only  -> unstage (keep work)
  git('add', 'a.txt');
  w(dir, 'b.txt', 'b2\n');            // unstaged-only -> discard
  w(dir, 'sub/c.txt', 'c2\n');        // unstaged-only -> discard
  git('add', 'b.txt');
  w(dir, 'b.txt', 'b3\n');            // MM -> discard all
  w(dir, 'loose.txt', 'untracked\n'); // must survive "restore all"

  await runInteractive(dir, ['undo', '.'], { mode: 'discard', ok: true });

  assert.deepStrictEqual(porcelain(git), [' M a.txt', '?? loose.txt'], 'kept work change + untouched untracked file');
  assert.strictEqual(read(dir, 'a.txt'), 'a2\n', 'staged-only file was unstaged, work kept');
  assert.strictEqual(read(dir, 'b.txt'), 'b1\n', 'MM file fully reverted (worktree)');
  assert.strictEqual(git('show', ':b.txt').stdout, 'b1\n', 'MM file fully reverted (index)');
  assert.strictEqual(read(dir, 'sub/c.txt'), 'c1\n', 'unstaged file reverted');
  assert.strictEqual(read(dir, 'loose.txt'), 'untracked\n', 'untracked file untouched by "."');
  rm(dir);
});

test('undo . with the discard confirm declined keeps the worktree changes', async () => {
  const { dir, git } = mkRepo();
  w(dir, 'a.txt', 'a1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  w(dir, 'a.txt', 'a2\n');

  const prompts = await runInteractive(dir, ['undo', '.'], { ok: false });

  assert.deepStrictEqual(prompts, ['ok'], 'one grouped confirm, not one per file');
  assert.strictEqual(read(dir, 'a.txt'), 'a2\n', 'declined -> change survives');
  rm(dir);
});

test('undo . asks ONE confirm for many unstaged files instead of one each', async () => {
  const { dir, git } = mkRepo();
  for (const n of ['a', 'b', 'c', 'd', 'e']) w(dir, `${n}.txt`, 'v1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  for (const n of ['a', 'b', 'c', 'd', 'e']) w(dir, `${n}.txt`, 'v2\n');

  const prompts = await runInteractive(dir, ['undo', '.'], { ok: true });

  assert.deepStrictEqual(prompts, ['ok'], '5 files, 1 prompt');
  assert.deepStrictEqual(porcelain(git), [], 'all five reverted');
  rm(dir);
});

// --------------------------------------------------- directories and globs

test('undo <dir> discards tracked changes under the directory only', () => {
  const { dir, git } = mkRepo();
  w(dir, 'src/one.js', '1\n');
  w(dir, 'src/two.js', '2\n');
  w(dir, 'other.txt', 'o\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  w(dir, 'src/one.js', '1x\n');
  w(dir, 'src/two.js', '2x\n');
  w(dir, 'other.txt', 'ox\n');

  const r = sg(dir, 'undo', 'src', '--yes');

  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Discarded changes to src\/one\.js, src\/two\.js/);
  assert.strictEqual(read(dir, 'src/one.js'), '1\n');
  assert.strictEqual(read(dir, 'src/two.js'), '2\n');
  assert.strictEqual(read(dir, 'other.txt'), 'ox\n', 'outside the pathspec untouched');
  rm(dir);
});

test('undo <glob> expands the pathspec and skips untracked files', () => {
  const { dir, git } = mkRepo();
  w(dir, 'a.txt', 'a1\n');
  w(dir, 'sub/b.txt', 'b1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  w(dir, 'a.txt', 'a2\n');
  w(dir, 'sub/b.txt', 'b2\n');
  w(dir, 'k.js', 'js\n');
  git('add', 'k.js');                 // staged-only, must NOT match *.txt
  w(dir, 'fresh.txt', 'untracked\n'); // untracked, must NOT match *.txt

  const r = sg(dir, 'undo', '*.txt', '--yes');

  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(read(dir, 'a.txt'), 'a1\n', 'root match reverted');
  assert.strictEqual(read(dir, 'sub/b.txt'), 'b1\n', 'glob matches across "/" like git');
  assert.strictEqual(read(dir, 'fresh.txt'), 'untracked\n', 'untracked excluded from a broad spec');
  assert.match(git('status', '--porcelain').stdout, /^A  k\.js/m, 'staged non-match untouched');
  rm(dir);
});

test('undo <dir> holding only untracked files explains itself and deletes nothing', () => {
  const { dir, git } = mkRepo();
  w(dir, 'a.txt', 'a1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  w(dir, 'logs/debug.log', 'junk\n');

  const r = sg(dir, 'undo', 'logs', '--yes');

  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /no tracked changes to undo/);
  assert.match(r.stdout, /sg clean/);
  assert.strictEqual(read(dir, 'logs/debug.log'), 'junk\n', 'untracked file survives');
  rm(dir);
});

test('undo <file> on an unchanged file reports it instead of acting', () => {
  const { dir, git } = mkRepo();
  w(dir, 'a.txt', 'a1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');

  const r = sg(dir, 'undo', 'a.txt', '--yes');

  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /✖ "a\.txt" has no changes to undo/);
  rm(dir);
});

// ---------------------------------------------------- --staged / --worktree

test('undo . --staged unstages everything and keeps the worktree changes', () => {
  const { dir, git } = mkRepo();
  w(dir, 'a.txt', 'a1\n');
  w(dir, 'b.txt', 'b1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  w(dir, 'a.txt', 'a2\n');
  w(dir, 'b.txt', 'b2\n');
  git('add', '-A');

  const r = sg(dir, 'undo', '.', '--staged');

  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Unstaged a\.txt, b\.txt/);
  assert.deepStrictEqual(porcelain(git), [' M a.txt', ' M b.txt'], 'nothing staged, work kept');
  assert.strictEqual(read(dir, 'a.txt'), 'a2\n');
  rm(dir);
});

test('undo . --worktree restores the worktree from the index, keeping staged work', () => {
  const { dir, git } = mkRepo();
  w(dir, 'a.txt', 'a1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  w(dir, 'a.txt', 'a2\n');
  git('add', 'a.txt');   // staged v2
  w(dir, 'a.txt', 'a3\n'); // worktree v3

  const r = sg(dir, 'undo', '.', '--worktree', '--yes');

  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(read(dir, 'a.txt'), 'a2\n', 'worktree restored from the index');
  assert.strictEqual(git('show', ':a.txt').stdout, 'a2\n', 'staged change preserved');
  rm(dir);
});

test('undo . --staged --worktree discards index and worktree', () => {
  const { dir, git } = mkRepo();
  w(dir, 'a.txt', 'a1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  w(dir, 'a.txt', 'a2\n');
  git('add', 'a.txt');
  w(dir, 'a.txt', 'a3\n');

  const r = sg(dir, 'undo', '.', '--staged', '--worktree', '--yes');

  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(read(dir, 'a.txt'), 'a1\n');
  assert.deepStrictEqual(porcelain(git), []);
  rm(dir);
});

test('undo --staged ignores untracked files with a hint', () => {
  const { dir, git } = mkRepo();
  w(dir, 'a.txt', 'a1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  w(dir, 'loose.txt', 'untracked\n');

  const r = sg(dir, 'undo', 'loose.txt', '--staged');

  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Untracked — nothing to restore: loose\.txt/);
  assert.strictEqual(read(dir, 'loose.txt'), 'untracked\n');
  rm(dir);
});

// ------------------------------------------------------------ --source <ref>

test('undo <file> --source <ref> restores the worktree from an older revision', async () => {
  const { dir, git } = mkRepo();
  w(dir, 'a.txt', 'v1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: v1');
  w(dir, 'a.txt', 'v2\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: v2');
  w(dir, 'a.txt', 'v3\n');

  const prompts = await runInteractive(dir, ['undo', 'a.txt', '--source', 'HEAD~1'], { ok: true });

  assert.deepStrictEqual(prompts, ['ok'], 'overwriting the worktree is confirmed');
  assert.strictEqual(read(dir, 'a.txt'), 'v1\n', 'pulled the older revision in');
  rm(dir);
});

test('undo <file> --source <ref> declined leaves the file untouched', async () => {
  const { dir, git } = mkRepo();
  w(dir, 'a.txt', 'v1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: v1');
  w(dir, 'a.txt', 'v2\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: v2');

  await runInteractive(dir, ['undo', 'a.txt', '--source', 'HEAD~1'], { ok: false });

  assert.strictEqual(read(dir, 'a.txt'), 'v2\n');
  rm(dir);
});

test('undo <file> --source <ref> --staged restores the index only, no confirm', async () => {
  const { dir, git } = mkRepo();
  w(dir, 'a.txt', 'v1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: v1');
  w(dir, 'a.txt', 'v2\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: v2');

  const prompts = await runInteractive(dir, ['undo', 'a.txt', '--source', 'HEAD~1', '--staged'], {});

  assert.deepStrictEqual(prompts, [], 'index-only restore needs no confirm');
  assert.strictEqual(git('show', ':a.txt').stdout, 'v1\n', 'index restored from the old revision');
  assert.strictEqual(read(dir, 'a.txt'), 'v2\n', 'worktree untouched');
  rm(dir);
});

test('undo --source without a pathspec exits 1 with guidance', () => {
  const { dir, git } = mkRepo();
  w(dir, 'a.txt', 'v1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');

  const r = sg(dir, 'undo', '--source', 'HEAD~1');

  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /--source needs pathspecs/);
  rm(dir);
});

// ------------------------------------------------------------------ --patch

test('undo --patch delegates to git restore -p and exits cleanly on a clean tree', () => {
  const { dir, git } = mkRepo();
  w(dir, 'a.txt', 'v1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');

  const r = sg(dir, 'undo', 'a.txt', '--patch');

  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /git restore -p/);
  rm(dir);
});

test('undo --help documents the restore-parity flags', () => {
  const r = spawnSync(process.execPath, [BIN, 'undo', '--help'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
  for (const flag of ['--source', '--staged', '--worktree', '--patch']) {
    assert.match(r.stdout, new RegExp(flag.replace('-', '\\-')));
  }
});
