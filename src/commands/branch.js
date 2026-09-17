const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { ensureGitRepo, runGit, getCurrentBranch } = require('../utils/git');
const { BRANCH_PREFIXES } = require('../utils/config');

const branch = new Command('branch')
  .description('Smart branch — create with convention, switch, clean (improves `git branch`/`checkout`/`switch`)')
  .alias('br')
  .option('-c, --create <name>', 'create branch (auto-prefix help)')
  .option('-d, --delete <name>', 'delete branch (safe, checks merged)')
  .option('-D, --force-delete <name>', 'force delete branch')
  .option('-a, --all', 'list all (including remote)')
  .action(async (opts) => {
    ensureGitRepo();

    if (opts.create) {
      let name = opts.create;
      // If no prefix, prompt
      if (!BRANCH_PREFIXES.some(p => name.startsWith(p))) {
        const { prefix } = await inquirer.prompt([{ type: 'list', name: 'prefix', message: `Choose prefix for "${name}":`, choices: [...BRANCH_PREFIXES, 'no prefix'] }]);
        if (prefix !== 'no prefix') name = prefix + name;
      }
      try {
        runGit(`checkout -b "${name}"`);
      } catch (e) {
        // throw -> bin's parseAsync catch renders `✖ <msg>`, exit 1 (no stack)
        throw new Error(`Could not create branch "${name}": ${e.message}`);
      }
      console.log(chalk.green(`✔ Created and switched to branch ${chalk.bold(name)}`));
      return;
    }

    if (opts.delete) {
      // exact-line match — substring includes() would treat "feature" as merged
      // when only "feature-x" is (audit pass 2 finding 1).
      const merged = (runGit('branch --merged', { allowError: true }) || '')
        .split('\n').map(l => l.replace('*', '').trim()).filter(Boolean);
      const isMerged = merged.includes(opts.delete);
      try {
        if (!isMerged) {
          const { force } = await inquirer.prompt([{ type: 'confirm', name: 'force', message: chalk.yellow(`Branch ${opts.delete} not fully merged. Force delete?`), default: false }]);
          if (!force) { console.log(chalk.yellow('Aborted.')); return; }
          runGit(`branch -D "${opts.delete}"`);
        } else {
          runGit(`branch -d "${opts.delete}"`);
        }
      } catch (e) {
        throw new Error(`Could not delete branch "${opts.delete}": ${e.message}`);
      }
      console.log(chalk.green(`✔ Deleted branch ${opts.delete}`));
      return;
    }

    if (opts.forceDelete) {
      try {
        runGit(`branch -D "${opts.forceDelete}"`);
      } catch (e) {
        throw new Error(`Could not force-delete branch "${opts.forceDelete}": ${e.message}`);
      }
      console.log(chalk.green(`✔ Force-deleted ${opts.forceDelete}`));
      return;
    }

    // Default: list with smart info
    const current = getCurrentBranch();
    const args = opts.all ? 'branch -a' : 'branch';
    const out = runGit(args);
    console.log(chalk.bold.cyan('▸ smart branches'));
    console.log(chalk.gray('─'.repeat(40)));
    out.split('\n').forEach(line => {
      if (line.startsWith('*')) console.log(chalk.green.bold(line) + chalk.gray(' ← current'));
      else if (line.trim().startsWith('remotes/')) console.log(chalk.gray(line));
      else if (line.trim()) console.log(' ' + line.trim());
    });
    console.log(chalk.gray('─'.repeat(40)));
    console.log(chalk.gray(`Current: ${chalk.green(current)} | Use: ${chalk.cyan('sg branch --create <name>')} or ${chalk.cyan('sg cleanup')}`));
  });

module.exports = branch;
