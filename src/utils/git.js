const run = require('./git/run');
const status = require('./git/status');
const pathspec = require('./git/pathspec');

// Shim — preserves require('../utils/git') API but delegates to modular files.
// See src/utils/git/{run,status,pathspec}.js for actual implementations.
// This file exists for backward compat; new code may import submodules directly.
// Canonical source is git-state#getBranchState (config-based, distinguishes gone). getBranchState

module.exports = {
  // run.js
  shellSplit: run.shellSplit,
  isGitRepo: run.isGitRepo,
  ensureGitRepo: run.ensureGitRepo,
  runGit: run.runGit,
  // status.js
  invalidateChangedCache: status.invalidateChangedCache,
  getCurrentBranch: status.getCurrentBranch,
  getUpstream: status.getUpstream,
  getStatusPorcelain: status.getStatusPorcelain,
  getDiffSummary: status.getDiffSummary,
  getStashList: status.getStashList,
  getChangedFiles: status.getChangedFiles,
  getAheadBehind: status.getAheadBehind,
  suggestNextSteps: status.suggestNextSteps,
  // pathspec.js
  expandPathspecs: pathspec.expandPathspecs,
  trackedPathspecs: pathspec.trackedPathspecs,
  countUntracked: pathspec.countUntracked,
  gitAddFiles: pathspec.gitAddFiles,
  gitAddPatch: pathspec.gitAddPatch,
  restoreFiles: pathspec.restoreFiles,
  unstageFiles: pathspec.unstageFiles,
  discardFiles: pathspec.discardFiles,
};
