const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { ensureGitRepo, runGit } = require('../utils/git');
const { getOperationState, OP_CMDS } = require('../utils/git-state');

const abort = new Command('abort')
  .description('Abort the in-progress rebase/merge/cherry-pick/revert/bisect back to the pre-operation state (improves `git rebase --abort` etc.)')
  .option('--yes', 'skip confirmation')
  .action(async (opts) => {
    ensureGitRepo();
    const op = getOperationState();
    if (!op.operation) {
      console.log(chalk.green('✔ Nothing to abort.'));
      return;
    }

    if (op.operation === 'bisect') {
      // bisect reset discards nothing of value — no confirm needed
      runGit('bisect reset');
      console.log(chalk.green('✔ Bisect reset — back to your original commit.'));
      return;
    }

    const cmd = OP_CMDS.abort[op.operation];
    if (!opts.yes) {
      const { ok } = await inquirer.prompt([{
        type: 'confirm',
        name: 'ok',
        message: chalk.red(`Abort ${op.operation}? Working changes from it will be discarded.`),
        default: false,
      }]);
      if (!ok) {
        console.log(chalk.yellow('Cancelled — nothing aborted.'));
        return;
      }
    }

    runGit(cmd, { env: { GIT_EDITOR: 'true' } });
    if (getOperationState().operation) {
      console.error(chalk.red(`✖ Could not abort ${op.operation} — check the state with ${chalk.cyan('sg doctor')}.`));
      process.exit(1);
    }
    console.log(chalk.green(`✔ ${op.operation} aborted — back to pre-operation state.`));
  });

module.exports = abort;