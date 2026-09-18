const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { ensureGitRepo, runGit } = require('../utils/git');
const { appendPatterns, isDirectoryEntry } = require('../utils/gitignore');
const { UserError } = require('../utils/errors');

const untrack = new Command('untrack')
  .description('Stop tracking files while keeping them on disk; offers a .gitignore entry (improves `git rm --cached`)')
  .argument('<paths...>', 'files or directories to untrack (e.g. sg untrack .env dist/)')
  .option('--no-gitignore', 'skip the .gitignore offer')
  .option('--yes', 'auto-confirm adding to .gitignore')
  .action(async (paths, opts) => {
    ensureGitRepo();

    const valid = [];
    for (const p of paths) {
      const tracked = runGit(['ls-files', '--error-unmatch', '--', p], { allowError: true }) !== null;
      if (!tracked) console.log(chalk.yellow(`  ✖ "${p}" is not tracked — nothing to do`));
      else valid.push(p);
    }
    if (!valid.length) {
      throw new UserError('None of the given paths are tracked.');
    }

    console.log(chalk.gray(`→ git rm --cached -r -- ${valid.join(' ')}`));
    runGit(['rm', '--cached', '-r', '--', ...valid]);
    console.log(chalk.green(`✔ Untracked ${valid.length} path(s) — files stay on disk`));

    if (opts.gitignore === false) {
      console.log(chalk.gray('(.gitignore untouched — --no-gitignore)'));
      return;
    }

    const entries = valid.map((p) => isDirectoryEntry(p));
    if (!opts.yes) {
      const { ok } = await inquirer.prompt([{
        type: 'confirm',
        name: 'ok',
        message: `Add ${entries.join(', ')} to .gitignore so it stays untracked?`,
        default: true,
      }]);
      if (!ok) {
        console.log(chalk.yellow('OK — not added to .gitignore.'));
        return;
      }
    }
    const res = appendPatterns(entries);
    if (res.added.length) console.log(chalk.green(`✔ Added to .gitignore: ${res.added.join(', ')}`));
    else console.log(chalk.gray('Already in .gitignore.'));
  });

module.exports = untrack;