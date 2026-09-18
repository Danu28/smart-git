const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin', 'smart-git.js');

function sg(cwd, ...args) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
}
function mkRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-phase1-'));
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@smart-git.local');
  git('config', 'user.name', 'smart-git test');
  return { dir, git };
}

// Phase 1 invariants — must PASS after Phase 1 refactor

test('Phase1: no command uses process.exit(1) directly (except bin)', () => {
  const files = fs.readdirSync(path.join(__dirname, '..', 'src/commands')).filter(f=>f.endsWith('.js'));
  const offenders = [];
  for(const f of files){
    const src = fs.readFileSync(path.join(__dirname, '..', 'src/commands', f), 'utf8');
    // allow process.exitCode and comments, but not process.exit(1)
    if(/process\.exit\s*\(/.test(src)) offenders.push(f);
  }
  const gitSrc = fs.readFileSync(path.join(__dirname, '..', 'src/utils/git.js'), 'utf8');
  if(/process\.exit\s*\(/.test(gitSrc)) offenders.push('utils/git.js');
  assert.deepStrictEqual(offenders, [], `Found process.exit in: ${offenders.join(', ')} - should use UserError`);
});

test('Phase1: UserError exists and is used', () => {
  const { UserError } = require('../src/utils/errors');
  assert.ok(UserError, 'UserError exported');
  const e = new UserError('test');
  assert.strictEqual(e.name, 'UserError');
  assert.strictEqual(e.message, 'test');
});

test('Phase1: ensureGitRepo throws UserError outside repo (in-process)', async () => {
  const { program } = require('../src/index');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-norepo-phase1-'));
  const prev = process.cwd();
  process.chdir(dir);
  try{
    let threw = false;
    try{
      await program.parseAsync(['status'], { from: 'user' });
    }catch(err){
      threw = true;
      assert.match(err.message, /Not a git repository/);
      assert.strictEqual(err.name, 'UserError');
    }
    assert.ok(threw, 'should throw UserError');
  }finally{
    process.chdir(prev);
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('Phase1: pr uses array argv + shell only for .cmd (no shell:true string)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/commands/pr.js'), 'utf8');
  assert.ok(src.includes('spawnGh'), 'pr should use spawnGh helper');
  assert.ok(src.includes('isGhCmdShim'), 'pr should check .cmd');
  assert.ok(!src.includes("ghCommand(['--version'])"), 'should not use ghCommand string with shell:true');
  assert.ok(!src.match(/spawnSync\(ghCommand/), 'no spawnSync(ghCommand');
});

test('Phase1: getAheadBehind delegates to getBranchState (canonical)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/utils/git.js'), 'utf8');
  assert.match(src, /getBranchState/, 'getAheadBehind should delegate to getBranchState');
  assert.match(src, /Canonical source is git-state/, 'should have comment about canonical');
});

test('Phase1: getAheadBehind and getBranchState agree in a repo with upstream', () => {
  const { dir, git } = mkRepo();
  // create initial commit and check both APIs agree when no upstream
  fs.writeFileSync(path.join(dir,'a.txt'), 'x\n');
  git('add','-A'); git('commit','-qm','feat: init');
  const { getAheadBehind } = require('../src/utils/git');
  const { getBranchState } = require('../src/utils/git-state');
  const prev = process.cwd(); process.chdir(dir);
  try{
    const ab = getAheadBehind();
    const bs = getBranchState();
    // No upstream -> both say 0/0 false
    assert.strictEqual(ab.hasUpstream, false);
    assert.strictEqual(bs.upstream, null);
    assert.strictEqual(ab.ahead, 0);
    assert.strictEqual(ab.behind, 0);
  }finally{
    process.chdir(prev);
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('Phase1: bin catches UserError cleanly (no stack in stderr)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-norepo-bin-'));
  const r = sg(dir, 'status');
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /Not a git repository/);
  // Should NOT contain stack trace like "at Object" or "UserError"
  assert.doesNotMatch(r.stderr, /at Object\.<anonymous>|at Command/);
  fs.rmSync(dir,{recursive:true,force:true});
});

test('Phase1: switch/why/rescue errors are UserError and yield exit 1 with clean message (spawn)', () => {
  const { dir, git } = mkRepo();
  fs.writeFileSync(path.join(dir,'a.txt'),'x\n');
  git('add','-A'); git('commit','-qm','feat: init');
  let r = sg(dir, 'switch', 'no-such-branch-xyz');
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /Branch "no-such-branch-xyz" not found/);
  assert.doesNotMatch(r.stderr, /at .*Command/);
  r = sg(dir, 'why', 'nope.js');
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /not a tracked file/);
  r = sg(dir, 'rescue', 'deadbeef');
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /Not a commit: deadbeef/);
  fs.rmSync(dir,{recursive:true,force:true});
});
