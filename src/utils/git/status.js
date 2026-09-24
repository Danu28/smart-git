const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { runGit } = require('./run');

// mtime cache for repeated status
let _changedCache = { key: null, value: null, ts: 0 };
function invalidateChangedCache() { _changedCache = { key: null, value: null, ts: 0 }; }
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

function getCurrentBranch() {
  try { return runGit('rev-parse --abbrev-ref HEAD'); } catch { return 'unknown'; }
}

function getUpstream() {
  try { return runGit('rev-parse --abbrev-ref --symbolic-full-name @{u}', { allowError: true }); } catch { return null; }
}

function getStatusPorcelain() {
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
  const k = _cacheKey();
  const now = Date.now();
  if (k && _changedCache.key === k && (now - _changedCache.ts) < 2000 && _changedCache.value) return _changedCache.value;
  const out = runGit('status --porcelain -z', { allowError: true, raw: true }) || '';
  const files = [];
  if (!out) return files;
  const parts = out.split('\u0000').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const field = parts[i];
    const xy = field.slice(0, 2);
    const file = field.slice(3);
    if (!file) continue;
    if (xy[0] === 'R' || xy[0] === 'C') i++;
    files.push({ xy, raw: field, file, staged: xy[0] !== ' ' && xy[0] !== '?' && xy[0] !== '!', unstaged: xy[1] !== ' ' });
  }
  if (k) _changedCache = { key: k, value: files, ts: now };
  return files;
}

function getAheadBehind() {
  try {
    const { getBranchState } = require('../git-state');
    const b = getBranchState();
    if (!b.upstream) return { ahead: 0, behind: 0, hasUpstream: false };
    if (b.gone) return { ahead: 0, behind: 0, hasUpstream: false };
    return { ahead: b.ahead, behind: b.behind, hasUpstream: true };
  } catch {
    try {
      const upstream = getUpstream();
      if (!upstream) return { ahead: 0, behind: 0, hasUpstream: false };
      const out = runGit(`rev-list --left-right --count HEAD...@{u}`, { allowError: true });
      if (!out) return { ahead: 0, behind: 0, hasUpstream: true };
      const [ahead, behind] = out.split(/\s+/).map(Number);
      return { ahead, behind, hasUpstream: true };
    } catch { return { ahead: 0, behind: 0, hasUpstream: false }; }
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
  } else suggestions.push('No upstream → ' + chalk.cyan('sg sync') + ' will set upstream');
  return suggestions;
}

module.exports = {
  invalidateChangedCache,
  getCurrentBranch,
  getUpstream,
  getStatusPorcelain,
  getDiffSummary,
  getStashList,
  getChangedFiles,
  getAheadBehind,
  suggestNextSteps,
};
