const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

// Interactive commit prompts need a TTY, which CI/Windows shells lack.
// inquirer is a shared require-cache singleton, so we stub `prompt` with a
// scripted answer map and drive the real commander action. This locks in the
// pass-2 gating: happy path = type + subject + one "Add details?" confirm,
// with scope/body/breaking/issues only asked when the user opts in.

const BIN_DIR = path.join(__dirname, '..');

function mkRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-itest-'));
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@smart-git.local');
  git('config', 'user.name', 'smart-git test');
  return { dir, git };
}

function write(dir, name, content) {
  fs.writeFileSync(path.join(dir, name), content);
}

async function runInteractive(repoDir, answers) {
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
    // fresh require of the program so cached module state is clean
    const program = require(path.join(BIN_DIR, 'src', 'index')).program;
    await program.parseAsync(['commit'], { from: 'user' });
    return prompts;
  } finally {
    process.chdir(prevCwd);
    inquirer.prompt = original;
  }
}

test('interactive commit happy path asks only 4 prompts (details gated)', async () => {
  const { dir, git } = mkRepo();
  write(dir, 'app.txt', 'v1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  write(dir, 'app.txt', 'v2\n');

  const prompts = await runInteractive(dir, {
    type: 'feat',
    subject: 'simple',
    details: false,
    confirm: true,
  });

  assert.deepStrictEqual(prompts, ['type', 'subject', 'details', 'confirm']);
  assert.strictEqual(git('log', '-1', '--pretty=%s').stdout.trim(), 'feat: simple');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('interactive commit with details asks full set and builds conventional message', async () => {
  const { dir, git } = mkRepo();
  write(dir, 'app.txt', 'v1\n');
  git('add', '-A');
  git('commit', '-qm', 'feat: init');
  write(dir, 'app.txt', 'v2\n');

  const prompts = await runInteractive(dir, {
    type: 'fix',
    subject: 'fix: risky',
    details: true,
    scope: 'core',
    body: 'because reasons',
    breaking: 'API removed',
    issues: '#1',
    confirm: true,
  });

  assert.deepStrictEqual(prompts, ['type', 'subject', 'details', 'scope', 'body', 'breaking', 'issues', 'confirm']);
  const msg = git('log', '-1', '--pretty=%B').stdout.trim();
  assert.strictEqual(msg, 'fix(core): fix: risky\n\nbecause reasons\n\nBREAKING CHANGE: API removed\n\nCloses #1');
  fs.rmSync(dir, { recursive: true, force: true });
});