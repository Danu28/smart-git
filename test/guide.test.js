const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

// sg guide: in-terminal playbook + per-command lookup. Works in ANY directory
// (it must not require a git repo to be consulted).

const BIN = path.join(__dirname, '..', 'bin', 'smart-git.js');

function sg(cwd, ...args) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
}

function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return dir;
}

test('guide prints the playbook sections', () => {
  const dir = tmpDir('sg-guide-');
  const r = sg(dir, 'guide');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Daily golden path/);
  assert.match(r.stdout, /sg sync/);
  assert.match(r.stdout, /When things go sideways/);
  assert.match(r.stdout, /sg rescue/);
  assert.match(r.stdout, /Safety contract/);
  assert.match(r.stdout, /sg guide <command>/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("guide <command> shows that command's description and options", () => {
  const dir = tmpDir('sg-guide-');
  const r = sg(dir, 'guide', 'commit');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /sg commit/);
  assert.match(r.stdout, /--amend/);
  assert.match(r.stdout, /--patch/);

  // alias resolution: st -> status
  const alias = sg(dir, 'guide', 'st');
  assert.strictEqual(alias.status, 0, alias.stderr);
  assert.match(alias.stdout, /sg status/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('guide <unknown> exits 1 with a clean message', () => {
  const dir = tmpDir('sg-guide-');
  const r = sg(dir, 'guide', 'definitely-not-a-thing');
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /Unknown command/);
  assert.doesNotMatch(r.stderr, /at Command|stack/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('guide works outside a git repository', () => {
  const dir = tmpDir('sg-norepo-');
  const r = sg(dir, 'guide');
  assert.strictEqual(r.status, 0, r.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});