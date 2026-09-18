const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

// ── mtime cache for repeated status (A4) ────────────────────────────────
let _changedCache = { key: null, value: null, ts: 0 };
function _cacheKey() {
  try {
    const gitDir = runGit('rev-parse --absolute-git-dir', { allowError: true });
    if (!gitDir) return null;
    const idx = path.join(gitDir, 'index');
    const head = path.join(gitDir, 'HEAD');
    const iM = fs.existsSync(idx) ? fs.statSync(idx).mtimeMs : 0;
    const hM = fs.existsSync(head) ? fs.statSync(head).mtimeMs : 0;
    return `${iM}:${hM}`;
  } catch { return null; }
}

// Tokenize a command string into an argv array WITHOUT invoking a shell.
// Handles single/double quotes and backslash escaping, strips quotes, and
// preserves backslashes inside double quotes (Windows temp paths like
// C:\Users\...\Temp\file.txt stay intact). This lets runGit use
// spawnSync('git', tokens) — eliminating every shell-injection vector
// (`& $ "` etc.) permanently (audit B8 recommendation).
function shellSplit(input) {
  const tokens = [];
  let cur = '';
  let inS = false;
  let inD = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inS) {
      if (ch === "'") inS = false;
      else cur += ch;
    } else if (inD) {
      if (ch === '"') inD = false;
      else if (ch === '\\' && input[i + 1] === '"') { cur += '"'; i++; }
      else cur += ch;
    } else {
      if (ch === "'") inS = true;
      else if (ch === '"') inD = true;
      else if (ch === '\\' && i + 1 < input.length) { cur += input[i + 1]; i++; }
      else if (/\s/.test(ch)) { if (cur) { tokens.push(cur); cur = ''; } }
      else cur += ch;
    }
  }
  if (cur) tokens.push(cur);
  return tokens;
}

function isGitRepo(cwd = process.cwd()) {
  const result = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, stdio: 'ignore' });
  return result.status === 0;
}

function ensureGitRepo() {
  if (!isGitRepo()) {
    console.error(chalk.red('✖ Not a git repository. Run `git init` first or cd into a repo.'));
    process.exit(1);
  }
}

function runGit(args, options = {}) {
  const { cwd = process.cwd(), silent = false, allowError = false, raw = false, env } = options;
  const argv = Array.isArray(args) ? args : shellSplit(String(args));
  const spawnOpts = { cwd, encoding: 'utf8', stdio: 'pipe', maxBuffer: 20 * 1024 * 1024 };
  if (env) spawnOpts.env = { ...process.env, ...env }; // e.g. GIT_EDITOR=true for non-interactive continue/autosquash
  const result = spawnSync('git', argv, spawnOpts);
  if (result.error) {
    if (allowError) return null;
    throw new Error(result.error.message.trim());
  }
  if (result.status !== 0) {
    if (allowError) return null;
    const msg = (result.stderr || result.stdout || '').toString().trim();
    throw new Error(msg || `git ${argv.join(' ')} failed (${result.status})`);
  }
  if (raw) return result.stdout || '';
  return (result.stdout || '').trim();
}

function getCurrentBranch() {
  try {
    return runGit('rev-parse --abbrev-ref HEAD');
  } catch {
    return 'unknown';
  }
}

function getUpstream() {
  try {
    return runGit('rev-parse --abbrev-ref --symbolic-full-name @{u}', { allowError: true });
  } catch {
    return null;
  }
}

function getStatusPorcelain() {
  // raw:true — runGit's .trim() would eat the leading space (X column) of the
  // FIRST porcelain line (' M file' → 'M file'), miscounting staged/unstaged.
  return runGit('status --porcelain=v1', { allowError: true, raw: true }) || '';
}

function getDiffSummary(cached = false) {
  const flag = cached ? '--cached' : '';
  const out = runGit(`diff --stat ${flag}`, { allowError: true }) || '';
  return out;
}

function getStashList() {
  return runGit('stash list', { allowError: true }) || '';
}

function getChangedFiles() {
  // mtime memo: second call within 2s and same index mtime returns cached
  const k = _cacheKey();
  const now = Date.now();
  if (k && _changedCache.key === k && (now - _changedCache.ts) < 2000 && _changedCache.value) return _changedCache.value;
  // -z format: each NUL field is "XY <path>" (path unquoted, spaces/UTF-8 safe).
  // NOTE: raw (untrimmed) output required — .trim() would eat the leading status space of field 1.
  // Renames/copies: "XY <dest>" followed by a separate NUL field with the old path (skip it).
  const out = runGit('status --porcelain -z', { allowError: true, raw: true }) || '';
  const files = [];
  if (!out) return files;
  const parts = out.split('\u0000').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const field = parts[i];
    const xy = field.slice(0, 2);
    const file = field.slice(3); // skip "XY "
    if (!file) continue;
    if (xy[0] === 'R' || xy[0] === 'C') {
      // destination is in this field; next field is the old path — skip it
      i++;
    }
    files.push({ xy, raw: field, file, staged: xy[0] !== ' ' && xy[0] !== '?' && xy[0] !== '!', unstaged: xy[1] !== ' ' });
  }
  if (k) _changedCache = { key: k, value: files, ts: now };
  return files;
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

function getAheadBehind() {
  try {
    const upstream = getUpstream();
    if (!upstream) return { ahead: 0, behind: 0, hasUpstream: false };
    const out = runGit(`rev-list --left-right --count HEAD...@{u}`, { allowError: true });
    if (!out) return { ahead: 0, behind: 0, hasUpstream: true };
    const [ahead, behind] = out.split(/\s+/).map(Number);
    return { ahead, behind, hasUpstream: true };
  } catch {
    return { ahead: 0, behind: 0, hasUpstream: false };
  }
}

function suggestNextSteps(status) {
  const suggestions = [];
  if (status.includes('??')) suggestions.push('Untracked files → ' + chalk.cyan('sg commit') + ' or ' + chalk.cyan('git add'));
  if (/^ M|^M/.test(status) || status.includes(' M')) suggestions.push('Modified files → ' + chalk.cyan('sg diff') + ' then ' + chalk.cyan('sg commit'));
  if (status.includes('UU')) suggestions.push('Merge conflicts → resolve then ' + chalk.cyan('sg commit'));
  const { ahead, behind, hasUpstream } = getAheadBehind();
  if (hasUpstream) {
    if (behind > 0) suggestions.push(`${behind} commit(s) behind → ` + chalk.cyan('sg sync'));
    if (ahead > 0) suggestions.push(`${ahead} commit(s) ahead → ` + chalk.cyan('sg sync') + ' to push');
  } else {
    suggestions.push('No upstream → ' + chalk.cyan('sg sync') + ' will set upstream');
  }
  return suggestions;
}

// ---------------------------------------------------------------------------
// Pathspec resolution — lets `sg undo` take the same arguments as
// `git restore` (".", "src/", "*.js") instead of exact file names only.
// ---------------------------------------------------------------------------

// NUL-separated path list from git — spaces/newlines/UTF-8 safe.
function listZ(args) {
  const r = spawnSync('git', args, { stdio: 'pipe', encoding: 'utf8' });
  if (r.status !== 0) return [];
  return (r.stdout || '').split('\u0000').filter(Boolean);
}

// Expand user pathspecs into the concrete CHANGED files they cover.
// Git owns pathspec semantics (globs also match "/", a directory covers its
// subtree); we intersect with the changed set so unmodified files are never
// touched. An exact path argument always matches (preserves the original
// behaviour for untracked files and renames) — a BROAD pathspec never pulls in
// untracked files, exactly like `git restore`, which leaves them alone.
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
    // tracked and modified in the worktree (includes worktree deletions)
    listZ(['ls-files', '-z', '-m', '--', spec]).forEach(add);
    // staged: index differs from HEAD — `ls-files -m` misses these entirely
    listZ(['diff', '--name-only', '-z', '--cached', '--', spec]).forEach(add);
    if (matched.length === before) unmatched.push(spec);
  }
  return { matched, unmatched };
}

// Tracked files a pathspec covers, changed or not — for `--source <ref>`, where
// the whole point is pulling an older version into a currently clean file.
function trackedPathspecs(specs) {
  const list = (specs || []).filter(Boolean);
  if (!list.length) return [];
  return listZ(['ls-files', '-z', '--', ...list]);
}

// How many untracked files a pathspec covers (used to explain "no changes"
// verdicts — git restore deliberately leaves untracked files alone).
function countUntracked(spec) {
  return listZ(['ls-files', '-z', '-o', '--exclude-standard', '--', spec]).length;
}

// Low-level `git restore` pass-through (used for --source / --patch). Mirrors
// git's target rules: neither flag = worktree, --staged = index only,
// --staged + --worktree = both.
function restoreFiles(files, options = {}) {
  const args = ['restore'];
  if (options.patch) args.push('--patch');
  if (options.source) args.push(`--source=${options.source}`);
  if (options.staged) args.push('--staged');
  if (options.worktree) args.push('--worktree');
  if (files && files.length) args.push('--', ...files);
  const r = spawnSync('git', args, { stdio: options.interactive ? 'inherit' : 'pipe', encoding: 'utf8' });
  if (r.status !== 0) {
    // interactive: git already explained itself on the inherited terminal
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
    // includeStaged: also drop the index copy (true "discard ALL changes").
    // Without it, only the worktree is restored and the staged version survives.
    const args = options.includeStaged
      ? ['restore', '--staged', '--worktree', '--', ...tracked]
      : ['restore', '--', ...tracked];
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
  isGitRepo,
  ensureGitRepo,
  runGit,
  shellSplit,
  getCurrentBranch,
  getUpstream,
  getStatusPorcelain,
  getDiffSummary,
  getStashList,
  getAheadBehind,
  suggestNextSteps,
  getChangedFiles,
  gitAddFiles,
  gitAddPatch,
  unstageFiles,
  discardFiles,
  expandPathspecs,
  trackedPathspecs,
  countUntracked,
  restoreFiles,
};