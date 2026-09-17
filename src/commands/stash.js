const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { ensureGitRepo, runGit } = require('../utils/git');

const stash = new Command('stash')
  .description('Smart stash — interactive list, push, pop, apply, drop (improves `git stash`)')
  .option('--list', 'list stashes (default)')
  .option('--push <msg>', 'push stash')
  .option('--pop', 'pop latest stash')
  .option('--clear', 'clear all stashes (confirm)')
  .action(async (opts) => {
    ensureGitRepo();
    if (opts.push) {
      const msg = opts.push === true ? 'smart-git stash' : opts.push;
      runGit(`stash push -m "${msg.replace(/"/g,'\\"')}"`);
      console.log(chalk.green(`✔ Stashed: ${msg}`));
      return;
    }
    if (opts.pop) {
      const list = runGit('stash list', { allowError: true }) || '';
      if (!list.trim()) {
        console.log(chalk.yellow('No stashes to pop.'));
        return;
      }
      try {
        runGit('stash pop');
        console.log(chalk.green('✔ Popped latest stash'));
      } catch (e) {
        console.error(chalk.red('✖ stash pop failed:'), e.message);
        console.log(chalk.yellow('  Likely conflicts — resolve them, then run `git stash drop` to finalize.'));
      }
      return;
    }
    if (opts.clear) {
      const { ok } = await inquirer.prompt([{ type: 'confirm', name: 'ok', message: chalk.red('Clear ALL stashes?'), default: false }]);
      if (!ok) return;
      runGit('stash clear');
      console.log(chalk.green('✔ Cleared all stashes'));
      return;
    }

    const list = runGit('stash list', { allowError: true }) || '';
    console.log(chalk.bold.cyan('▸ smart stash'));
    console.log(chalk.gray('─'.repeat(40)));
    if (!list.trim()) {
      console.log(chalk.gray('No stashes'));
      console.log(chalk.gray(`Use ${chalk.cyan('sg stash --push "msg"')} to create one`));
      return;
    }
    console.log(list);
    console.log(chalk.gray('─'.repeat(40)));
    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'Action:',
      choices: [
        { name: 'pop latest', value: 'pop' },
        { name: 'apply (keep stash)', value: 'apply' },
        { name: 'drop latest', value: 'drop' },
        { name: 'show stash@0 diff', value: 'show' },
        { name: 'cancel', value: 'cancel' },
      ]
    }]);
    if (action === 'cancel') return;
    if (action === 'pop') { runGit('stash pop'); console.log(chalk.green('✔ Popped')); }
    if (action === 'apply') { runGit('stash apply'); console.log(chalk.green('✔ Applied')); }
    if (action === 'drop') { runGit('stash drop'); console.log(chalk.green('✔ Dropped stash@0')); }
    if (action === 'show') { console.log(runGit('stash show -p stash@0', { allowError: true })); }
  });

module.exports = stash;
