const fs = require('node:fs');
const path = require('node:path');
const { runGit } = require('./git');

// Shared repo-state introspection, used by `sg doctor`, `sg status` and any
// future continue/abort command. Everything here is read-only: we only look
// at .git sentinel files and porcelain output, never mutate anything.

function getGitDir() {
  try { return runGit('rev-parse --absolute-git-dir'); } catch { return null; }
}

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function readFile(p) {
  try { return fs.readFileSync(p, 'utf8').trim(); } catch { return ''; }
}

// ── In-progress operations ────────────────────────────────────────────────

function getRebaseProgress(gitDir) {
  // interactive rebase: .git/rebase-merge/{msgnum,end}; non-interactive:
  // .git/rebase-apply/{next,last}. During a rebase these coexist with
  // CHERRY_PICK_HEAD, so they are checked BEFORE the sentinel files.
  const mergeDir = path.join(gitDir, 'rebase-merge');
  if (exists(mergeDir)) {
    return { kind: 'rebase', step: readFile(path.join(mergeDir, 'msgnum')) || null, total: readFile(path.join(mergeDir, 'end')) || null };
  }
  const applyDir = path.join(gitDir, 'rebase-apply');
  if (exists(applyDir)) {
    return { kind: 'rebase', step: readFile(path.join(applyDir, 'next')) || null, total: readFile(path.join(applyDir, 'last')) || null };
  }
  return null;
}

function getOperationState() {
  const gitDir = getGitDir();
  if (!gitDir) return { operation: null };
  const rebase = getRebaseProgress(gitDir);
  if (rebase) return { operation: 'rebase', ...rebase };
  if (exists(path.join(gitDir, 'MERGE_HEAD'))) return { operation: 'merge' };
  if (exists(path.join(gitDir, 'CHERRY_PICK_HEAD'))) return { operation: 'cherry-pick' };
  if (exists(path.join(gitDir, 'REVERT_HEAD'))) return { operation: 'revert' };
  if (exists(path.join(gitDir, 'BISECT_LOG'))) return { operation: 'bisect' };
  return { operation: null };
}

// Paths currently in conflict (unmerged in the index). Works during
// rebase/merge/cherry-pick and for plain `git merge` conflicts.
function getUnmergedPaths() {
  const out = runGit('diff --name-only --diff-filter=U', { allowError: true }) || '';
  return out.split('\n').filter(Boolean);
}

// ── Branch state ──────────────────────────────────────────────────────────

function getBranchState() {
  // symbolic-ref -q --short fails (status 1) when HEAD is detached → null.
  const head = runGit('symbolic-ref -q --short HEAD', { allowError: true });
  const detached = head === null;
  let short = null;
  if (detached) short = runGit('rev-parse --short HEAD', { allowError: true });
  if (!head) return { head, detached, short, upstream: null, gone: false, ahead: 0, behind: 0 };

  // precision upstream check: read branch.<name>.remote + .merge from config
  // instead of @{u}, so a deleted remote branch ("gone") is distinguishable
  // from "never had an upstream".
  const remote = runGit(`config --get branch.${head}.remote`, { allowError: true });
  const merge = runGit(`config --get branch.${head}.merge`, { allowError: true });
  if (!remote || !merge) return { head, detached, short, upstream: null, gone: false, ahead: 0, behind: 0 };

  const remoteBranch = merge.replace(/^refs\/heads\//, '');
  const upstream = `${remote}/${remoteBranch}`;
  const gone = runGit(`show-ref --verify --quiet refs/remotes/${remote}/${remoteBranch}`, { allowError: true }) === null;
  let ahead = 0, behind = 0;
  if (!gone) {
    // rev-list --left-right --count A...B → "<behind> <ahead>"
    const ab = runGit(`rev-list --left-right --count refs/remotes/${remote}/${remoteBranch}...HEAD`, { allowError: true }) || '';
    const [l, r] = ab.split(/\s+/).map(Number);
    behind = l || 0;
    ahead = r || 0;
  }
  return { head, detached, short, upstream, gone, ahead, behind };
}

// ── Misc health signals ───────────────────────────────────────────────────

function isShallowClone() {
  const gitDir = getGitDir();
  return !!(gitDir && exists(path.join(gitDir, 'shallow')));
}

function hasCommits() {
  return runGit('rev-parse --verify HEAD', { allowError: true }) !== null;
}

// Exact commands for resuming / aborting each in-progress operation. Single
// source of truth shared by `sg doctor` (hints), `sg continue` and `sg abort`.
const OP_CMDS = {
  continue: {
    rebase: 'rebase --continue',
    merge: 'merge --continue',
    'cherry-pick': 'cherry-pick --continue',
    revert: 'revert --continue',
    bisect: null, // no continue — doctor falls back to `git bisect good|bad`
  },
  abort: {
    rebase: 'rebase --abort',
    merge: 'merge --abort',
    'cherry-pick': 'cherry-pick --abort',
    revert: 'revert --abort',
    bisect: 'bisect reset',
  },
};

module.exports = {
  getGitDir,
  getOperationState,
  getRebaseProgress,
  getUnmergedPaths,
  getBranchState,
  isShallowClone,
  hasCommits,
  OP_CMDS,
};