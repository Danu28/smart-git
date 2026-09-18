const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { ensureGitRepo, runGit } = require('../utils/git');
const { UserError } = require('../utils/errors');
const { isProtected } = require('../utils/constants');

const clean = new Command('clean')
  .description('Safe clean — preview untracked files, protected-file guard, confirm before deleting (improves `git clean`) [deprecated: use sg tidy --untracked]')
  .option('--dry-run', 'show what would be deleted without prompting')
  .option('--ignored', 'also include ignored files (git clean -x)')
  .option('--yes', 'skip the confirmation prompt')
  .option('--force', 'allow deleting protected files (.env, *.pem, keys, ...)')
  .action(async (opts) => {
    console.log(chalk.yellow('⚠ sg clean is deprecated — use `sg tidy --untracked` (same flags)'));
    ensureGitRepo();
    const x = opts.ignored ? ' -x' : '';
    const previewRaw = runGit(`clean -n -d${x}`, { allowError: true, raw: true }) || '';
    const files = previewRaw.split('\n')
      .filter((l) => l.startsWith('Would remove '))
      .map((l) => l.slice('Would remove '.length))
      .filter(Boolean);
    const protectedFiles = files.filter(isProtected);
    const safe = files.filter((f) => !isProtected(f));

    console.log(chalk.bold.cyan('▸ smart clean'));
    console.log(chalk.gray('─'.repeat(40)));

    if (!files.length) {
      console.log(chalk.green('✔ Nothing to clean. Working tree tidy.'));
      return;
    }

    console.log(`${chalk.bold('Untracked')}${opts.ignored ? ' (incl. ignored)' : ''}: ${chalk.red(files.length)} file(s)`);
    if (safe.length) {
      console.log(chalk.bold('Would delete:'));
      safe.forEach((f) => console.log(`  ${chalk.gray(f)}`));
    }
    if (protectedFiles.length) {
      console.log(chalk.bold('🛡 Protected (never deleted without --force):'));
      protectedFiles.forEach((f) => console.log(`  ${chalk.yellow(f)}`));
    }

    if (opts.dryRun) {
      console.log(chalk.gray('─'.repeat(40)));
      console.log(chalk.yellow('[dry-run] No changes made'));
      return;
    }

    if (protectedFiles.length && !opts.force) {
      console.log(chalk.gray('─'.repeat(40)));
      throw new UserError(`Aborting: ${protectedFiles.length} protected file(s) may contain secrets. Re-run with --force after verifying.`);
    }
    if (opts.force && protectedFiles.length) {
      console.log(chalk.yellow(`  --force: deleting ${protectedFiles.length} protected file(s) as requested`));
    }

    if (!opts.yes) {
      const { ok } = await inquirer.prompt([{ type: 'confirm', name: 'ok', message: chalk.red(`Delete ${files.length} untracked file(s)? (irreversible)`), default: false }]);
      if (!ok) {
        console.log(chalk.yellow('Cancelled — nothing deleted.'));
        return;
      }
    }

    runGit(`clean -fd${x}`);
    console.log(chalk.green(`✔ Deleted ${files.length} file(s)`));
  });

module.exports = clean;