const { Command } = require('commander');
const chalk = require('chalk');
const { ensureGitRepo, runGit } = require('../utils/git');
const { getOperationState, getUnmergedPaths, OP_CMDS } = require('../utils/git-state');

// `continue` is a reserved word — module var is `continueCmd`.
const continueCmd = new Command('continue')
  .description('Resume the in-progress rebase/merge/cherry-pick/revert (improves `git rebase --continue` etc.)')
  .option('--yes', 'skip the status recap')
  .action((opts) => {
    ensureGitRepo();
    const op = getOperationState();
    const conflicts = getUnmergedPaths();

    if (!op.operation) {
      if (conflicts.length) {
        console.error(chalk.red(`✖ ${conflicts.length} conflicted file(s) with no operation detected.`));
        conflicts.forEach((f) => console.error('  ' + f));
        console.error(chalk.gray('Resolve them, then finish the merge with ') + chalk.cyan('sg commit') + chalk.gray('.'));
        process.exit(1);
      }
      console.log(chalk.green('✔ Nothing to continue.'));
      return;
    }

    if (op.operation === 'bisect') {
      console.log(chalk.yellow('Bisect has no "continue" — mark progress with: ') + chalk.cyan('git bisect good|bad'));
      return;
    }

    if (conflicts.length) {
      console.error(chalk.red(`✖ ${op.operation} in progress with ${conflicts.length} conflicted file(s) — resolve each, stage it, then re-run sg continue:`));
      conflicts.forEach((f) => console.error('  ' + f));
      process.exit(1);
    }

    const step = op.step && op.total ? ` (${op.step}/${op.total})` : '';
    if (!opts.yes) console.log(chalk.gray(`→ resuming ${op.operation}${step}...`));
    // GIT_EDITOR=true: a prepared message (merge/cherry-pick) must not open a TTY.
    runGit(OP_CMDS.continue[op.operation], { env: { GIT_EDITOR: 'true' } });

    const after = getOperationState();
    if (after.operation) {
      const prog = after.step && after.total ? ` (${after.step}/${after.total})` : '';
      console.log(chalk.green(`✔ Continued — ${after.operation} still in progress${prog}.`));
      if (getUnmergedPaths().length) console.log(chalk.yellow('More conflicts: resolve, stage, re-run sg continue.'));
    } else {
      console.log(chalk.green(`✔ ${op.operation} completed.`));
    }
  });

module.exports = continueCmd;