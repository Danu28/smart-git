const { Command } = require('commander');
const chalk = require('chalk');
const { ensureGitRepo, runGit, getStashList, getStatusPorcelain, suggestNextSteps } = require('../utils/git');
const { getBranchState } = require('../utils/git-state');

const status = new Command('status')
  .description('Smarter git status — colored, ahead/behind, stash, suggestions (improves `git status`)')
  .alias('st')
  .option('--porcelain', 'raw porcelain output')
  .action((opts) => {
    ensureGitRepo();
    if (opts.porcelain) {
      console.log(runGit('status --porcelain', { raw: true }));
      return;
    }

    // One-shot branchState (A2) — replaces 3 serial spawns with single rev-list
    const bState = getBranchState();
    const branch = bState.detached ? (bState.short || 'detached') : (bState.head || 'unknown');
    const upstream = bState.upstream;
    const ahead = bState.ahead;
    const behind = bState.behind;
    const hasUpstream = !!bState.upstream && !bState.gone;
    const porcelain = getStatusPorcelain();
    const stash = getStashList();

    console.log(chalk.bold.cyan('▸ smart-git status'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`${chalk.bold('Branch:')} ${chalk.green(branch)} ${hasUpstream ? chalk.gray(`↔ ${upstream}`) : chalk.yellow('(no upstream)')}`);
    if (hasUpstream) {
      const ab = [];
      if (ahead) ab.push(chalk.yellow(`↑${ahead} ahead`));
      if (behind) ab.push(chalk.magenta(`↓${behind} behind`));
      if (ab.length) console.log(`${chalk.bold('Sync:')} ${ab.join(' ')}`);
      else console.log(`${chalk.bold('Sync:')} ${chalk.green('up to date')}`);
    }

    // Parse porcelain
    const lines = porcelain ? porcelain.split('\n').filter(Boolean) : [];
    const staged = lines.filter(l => l[0] !== ' ' && l[0] !== '?' && l[0] !== '!');
    const unstaged = lines.filter(l => l[1] !== ' ' && l[1] !== '?');
    const untracked = lines.filter(l => l.startsWith('??'));

    console.log(`${chalk.bold('Staged:')} ${staged.length ? chalk.yellow(staged.length) : chalk.gray('0')}`);
    console.log(`${chalk.bold('Unstaged:')} ${unstaged.length ? chalk.red(unstaged.length) : chalk.gray('0')}`);
    console.log(`${chalk.bold('Untracked:')} ${untracked.length ? chalk.red(untracked.length) : chalk.gray('0')}`);
    console.log(`${chalk.bold('Stashes:')} ${stash ? chalk.cyan(stash.split('\n').length) : chalk.gray('0')}`);

    if (porcelain) {
      console.log(chalk.gray('─'.repeat(40)));
      // Pretty print
      lines.forEach(l => {
        const x = l[0], y = l[1], file = l.slice(3);
        let icon = ' ';
        let color = chalk.gray;
        if (x === '?' ) { icon = '?'; color = chalk.red; }
        else if (x === 'M' || y === 'M') { icon = '●'; color = y === 'M' ? chalk.red : chalk.yellow; }
        else if (x === 'A') { icon = '+'; color = chalk.green; }
        else if (x === 'D') { icon = '-'; color = chalk.red; }
        else if (x === 'R') { icon = '→'; color = chalk.cyan; }
        else if (x === 'U') { icon = '✖'; color = chalk.redBright; }
        console.log(color(` ${icon} ${l}`));
      });
    } else {
      console.log(chalk.green('✔ Working tree clean'));
    }

    // Last commit
    try {
      const last = runGit('log -1 --oneline --color=always', { allowError: true });
      if (last) console.log(`${chalk.bold('Last:')} ${last}`);
    } catch {}

    const suggestions = suggestNextSteps(porcelain);
    if (suggestions.length) {
      console.log(chalk.gray('─'.repeat(40)));
      console.log(chalk.bold('Suggestions:'));
      suggestions.forEach(s => console.log(chalk.gray('  • ') + s));
    }
    console.log();
  });

module.exports = status;
