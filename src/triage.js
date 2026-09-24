const chalk = require('chalk');
const { isGitRepo } = require('./utils/git');
const { getBranchState, getOperationState, getUnmergedPaths, hasCommits } = require('./utils/git-state');
const { getStatusPorcelain, getChangedFiles, runGit } = require('./utils/git');

/**
 * @typedef {Object} TriageResult
 * @property {string} mode - one of 'not-repo'|'active-op'|'dirty'|'sync-needed'|'clean'
 */

/**
 * Collect triage state without side effects (testable).
 * @param {string} [cwd]
 * @returns {Object}
 */
function getTriageState(cwd = process.cwd()) {
  if (!isGitRepo(cwd)) return { mode: 'not-repo' };
  const op = getOperationState();
  const unmerged = getUnmergedPaths();
  const b = getBranchState();
  const porcelain = getStatusPorcelain() || '';
  const dirtyCount = porcelain.split('\n').filter(Boolean).length;
  const changedFiles = dirtyCount ? getChangedFiles().slice(0, 5).map(f => f.file) : [];
  const has = hasCommits();
  let last = '';
  if (has) last = runGit('log -1 --oneline', { allowError: true }) || '';
  if (op.operation || unmerged.length) {
    return { mode: 'active-op', operation: op.operation, unmerged, branchState: b, dirtyCount, changedFiles, hasCommits: has, lastCommit: last };
  }
  if (dirtyCount) {
    return { mode: 'dirty', branchState: b, dirtyCount, changedFiles, hasCommits: has, lastCommit: last, unmerged, operation: op.operation };
  }
  if (b.behind || b.ahead) {
    return { mode: 'sync-needed', branchState: b, dirtyCount, changedFiles, hasCommits: has, lastCommit: last };
  }
  return { mode: 'clean', branchState: b, dirtyCount, changedFiles, hasCommits: has, lastCommit: last };
}

/**
 * Render triage banner and help to stdout.
 * @param {import('commander').Command} program
 */
function renderTriage(program) {
  const state = getTriageState();

  if (state.mode === 'not-repo') {
    console.log(chalk.bold.cyan('▸ smart-git triage — not a git repo'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  ${chalk.cyan('git init')}  create a new repo`);
    console.log(`  ${chalk.cyan('sg init --hooks')}  after init, install hooks`);
    console.log(chalk.gray('─'.repeat(40)));
    program.outputHelp();
    process.exit(0);
  }

  if (state.mode === 'active-op') {
    console.log(chalk.bold.cyan('▸ smart-git triage — action needed'));
    console.log(chalk.gray('─'.repeat(40)));
    if (state.operation) console.log(chalk.red(`  ⚠ ${state.operation} in progress`));
    if (state.unmerged.length) console.log(chalk.red(`  ✖ ${state.unmerged.length} conflicted: ${state.unmerged.join(', ')}`));
    console.log(`  ${chalk.cyan('sg doctor')}  diagnose,  ${chalk.cyan('sg resolve')}  pick ours/theirs,  ${chalk.cyan('sg continue')}/${chalk.cyan('sg abort')}`);
    console.log(chalk.gray('─'.repeat(40)));
    program.outputHelp();
    process.exit(0);
  }

  if (state.mode === 'dirty') {
    const b = state.branchState;
    console.log(chalk.bold.cyan('▸ smart-git triage — you have changes'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  ${chalk.yellow(state.dirtyCount + ' file(s)')} ${state.changedFiles.length ? chalk.gray(state.changedFiles.join(', ')) : ''} ${state.dirtyCount > 5 ? chalk.gray(`+${state.dirtyCount - 5} more`) : ''}`);
    if (b.behind) console.log(chalk.magenta(`  ↓ ${b.behind} behind`));
    if (b.ahead) console.log(chalk.yellow(`  ↑ ${b.ahead} ahead`));
    console.log(`  ${chalk.cyan('1')} sg status  — see what changed`);
    console.log(`  ${chalk.cyan('2')} sg diff    — staged vs unstaged`);
    console.log(`  ${chalk.cyan('3')} sg commit  — 2 prompts + AI draft (inferred)`);
    console.log(chalk.gray('─'.repeat(40)));
    program.outputHelp();
    process.exit(0);
  }

  if (state.mode === 'sync-needed') {
    const b = state.branchState;
    console.log(chalk.bold.cyan('▸ smart-git triage — sync needed'));
    console.log(chalk.gray('─'.repeat(40)));
    if (b.behind) console.log(chalk.magenta(`  ↓ ${b.behind} behind remote`));
    if (b.ahead) console.log(chalk.yellow(`  ↑ ${b.ahead} ahead`));
    console.log(`  ${chalk.cyan('sg sync')}  fetch → pull --rebase → push`);
    console.log(`  ${chalk.cyan('sg log --search <term>')}  find history`);
    console.log(chalk.gray('─'.repeat(40)));
    program.outputHelp();
    process.exit(0);
  }

  // clean
  console.log(chalk.bold.cyan('▸ smart-git triage — clean & up to date'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(chalk.green('  ✔ Working tree clean'));
  if (state.hasCommits) {
    if (state.lastCommit) console.log(`  Last: ${state.lastCommit}`);
  } else console.log(chalk.yellow('  No commits yet — sg commit to start'));
  console.log(`  ${chalk.cyan('sg log')}  history,  ${chalk.cyan('sg branch')}  branches,  ${chalk.cyan('sg guide')}  playbook`);
  console.log(chalk.gray('─'.repeat(40)));
  program.outputHelp();
  process.exit(0);
}

module.exports = { getTriageState, renderTriage };
