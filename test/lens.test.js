const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const lens = require('../src/lens');

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-git-lens-test-'));
  execSync('git init -q && git config user.email t@t && git config user.name t', { cwd: dir });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n');
  execSync('git add a.txt && git commit -q -m "init a"', { cwd: dir });
  return dir;
}

test('preview creates a worktree and exitLens removes it', () => {
  const dir = makeRepo();
  const prev = process.cwd();
  try {
    process.chdir(dir);
    const hash = execSync('git rev-parse HEAD', { cwd: dir }).toString().trim();
    const r = lens.preview(hash);
    assert.ok(fs.existsSync(r.dest), 'worktree should exist after preview');
    lens.exitLens(r.dest);
    assert.ok(!fs.existsSync(r.dest), 'worktree should be removed after exitLens');
  } finally {
    process.chdir(prev);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
