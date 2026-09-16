const { spawnSync } = require('child_process');
const chalk = require('chalk');

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
  const { cwd = process.cwd(), silent = false, allowError = false, raw = false } = options;
  const argv = Array.isArray(args) ? args : shellSplit(String(args));
  const result = spawnSync('git', argv, { cwd, encoding: 'utf8', stdio: 'pipe', maxBuffer: 20 * 1024 * 1024 });
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
  return runGit('status --porcelain=v1', { allowError: true }) || '';
}

function getDiffSummary(cached = false) {
  const flag = cached ? '--cached' : '';
  const out = runGit(`diff --stat ${flag}`, { allowError: true }) || '';
  return out;
}

function getStashList() {
  return runGit('stash list', { allowError: true }) || '';
}

function parsePorcelain(porcelain) {
  if (!porcelain || !porcelain.trim()) return [];
  return porcelain.split('\n').filter(Boolean).map(line => {
    const xy = line.slice(0, 2);
    const file = line.slice(3).trim();
    const displayFile = file.includes(' -> ') ? file.split(' -> ').pop().trim() : file;
    return { xy, raw: line, file: displayFile, staged: xy[0] !== ' ' && xy[0] !== '?' && xy[0] !== '!', unstaged: xy[1] !== ' ' };
  });
}

function getChangedFiles() {
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
  parsePorcelain,
  getChangedFiles,
  gitAddFiles,
  gitAddPatch,
};