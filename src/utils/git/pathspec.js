const { spawnSync } = require('child_process');
const { runGit } = require('./run');
const { getChangedFiles } = require('./status');

function listZ(args) {
  const r = spawnSync('git', args, { stdio: 'pipe', encoding: 'utf8' });
  if (r.status !== 0) return [];
  return (r.stdout || '').split('\u0000').filter(Boolean);
}

function expandPathspecs(specs, options = {}) {
  const list = (specs || []).filter(Boolean);
  const changed = options.changed || getChangedFiles();
  const changedMap = new Map(changed.map(f => [f.file, f]));
  const matched = [];
  const unmatched = [];
  const seen = new Set();
  for (const spec of list) {
    const before = matched.length;
    const add = (p) => {
      const f = changedMap.get(p);
      if (f && !seen.has(p)) { seen.add(p); matched.push(f); }
    };
    const exact = changedMap.get(spec);
    if (exact) add(spec);
    listZ(['ls-files', '-z', '-m', '--', spec]).forEach(add);
    listZ(['diff', '--name-only', '-z', '--cached', '--', spec]).forEach(add);
    if (matched.length === before) unmatched.push(spec);
  }
  return { matched, unmatched };
}

function trackedPathspecs(specs) {
  const list = (specs || []).filter(Boolean);
  if (!list.length) return [];
  return listZ(['ls-files', '-z', '--', ...list]);
}

function countUntracked(spec) {
  return listZ(['ls-files', '-z', '-o', '--exclude-standard', '--', spec]).length;
}

function gitAddFiles(files, options = {}) {
  const { cwd = process.cwd() } = options;
  if (!files || !files.length) return false;
  const result = spawnSync('git', ['add', '--', ...files], { cwd, stdio: options.silent ? 'pipe' : 'inherit' });
  if (result.status !== 0) {
    const err = result.stderr ? result.stderr.toString() : 'git add failed';
    throw new Error(err.trim());
  }
  return true;
}

function gitAddPatch(files, options = {}) {
  const { cwd = process.cwd() } = options;
  const args = files && files.length ? ['add', '-p', '--', ...files] : ['add', '-p'];
  const result = spawnSync('git', args, { cwd, stdio: 'inherit' });
  return result.status === 0;
}

function restoreFiles(files, options = {}) {
  const args = ['restore'];
  if (options.patch) args.push('--patch');
  if (options.source) args.push(`--source=${options.source}`);
  if (options.staged) args.push('--staged');
  if (options.worktree) args.push('--worktree');
  if (files && files.length) args.push('--', ...files);
  const r = spawnSync('git', args, { stdio: options.interactive ? 'inherit' : 'pipe', encoding: 'utf8' });
  if (r.status !== 0) {
    if (options.interactive) return false;
    throw new Error((r.stderr || '').toString().trim() || `git ${args.join(' ')} failed`);
  }
  return true;
}

function unstageFiles(files) {
  if (!files || !files.length) return false;
  const result = spawnSync('git', ['restore', '--staged', '--', ...files], { stdio: 'pipe', encoding: 'utf8' });
  if (result.status !== 0) throw new Error((result.stderr || '').toString().trim());
  return true;
}

function discardFiles(files, options = {}) {
  if (!files || !files.length) return false;
  const changed = new Map(getChangedFiles().map(f => [f.file, f]));
  const tracked = [];
  const untracked = [];
  for (const file of files) {
    const f = changed.get(file);
    if (f && f.xy === '??') untracked.push(file);
    else tracked.push(file);
  }
  if (tracked.length) {
    const args = options.includeStaged ? ['restore', '--staged', '--worktree', '--', ...tracked] : ['restore', '--', ...tracked];
    const r = spawnSync('git', args, { stdio: 'pipe', encoding: 'utf8' });
    if (r.status !== 0) throw new Error((r.stderr || '').toString().trim());
  }
  if (untracked.length) {
    const r = spawnSync('git', ['clean', '-f', '--', ...untracked], { stdio: 'pipe', encoding: 'utf8' });
    if (r.status !== 0) throw new Error((r.stderr || '').toString().trim());
  }
  return true;
}

module.exports = {
  listZ,
  expandPathspecs,
  trackedPathspecs,
  countUntracked,
  gitAddFiles,
  gitAddPatch,
  restoreFiles,
  unstageFiles,
  discardFiles,
};
