const { Command } = require('commander');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { ensureGitRepo, getChangedFiles } = require('../utils/git');
const { readPatterns, appendPatterns, findTrackedMatches } = require('../utils/gitignore');

const ignore = new Command('ignore')
  .description('Add patterns to .gitignore with dedupe and tracked-file warnings (improves editing .gitignore)')
  .argument('[patterns...]', 'patterns to append (e.g. sg ignore "*.log" dist/)')
  .option('--from-status', 'pick untracked files from git status to ignore')
  .action(async (patterns, opts) => {
    ensureGitRepo();

    // bare `sg ignore` lists the current .gitignore
    if (!patterns.length && !opts.fromStatus) {
      const current = readPatterns();
      console.log(chalk.bold.cyan('▸ smart ignore'));
      console.log(chalk.gray('─'.repeat(40)));
      if (current.length) {
        console.log(chalk.bold('.gitignore:'));
        current.forEach((l) => console.log(`  ${chalk.gray(l)}`));
      } else {
        console.log(chalk.yellow('No .gitignore yet — add a pattern: ') + chalk.cyan('sg ignore "*.log"'));
      }
      return;
    }

    let toAdd = patterns.map((p) => String(p));
    if (opts.fromStatus) {
      const untracked = getChangedFiles().filter((f) => f.xy === '??').map((f) => f.file);
      if (!untracked.length) {
        console.log(chalk.green('✔ No untracked files to ignore.'));
        return;
      }
      const { selected } = await inquirer.prompt([{
        type: 'checkbox',
        name: 'selected',
        message: 'Select untracked files to ignore:',
        choices: untracked.map((f) => ({ name: f, value: f })),
        validate: (v) => v.length > 0 || 'Select at least one file',
      }]);
      toAdd = selected;
    }
    if (!toAdd.length) return;

    for (const p of toAdd) {
      const matches = findTrackedMatches(p);
      if (matches.length) {
        console.log(chalk.yellow(`  ⚠ "${p}" matches tracked file(s): ${matches.join(', ')} — ignore won't apply until untracked: `) + chalk.cyan(`sg untrack ${matches[0]}`));
      }
    }

    const res = appendPatterns(toAdd);
    console.log(chalk.green(`✔ Added ${res.added.length} pattern(s) to .gitignore`));
    if (res.existing.length) console.log(chalk.gray(`  already present: ${res.existing.join(', ')}`));
  });

module.exports = ignore;