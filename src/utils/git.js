const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

function isGitRepo(cwd = process.cwd()) {
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function ensureGitRepo() {
  if (!isGitRepo()) {
    console.error(chalk.red('✖ Not a git repository. Run `git init` first or cd into a repo.'));
    process.exit(1);
  }
}

function runGit(args, options = {}) {
  const { cwd = process.cwd(), silent = false, allowError = false } = options;
  try {
    const cmd = `git ${args}`;
    const out = execSync(cmd, { cwd, encoding: 'utf8', stdio: silent ? 'pipe' : undefined });
    return (out || '').trim();
  } catch (e) {
    if (allowError) return null;
    const msg = e.stderr ? e.stderr.toString() : e.message;
    throw new Error(msg.trim());
  }
}

function runGitLive(args, options = {}) {
  const { cwd = process.cwd() } = options;
  const result = spawnSync('git', args.split(' '), { cwd, stdio: 'inherit', shell: false });
  return result.status === 0;
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
  runGitLive,
  getCurrentBranch,
  getUpstream,
  getStatusPorcelain,
  getDiffSummary,
  getStashList,
  getAheadBehind,
  suggestNextSteps,
};
