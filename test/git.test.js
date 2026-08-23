const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const git = require('../src/git');

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-git-git-test-'));
  execSync('git init -q && git config user.email t@t && git config user.name t', { cwd: dir });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\nworld\n');
  execSync('git add a.txt && git commit -q -m "init a"', { cwd: dir });
  return dir;
}

test('gitRoot returns the repo toplevel', () => {
  const dir = makeRepo();
  try {
    assert.strictEqual(path.resolve(git.gitRoot(dir)), path.resolve(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('commitInfo returns author/date/message for a commit', () => {
  const dir = makeRepo();
  try {
    const hash = execSync('git rev-parse HEAD', { cwd: dir }).toString().trim();
    const info = git.commitInfo(hash, dir);
    assert.strictEqual(info.fullHash, hash);
    assert.ok(info.author);
    assert.ok(info.date);
    assert.match(info.message, /init a/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('blame resolves the commit that last touched a line', () => {
  const dir = makeRepo();
  try {
    const hash = execSync('git rev-parse HEAD', { cwd: dir }).toString().trim();
    assert.strictEqual(git.blame('a.txt', 1, dir), hash);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
