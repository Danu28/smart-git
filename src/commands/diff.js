const { Command } = require('commander');
const chalk = require('chalk');
const { ensureGitRepo, runGit } = require('../utils/git');

const diff = new Command('diff')
  .description('Smart diff — summary + staged/unstaged split with stats (improves `git diff`)')
  .option('--staged', 'show staged only')
  .option('--stat', 'show stat only')
  .option('--check', 'summary only, no patch')
  .action((opts) => {
    ensureGitRepo();
    console.log(chalk.bold.cyan('▸ smart diff'));
    console.log(chalk.gray('─'.repeat(40)));

    const stagedStat = runGit('diff --cached --stat', { allowError: true }) || '(no staged)';
    const unstagedStat = runGit('diff --stat', { allowError: true }) || '(no unstaged)';
    const untracked = runGit('ls-files --others --exclude-standard', { allowError: true }) || '';

    console.log(chalk.bold('Staged:'));
    console.log(chalk.yellow(stagedStat));
    console.log(chalk.bold('Unstaged:'));
    console.log(chalk.red(unstagedStat));
    if (untracked) {
      console.log(chalk.bold('Untracked:'));
      console.log(chalk.gray(untracked.split('\n').map(f=>`  ? ${f}`).join('\n')));
    }

    if (opts.check) return;

    if (opts.stat) {
      // already shown
      return;
    }

    const target = opts.staged ? '--cached' : '';
    const patch = runGit(`diff ${target} --color=always | head -n 200`, { allowError: true });
    if (patch && patch.trim()) {
      console.log(chalk.gray('─'.repeat(40)));
      console.log(patch);
      if (patch.split('\n').length >= 200) console.log(chalk.gray('... truncated, use `git diff` for full patch'));
    }
  });

module.exports = diff;
